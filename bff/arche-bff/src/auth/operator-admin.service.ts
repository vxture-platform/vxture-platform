/**
 * operator-admin.service.ts — delegate operator account admin actions to the IdP.
 * @package @vxture/bff-arche
 *
 * Mirrors OperatorStepUpService: server-to-server POST to the IdP internal endpoints
 * (AUTH_INTERNAL_TOKEN over the container-internal URL — never the public issuer) for
 * admin-delegated operator disable / enable / force-logout (B9-P1b-α). Credentials and
 * sessions stay IdP-owned. actorOperatorId is the acting operator (from the RP session),
 * never the browser body. Fail-closed when internal auth / IdP URL is unconfigured.
 *
 * Design: docs/design/identity-platform-internal-delegation.md §3.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";

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
    const token = this.config.auth.AUTH_INTERNAL_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException("operator_admin_unavailable");
    }
    return token;
  }

  /** POST to an IdP internal operator endpoint; map errors without leaking internals. */
  private async delegate<T>(
    path: string,
    actorOperatorId: string,
    reason?: string,
    extra?: Record<string, unknown>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.idpBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-internal-auth": this.internalToken(),
        },
        body: JSON.stringify({ actorOperatorId, reason, ...extra }),
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
    // anything else (401 internal-auth, 5xx) = unavailable.
    if (res.status === 400) throw new BadRequestException(message);
    if (res.status === 403) throw new ForbiddenException(message);
    if (res.status === 404) throw new NotFoundException(message);
    if (res.status === 409) throw new ConflictException(message);
    if (res.status === 422) throw new UnprocessableEntityException(message);
    throw new ServiceUnavailableException("operator_admin_unavailable");
  }

  /**
   * Create a new operator (TD-017 §③⑤). No credential is created; the IdP mails
   * an out-of-band initial-setup link to the new operator's own email — the
   * creating admin only gets a masked delivery confirmation, never the link.
   */
  createOperator(
    actorOperatorId: string,
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
      actorOperatorId,
      undefined,
      input,
    );
  }

  disableOperator(
    operatorId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<OperatorDisableResult> {
    return this.delegate<OperatorDisableResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/disable`,
      actorOperatorId,
      reason,
    );
  }

  enableOperator(
    operatorId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<OperatorEnableResult> {
    return this.delegate<OperatorEnableResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/enable`,
      actorOperatorId,
      reason,
    );
  }

  forceLogoutOperator(
    operatorId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<OperatorForceLogoutResult> {
    return this.delegate<OperatorForceLogoutResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/sessions/revoke`,
      actorOperatorId,
      reason,
    );
  }

  resetOperatorMfa(
    operatorId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<OperatorForceLogoutResult> {
    return this.delegate<OperatorForceLogoutResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/mfa/reset`,
      actorOperatorId,
      reason,
    );
  }

  /**
   * Self-service email change (TD-017 §③) — the operator changes their OWN email;
   * a code is sent to the NEW address (step 1). operatorId is the acting operator
   * (self); the IdP enforces id === actor.
   */
  startEmailChange(
    operatorId: string,
    newEmail: string,
  ): Promise<{ ok: true; sentTo: string }> {
    return this.delegate<{ ok: true; sentTo: string }>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/contact/email/start`,
      operatorId,
      undefined,
      { newEmail },
    );
  }

  /** Self-service email change — step 2: submit the code → new email + verified. */
  verifyEmailChange(
    operatorId: string,
    code: string,
  ): Promise<{ ok: true; email: string }> {
    return this.delegate<{ ok: true; email: string }>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/contact/email/verify`,
      operatorId,
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
    actorOperatorId: string,
    reason?: string,
  ): Promise<OperatorResetPasswordResult> {
    return this.delegate<OperatorResetPasswordResult>(
      `/internal/operator/accounts/${encodeURIComponent(operatorId)}/reset-password`,
      actorOperatorId,
      reason,
    );
  }

  // ── C12: admin-delegated CUSTOMER account management (realm=customer) ──
  //   Reuses the same S2S delegate; targets resolve via account.users only at the
  //   IdP (an operator id yields 404). No rank gate / anti-lockout (an operator may
  //   fully disable an abusive customer). Disable also revokes all their sessions.

  disableAccount(
    userId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<{ ok: true; status: string; revoked: number }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/disable`,
      actorOperatorId,
      reason,
    );
  }

  enableAccount(
    userId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<{ ok: true; status: string }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/enable`,
      actorOperatorId,
      reason,
    );
  }

  forceLogoutAccount(
    userId: string,
    actorOperatorId: string,
    reason?: string,
  ): Promise<{ ok: true; revoked: number }> {
    return this.delegate(
      `/internal/account/users/${encodeURIComponent(userId)}/sessions/revoke`,
      actorOperatorId,
      reason,
    );
  }
}
