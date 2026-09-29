/**
 * authn.service.ts — registration + login orchestration on the new model.
 *
 * docs/design/identity-platform-architecture.md §4 (login = identifier+password OR phone code),
 * §13.1 (register → User + personal Org + default Workspace + owner@both),
 * §13.2 (central session). Composes service-account (credentials), service-organization
 * (org provisioning + active-org context), the TokenService (4.2) and SessionService.
 *
 * Replaces the old service-iam AccountAuthService + tenant-provisioning paths.
 */
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import { AccountService, type UserView } from "@vxture/service-account";
import { UserOnboardingService } from "./user-onboarding.service";
import { MailService, VerifyCodeService } from "@vxture/service-mail";
import {
  ActiveContextService,
  type ProvisionedOrg,
} from "@vxture/service-organization";
import { PhoneCodeService } from "@vxture/service-sms";
import { TokenService } from "../token/token.service";
import { PasswordResetRepository } from "./password-reset.repository";
import { SessionService } from "./session.service";

/** Password-reset link lifetime (matches the email copy + the table design). */
const RESET_TTL_SECONDS = 15 * 60;

export interface RegisterInput {
  account?: string | null;
  email?: string | null;
  phone: string;
  password?: string | null;
  name?: string | null;
}

export interface LoginContext {
  clientId: string;
  realm?: "customer" | "workforce";
  authMethod: string;
  ip?: string | null;
  userAgent?: string | null;
  activeOrgHint?: string;
}

export interface LoginResult {
  sid: string;
  accessToken: string;
  refreshToken: string;
  user: UserView;
  activeOrg: string | null;
  activeWorkspace: string | null;
  roles: string[];
}

@Injectable()
export class AuthnService {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(UserOnboardingService)
    private readonly onboarding: UserOnboardingService,
    @Inject(ActiveContextService)
    private readonly activeContext: ActiveContextService,
    @Inject(TokenService) private readonly token: TokenService,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(PhoneCodeService) private readonly phoneCode: PhoneCodeService,
    @Inject(PasswordResetRepository)
    private readonly passwordReset: PasswordResetRepository,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(VerifyCodeService) private readonly emailCode: VerifyCodeService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** §13.1: create User (Argon2id) + personal Org + default Workspace + owner@both. */
  async register(
    input: RegisterInput,
  ): Promise<{ user: UserView } & ProvisionedOrg> {
    const user = await this.account.createUser({
      account: input.account ?? null,
      email: input.email ?? null,
      phone: input.phone,
      password: input.password ?? null,
      name: input.name ?? null,
      phoneVerified: true,
    });
    const provisioned = await this.onboarding.onboardNewUser(user, input.name);
    return { user, ...provisioned };
  }

  /** Identifier (account|email|phone) + password. Returns the user or null. */
  loginWithPassword(
    identifier: string,
    password: string,
  ): Promise<UserView | null> {
    return this.account.verifyCredential(identifier, password);
  }

  /**
   * Phone + SMS code. Phone-code login doubles as registration: an unknown phone
   * creates the user + personal org (the phone is a verified anchor).
   */
  async loginWithPhoneCode(
    phone: string,
    code: string,
  ): Promise<{ user: UserView; isNew: boolean }> {
    const verified = await this.phoneCode.verifyCode(phone, code, {
      scope: "tenant-auth",
    });
    if (!verified) throw new UnauthorizedException("invalid_phone_code");

    const existing = await this.account.findUserByIdentifier(phone);
    if (existing) {
      const user: UserView = {
        id: existing.id,
        account: existing.account,
        email: existing.email,
        phone: existing.phone,
        name: existing.name,
        status: existing.status,
        avatarHash: existing.avatarHash,
      };
      return { user, isNew: false };
    }
    const user = await this.account.createUser({ phone, phoneVerified: true });
    await this.onboarding.onboardNewUser(user);
    return { user, isNew: true };
  }

  /** Send an email login code (reuses the shared email verify-code service). */
  sendEmailCode(email: string): Promise<void> {
    return this.emailCode.sendCode(email);
  }

  /**
   * Email + email code. Unlike phone-code login this NEVER auto-registers
   * (D-CB, identity-platform-account.md): the code only proves control of the
   * address, so a login succeeds only for an existing account that has this
   * exact email bound. Throws on a bad/expired code; returns null when the
   * (controlled) email maps to no account so the caller can say "not registered"
   * — that reveals nothing about other users (the requester owns the address).
   */
  async loginWithEmailCode(
    email: string,
    code: string,
  ): Promise<UserView | null> {
    const normalized = email.toLowerCase().trim();
    const verified = await this.emailCode.verifyCode(normalized, code);
    if (!verified) throw new UnauthorizedException("invalid_email_code");

    const existing = await this.account.findUserByIdentifier(normalized);
    if (!existing || existing.email?.toLowerCase() !== normalized) {
      return null;
    }
    return {
      id: existing.id,
      account: existing.account,
      email: existing.email,
      phone: existing.phone,
      name: existing.name,
      status: existing.status,
      avatarHash: existing.avatarHash,
    };
  }

  /** Establish the central session and issue tokens with the active-org claim context. */
  async completeLogin(user: UserView, ctx: LoginContext): Promise<LoginResult> {
    const realm = ctx.realm ?? "customer";
    const session = await this.session.create({
      userId: user.id,
      realm,
      authMethod: ctx.authMethod,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    const context = await this.activeContext.resolveActiveContext(
      user.id,
      ctx.activeOrgHint,
    );
    const accessToken = this.token.issueAccessToken({
      sub: `usr_${user.id}`,
      audience: ctx.clientId,
      sessionId: session.sid,
      activeOrg: context?.activeOrg ?? null,
      activeOrgType: context?.activeOrgType ?? null,
      activeOrgName: context?.activeOrgName ?? null,
      activeWorkspace: context?.activeWorkspace ?? null,
      activeWorkspaceName: context?.activeWorkspaceName ?? null,
      roles: context?.roles ?? [],
      userType: "tenant_user",
    });
    const refreshToken = await this.token.issueRefreshToken({
      userId: user.id,
      sessionId: session.sid,
      clientId: ctx.clientId,
    });
    return {
      sid: session.sid,
      accessToken,
      refreshToken,
      user,
      activeOrg: context?.activeOrg ?? null,
      activeWorkspace: context?.activeWorkspace ?? null,
      roles: context?.roles ?? [],
    };
  }

  /**
   * Email-link password reset request (§6.1 / D-BE=A). Looks the user up by email
   * and, only when one with an email exists, issues a one-time token and mails the
   * reset link. No-ops silently otherwise — the caller always returns 200 so the
   * endpoint can't be used to probe which emails are registered.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = email.toLowerCase().trim();
    const user = await this.account.findUserByIdentifier(normalized);
    if (!user || !user.email) return;
    const raw = await this.passwordReset.issue(user.id, RESET_TTL_SECONDS);
    const base = this.config.platform.LOGIN_UI_BASE_URL.replace(/\/$/, "");
    const resetUrl = `${base}/reset-password?token=${raw}`;
    // Delivery failure must not surface to the caller (anti-enumeration: same 200
    // either way) nor 500 the request — the token simply expires unused.
    try {
      await this.mail.sendPasswordReset(user.email, resetUrl);
    } catch (err) {
      console.error(
        "[authn] password-reset mail send failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Consume a reset token and set the new password (Argon2id). Returns false when
   * the token is unknown / expired / already used (caller maps to 400).
   */
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const userId = await this.passwordReset.consume(token);
    if (!userId) return false;
    /*
     * 通知在写路径里（AccountService.setPassword），不在这一层：这条路此前**既不落审计行
     * 也不发任何消息**，而它正是账号被接管时真正会被走的那一条——凭据被重置令牌改掉，
     * 本人一句话都收不到。判据建在审计行上会静默漏掉恰好最要紧的这一条（这里与
     * website-bff 的改密路径都没有审计行），所以交代来由、由写路径自己发。
     * 收件箱与邮件能不能真的送出去，取决于本进程有没有装通知分发器——见交付说明。
     */
    await this.account.setPassword(userId, newPassword, {
      cause: "reset_by_email",
    });
    return true;
  }
}
