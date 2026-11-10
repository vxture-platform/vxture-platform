/**
 * Realm-separated short-lived account ownership ceremonies.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-10
 */
import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccountReauthenticationService } from "../authn/account-reauthentication.service";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { SID_COOKIE_NAME } from "../authn/cookie";

function input(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("invalid_request");
  return body as Record<string, unknown>;
}

// ============================================================================
// Customer-only cookie and origin guard
// ============================================================================
@Controller("oidc/customer/self/reauthentication")
@UseGuards(CustomerSelfGuard)
export class AccountReauthenticationRouter {
  constructor(
    @Inject(AccountReauthenticationService)
    private readonly service: AccountReauthenticationService,
  ) {}

  @Post("options")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  options(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    const data = input(body);
    return this.service.options(
      "customer",
      req.customer.sid,
      data.operation,
      data.target,
    );
  }

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.service.start("customer", req.customer.sid, input(body));
  }

  @Post(":id/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verify(
    @Req() req: CustomerSelfRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.verify("customer", req.customer.sid, id, input(body));
  }
}

// ============================================================================
// Workforce-only cookie and origin guard
// ============================================================================
@Controller("oidc/operator/self/reauthentication")
@UseGuards(OperatorSelfGuard)
export class OperatorAccountReauthenticationRouter {
  constructor(
    @Inject(AccountReauthenticationService)
    private readonly service: AccountReauthenticationService,
  ) {}

  private sid(req: Request) {
    const value: unknown = req.cookies?.[SID_COOKIE_NAME.operator];
    return typeof value === "string" ? value : undefined;
  }

  @Post("options")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  options(@Req() req: Request, @Body() body: unknown) {
    const data = input(body);
    return this.service.options(
      "workforce",
      this.sid(req),
      data.operation,
      data.target,
    );
  }

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(@Req() req: Request, @Body() body: unknown) {
    return this.service.start("workforce", this.sid(req), input(body));
  }

  @Post(":id/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verify(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.service.verify("workforce", this.sid(req), id, input(body));
  }
}
