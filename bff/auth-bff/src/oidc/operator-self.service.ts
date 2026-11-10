/**
 * Workforce account self-service, authorized exclusively by the central operator session.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import { AccountReauthenticationService } from "../authn/account-reauthentication.service";
import { validNewPassword } from "../authn/password-policy";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import { PhoneCodeService } from "@vxture/service-sms";
import { RedisService } from "../redis/redis.service";
import { RealmSessionService } from "./realm-session.service";
import { OperatorRefreshTokenRepository } from "../token/operator-refresh-token.repository";
import { OperatorMfaService } from "./operator-mfa.service";
import { OidcService } from "./oidc.service";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** 国内裸 11 位手机号(与租户侧同口径)。 */
const PHONE_RE = /^1\d{10}$/;
/** operator 密码下限,与 operator-public.router 的重置口径一致(12)。 */

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
  /** 是否已启用 TOTP 二次验证(展示用,决定 UI 是"设置"还是"重新设置")。 */
  mfaTotpEnabled: boolean;
}

@Injectable()
export class OperatorSelfService {
  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealmSessionService)
    private readonly realmSession: RealmSessionService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PhoneCodeService) private readonly phoneCode: PhoneCodeService,
    @Inject(OperatorRefreshTokenRepository)
    private readonly refreshTokens: OperatorRefreshTokenRepository,
    @Inject(OperatorMfaService) private readonly mfa: OperatorMfaService,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(AccountReauthenticationService)
    private readonly reauthentication: AccountReauthenticationService,
  ) {}

  /**
   * Resolve the operator id from the central session cookie; 401 otherwise.
   * Identical guard to OperatorWebauthnService — the browser must already hold a
   * workforce-realm `vx_sid_op` session.
   */
  private async resolveOperatorId(sid: string | undefined): Promise<string> {
    return this.realmSession.requireOperator(sid);
  }

  /** Read the authenticated operator's own account view (no secret material). */
  async getSelf(sid: string | undefined): Promise<OperatorSelfView> {
    const operatorId = await this.resolveOperatorId(sid);
    const [view, mfaCtx] = await Promise.all([
      this.operators.getOperatorAdminView(operatorId),
      this.operators.getMfaContext(operatorId),
    ]);
    if (!view) throw new UnauthorizedException("operator_session_required");
    return {
      username: view.username,
      email: view.email,
      emailVerified: view.emailVerified,
      phone: view.phone,
      phoneVerified: view.phoneVerified,
      role: view.roleCode,
      mfaTotpEnabled: mfaCtx?.totpEnabled === true,
    };
  }

  /**
   * Stage a session-bound email proof before delivery and activate its exact version.
   * @throws {Error} On invalid input, exhausted send budget or delivery/store failure.
   */
  async startEmailChange(
    sid: string | undefined,
    newEmailRaw: string | undefined,
    proofToken?: unknown,
  ): Promise<{ ok: true; sentTo: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newEmail =
      typeof newEmailRaw === "string" ? newEmailRaw.trim().toLowerCase() : "";
    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      throw new BadRequestException("invalid_email");
    }
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    await this.requireContactProof(
      sid,
      operatorId,
      "email",
      newEmail,
      proofToken,
    );
    const code = String(randomInt(100000, 1000000));
    const version = await this.redis.beginOperatorEmailChange(
      operatorId,
      sid!,
      newEmail,
      code,
    );
    if (!version)
      throw new HttpException(
        "too_many_attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    try {
      await this.mail.sendVerifyCode(newEmail, code);
    } catch (error) {
      await this.redis.finishOperatorEmailChange(operatorId, version, true);
      throw error;
    }
    if (
      !(await this.redis.finishOperatorEmailChange(operatorId, version, false))
    )
      throw new BadRequestException("invalid_or_expired_code");
    return { ok: true, sentTo: maskEmail(newEmail) };
  }

  /**
   * Consume a one-use email proof before rechecking the operator and writing contact data.
   * @throws {Error} On invalid/expired proof, revoked session or address collision.
   */
  async verifyEmailChange(
    sid: string | undefined,
    codeRaw: string | undefined,
    proofToken?: unknown,
    expectedEmail?: string,
  ): Promise<{ ok: true; email: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!/^\d{6}$/.test(code))
      throw new BadRequestException("invalid_or_expired_code");
    const newEmail = await this.redis.consumeOperatorEmailChange(
      operatorId,
      sid!,
      code,
    );
    if (
      !newEmail ||
      (expectedEmail !== undefined &&
        newEmail !== expectedEmail.trim().toLowerCase())
    )
      throw new BadRequestException("invalid_or_expired_code");
    const securityVersion = await this.requireContactProof(
      sid,
      operatorId,
      "email",
      newEmail,
      proofToken,
      true,
    );
    if ((await this.resolveOperatorId(sid)) !== operatorId)
      throw new UnauthorizedException("operator_session_required");
    try {
      const ok = await this.operators.setOperatorContactVerified(
        operatorId,
        "email",
        newEmail,
        securityVersion,
      );
      if (!ok) throw new UnauthorizedException("operator_session_required");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("email_in_use");
      }
      throw err;
    }
    await this.finishContactChange(operatorId);
    return { ok: true, email: newEmail };
  }

  /**
   * Send a code through the isolated workforce scheme, bound to this account,
   * session and new number. Staging first prevents verification during dispatch.
   * @throws {Error} On invalid input, exhausted budget, store or provider failure.
   */
  async startPhoneChange(
    sid: string | undefined,
    newPhoneRaw: string | undefined,
    proofToken?: unknown,
  ): Promise<{ ok: true; sentTo: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newPhone = typeof newPhoneRaw === "string" ? newPhoneRaw.trim() : "";
    if (!PHONE_RE.test(newPhone)) {
      throw new BadRequestException("invalid_phone");
    }
    await this.requireContactProof(
      sid,
      operatorId,
      "phone",
      newPhone,
      proofToken,
    );
    const version = await this.redis.beginOperatorPhoneChange(
      operatorId,
      sid!,
      newPhone,
    );
    if (!version) {
      throw new HttpException(
        "too_many_attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.phoneCode.sendCode(newPhone, {
        scope: "workforce-phone-change",
      });
    } catch (error) {
      await this.redis.finishOperatorPhoneChange(operatorId, version, true);
      throw error;
    }
    if (
      !(await this.redis.finishOperatorPhoneChange(operatorId, version, false))
    ) {
      throw new BadRequestException("invalid_or_expired_code");
    }
    return { ok: true, sentTo: maskPhone(newPhone) };
  }

  /**
   * Verify only a pending phone change owned by the current account/session.
   * Consume before writing so replays and stale in-flight results cannot mutate contact data.
   * @throws {Error} On invalid input/code, collision, store or provider failure.
   */
  async verifyPhoneChange(
    sid: string | undefined,
    newPhoneRaw: string | undefined,
    codeRaw: string | undefined,
    proofToken?: unknown,
  ): Promise<{ ok: true; phone: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    const newPhone = typeof newPhoneRaw === "string" ? newPhoneRaw.trim() : "";
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!PHONE_RE.test(newPhone) || !/^\d{6}$/.test(code)) {
      throw new BadRequestException("invalid_request");
    }
    const version = await this.redis.attemptOperatorPhoneChange(
      operatorId,
      sid!,
      newPhone,
    );
    if (!version) throw new BadRequestException("invalid_or_expired_code");
    let ok: boolean;
    try {
      ok = await this.phoneCode.verifyCode(newPhone, code, {
        scope: "workforce-phone-change",
      });
    } catch (error) {
      await this.redis.finishOperatorPhoneChange(operatorId, version, false);
      throw error;
    }
    const owned = await this.redis.finishOperatorPhoneChange(
      operatorId,
      version,
      ok,
    );
    if (!owned) throw new BadRequestException("invalid_or_expired_code");
    if (!ok) throw new BadRequestException("invalid_or_expired_code");
    // Recheck the session after external I/O; logout during verification must fail closed.
    if ((await this.resolveOperatorId(sid)) !== operatorId) {
      throw new UnauthorizedException("operator_session_required");
    }
    const securityVersion = await this.requireContactProof(
      sid,
      operatorId,
      "phone",
      newPhone,
      proofToken,
      true,
    );
    try {
      const written = await this.operators.setOperatorContactVerified(
        operatorId,
        "phone",
        newPhone,
        securityVersion,
      );
      if (!written)
        throw new UnauthorizedException("operator_session_required");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("phone_in_use");
      }
      throw err;
    }
    await this.finishContactChange(operatorId);
    return { ok: true, phone: newPhone };
  }

  /**
   * Change the password and end every workforce login, including this browser.
   * Revoking refresh tokens alone would still allow silent central-session SSO.
   */
  async changePassword(
    sid: string | undefined,
    currentPassword: string | undefined,
    newPassword: string | undefined,
    proofToken?: unknown,
  ): Promise<{ ok: true }> {
    const operatorId = await this.resolveOperatorId(sid);
    const current = typeof currentPassword === "string" ? currentPassword : "";
    const next = typeof newPassword === "string" ? newPassword : "";
    if (!validNewPassword(next, "workforce")) {
      throw new BadRequestException("weak_password");
    }
    const before = await this.operators.findById(operatorId);
    if (!before?.credentialVersion)
      throw new UnauthorizedException("operator_session_required");
    const verified = await this.operators.verifyOperatorPassword(
      operatorId,
      current,
    );
    if (!verified) throw new BadRequestException("invalid_current_password");
    await this.reauthentication.require(
      "workforce",
      sid,
      proofToken,
      "password",
      "",
      true,
    );
    const ok = await this.operators.setOperatorPassword(operatorId, next, {
      forceChange: false,
      expectedCredentialVersion: before.credentialVersion,
      ...(before.authenticationVersion
        ? { expectedAuthenticationVersion: before.authenticationVersion }
        : {}),
    });
    if (!ok) throw new UnauthorizedException("operator_session_required");
    // Attempt both authorities even if one fails after the password was committed.
    const results = await Promise.allSettled([
      this.refreshTokens.revokeAllForOperator(operatorId),
      this.oidc.endOperatorSessions(operatorId),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    return { ok: true };
  }

  /** Unverified current contacts need only their own delivery proof; replacements need MFA. */
  private async requireContactProof(
    sid: string | undefined,
    operatorId: string,
    kind: "email" | "phone",
    target: string,
    proofToken: unknown,
    consume = false,
  ) {
    const view = await this.operators.getOperatorAdminView(operatorId);
    if (!view) throw new UnauthorizedException("operator_session_required");
    const current = kind === "email" ? view.email : view.phone;
    const verified = kind === "email" ? view.emailVerified : view.phoneVerified;
    const operator = await this.operators.findById(operatorId);
    if (!operator?.authenticationVersion)
      throw new UnauthorizedException("operator_session_required");
    if (current === target && !verified) return operator.authenticationVersion;
    await this.reauthentication.require(
      "workforce",
      sid,
      proofToken,
      `${kind}-change`,
      target,
      consume,
    );
    return operator.authenticationVersion;
  }

  private async finishContactChange(operatorId: string) {
    // Durable revocation commits with the contact. Current credential versions also
    // reject old central authorization when best-effort Redis cleanup is unavailable.
    await this.oidc.endOperatorSessions(operatorId).catch(() => undefined);
  }

  // ============================================================================
  // Workforce MFA self-service
  // ============================================================================

  /**
   * Reauthenticate before staging a session-bound secret. The active factor and
   * recovery codes remain valid until the new ceremony is confirmed.
   */
  async startMfaTotp(
    sid: string | undefined,
    currentPassword: unknown,
    currentCode: unknown,
  ): Promise<{ secret: string; otpauthUri: string; enrollmentToken: string }> {
    const operatorId = await this.resolveOperatorId(sid);
    if (!(await this.redis.reserveOperatorMfaStepUp(operatorId))) {
      throw new HttpException(
        "too_many_attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ctx = await this.operators.getMfaContext(operatorId);
    if (
      !ctx ||
      ctx.webauthnRequired ||
      (!ctx.totpEnabled && ctx.webauthnCredentialCount > 0)
    ) {
      throw new BadRequestException("webauthn_required");
    }
    const previous = await this.operators.getTotpEnrollment(operatorId);
    if (
      typeof currentPassword !== "string" ||
      !(await this.operators.verifyOperatorPassword(
        operatorId,
        currentPassword,
      ))
    ) {
      throw new BadRequestException("invalid_current_password");
    }
    if (
      previous?.enabled &&
      (typeof currentCode !== "string" ||
        !(await this.mfa.verifySecondFactor({
          operatorId,
          method: "totp",
          code: currentCode.trim(),
        })))
    ) {
      throw new BadRequestException("invalid_current_mfa_code");
    }
    const enrollmentToken = randomUUID();
    const enrollment = await this.mfa.beginTotpEnrollment(
      operatorId,
      `self:${sid}:${enrollmentToken}`,
      false,
      { secret: previous?.secret ?? null, enabled: previous?.enabled ?? false },
    );
    return { ...enrollment, enrollmentToken };
  }

  /**
   * Self-service TOTP (re-)enrollment — step 2: confirm with the first valid code.
   * On success enables the new secret + issues a fresh batch of recovery codes
   * (returned ONCE for display). Wrong/expired code → 400.
   */
  async confirmMfaTotp(
    sid: string | undefined,
    codeRaw: string | undefined,
    enrollmentToken: unknown,
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    const operatorId = await this.resolveOperatorId(sid);
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (
      !/^\d{6}$/.test(code) ||
      typeof enrollmentToken !== "string" ||
      !/^[0-9a-f-]{36}$/.test(enrollmentToken)
    ) {
      throw new BadRequestException("invalid_or_expired_code");
    }
    const result = await this.mfa.confirmTotpEnrollment(
      operatorId,
      code,
      `self:${sid}:${enrollmentToken}`,
    );
    if (!result.ok) throw new BadRequestException("invalid_or_expired_code");
    return { ok: true, recoveryCodes: result.recoveryCodes };
  }
}
