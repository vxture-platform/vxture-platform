/**
 * Dedicated authentication for product provisioning discovery.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category guard
 * @author AI-Generated
 * @date 2026-10-12
 */
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { isProductCode } from "../platform/product-code";
import type { S2sCallerCtx } from "./s2s-caller";
import { S2sTokenVerifier } from "./s2s-token-verifier.service";

// ── Grant vocabulary ───────────────────────────────────────────────────

/** Exact scope of the non-workspace, read-only discovery ticket. */
export const PROVISIONING_READ_SCOPE = "provisioning:read";

// ── Authentication ─────────────────────────────────────────────────────

/** Accept only a verified discovery ticket; shared secrets are never accepted. */
@Injectable()
export class ProvisioningReadGuard implements CanActivate {
  constructor(
    @Inject(S2sTokenVerifier) private readonly verifier: S2sTokenVerifier,
  ) {}

  /** Bind product identity exclusively to verified act.sub. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { s2sCaller?: S2sCallerCtx }>();
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ") || !authorization.slice(7)) {
      throw new UnauthorizedException({
        code: "PROVISIONING_READ_TOKEN_INVALID",
        message: "A valid product provisioning read ticket is required.",
        retryable: false,
      });
    }
    let claims: Record<string, unknown>;
    try {
      claims = await this.verifier.verify(authorization.slice(7));
    } catch {
      throw new UnauthorizedException({
        code: "PROVISIONING_READ_TOKEN_INVALID",
        message: "A valid product provisioning read ticket is required.",
        retryable: false,
      });
    }
    const act = claims["act"];
    const productCode =
      typeof act === "object" && act !== null && !Array.isArray(act)
        ? (act as Record<string, unknown>)["sub"]
        : undefined;
    if (
      claims["aud"] !== "vxture" ||
      claims["scope"] !== PROVISIONING_READ_SCOPE ||
      claims["mode"] !== "service" ||
      typeof productCode !== "string" ||
      !isProductCode(productCode) ||
      typeof claims["exp"] !== "number" ||
      !Number.isFinite(claims["exp"]) ||
      claims["exp"] <= Math.floor(Date.now() / 1000) ||
      [
        "sub",
        "workspace_id",
        "org_id",
        "tenant_id",
        "active_workspace",
        "active_org",
        "delegated",
        "userType",
        "realm",
      ].some((key) => key in claims)
    ) {
      throw new UnauthorizedException({
        code: "PROVISIONING_READ_TOKEN_INVALID",
        message: "A valid product provisioning read ticket is required.",
        retryable: false,
      });
    }
    req.s2sCaller = {
      productCode,
      mode: "service",
      orgId: null,
      workspaceId: null,
      delegated: false,
    };
    return true;
  }
}
