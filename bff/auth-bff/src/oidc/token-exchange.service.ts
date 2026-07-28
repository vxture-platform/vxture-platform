/**
 * token-exchange.service.ts — RFC 8693 token exchange grant (T1, product_210 §3).
 *
 * Mints short-lived S2S tokens for product↔product calls, replacing
 * `AUTH_INTERNAL_TOKEN` as the long-term direction (product_210 §1/§5).
 * Two modes (product_210 §3.2):
 *  - OBO (on-behalf-of): the caller presents a `subject_token` — a real user
 *    access_token this IdP issued. Context (org/workspace/sub) is read from
 *    that token, not trusted from the request body — the caller cannot forge
 *    a workspace it has no user session in.
 *  - service: no subject_token; the caller declares `workspace_id` (+ optional
 *    `org_id`) explicitly. D2 gates minting on the caller product holding real
 *    coverage of that workspace (active/trialing subscription OR a provisioned
 *    state) — "you can only speak for a workspace you're actually opened in".
 *
 * Claims follow product_210 §3.1 exactly: `aud` = target product_code (single
 * value), `act.sub` = caller product_code, `org_id`/`workspace_id`, `mode`,
 * `scope = tool:{target}` (product-level, D3). `sub` is present only in OBO
 * mode (service-mode tokens have no user behind them). TTL = 300s,
 * not-refreshable (D1) — the caller re-exchanges on expiry.
 *
 * The provider (被调方) verification obligations (§3.3: RS256-only, kid
 * lookup, iss/aud/exp/act.sub checks, never accept AUTH_INTERNAL_TOKEN for
 * this) are NOT this file's concern — they land wherever a tool endpoint
 * verifies inbound S2S tokens: per-provider for T3, and — for the platform's
 * own `/platform/*`/`/usage/*` endpoints — `PlatformAuthGuard` (T2, scoped
 * to those three routers only — NOT `InternalAuthGuard`, which protects
 * operator/account admin-internal routers and must never accept this
 * grant's tokens), which accepts `aud = PLATFORM_S2S_AUDIENCE` tokens
 * minted by this same grant.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { OidcKeyService } from "./oidc-key.service";

// Inline the DI token (same idiom as app-scope.resolver.ts): avoid importing
// SubscriptionModule directly here, which pulls NestJS module-level code that
// breaks vitest in auth-bff's test scope. SubscriptionModule is already
// imported into AppModule, so the token resolves at runtime regardless.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/**
 * TD-034: support.audit_logs.actor_type has no value that fits "the caller
 * was a product/client, not a person" — this is the platform-wide zero-UUID
 * sentinel already used for the same "no real actor" purpose elsewhere (e.g.
 * services/model/platform's COMMERCE_SENTINEL_UUID). actor_type='system'
 * pairs with it here rather than inventing a new per-package sentinel.
 */
const AUDIT_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
export const TOKEN_EXCHANGE_ISSUED_TOKEN_TYPE =
  "urn:ietf:params:oauth:token-type:access_token";
/** D1: short enough that a leaked/transitively-forwarded token has little value. */
export const TOKEN_EXCHANGE_TTL_SECONDS = 300;
/**
 * T2 (product_210 §3.5/§8): the platform itself as a token-exchange target —
 * for the platform-face endpoints (`/platform/*`, `/usage/*`) migrating off
 * `AUTH_INTERNAL_TOKEN`. L0/vxture is explicitly NOT a row in
 * product.products (product_100 §1: "L0 不是产品"), so no product has this
 * code today. `resolveTargetProductCode` still checks product.products
 * FIRST and only falls back to this sentinel when no real row matches
 * (post-review hardening, 2026-07-12) — the DB stays authoritative, so a
 * hypothetical future product literally named "vxture" would win over the
 * sentinel rather than being silently shadowed by it.
 */
export const PLATFORM_S2S_AUDIENCE = "vxture";

/**
 * Platform-level caller allowlist (2026-07-28, atlas C2/C3 wiring line):
 * confidential platform BFFs that are not themselves products (productCode
 * null) but need to mint service-mode tokens on behalf of an
 * already-authenticated tenant workspace — their own session middleware,
 * not this service, establishes that workspace binding before this code
 * path is ever reached. `console` is the first member: it proxies tenant
 * model/grant/quota/usage reads to atlas and needs a signed S2S token
 * (atlas's S2sAuthGuard has no shared-secret fallback). Deliberately an
 * explicit allowlist, not "any platform-level client" — keeps the blast
 * radius of this bypass scoped and auditable.
 */
const PLATFORM_LEVEL_S2S_CALLERS = new Set(["console"]);

export interface TokenExchangeCaller {
  /** The authenticated client_id (product_210 §2: caller's existing confidential client). */
  clientId: string;
  /** Resolved product_code for that client, or null for a platform-level client. */
  productCode: string | null;
}

export interface TokenExchangeRequest {
  /** Target product_code — becomes the minted token's `aud`. */
  audience: string | undefined;
  /** OBO mode when present: a user access_token this IdP issued. */
  subjectToken: string | undefined;
  /** service mode: explicit workspace context (required when no subject_token). */
  workspaceId: string | undefined;
  orgId: string | undefined;
}

export interface TokenExchangeResult {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenExchangeService {
  private readonly logger = new Logger(TokenExchangeService.name);

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
  ) {}

  async exchange(
    caller: TokenExchangeCaller,
    req: TokenExchangeRequest,
  ): Promise<TokenExchangeResult> {
    // Operator-OBO (product_250 M-1, batch B): a workforce-realm RP (admin —
    // and later the capability-console shell) presents its operator's access
    // token to mint a management-plane token for a provider (aud=atlas/...).
    // Dispatched before the product-caller gate below, because these callers
    // are platform-level clients (productCode null) which T1 rightly rejects.
    if (req.subjectToken) {
      const subjClaims = this.tryVerify(req.subjectToken);
      if (subjClaims && subjClaims["userType"] === "operator") {
        return this.exchangeOperator(caller, req, subjClaims);
      }
    }
    if (
      !req.subjectToken &&
      !caller.productCode &&
      PLATFORM_LEVEL_S2S_CALLERS.has(caller.clientId)
    ) {
      return this.exchangePlatformCaller(caller, req);
    }
    if (!caller.productCode) {
      // A platform-level client (website/console/admin) has no product
      // identity to assert via act.sub — it is not a valid T1 caller,
      // unless it's in PLATFORM_LEVEL_S2S_CALLERS (handled above).
      throw new BadRequestException("invalid_client");
    }
    if (!req.audience) {
      throw new BadRequestException("invalid_request");
    }
    const target = await this.resolveTargetProductCode(req.audience);
    if (!target) {
      throw new BadRequestException("invalid_target");
    }

    const context = req.subjectToken
      ? await this.resolveOboContext(req.subjectToken, caller.clientId)
      : await this.resolveServiceContext(caller.productCode, req);

    // Explicit jti (rather than letting sign() generate one internally) so
    // the audit record below cites the exact id the issued token carries.
    const jti = randomUUID();
    const accessToken = this.keys.sign(
      {
        act: { sub: caller.productCode },
        org_id: context.orgId,
        tenant_id: context.tenantId,
        workspace_id: context.workspaceId,
        mode: context.mode,
        scope: `tool:${target}`,
      },
      {
        audience: target,
        // exactOptionalPropertyTypes: omit the key entirely in service mode
        // rather than passing `subject: undefined`.
        ...(context.sub !== undefined ? { subject: context.sub } : {}),
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: jti,
      },
    );
    await this.recordAudit({
      jti,
      callerProduct: caller.productCode,
      targetProduct: target,
      mode: context.mode,
      workspaceId: context.workspaceId,
      orgId: context.orgId,
      tenantId: context.tenantId,
    });
    return { accessToken, expiresIn: TOKEN_EXCHANGE_TTL_SECONDS };
  }

  /** Local verify that reports "not ours/expired" as null instead of throwing. */
  private tryVerify(token: string): Record<string, unknown> | null {
    try {
      return this.keys.verify(token);
    } catch {
      return null;
    }
  }

  /**
   * Operator-OBO mode (product_250 M-1): mint a short-lived management-plane
   * token carrying the OPERATOR's identity for a provider audience. Distinct
   * from T1 in every dimension that matters:
   *  - caller = a workforce-realm RP client (platform-level, productCode null),
   *    asserted via the same single-audience discipline as T1 OBO — the
   *    presented operator token must have been minted FOR this exact caller;
   *  - subject = a person (opr_<id>), not a service; `amr` is mirrored from
   *    the operator session so providers can enforce step-up freshness on
   *    high-stakes endpoints (M-1) without re-running the ceremony;
   *  - no org/workspace context (operators are global, dataScope=global) and
   *    scope = `mgmt:{target}` — structurally distinguishable from S2S
   *    `tool:{target}` tokens so a management token can never pass a supply-
   *    surface guard by accident (and vice versa).
   * The platform sentinel audience is refused: management tokens target real
   * provider products only.
   */
  private async exchangeOperator(
    caller: TokenExchangeCaller,
    req: TokenExchangeRequest,
    subjClaims: Record<string, unknown>,
  ): Promise<TokenExchangeResult> {
    if (subjClaims["aud"] !== caller.clientId) {
      throw new BadRequestException("invalid_request");
    }
    if (!req.audience || req.audience === PLATFORM_S2S_AUDIENCE) {
      throw new BadRequestException("invalid_target");
    }
    const target = await this.resolveTargetProductCode(req.audience);
    if (!target || target === PLATFORM_S2S_AUDIENCE) {
      throw new BadRequestException("invalid_target");
    }
    const sub = subjClaims["sub"];
    if (typeof sub !== "string" || !sub) {
      throw new BadRequestException("invalid_request");
    }
    const amr = subjClaims["amr"];
    const operatorRole = subjClaims["operator_role"];
    const jti = randomUUID();
    const accessToken = this.keys.sign(
      {
        act: { sub: caller.clientId },
        mode: "operator",
        userType: "operator",
        realm: "workforce",
        scope: `mgmt:${target}`,
        ...(typeof operatorRole === "string" && operatorRole
          ? { operator_role: operatorRole }
          : {}),
        ...(Array.isArray(amr) && amr.length > 0 ? { amr } : {}),
      },
      {
        audience: target,
        subject: sub,
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: jti,
      },
    );
    await this.recordAudit({
      jti,
      callerProduct: caller.clientId,
      targetProduct: target,
      mode: "operator",
      workspaceId: "",
      orgId: null,
    });
    return { accessToken, expiresIn: TOKEN_EXCHANGE_TTL_SECONDS };
  }

  /**
   * Platform-caller mode (2026-07-28): an allowlisted platform-level BFF
   * (PLATFORM_LEVEL_S2S_CALLERS, productCode null) mints a service-mode
   * token declaring an explicit workspace_id, without asserting a product
   * identity via act.sub — act.sub becomes the caller's own client_id
   * instead (e.g. "console"), so a provider can distinguish "the platform's
   * console surface asked on a tenant's behalf" from "product X called for
   * its own execution".
   *
   * Deliberately reuses `mode: "service"` (not a new mode value) — the
   * shape is the same (no subject_token, explicit workspace_id) and a new
   * mode would need every provider's guard to accept it; providers that
   * already accept T1 service-mode tokens need no change on their end.
   *
   * No D2 coverage check here (there is no caller product to check
   * subscription coverage for): workspace legitimacy is the caller's own
   * responsibility, already established by its session middleware before
   * this endpoint is reached — these are same-trust-boundary confidential
   * clients (the allowlist), not external parties.
   */
  private async exchangePlatformCaller(
    caller: TokenExchangeCaller,
    req: TokenExchangeRequest,
  ): Promise<TokenExchangeResult> {
    if (!req.audience) {
      throw new BadRequestException("invalid_request");
    }
    const target = await this.resolveTargetProductCode(req.audience);
    if (!target || target === PLATFORM_S2S_AUDIENCE) {
      throw new BadRequestException("invalid_target");
    }
    if (!req.workspaceId) {
      throw new BadRequestException("invalid_request");
    }
    const tenantId = await this.resolveTenantId(req.workspaceId);
    const jti = randomUUID();
    const accessToken = this.keys.sign(
      {
        act: { sub: caller.clientId },
        org_id: req.orgId ?? null,
        tenant_id: tenantId,
        workspace_id: req.workspaceId,
        mode: "service",
        scope: `tool:${target}`,
      },
      {
        audience: target,
        expiresInSec: TOKEN_EXCHANGE_TTL_SECONDS,
        jwtid: jti,
      },
    );
    await this.recordAudit({
      jti,
      callerProduct: caller.clientId,
      targetProduct: target,
      mode: "service",
      workspaceId: req.workspaceId,
      orgId: req.orgId ?? null,
      tenantId,
    });
    return { accessToken, expiresIn: TOKEN_EXCHANGE_TTL_SECONDS };
  }

  /**
   * product_210 §6: append-only audit trail for successful token exchanges
   * (actor_type='system' — the caller is a product/client, not a person; see
   * AUDIT_SYSTEM_ACTOR_ID). Best-effort: a write failure must not undo an
   * already-issued token, mirroring provisioning's safeProvisioningHook
   * best-effort convention. Not called on the failure path (product_210 §8's
   * chosen direction scopes this to the success tail; D1's 300s TTL already
   * bounds the abuse window of an unaudited failed attempt).
   */
  private async recordAudit(input: {
    jti: string;
    /** product_code for T1 modes; the workforce client_id for operator mode. */
    callerProduct: string;
    targetProduct: string;
    mode: "obo" | "service" | "operator";
    workspaceId: string;
    orgId: string | null;
    tenantId?: string | null;
  }): Promise<void> {
    try {
      await this.pool.query(
        `insert into support.audit_logs
           (actor_type, actor_id, action, result, resource_type, resource_id, after, created_at)
         values ('system', $1, 'oidc.token_exchange.issued', 'success', 'oidc_token_exchange', $2, $3, now())`,
        [
          AUDIT_SYSTEM_ACTOR_ID,
          input.jti,
          JSON.stringify({
            caller_product: input.callerProduct,
            target_product: input.targetProduct,
            mode: input.mode,
            workspace_id: input.workspaceId,
            org_id: input.orgId,
            tenant_id: input.tenantId ?? null,
          }),
        ],
      );
    } catch (e) {
      this.logger.error(
        `token-exchange audit write failed (jti=${input.jti}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * `tenant_id` claim (vxture-atlas#66 follow-up, platform#170): resolved
   * server-side from the workspace's owning row, not from a caller-declared
   * `org_id` or the session's `active_org` claim — those are both nullable
   * for `personal` tenants (product_210's org concept only covers the
   * `organization` tenant kind), so a token minted for a personal tenant's
   * workspace previously carried no tenancy identity at all. A workspace
   * always has exactly one owning tenant (`tenancy.workspaces.tenant_id`,
   * NOT NULL), so this is always resolvable regardless of tenant kind.
   */
  private async resolveTenantId(workspaceId: string): Promise<string | null> {
    const res = await this.pool.query<{ tenant_id: string }>(
      `select tenant_id from tenancy.workspaces
        where id = $1 and deleted_at is null`,
      [workspaceId],
    );
    return res.rows[0]?.tenant_id ?? null;
  }

  /**
   * DB-first, sentinel-fallback (product_100 §1's "L0 不是产品" means no row
   * exists for PLATFORM_S2S_AUDIENCE today — but checking the table first,
   * rather than short-circuiting on the literal string, means the DB stays
   * authoritative if that ever changes, instead of a real product being
   * silently shadowed by the sentinel).
   */
  private async resolveTargetProductCode(
    audience: string,
  ): Promise<string | null> {
    const res = await this.pool.query<{ product_code: string }>(
      `select product_code from product.products
        where product_code = $1 and status = 'active'`,
      [audience],
    );
    if (res.rows[0]) {
      return res.rows[0].product_code;
    }
    return audience === PLATFORM_S2S_AUDIENCE ? PLATFORM_S2S_AUDIENCE : null;
  }

  /**
   * OBO: read org/workspace/sub straight off a presented user access_token,
   * self-verified against this IdP's own signing key (`OidcKeyService.verify`
   * — the same check `/userinfo`/`/revoke` do). The caller cannot forge
   * context this way; a malformed/expired/foreign token is rejected outright.
   *
   * Single-audience discipline (product_210 §3.1: "A 的 token 到 B 必拒"):
   * the presented subject_token must have been minted FOR this exact caller
   * (`aud === callerClientId`, mirroring how user access_tokens are minted —
   * `audience: client.clientId` in oidc.service.ts's issueAccessAndId). Without
   * this check, any product could OBO with any user token this IdP ever
   * issued to ANY client, regardless of which client it was meant for —
   * post-review correction, 2026-07-12.
   */
  private async resolveOboContext(
    subjectToken: string,
    callerClientId: string,
  ): Promise<{
    mode: "obo";
    sub: string;
    orgId: string | null;
    tenantId: string | null;
    workspaceId: string;
  }> {
    let claims: Record<string, unknown>;
    try {
      claims = this.keys.verify(subjectToken);
    } catch {
      throw new BadRequestException("invalid_request");
    }
    if (claims["aud"] !== callerClientId) {
      throw new BadRequestException("invalid_request");
    }
    const workspaceId = claims["active_workspace"];
    if (typeof workspaceId !== "string" || !workspaceId) {
      // No active workspace on the presented token — nothing to act on
      // behalf of (also rejects service-mode S2S tokens presented here,
      // which never carry active_workspace).
      throw new BadRequestException("invalid_request");
    }
    const sub = claims["sub"];
    if (typeof sub !== "string" || !sub) {
      throw new BadRequestException("invalid_request");
    }
    const orgId = claims["active_org"];
    const tenantId = await this.resolveTenantId(workspaceId);
    return {
      mode: "obo",
      sub,
      orgId: typeof orgId === "string" ? orgId : null,
      tenantId,
      workspaceId,
    };
  }

  /**
   * service mode: D2 (product_210 §3.2/§9) — the caller product must hold
   * real coverage of the declared workspace, checked directly (no configured
   * allow-list to maintain/drift): an active/trialing subscription OR a
   * provisioned state. Query shape mirrors app-scope.resolver.ts (inlined
   * pool query, same reason: avoid pulling module-level code into this
   * package's test scope).
   */
  private async resolveServiceContext(
    callerProductCode: string,
    req: TokenExchangeRequest,
  ): Promise<{
    mode: "service";
    sub: undefined;
    orgId: string | null;
    tenantId: string | null;
    workspaceId: string;
  }> {
    if (!req.workspaceId) {
      throw new BadRequestException("invalid_request");
    }
    const res = await this.pool.query<{ covered: boolean }>(
      `select (
         exists (
           select 1 from metering.subscriptions ts
           join product.plan_components pc on pc.plan_version_id = ts.plan_version_id
           join product.products prod on prod.id = pc.product_id
           where ts.workspace_id = $1
             and prod.product_code = $2
             and ts.status in ('active', 'trialing')
             and ts.deleted_at is null
         )
         or exists (
           select 1 from provisioning.provisionings pr
           join product.products prod on prod.id = pr.product_id
           where pr.workspace_id = $1
             and prod.product_code = $2
             and pr.status = 'provisioned'
         )
       ) as covered`,
      [req.workspaceId, callerProductCode],
    );
    if (!res.rows[0]?.covered) {
      throw new BadRequestException("invalid_target");
    }
    const tenantId = await this.resolveTenantId(req.workspaceId);
    return {
      mode: "service",
      sub: undefined,
      orgId: req.orgId ?? null,
      tenantId,
      workspaceId: req.workspaceId,
    };
  }
}
