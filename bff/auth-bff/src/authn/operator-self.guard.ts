/**
 * Workforce-only account-center request authorization.
 * @package @vxture/bff-auth
 * @layer Application
 * @category guard
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { RealmSessionService } from "../oidc/realm-session.service";
import { SID_COOKIE_NAME } from "./cookie";

@Injectable()
export class OperatorSelfGuard implements CanActivate {
  constructor(
    @Inject(AccountsOriginGuard) private readonly origin: AccountsOriginGuard,
    @Inject(RealmSessionService) private readonly realms: RealmSessionService,
  ) {}

  /**
   * Authorize workforce self-service without falling back to the customer cookie.
   * @param context - HTTP execution context.
   * @returns True only after browser and workforce identity checks succeed.
   * @throws {UnauthorizedException} For invalid workforce sessions.
   * @throws {ForbiddenException} For invalid browser origins or request formats.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    this.origin.assertRequest(req);
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const sid = cookies[SID_COOKIE_NAME.operator];
    await this.realms.requireOperator(
      typeof sid === "string" ? sid : undefined,
    );
    return true;
  }
}
