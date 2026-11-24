/**
 * Reject disabled desktop routes and cross-surface requests.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category middleware
 * @author AI-Generated
 * @date 2026-11-23
 */
import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { DESKTOP_RUNTIME, type DesktopRuntime } from "./runtime";
@Injectable()
export class DesktopEnabledGuard implements CanActivate {
  constructor(
    @Inject(DESKTOP_RUNTIME) private readonly runtime: DesktopRuntime | null,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !this.runtime ||
      request.headers.host?.toLowerCase() !==
        new URL(this.runtime.config.base).host.toLowerCase()
    )
      throw new NotFoundException({
        code: "DESKTOP_UNAVAILABLE",
        message: "Endpoint not found",
      });
    return true;
  }
}
