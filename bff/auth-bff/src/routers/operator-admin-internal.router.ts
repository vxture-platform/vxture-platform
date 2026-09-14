/**
 * operator-admin-internal.router.ts — internal IdP endpoints for admin-delegated
 * operator account management (B9-P1b-α: disable / enable / force-logout).
 * @package @vxture/bff-auth
 *
 * Server-to-server only (InternalAuthGuard / AUTH_INTERNAL_TOKEN). admin-bff, on
 * behalf of an authenticated + step-up'd operator, delegates operator status/session
 * mutations here — the IdP owns operator credentials & sessions (realm=workforce).
 * NEVER exposed publicly (nginx must not route /internal/*). actorOperatorId is
 * supplied by the trusted caller (RP session), never a browser. Realm-isolated: every
 * target is resolved via admin.operator_account only, so a customer id yields 404.
 *
 * Design: docs/design/identity-platform-internal-delegation.md §4/§5/§11b.
 * Credential ops (reset-password / create / mfa-reset) are P1b-β (need a public
 * operator reset flow) and are NOT in this router.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import { PgOperatorRepository } from "@vxture/service-iam";
import { MailService } from "@vxture/service-mail";
import { InternalAuthGuard } from "../authn/internal-auth.guard";
import { OidcService } from "../oidc/oidc.service";
import { OperatorRefreshTokenRepository } from "../token/operator-refresh-token.repository";
import { RedisService } from "../redis/redis.service";

interface AdminActionBody {
  actorOperatorId?: string;
  reason?: string;
}

type OperatorAdminView = NonNullable<
  Awaited<ReturnType<PgOperatorRepository["getOperatorAdminView"]>>
>;

const OPERATOR_STATUS_ACTIVE = "active";
const OPERATOR_RESET_TTL_SECONDS = 30 * 60;
const OPERATOR_CONTACT_TTL_SECONDS = 10 * 60;

/** Mask an email for API responses: b***@example.com. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const head = local?.slice(0, 1) ?? "";
  return `${head}***@${domain ?? ""}`;
}

@Controller("internal/operator/accounts")
@UseGuards(InternalAuthGuard)
export class OperatorAdminInternalRouter {
  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(OperatorRefreshTokenRepository)
    private readonly refreshTokens: OperatorRefreshTokenRepository,
    @Inject(RedisService)
    private readonly redis: RedisService,
    @Inject(VxConfigService)
    private readonly config: VxConfigService,
    @Inject(MailService)
    private readonly mail: MailService,
    @Inject(OidcService)
    private readonly oidc: OidcService,
  ) {}

  /** 吊销刷新令牌，并结束中央会话（否则静默 SSO 会把人放回来）。返回结束的会话数。 */
  private async endSessions(operatorId: string): Promise<number> {
    await this.refreshTokens.revokeAllForOperator(operatorId);
    return this.oidc.endOperatorSessions(operatorId);
  }

  /**
   * Rank gate (TD-017 graded model, layer 2 of 3). Layer 1 (capability
   * operator:account.manage) is enforced by admin-bff on the RP session; this
   * IdP-side gate re-resolves BOTH ranks from the DB (never caller-supplied)
   * and requires actor.rank strictly greater than target.rank — equal rank is
   * refused, which also forbids super_admin↔super_admin mutual operations.
   * Returns the resolved actor + target views for further guards.
   */
  private async assertRankGate(
    actorId: string,
    targetId: string,
  ): Promise<{ actor: OperatorAdminView; target: OperatorAdminView }> {
    const [actor, target] = await Promise.all([
      this.operators.getOperatorAdminView(actorId),
      this.operators.getOperatorAdminView(targetId),
    ]);
    if (!target) throw new NotFoundException("operator_not_found");
    if (!actor) throw new BadRequestException("invalid_request");
    if (actor.roleRank <= target.roleRank) {
      throw new ForbiddenException("insufficient_rank");
    }
    return { actor, target };
  }

  /**
   * Create a new operator account (TD-017 §③⑤ create-operator). Rank-gated: the
   * actor's rank must be strictly greater than the NEW role's rank (mirrors
   * admin-bff's changeAdminRole "cannot grant a role at or above one's own
   * level" — enforced here too, defense-in-depth, since credential delivery is
   * IdP-side). No credential is created; instead a single-use initial-setup
   * token (the SAME store as reset-password) is mailed to the new operator's
   * OWN email — the creating admin never sees the link/password (TD-017
   * out-of-band, extended to account creation per owner decision 2026-07-04:
   * create-operator reuses the same flow, so it must not reopen the flat-top
   * "creator learns the initial credential" surface).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body()
    body: AdminActionBody & {
      username?: string;
      displayName?: string;
      email?: string;
      phone?: string;
      roleId?: string;
    },
  ): Promise<{ ok: true; operatorId: string; deliveredTo: string }> {
    const actor = requireActor(body);
    const username = (body.username ?? "").trim();
    const displayName = (body.displayName ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = (body.phone ?? "").trim();
    const roleId = (body.roleId ?? "").trim();
    if (!username || !displayName || !email || !roleId) {
      throw new BadRequestException("invalid_request");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException("invalid_email");
    }

    const [actorView, newRole] = await Promise.all([
      this.operators.getOperatorAdminView(actor),
      this.operators.getRoleForRankCheck(roleId),
    ]);
    if (!actorView) throw new BadRequestException("invalid_request");
    if (!newRole) throw new BadRequestException("role_not_found");
    if (actorView.roleRank <= newRole.rank) {
      throw new ForbiddenException("insufficient_rank");
    }

    let created: { id: string };
    try {
      created = await this.operators.createOperator({
        roleId,
        username,
        displayName,
        email,
        phone: phone || null,
        createdBy: actor,
      });
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("username_or_contact_in_use");
      }
      throw err;
    }

    const token = randomBytes(32).toString("base64url");
    await this.redis.storeOperatorPasswordReset(
      token,
      created.id,
      OPERATOR_RESET_TTL_SECONDS,
    );
    const base = this.config.platform.LOGIN_UI_BASE_URL.replace(/\/$/, "");
    const setupLink = `${base}/operator/reset-password?token=${token}`;
    try {
      await this.mail.sendPasswordReset(
        email,
        setupLink,
        OPERATOR_RESET_TTL_SECONDS / 60,
      );
    } catch (err) {
      // Undo: without a delivered link the new account has no way to ever set
      // a password — surface failure so the caller can retry (account remains,
      // idempotently re-mailable by re-running create is NOT supported; the
      // admin retries via a future "resend setup email" op, out of scope here).
      await this.redis
        .consumeOperatorPasswordReset(token)
        .catch(() => undefined);
      console.error(
        "[operator-admin] create-operator mail send failed",
        err instanceof Error ? err.message : err,
      );
      throw new BadRequestException("setup_mail_delivery_failed");
    }
    return {
      ok: true,
      operatorId: created.id,
      deliveredTo: maskEmail(email),
    };
  }

  /**
   * Disable an operator (blocks login — SELECT_OPERATOR gates status='active') and
   * revoke all their sessions. Anti-lockout: cannot disable self or the last active
   * operator. Idempotent for an already-disabled target (still re-revokes sessions).
   */
  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disable(
    @Param("id") id: string,
    @Body() body: AdminActionBody,
  ): Promise<{ ok: true; status: string; revoked: number }> {
    const actor = requireActor(body);
    if (id === actor) {
      throw new BadRequestException("cannot_disable_self");
    }
    const { target } = await this.assertRankGate(actor, id);
    if (target.status !== OPERATOR_STATUS_ACTIVE) {
      const revoked = await this.endSessions(id);
      return { ok: true, status: target.status, revoked };
    }
    if ((await this.operators.countActiveOperators()) <= 1) {
      throw new BadRequestException("cannot_disable_last_operator");
    }
    // TD-019: survival check + status update happen in ONE transaction, row-
    // locking the full active-super_admin set first (see disableOperatorGuarded).
    const result = await this.operators.disableOperatorGuarded(id, actor);
    if (!result.ok) {
      if (result.reason === "last_super_admin") {
        throw new ConflictException("last_super_admin");
      }
      throw new NotFoundException("operator_not_found");
    }
    const revoked = await this.endSessions(id);
    return { ok: true, status: result.status, revoked };
  }

  /** Re-enable a disabled operator (status → active). Idempotent. Rank-gated. */
  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  async enable(
    @Param("id") id: string,
    @Body() body: AdminActionBody,
  ): Promise<{ ok: true; status: string }> {
    const actor = requireActor(body);
    await this.assertRankGate(actor, id);
    const status = await this.operators.setOperatorStatus(
      id,
      OPERATOR_STATUS_ACTIVE,
      actor,
    );
    if (!status) throw new NotFoundException("operator_not_found");
    return { ok: true, status };
  }

  /** Force-logout: end every central session and revoke the refresh tokens. Rank-gated. */
  @Post(":id/sessions/revoke")
  @HttpCode(HttpStatus.OK)
  async revokeSessions(
    @Param("id") id: string,
    @Body() body: AdminActionBody,
  ): Promise<{ ok: true; revoked: number }> {
    const actor = requireActor(body);
    await this.assertRankGate(actor, id);
    const revoked = await this.endSessions(id);
    return { ok: true, revoked };
  }

  /**
   * MFA reset: wipe the operator's enrolled second factors (TOTP/WebAuthn/recovery)
   * and revoke all sessions so they must re-auth + re-enroll. Policy is kept, so the
   * MFA requirement still applies on the next login.
   */
  @Post(":id/mfa/reset")
  @HttpCode(HttpStatus.OK)
  async resetMfa(
    @Param("id") id: string,
    @Body() body: AdminActionBody,
  ): Promise<{ ok: true; revoked: number }> {
    const actor = requireActor(body);
    await this.assertRankGate(actor, id);
    const done = await this.operators.resetOperatorMfa(id);
    if (!done) throw new NotFoundException("operator_not_found");
    const revoked = await this.endSessions(id);
    return { ok: true, revoked };
  }

  /**
   * Generate a single-use operator password-reset token (admin-delegated, B9-P1b-β,
   * TD-017 out-of-band delivery). Stores {operatorId} in Redis (short TTL) and MAILS
   * the public reset link to the target operator's own email — the initiating admin
   * NEVER sees the link (a returned link would let the initiator set a password they
   * know and impersonate the target). Sessions are revoked only after the mail is
   * accepted (admin-forced reset ⇒ lockout, but never a lockout with no recovery
   * path). Targets without an email are refused (422 no_email — fix the email via
   * metadata first). No plaintext password is ever handled here or by admin-bff.
   */
  @Post(":id/reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param("id") id: string,
    @Body() body: AdminActionBody,
  ): Promise<{ ok: true; deliveredTo: string; expiresIn: number }> {
    const actor = requireActor(body);
    const { target } = await this.assertRankGate(actor, id);
    if (!target.email) {
      throw new UnprocessableEntityException("no_email");
    }
    // TD-017 §③: only deliver to a VERIFIED contact. A staff-rewritten email is
    // unverified (metadata edit drops the flag), so it cannot receive the reset
    // link — the owner must re-verify via self-service first. Closes the
    // "rewrite email → capture reset link" takeover at the delivery gate.
    if (!target.emailVerified) {
      throw new UnprocessableEntityException("contact_unverified");
    }
    const token = randomBytes(32).toString("base64url");
    await this.redis.storeOperatorPasswordReset(
      token,
      id,
      OPERATOR_RESET_TTL_SECONDS,
    );
    const base = this.config.platform.LOGIN_UI_BASE_URL.replace(/\/$/, "");
    const resetLink = `${base}/operator/reset-password?token=${token}`;
    try {
      await this.mail.sendPasswordReset(
        target.email,
        resetLink,
        OPERATOR_RESET_TTL_SECONDS / 60,
      );
    } catch (err) {
      // Undo (consume = single-use invalidation): without a delivered link,
      // revoking sessions would strand the target.
      await this.redis
        .consumeOperatorPasswordReset(token)
        .catch(() => undefined);
      console.error(
        "[operator-admin] reset mail send failed",
        err instanceof Error ? err.message : err,
      );
      throw new BadRequestException("reset_mail_delivery_failed");
    }
    await this.endSessions(id);
    return {
      ok: true,
      deliveredTo: maskEmail(target.email),
      expiresIn: OPERATOR_RESET_TTL_SECONDS,
    };
  }

  /**
   * Self-service email change — step 1 (TD-017 §③). The operator (self only,
   * id must equal actorOperatorId) requests a change to a NEW email; a 6-digit
   * code is sent to that NEW address, proving ownership. The account is NOT
   * mutated here — only a pending record (Redis, short TTL) is stored. Verifying
   * (step 2) is what writes the new email + sets email_verified=true, which is
   * the ONLY path that restores out-of-band-delivery eligibility.
   */
  @Post(":id/contact/email/start")
  @HttpCode(HttpStatus.OK)
  async startEmailChange(
    @Param("id") id: string,
    @Body() body: AdminActionBody & { newEmail?: string },
  ): Promise<{ ok: true; sentTo: string }> {
    const actor = requireActor(body);
    if (id !== actor) throw new ForbiddenException("self_only");
    const newEmail = (body.newEmail ?? "").trim().toLowerCase();
    if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
      throw new BadRequestException("invalid_email");
    }
    const target = await this.operators.getOperatorAdminView(id);
    if (!target) throw new NotFoundException("operator_not_found");
    const code = String(randomInt(100000, 1000000));
    await this.redis.storeOperatorContactChange(
      id,
      "email",
      newEmail,
      code,
      OPERATOR_CONTACT_TTL_SECONDS,
    );
    await this.mail.sendVerifyCode(newEmail, code);
    return { ok: true, sentTo: maskEmail(newEmail) };
  }

  /**
   * Self-service email change — step 2: submit the code from the new address.
   * On match, writes the new email + email_verified=true (proven owned).
   * Unique collision → 409; bad/expired code → 400.
   */
  @Post(":id/contact/email/verify")
  @HttpCode(HttpStatus.OK)
  async verifyEmailChange(
    @Param("id") id: string,
    @Body() body: AdminActionBody & { code?: string },
  ): Promise<{ ok: true; email: string }> {
    const actor = requireActor(body);
    if (id !== actor) throw new ForbiddenException("self_only");
    const code = (body.code ?? "").trim();
    const newEmail = await this.redis.verifyOperatorContactChange(
      id,
      "email",
      code,
    );
    if (!newEmail) throw new BadRequestException("invalid_or_expired_code");
    try {
      const ok = await this.operators.setOperatorContactVerified(
        id,
        "email",
        newEmail,
      );
      if (!ok) throw new NotFoundException("operator_not_found");
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        throw new ConflictException("email_in_use");
      }
      throw err;
    }
    return { ok: true, email: newEmail };
  }
}

function requireActor(body: AdminActionBody): string {
  if (!body.actorOperatorId) {
    throw new BadRequestException("invalid_request");
  }
  return body.actorOperatorId;
}
