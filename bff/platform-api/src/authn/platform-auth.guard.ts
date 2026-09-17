/**
 * platform-auth.guard.ts — the platform-face C2/C3 self-service guard.
 * @package @vxture/bff-platform-api
 *
 * Protects ONLY the platform-face self-service endpoints (T2,
 * product_210 §3.5/§8): `platform-entitlements.router.ts`,
 * `platform-usage.router.ts`, `platform-sharing.router.ts`, and
 * `platform-provisioning.router.ts`. Deliberately
 * a SEPARATE class from auth-bff's `InternalAuthGuard` (post-review split,
 * 2026-07-12) — that guard also gates operator/account admin actions that
 * trust a caller-declared actor id with no identity binding, and must never
 * accept a bearer credential any confidential OIDC client can mint for
 * itself. This guard's blast radius is scoped to exactly the three routers
 * that were designed to be product self-service in the first place.
 *
 * Two accepted credentials, either satisfies (migration, not a breaking
 * cutover — live callers like arda that haven't adopted token exchange yet
 * are unaffected):
 *
 *  - legacy: the shared AUTH_INTERNAL_TOKEN in `x-vxture-internal-auth`.
 *    Fail-closed when the token is unconfigured; constant-time compare.
 *  - S2S token (new): `Authorization: Bearer <token>`, a token minted by
 *    the token-exchange grant (T1) with `aud = PLATFORM_S2S_AUDIENCE`.
 *    Verified via S2sTokenVerifier (IdP JWKS over the internal network —
 *    D13 host split: the signing private key stays confined to auth-bff);
 *    `act.sub` (rule 6, §3.3) must be present and becomes the caller's
 *    product identity, attached to the request as `s2sCaller` for handlers
 *    to read via the `@S2sCaller()` decorator.
 *
 * 第四个（开通回执，2026-09-17）是按同一条判据加进来的，不是把半径放宽:它与
 * `POST /usage/consume` 一字不差——产品**用自己的 S2S 票上报自己的事实**，`act.sub`
 * 归因、`scopeToS2sCaller` 拒产品不符、工作区以 token 为准，请求体声明的一律丢弃。
 * 这条判据（「产品自助上报自己的事」）才是这个 guard 的边界，「三个」只是当时的计数。
 * 不属于它的东西照旧不能进来:任何信任调用方自报 actor 的运营/账号管理动作，仍然只走
 * auth-bff 的 `InternalAuthGuard`。
 * * `AUTH_INTERNAL_TOKEN` retirement (the "退役" end state) is NOT this
 * change — see TD-035/product_210 §8 T2 for the residual gap this dual-
 * accept mode does not close: neither path binds the caller's identity to
 * the specific workspace/product it asks about in the request body/query
 * (pre-existing, applies to both credentials equally).
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";
import type { S2sCallerCtx } from "./s2s-caller";
import { S2sTokenVerifier } from "./s2s-token-verifier.service";

/** Same header as auth-bff's InternalAuthGuard (`internal-auth.guard.ts`). */
export const INTERNAL_AUTH_HEADER = "x-vxture-internal-auth";

/**
 * Audience of platform-face S2S tokens. Minting stays in auth-bff
 * (`token-exchange.service.ts` PLATFORM_S2S_AUDIENCE) — two constants,
 * one contract value, "vxture" (product_210 §3.3).
 */
export const PLATFORM_S2S_AUDIENCE = "vxture";

type RequestWithS2sCaller = Request & { s2sCaller?: S2sCallerCtx };

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(S2sTokenVerifier) private readonly verifier: S2sTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithS2sCaller>();

    const authorization = req.header("authorization");
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    if (bearerToken) {
      return this.activateViaS2sToken(bearerToken, req);
    }

    const expected = this.config.auth.AUTH_INTERNAL_TOKEN;
    if (!expected) {
      throw new UnauthorizedException("internal_auth_unavailable");
    }
    const presented = req.header(INTERNAL_AUTH_HEADER) ?? "";
    if (!safeEqual(presented, expected)) {
      throw new UnauthorizedException("invalid_internal_auth");
    }
    return true;
  }

  private async activateViaS2sToken(
    token: string,
    req: RequestWithS2sCaller,
  ): Promise<boolean> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException("invalid_token");
    }
    // verify() checks alg/iss/exp but deliberately not aud (product_210's
    // token-exchange docblock: the aud check is the consuming guard's job).
    if (claims["aud"] !== PLATFORM_S2S_AUDIENCE) {
      throw new UnauthorizedException("invalid_token");
    }
    const act = claims["act"] as { sub?: unknown } | undefined;
    if (!act || typeof act.sub !== "string" || !act.sub) {
      throw new UnauthorizedException("invalid_token");
    }
    const orgId = claims["org_id"];
    const workspaceId = claims["workspace_id"];
    req.s2sCaller = {
      productCode: act.sub,
      mode: claims["mode"] === "obo" ? "obo" : "service",
      orgId: typeof orgId === "string" ? orgId : null,
      workspaceId: typeof workspaceId === "string" ? workspaceId : null,
    };
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
