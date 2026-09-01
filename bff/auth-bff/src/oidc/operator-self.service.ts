/**
 * operator-self.service.ts — operator SELF-service account management, authorized
 * by the operator central session cookie (vx_sid_op).
 * @package @vxture/bff-auth
 *
 * Phase B(收敛到身份层,2026-09-02):运营者本人的账户自助(读身份、改邮箱)统一收口在
 * 身份层。此前只有 admin-bff 的 RP 会话代理到 `internal/operator/accounts/:id/contact/
 * email/*`(内部 token + body 自证);本服务把同一套逻辑改为**浏览器直连、`vx_sid_op`
 * cookie 鉴权**,与 operator-webauthn.service 同一 guard 模式(`resolveOperatorId`),供
 * accounts 门户「个人信息」页同源调用,三门户 popover 深链于此。
 *
 * 只覆盖 whoami + 改邮箱(B.1)。改手机/改密码/MFA 自助是 net-new 流程(B.2)。
 * 写入面(admin.operator_account)只经 PgOperatorRepository,与内部委托路径同一张表。
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import { PhoneCodeService } from "@vxture/service-sms";
import { RedisService } from "../redis/redis.service";
import { OperatorRefreshTokenRepository } from "../token/operator-refresh-token.repository";

/** operator central-session `sub` prefix (workforce realm). Mirrors webauthn service. */
const OPERATOR_SUB_PREFIX = "opr_";
/** pending contact-change TTL — matches operator-admin-internal.router. */
const OPERATOR_CONTACT_TTL_SECONDS = 10 * 60;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** 国内裸 11 位手机号(与租户侧同口径)。 */
const PHONE_RE = /^1\d{10}$/;
/** operator 密码下限,与 operator-public.router 的重置口径一致(12)。 */
const OPERATOR_PASSWORD_MIN = 12;

/** Mask an email for API responses: b***@example.com. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const head = local?.slice(0, 1) ?? "";
  return `${head}***@${domain ?? ""}`;
}

/** Mask a phone for API responses: 138****8000. */
function maskPhone(phone: string): string {
  return phone.length >= 7
    ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
    : phone;
}

export interface OperatorSelfView {
  username: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  /** 角色码(role_code);展示用,不做鉴权。 */
  role: string;
}

@Injectable()
export class OperatorSelfService {
  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PhoneCodeService) private readonly phoneCode: PhoneCodeService,
    @Inject(OperatorRefreshTokenRepository)
    private readonly refreshTokens: OperatorRefreshTokenRepository,
  ) {}

  /**
   * Resolve the operator id from the central session cookie; 401 otherwise.
   * Identical guard to OperatorWebauthnService — the browser must already hold a
   * workforce-realm `vx_sid_op` session.
   */
  private async resolveOperatorId(sid: string | undefined): Promise<string> {
    if (!sid) throw new UnauthorizedException("operator_session_required");
    const session = await this.redis.getOidcSession(sid);
    if (
      !session ||
      session.realm !== "workforce" ||
      !session.sub.startsWith(OPERATOR_SUB_PREFIX)
    ) {
      throw new UnauthorizedException("operator_session_required");
    }
    return session.sub.slice(OPERATOR_SUB_PREFIX.length);
  }

  /** Read the authenticated operator's own account view (no secret material). */
  async getSelf(sid: string | undefined): Promise<OperatorSelfView> {
    const operatorId = await this.resolveOperatorId(sid);
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    return {
      username: view.username,
      email: view.email,
      emailVerified: view.emailVerified,
      phone: view.phone,
      phoneVerified: view.phoneVerified,
      role: view.roleCode,
    };
  }

  /**
   * Self-service email change — step 1: send a 6-digit code to the NEW address
   * (proving ownership). Nothing is mutated here; a pending record is parked in
   * Redis (short TTL). Same logic as the internal delegation path, but authorized
   * by the session cookie instead of an internal token + body self-assertion.
   */
  async startEmailChange(
    sid: string | undefined,
    newEmailRaw: string | undefined,
  ): Promise<{ ok: true; sentTo: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newEmail = (newEmailRaw ?? "").trim().toLowerCase();
    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      throw new BadRequestException("invalid_email");
    }
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    const code = String(randomInt(100000, 1000000));
    await this.redis.storeOperatorContactChange(
      operatorId,
      "email",
      newEmail,
      code,
      OPERATOR_CONTACT_TTL_SECONDS,
    );
    await this.mail.sendVerifyCode(newEmail, code);
    return { ok: true, sentTo: maskEmail(newEmail) };
  }

  /**
   * Self-service email change — step 2: submit the code from the new address. On
   * match, writes the new email + email_verified=true (proven owned). Unique
   * collision → 409; bad/expired code → 400.
   */
  async verifyEmailChange(
    sid: string | undefined,
    codeRaw: string | undefined,
  ): Promise<{ ok: true; email: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const code = (codeRaw ?? "").trim();
    const newEmail = await this.redis.verifyOperatorContactChange(
      operatorId,
      "email",
      code,
    );
    if (!newEmail) throw new BadRequestException("invalid_or_expired_code");
    try {
      const ok = await this.operators.setOperatorContactVerified(
        operatorId,
        "email",
        newEmail,
      );
      if (!ok) throw new UnauthorizedException("operator_session_required");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("email_in_use");
      }
      throw err;
    }
    return { ok: true, email: newEmail };
  }

  /**
   * Self-service phone change — step 1: send an SMS code to the NEW number.
   * PhoneCodeService(阿里云)拥有验证码的生成/有效期/频控;此处不自管码。绑定关系由
   * verify 步骤的 verifyCode(newPhone, code) 保证(码只对发到的号有效),故 newPhone 由
   * 客户端在两步都带上是安全的。
   */
  async startPhoneChange(
    sid: string | undefined,
    newPhoneRaw: string | undefined,
  ): Promise<{ ok: true; sentTo: string }> {
    await this.resolveOperatorId(sid);
    const newPhone = (newPhoneRaw ?? "").trim();
    if (!PHONE_RE.test(newPhone)) {
      throw new BadRequestException("invalid_phone");
    }
    await this.phoneCode.sendCode(newPhone);
    return { ok: true, sentTo: maskPhone(newPhone) };
  }

  /**
   * Self-service phone change — step 2: submit the code sent to the new number.
   * On a valid code, writes the new phone + phone_verified=true. Unique collision
   * → 409; bad code → 400.
   */
  async verifyPhoneChange(
    sid: string | undefined,
    newPhoneRaw: string | undefined,
    codeRaw: string | undefined,
  ): Promise<{ ok: true; phone: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newPhone = (newPhoneRaw ?? "").trim();
    const code = (codeRaw ?? "").trim();
    if (!PHONE_RE.test(newPhone) || !code) {
      throw new BadRequestException("invalid_request");
    }
    const ok = await this.phoneCode.verifyCode(newPhone, code);
    if (!ok) throw new BadRequestException("invalid_or_expired_code");
    try {
      const written = await this.operators.setOperatorContactVerified(
        operatorId,
        "phone",
        newPhone,
      );
      if (!written)
        throw new UnauthorizedException("operator_session_required");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("phone_in_use");
      }
      throw err;
    }
    return { ok: true, phone: newPhone };
  }

  /**
   * Self-service password change: verify the CURRENT password (re-auth, no
   * last-login side effect), set the new one (Argon2id, min 12), and revoke all
   * refresh tokens so other sessions must re-login. 当前浏览器会话 cookie 仍有效至
   * 到期(RP 会话独立),用户体验上不会把自己踢下线。
   */
  async changePassword(
    sid: string | undefined,
    currentPassword: string | undefined,
    newPassword: string | undefined,
  ): Promise<{ ok: true }> {
    const operatorId = await this.resolveOperatorId(sid);
    const current = currentPassword ?? "";
    const next = newPassword ?? "";
    if (next.length < OPERATOR_PASSWORD_MIN) {
      throw new BadRequestException("weak_password");
    }
    const verified = await this.operators.verifyOperatorPassword(
      operatorId,
      current,
    );
    if (!verified) throw new BadRequestException("invalid_current_password");
    const ok = await this.operators.setOperatorPassword(operatorId, next, {
      forceChange: false,
    });
    if (!ok) throw new UnauthorizedException("operator_session_required");
    await this.refreshTokens.revokeAllForOperator(operatorId);
    return { ok: true };
  }
}
