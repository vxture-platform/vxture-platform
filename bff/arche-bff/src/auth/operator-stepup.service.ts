/**
 * operator-stepup.service.ts — 向 IdP 换取 operator step-up 凭证。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 把已认证 operator 提交的 TOTP 码转发到 IdP 的内部 step-up 端点（S2S，
 * `AUTH_INTERNAL_TOKEN` + 内部 IdP URL，**绝不走公开 issuer**）。`operatorId`
 * 由本服务从 RP 会话取，不信浏览器请求体。
 *
 * **`audience: "opera"` 是本文件存在的原因之一**：IdP 此前把 step-up 凭证的 `aud`
 * 硬编码成 `admin`（`OPERATOR_CLIENT_ID`），opera 用自己的 RP client 验签必然失败
 * ——等于除 admin 外没有门户能用 step-up。2026-08-13 随 `product_250` v0.4 把
 * audience 参数化，这里显式声明自己。
 *
 * 与 admin-bff 那份同构但**物理独立**：两个 *-bff 之间不建依赖是明确纪律
 * （见 atlas.router.ts 文件头同一条）。
 *
 * 配置缺失一律 fail-closed：换不到凭证就是过不了闸门，不降级放行。
 */
import { Inject, Injectable } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import { serviceUnavailable, unauthenticated } from "../errors/api-error";

/** 本门户的 workforce RP client_id——凭证的 `aud`，与守卫验签时的期望一致。 */
const ARCHE_RP_CLIENT_ID = "arche";

export interface StepUpCredential {
  stepUpToken: string;
  expiresIn: number;
}

@Injectable()
export class OperatorStepUpService {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** 容器内网 IdP 地址（镜像 RP backchannel），不是公开 issuer。 */
  private idpBaseUrl(): string {
    const base =
      process.env.OIDC_BACKCHANNEL_ISSUER ?? process.env.AUTH_BFF_URL ?? "";
    if (!base) {
      throw serviceUnavailable(
        "AUTH_STEP_UP_UNAVAILABLE",
        "operator_stepup_unavailable",
      );
    }
    return base.replace(/\/$/, "");
  }

  private internalToken(): string {
    const token = this.config.auth.AUTH_INTERNAL_TOKEN;
    if (!token) {
      throw serviceUnavailable(
        "AUTH_STEP_UP_UNAVAILABLE",
        "operator_stepup_unavailable",
      );
    }
    return token;
  }

  /** 在 IdP 校验 TOTP → 短时 step-up 凭证（TTL 300s，见 IdP 侧常量）。 */
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
        body: JSON.stringify({
          operatorId,
          code,
          audience: ARCHE_RP_CLIENT_ID,
        }),
      });
    } catch {
      throw serviceUnavailable(
        "AUTH_STEP_UP_UNAVAILABLE",
        "operator_stepup_unavailable",
      );
    }
    if (res.status === 401) {
      throw unauthenticated("AUTH_MFA_CODE_INVALID", "invalid_mfa_code");
    }
    if (!res.ok) {
      throw serviceUnavailable("AUTH_STEP_UP_FAILED", "operator_stepup_failed");
    }
    const data = (await res
      .json()
      .catch(() => ({}))) as Partial<StepUpCredential>;
    if (!data.stepUpToken || typeof data.expiresIn !== "number") {
      throw serviceUnavailable("AUTH_STEP_UP_FAILED", "operator_stepup_failed");
    }
    return { stepUpToken: data.stepUpToken, expiresIn: data.expiresIn };
  }
}
