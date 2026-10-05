/**
 * s2s-caller.ts — the calling product's identity, derived from a verified
 * T2 S2S token (product_210 §3.5/§8). Populated by PlatformAuthGuard (the
 * platform-face C2/C3 self-service routers ONLY — NOT InternalAuthGuard,
 * which protects operator/account admin-internal routers and must never
 * accept this token type) when the request authenticates via
 * `Authorization: Bearer <token>` instead of the legacy
 * `x-vxture-internal-auth` header; absent on the legacy path.
 *
 * Mirrors current-user.ts's shape/decorator pattern (populated by
 * AccessTokenGuard) — same idiom, different guard, different token type.
 */
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface S2sCallerCtx {
  /**
   * act.sub — the calling product's product_code. On a delegated ticket it is
   * the L1 reporter's client_id (today `"atlas"`), which is NOT a catalog
   * product: see `delegated`.
   */
  productCode: string;
  mode: "obo" | "service";
  orgId: string | null;
  workspaceId: string | null;
  /**
   * The ticket's `delegated` claim (decision 3 PR C, 2026-10-04 — L3 分层设计
   * §4.3 形态 A). `true` only on a delegated-reporter ticket minted by
   * auth-bff for an allowlisted L1 reporter: the reporter attributes usage
   * to the CALLER product (ADR-013 D1), so `act.sub` names the reporter, the
   * request's declared product is the ATTRIBUTED product, and the ticket
   * carries no workspace (the declared one is used — `scopeToS2sCaller`).
   * `false` on every product ticket; the guard sets it from the claim, never
   * from the request.
   */
  delegated: boolean;
}

/**
 * Inject the S2S caller identity (populated by PlatformAuthGuard's Bearer
 * path). `undefined` when the request authenticated via the legacy shared
 * secret instead — handlers that need to distinguish must check for that.
 */
export const S2sCaller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): S2sCallerCtx | undefined =>
    (ctx.switchToHttp().getRequest() as { s2sCaller?: S2sCallerCtx }).s2sCaller,
);
