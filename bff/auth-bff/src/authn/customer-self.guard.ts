/**
 * Customer account-center request authorization.
 * @package @vxture/bff-auth
 * @layer Application
 * @category guard
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AccountsOriginGuard,
  ACCOUNT_RAW_IMAGE,
} from "../accounts/accounts-origin.guard";
import type { Request } from "express";
import { SID_COOKIE_NAME } from "./cookie";
import {
  RealmSessionService,
  type CustomerSessionContext,
} from "../oidc/realm-session.service";

/** Only explicitly marked lifecycle recovery handlers accept deleting mutations. */
export const ACCOUNT_RECOVERY = "accounts:recovery";

export interface CustomerSelfRequest extends Request {
  customer: CustomerSessionContext;
}

@Injectable()
export class CustomerSelfGuard implements CanActivate {
  constructor(
    @Inject(RealmSessionService) private readonly realms: RealmSessionService,
    @Inject(AccountsOriginGuard) private readonly origin: AccountsOriginGuard,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  /**
   * Enforce an explicit browser origin before accessing customer data.
   * @param context - Nest HTTP execution context.
   * @returns Whether the request has an authenticated customer identity.
   * @throws {ForbiddenException} For untrusted origins or unsafe request formats.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CustomerSelfRequest>();
    const safe = req.method === "GET" || req.method === "HEAD";
    this.origin.assertRequest(
      req,
      this.reflector.getAllAndOverride<boolean>(ACCOUNT_RAW_IMAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false,
    );
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const sid = cookies[SID_COOKIE_NAME.tenant];
    req.customer = await this.realms.requireCustomer(
      typeof sid === "string" ? sid : undefined,
    );
    const recovery =
      this.reflector.getAllAndOverride<boolean>(ACCOUNT_RECOVERY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (!safe && req.customer.user.status !== "active" && !recovery) {
      throw new ForbiddenException("customer_account_read_only");
    }
    return true;
  }
}
