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
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";

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
  ): Promise<StepUpCredential> {
    let res: Response;
    try {
      res = await fetch(`${this.idpBaseUrl()}/internal/operator/stepup/totp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-internal-auth": this.internalToken(),
        },
        body: JSON.stringify({ operatorId, code }),
      });
    } catch {
      throw new ServiceUnavailableException("operator_stepup_unavailable");
    }
    if (res.status === 401) {
      throw new UnauthorizedException("invalid_mfa_code");
    }
    if (!res.ok) {
      throw new ServiceUnavailableException("operator_stepup_failed");
    }
    const data = (await res
      .json()
      .catch(() => ({}))) as Partial<StepUpCredential>;
    if (!data.stepUpToken || typeof data.expiresIn !== "number") {
      throw new ServiceUnavailableException("operator_stepup_failed");
    }
    return { stepUpToken: data.stepUpToken, expiresIn: data.expiresIn };
  }
}
