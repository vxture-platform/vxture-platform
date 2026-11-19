/**
 * Accept only workspace-bound product tickets for the minimal roster read.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category guard
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import type { S2sCallerCtx } from "./s2s-caller";
import { S2sTokenVerifier } from "./s2s-token-verifier.service";

// ============================================================================
// Strict product ticket authentication
// ============================================================================

/** No legacy shared-secret or Console session path is accepted here. */
@Injectable()
export class ProductRosterGuard implements CanActivate {
  constructor(
    @Inject(S2sTokenVerifier) private readonly verifier: S2sTokenVerifier,
  ) {}

  /**
   * Verify the narrow tool ticket before creating the handler's scope.
   * @param context - Current HTTP request.
   * @returns True when a verified product ticket is attached to the request.
   * @throws UnauthorizedException For every other credential or ticket shape.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { s2sCaller?: S2sCallerCtx }>();
    const deny = () =>
      new UnauthorizedException({
        code: "PRODUCT_ROSTER_INVALID_TOKEN",
        message: "A valid workspace-bound product ticket is required.",
        retryable: false,
      });
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ") || !header.slice(7)) throw deny();
    let claims: Record<string, unknown>;
    try {
      claims = await this.verifier.verify(header.slice(7));
    } catch {
      throw deny();
    }
    const act = claims["act"] as { sub?: unknown } | null;
    const mode = claims["mode"];
    if (
      claims["aud"] !== "vxture" ||
      claims["scope"] !== "tool:vxture" ||
      claims["delegated"] === true ||
      (mode !== "obo" && mode !== "service") ||
      typeof act?.sub !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(act.sub) ||
      typeof claims["org_id"] !== "string" ||
      typeof claims["workspace_id"] !== "string" ||
      typeof claims["exp"] !== "number" ||
      !Number.isFinite(claims["exp"]) ||
      claims["exp"] <= Date.now() / 1000 ||
      (mode === "obo" && typeof claims["sub"] !== "string") ||
      (mode === "service" && claims["sub"] != null)
    )
      throw deny();
    req.s2sCaller = {
      productCode: act.sub,
      mode,
      delegated: false,
      orgId: claims["org_id"],
      workspaceId: claims["workspace_id"],
      ...(mode === "obo" ? { subject: claims["sub"] as string } : {}),
    };
    return true;
  }
}
