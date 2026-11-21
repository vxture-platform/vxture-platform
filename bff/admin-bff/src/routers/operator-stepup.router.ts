/**
 * operator-stepup.router.ts — operator step-up re-auth (admin-bff, P4.2).
 * @package @vxture/bff-admin
 *
 * The authenticated operator submits a TOTP code; admin-bff verifies it via the
 * IdP and, on success, sets a short-lived host-only step-up cookie that the
 * OperatorStepUpGuard checks before high-risk writes. operatorId comes from the
 * RP session (AuthMiddleware), never the request body.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OperatorStepUpService } from "../auth/operator-stepup.service";
import { stepUpCookieName } from "../auth/step-up.decorator";
import { stepUpActionCookieName } from "../auth/step-up.decorator";
import { assertAnyCapability } from "../auth/capability";
import type { VoucherStepUpIntent } from "../auth/voucher-step-up";
import { RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";

@Controller("api/operator/step-up")
export class OperatorStepUpRouter {
  constructor(
    @Inject(OperatorStepUpService)
    private readonly stepUp: OperatorStepUpService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  /** Verify TOTP → set a short-lived step-up cookie for high-risk writes. */
  @Post("totp")
  @HttpCode(HttpStatus.OK)
  async totp(
    @Body() body: { code?: string; action?: VoucherStepUpIntent },
    @Req() req: Request & RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; expiresIn: number }> {
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.code !== "string" ||
      !body.code
    ) {
      throw new BadRequestException("invalid_request");
    }
    const operatorId = req.user?.id;
    if (!operatorId) {
      throw new BadRequestException("invalid_request");
    }
    let action: { requestHash: string; sessionHash: string } | undefined;
    if (body.action !== undefined) {
      assertAnyCapability(req, ["promotion:campaign.manage"]);
      if (
        !body.action ||
        typeof body.action.requestHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.action.requestHash) ||
        !req.operatorSessionHash
      )
        throw new BadRequestException("invalid_action_request");
      action = {
        requestHash: body.action.requestHash,
        sessionHash: req.operatorSessionHash,
      };
    }
    const { stepUpToken, expiresIn } = await this.stepUp.requestTotpStepUp(
      operatorId,
      body.code,
      action,
    );
    const secure = this.rpRuntime.cookieSecure;
    res.cookie(
      (action ? stepUpActionCookieName : stepUpCookieName)(secure),
      stepUpToken,
      {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: expiresIn * 1000,
      },
    );
    return { ok: true, expiresIn };
  }
}
