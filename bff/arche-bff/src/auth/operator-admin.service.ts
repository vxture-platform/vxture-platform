/**
 * operator-admin.service.ts — delegate operator account admin actions to the IdP.
 * @package @vxture/bff-arche
 *
 * Mirrors OperatorStepUpService: server-to-server POST to the IdP internal endpoints
 * (IDP_INTERNAL_TOKEN over the container-internal URL — never the public issuer) for
 * admin-delegated operator disable / enable / force-logout (B9-P1b-α). Credentials and
 * sessions stay IdP-owned. The acting operator comes from the RP session, never the
 * browser body — and since 2026-10-04 (E1 PR C) it is sent as a **pair**: `actorOperatorId`
 * in the body (audit text needs it) plus the operator's own session access token in
 * `x-vxture-actor-token`, which auth-bff's `ActorBindingGuard` verifies (aud=arche,
 * sub == actorOperatorId, central session alive). Holding IDP_INTERNAL_TOKEN alone no longer
 * lets a caller name an arbitrary operator. Fail-closed when internal auth / IdP URL is
 * unconfigured.
 *
 * Design: docs/30-design/identity/100-internal-delegation.md §3.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { ActingOperator } from "./acting-operator";

/** auth-bff `ActorBindingGuard` 读的头；与 `bff/auth-bff/src/authn/actor-binding.guard.ts` 逐字相同。 */
export const ACTOR_TOKEN_HEADER = "x-vxture-actor-token";

export interface OperatorDisableResult {
  ok: true;
  status: string;
  revoked: number;
}
export interface OperatorEnableResult {
  ok: true;
  status: string;
}
export interface OperatorForceLogoutResult {
  ok: true;
  revoked: number;
}
export interface OperatorResetPasswordResult {
  ok: true;
  /** Masked target email the reset link was mailed to (b***@example.com). */
  deliveredTo: string;
  expiresIn: number;
}
export interface CreateOperatorResult {
  ok: true;
  operatorId: string;
  /** Masked new-operator email the initial-setup link was mailed to. */
  deliveredTo: string;
}

/** IdP 中央会话（auth-bff GET /internal/operator/sessions）。sid 不出 IdP，只有 sessionRef。 */
export interface IdpOperatorSession {
  sessionRef: string;
  operatorId: string;
  authMethod: string;
  /** 这个会话登录过的平台（client_id）。 */
  clients: string[];
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class OperatorAdminService {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Internal IdP base URL (container-internal; mirrors the RP backchannel). */
  private idpBaseUrl(): string {
    const base =
      process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL ?? "";
    if (!base) {
      throw new ServiceUnavailableException("operator_admin_unavailable");
    }
    return base.replace(/\/$/, "");
  }

  private internalToken(): string {
    // 内部面的钥匙（2026-10-04 拆分）：auth-bff 的 /internal/* 只认 IDP_INTERNAL_TOKEN；
    // 产品面的 AUTH_INTERNAL_TOKEN 对它是外人，这里不回落到它。
    const token = this.config.auth.IDP_INTERNAL_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException("operator_admin_unavailable");
    }
    return token;
  }

  /**
   * POST to an IdP internal operator endpoint; map errors without leaking internals.
   * `actor.accessToken` goes in `x-vxture-actor-token` (ActorBindingGuard), `actor.operatorId`
   * in the body — both halves of the binding, from the same RP session.
   */
  private async delegate<T>(
    path: string,
    actor: ActingOperator,
    reason?: string,
    extra?: Record<string, unknown>,
  ): Promise<T> {
    if (!actor.operatorId || !actor.accessToken) {
      // 调用点该用 requireActingOperator 取主体；到这里还缺一半就是调用点漏了，不能带着
      // 半个主体去敲 IdP（它会 401，而这边映射成 503 把排障引向「IdP 挂了」）。
      throw new UnauthorizedException("operator_actor_incomplete");
    }
    let res: Response;
    try {
      res = await fetch(`${this.idpBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-internal-auth": this.internalToken(),
          [ACTOR_TOKEN_HEADER]: actor.accessToken,
        },
        body: JSON.stringify({
          actorOperatorId: actor.operatorId,
          reason,
          ...extra,
        }),
      });
    } catch {
      throw new ServiceUnavailableException("operator_admin_unavailable");
    }
    if (res.ok) {
      return (await res.json()) as T;
    }
    let message = "operator_admin_failed";
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {
      // non-JSON error body — keep the generic message.
    }
    // 400 = anti-lockout / self / bad request (surface to operator);
    // 403 = insufficient_rank (TD-017 graded model); 404 = operator not found;
    // 409 = last_super_admin (survival guard); 422 = no_email (out-of-band reset);
    // anything else (401 internal-auth / actor_token_*, 5xx) = unavailable.
    if (res.status === 400) throw new BadRequestException(message);
    if (res.status === 403) throw new ForbiddenException(message);
    if (res.status === 404) throw new NotFoundException(message);
    if (res.status === 409) throw new ConflictException(message);
    if (res.status === 422) throw new UnprocessableEntityException(message);
    throw new ServiceUnavailableException("operator_admin_unavailable");
  }

  /**
   * 在线会话：IdP 中央会话（realm=workforce）。只读、没有操作者；读不到一律 503——
   * 调用方决定是整页报错（在线会话页）还是降级成「—」（平台用户列表、总览）。
   */
  async listOperatorSessions(): Promise<IdpOperatorSession[]> {
    let res: Response;
    try {
      res = await fetch(`${this.idpBaseUrl()}/internal/operator/sessions`, {
        headers: { "x-vxture-internal-auth": this.internalToken() },
      });
    } catch {
      throw new ServiceUnavailableException("operator_sessions_unavailable");
    }
    if (!res.ok) {
      throw new ServiceUnavailableException("operator_sessions_unavailable");
    }
    const body = (await res.json()) as { sessions?: unknown };
    return Array.isArray(body.sessions)
      ? (body.sessions as IdpOperatorSession[])
      : [];
  }

  /**
   * Create a new operator (TD-017 §③⑤). No credential is created; the IdP mails
   * an out-of-band initial-setup link to the new operator's own email — the
   * creating admin only gets a masked delivery confirmation, never the link.
   */
  createOperator(
    actor: ActingOperator,
    input: {
      username: string;
      displayName: string;
      email: string;
      phone: string | null;
      roleId: string;
    },
  ): Promise<CreateOperatorResult> {
    return this.delegate<CreateOperatorResult>(
      "/internal/operator/accounts",
      actor,
      undefined,
      input,
    );
  }

  disableOperator(
    operatorId: string,
    actor: ActingOperator,
    reason?: string,
  ): Promise<OperatorDisableResult> {
    return this.delegate<OperatorDisableResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/disable`,
      actor,
      reason,
    );
  }

  enableOperator(
    operatorId: string,
    actor: ActingOperator,
    reason?: string,
  ): Promise<OperatorEnableResult> {
    return this.delegate<OperatorEnableResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/enable`,
      actor,
      reason,
    );
  }

  forceLogoutOperator(
    operatorId: string,
    actor: ActingOperator,
    reason?: string,
  ): Promise<OperatorForceLogoutResult> {
    return this.delegate<OperatorForceLogoutResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/sessions/revoke`,
      actor,
      reason,
    );
  }

  resetOperatorMfa(
    operatorId: string,
    actor: ActingOperator,
    reason?: string,
  ): Promise<OperatorForceLogoutResult> {
    return this.delegate<OperatorForceLogoutResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/mfa/reset`,
      actor,
      reason,
    );
  }

  /**
   * Self-service email change (TD-017 §③) — the operator changes their OWN email;
   * a code is sent to the NEW address (step 1). The actor IS the target (self); the IdP
   * enforces id === actorOperatorId, and (PR C) that the session token is the actor's.
   * No router in arche-bff calls this today (self-service moved to auth-bff's cookie
   * path, see admin-bff's note of 2026-09-02); kept with the bound signature so a future
   * caller cannot reach delegate() with half a principal.
   */
  startEmailChange(
    actor: ActingOperator,
    newEmail: string,
  ): Promise<{ ok: true; sentTo: string }> {
    return this.delegate<{ ok: true; sentTo: string }>(
      `/internal/operator/accounts/${encodeURIComponent(actor.operatorId)}/contact/email/start`,
      actor,
      undefined,
      { newEmail },
    );
  }

  /** Self-service email change — step 2: submit the code → new email + verified. */
  verifyEmailChange(
    actor: ActingOperator,
    code: string,
  ): Promise<{ ok: true; email: string }> {
    return this.delegate<{ ok: true; email: string }>(
      `/internal/operator/accounts/${encodeURIComponent(actor.operatorId)}/contact/email/verify`,
      actor,
      undefined,
      { code },
    );
  }

  /**
   * Admin-initiated password reset — the IdP mails the single-use link to the
   * TARGET operator's own email (out-of-band, TD-017); the initiator only gets a
   * masked delivery confirmation, never the link.
   */
  resetOperatorPassword(
    operatorId: string,
    actor: ActingOperator,
    reason?: string,
  ): Promise<OperatorResetPasswordResult> {
    return this.delegate<OperatorResetPasswordResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/reset-password`,
      actor,
      reason,
    );
  }

  // ── C12: admin-delegated CUSTOMER account management (realm=customer) ──
  //   Reuses the same S2S delegate; targets resolve via account.users only at the
  //   IdP (an operator id yields 404). No rank gate / anti-lockout (an operator may
  //   fully disable an abusive customer). Disable also revokes all their sessions.
  //
  //   `reason` is REQUIRED on these three (owner 2026-09-29). The IdP boundary
  //   (auth-bff AccountAdminInternalRouter) now answers a missing / blank reason with
  //   400 `reason_required`, because that sentence is copied verbatim into the
  //   notification the CUSTOMER receives: an account locked with no stated reason
  //   leaves its owner guessing, from a console he can no longer open.
  //   Declaring it optional here did not make it lenient, it only moved the refusal
  //   one hop later - any caller that omitted it could produce nothing but a rejected
  //   request. The operator-realm actions above keep it optional: that boundary did
  //   not change, and its reason is not shown to anyone outside admin.

  disableAccount(
    userId: string,
    actor: ActingOperator,
    reason: string,
  ): Promise<{ ok: true; status: string; revoked: number }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/disable`,
      actor,
      reason,
    );
  }

  enableAccount(
    userId: string,
    actor: ActingOperator,
    reason: string,
  ): Promise<{ ok: true; status: string }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/enable`,
      actor,
      reason,
    );
  }

  forceLogoutAccount(
    userId: string,
    actor: ActingOperator,
    reason: string,
  ): Promise<{ ok: true; revoked: number }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/sessions/revoke`,
      actor,
      reason,
    );
  }
}
