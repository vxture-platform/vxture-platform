/**
 * operator-stepup.router.ts — operator 二次验证（step-up）入口。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 已认证的 operator 提交 TOTP 码；opera-bff 转发给 IdP 校验，成功则种一枚短时
 * host-only cookie，`OperatorStepUpGuard` 在高危写路由上校验它。
 *
 * `operatorId` 取自 RP 会话（`OperatorAuthMiddleware` 填的 `req.operator`），
 * **永不取自请求体**——否则任何人都能替别人换凭证。
 *
 * 挂在 `api/` 下（受 `OperatorAuthMiddleware` 覆盖）：换 step-up 凭证本身就要求
 * 先有会话，未登录不该能打这个端点。
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  Body,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OperatorStepUpService } from "../auth/operator-stepup.service";
import { invalidRequest, unauthenticated } from "../errors/api-error";
import { stepUpCookieName } from "../auth/step-up.decorator";
import { RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/request-context";

@Controller("api/operator/step-up")
export class OperatorStepUpRouter {
  constructor(
    @Inject(OperatorStepUpService)
    private readonly stepUp: OperatorStepUpService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  /** 校验 TOTP → 种短时 step-up cookie。 */
  @Post("totp")
  @HttpCode(HttpStatus.OK)
  async totp(
    @Body() body: { code?: string },
    @Req() req: Request & RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; expiresIn: number }> {
    if (!body.code) {
      throw invalidRequest("VALIDATION_REQUIRED", "invalid_request", "code");
    }
    const operatorId = req.operator?.id;
    if (!operatorId) {
      /* 没有会话主体——这不是请求写错了，是没登录。原来一律回 400
         `invalid_request`，门户只能猜是哪一种。 */
      throw unauthenticated("AUTH_NO_SESSION", "No active session");
    }
    const { stepUpToken, expiresIn } = await this.stepUp.requestTotpStepUp(
      operatorId,
      body.code,
    );
    const secure = this.rpRuntime.cookieSecure;
    res.cookie(stepUpCookieName(secure), stepUpToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      /* 与凭证自身 TTL 对齐：cookie 活得比凭证久没有意义，只会让守卫在
         "有 cookie 但验签过期"上多绕一圈。 */
      maxAge: expiresIn * 1000,
    });
    return { ok: true, expiresIn };
  }
}
