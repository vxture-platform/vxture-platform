/**
 * Browser boundary shared by both account domains.
 * @package @vxture/bff-auth
 * @layer Application
 * @category guard
 * @author AI-Generated
 * @date 2026-11-07
 */
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
// ⚠️ 跨层引用: Read configured identity origins through the public configuration API.
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";

export const ACCOUNT_RAW_IMAGE = "accounts:raw-image";

@Injectable()
export class AccountsOriginGuard {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /**
   * Reject untrusted browser callers independently of the general CORS allowlist.
   * @param req - Incoming account-center request.
   * @param rawImage - Server-selected exception for the raw avatar upload.
   * @returns Nothing when the origin and body format are permitted.
   * @throws {ForbiddenException} For an invalid origin or body format.
   */
  assertRequest(req: Request, rawImage = false): void {
    const allowed = new Set([
      new URL(this.config.platform.LOGIN_UI_BASE_URL).origin,
      new URL(this.config.auth.OIDC_ISSUER).origin,
    ]);
    const origin = req.get("origin");
    const safe = req.method === "GET" || req.method === "HEAD";
    // An exact Origin remains authoritative for explicitly configured cross-site UIs.
    if (
      (origin !== undefined && !allowed.has(origin)) ||
      (!safe && !origin) ||
      (!origin && req.get("sec-fetch-site") === "cross-site")
    ) {
      throw new ForbiddenException("accounts_origin_forbidden");
    }
    if (
      !safe &&
      req.method !== "DELETE" &&
      !rawImage &&
      !req.is("application/json")
    ) {
      throw new ForbiddenException("accounts_json_required");
    }
  }
}
