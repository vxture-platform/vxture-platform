/**
 * Public captcha configuration and verification endpoints.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { extractClientIp } from "@vxture/core-utils";
import { HumanCaptchaService } from "../authn/human-captcha.service";

function realmOf(value: unknown): "customer" | "workforce" {
  if (value !== "customer" && value !== "workforce")
    throw new BadRequestException("invalid_realm");
  return value;
}

@Controller("auth/captcha")
export class CaptchaRouter {
  constructor(
    @Inject(HumanCaptchaService) private readonly captcha: HumanCaptchaService,
  ) {}

  @Get("config")
  config(
    @Query("realm") realm: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.captcha.config(realmOf(realm));
  }

  @Post("verify")
  @HttpCode(200)
  verify(
    @Body() body: { realm?: unknown; captchaVerifyParam?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.captcha.verify(
      realmOf(body?.realm),
      body?.captchaVerifyParam,
      extractClientIp(request),
    );
  }
}
