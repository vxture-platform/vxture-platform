/**
 * operator-stepup.service.ts — request an operator step-up credential from the IdP.
 * @package @vxture/bff-admin
 *
 * Forwards an authenticated operator's TOTP code to the IdP's internal step-up
 * endpoint (server-to-server, IDP_INTERNAL_TOKEN over the internal IdP URL —
 * never the public issuer). The operatorId is supplied by the caller from the RP
 * session, not the browser body. Returns the short-lived step-up credential the
 * OperatorStepUpGuard later verifies. Fail-closed when internal auth / IdP URL
 * is unconfigured.
 */
import {
  HttpException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { StepUpActionBinding } from "./voucher-step-up";

export interface StepUpCredential {
  stepUpToken: string;
  expiresIn: number;
}

@Injectable()
export class OperatorStepUpService {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Internal IdP base URL (container-internal; mirrors the RP backchannel). */
  private idpBaseUrl(): string {
    const base =
      process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL ?? "";
    if (!base) {
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    }
    return base.replace(/\/$/, "");
  }

  private internalToken(): string {
    // 内部面的钥匙（2026-10-04 拆分）：auth-bff 的 /internal/* 只认 IDP_INTERNAL_TOKEN；
    // 产品面的 AUTH_INTERNAL_TOKEN 对它是外人，这里不回落到它。
    const token = this.config.auth.IDP_INTERNAL_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    }
    return token;
  }

  /** Verify TOTP for the operator at the IdP → short-lived step-up credential. */
  async requestTotpStepUp(
    operatorId: string,
    code: string,
    action?: StepUpActionBinding,
  ): Promise<StepUpCredential> {
    let res: Response;
    try {
      res = await fetch(`${this.idpBaseUrl()}/internal/operator/stepup/totp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-internal-auth": this.internalToken(),
        },
        body: JSON.stringify({
          operatorId,
          code,
          ...(action ? { action } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    }
    if (res.status === 401) {
      throw new UnauthorizedException("invalid_mfa_code");
    }
    if (res.status === 403) {
      const body: unknown = await res.json().catch(() => null);
      if (
        body &&
        typeof body === "object" &&
        "message" in body &&
        (body.message === "webauthn_required" ||
          body.message === "operator_totp_required")
      )
        throw new ForbiddenException(body.message);
      throw new ServiceUnavailableException("operator_stepup_failed");
    }
    if (res.status === 429) {
      const body: unknown = await res.json().catch(() => null);
      const value =
        body && typeof body === "object" && "retryAfter" in body
          ? body.retryAfter
          : undefined;
      // Keep the upstream status without reflecting arbitrary upstream messages.
      const retryAfter =
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        value <= 900
          ? value
          : 900;
      throw new HttpException(
        {
          message: `too_many_attempts; retry after ${retryAfter}s`,
          retryAfter,
        },
        429,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException("operator_stepup_failed");
    }
    const data: unknown = await res.json().catch(() => null);
    if (
      !data ||
      typeof data !== "object" ||
      !("stepUpToken" in data) ||
      typeof data.stepUpToken !== "string" ||
      !data.stepUpToken ||
      !("expiresIn" in data) ||
      typeof data.expiresIn !== "number" ||
      !Number.isSafeInteger(data.expiresIn) ||
      data.expiresIn <= 0 ||
      data.expiresIn > 300
    ) {
      throw new ServiceUnavailableException("operator_stepup_failed");
    }
    return { stepUpToken: data.stepUpToken, expiresIn: data.expiresIn };
  }

  /**
   * Ask the IdP for one execution permit or committed-receipt replay only.
   * @param operatorId - Authenticated operator.
   * @param stepUpToken - Locally verified action credential.
   * @param action - Server-computed session and request binding.
   * @returns The narrow mode confirmed by the shared authorization store.
   * @throws {ForbiddenException} When the proof is unavailable or mismatched.
   * @throws {ServiceUnavailableException} When the IdP result cannot be verified.
   */
  async consumeAction(
    operatorId: string,
    stepUpToken: string,
    action: StepUpActionBinding,
  ): Promise<{ mode: "execute" | "replay" }> {
    let res: Response;
    try {
      res = await fetch(
        `${this.idpBaseUrl()}/internal/operator/stepup/consume`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vxture-internal-auth": this.internalToken(),
          },
          body: JSON.stringify({
            operatorId,
            stepUpToken,
            action,
            audience: "admin",
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    }
    if (res.status === 403) throw new ForbiddenException("step_up_required");
    if (!res.ok)
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    const body: unknown = await res.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      !("mode" in body) ||
      (body.mode !== "execute" && body.mode !== "replay")
    )
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    return { mode: body.mode };
  }
}
