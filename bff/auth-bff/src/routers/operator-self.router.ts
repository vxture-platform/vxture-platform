/**
 * operator-self.router.ts — operator SELF-service account endpoints, authorized by
 * the operator central session cookie (vx_sid_op), served on the accounts origin.
 * @package @vxture/bff-auth
 *
 * Phase B(收敛到身份层):accounts 门户「个人信息」页同源调用这些端点(credentials:
 * include 带 vx_sid_op)。与 operator-webauthn.router 同一鉴权模型——不是内部 token、
 * 不是一次性 token,而是浏览器持有的 workforce 中心会话。写侧只覆盖改邮箱(B.1)。
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  OperatorSelfService,
  type OperatorSelfView,
} from "../oidc/operator-self.service";
import { SID_COOKIE_NAME as SID_COOKIE } from "../authn/cookie";

@Controller()
export class OperatorSelfRouter {
  constructor(
    @Inject(OperatorSelfService)
    private readonly self: OperatorSelfService,
  ) {}

  /** Read the authenticated operator's own account view. */
  @Get("oidc/operator/self")
  async getSelf(@Req() req: Request): Promise<OperatorSelfView> {
    return this.self.getSelf(operatorSid(req));
  }

  /** Email change — step 1: send a code to the new address. */
  @Post("oidc/operator/self/email/start")
  @HttpCode(HttpStatus.OK)
  async startEmail(
    @Body() body: { newEmail?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; sentTo: string }> {
    return this.self.startEmailChange(operatorSid(req), body.newEmail);
  }

  /** Email change — step 2: verify the code, write the new email. */
  @Post("oidc/operator/self/email/verify")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: { code?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; email: string }> {
    return this.self.verifyEmailChange(operatorSid(req), body.code);
  }
}

/** Read the operator central-session cookie from the request. */
function operatorSid(req: Request): string | undefined {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  return cookies[SID_COOKIE.operator];
}
