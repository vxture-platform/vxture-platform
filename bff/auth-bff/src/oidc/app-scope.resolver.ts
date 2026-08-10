/**
 * app-scope.resolver.ts — Generic subscription claim resolver for tenant OIDC tokens.
 *
 * For each `{product_code}:subscription` scope requested by the RP, queries the
 * active/trial subscription for the workspace whose plan_version includes a
 * component for that product, and returns a typed claim object. Also performs
 * the one-time CAS stamp of `had_trial_at` when a trial subscription is first seen.
 *
 * Subscriptions are workspace-scoped (ADR-11: workspace = cost center) and a
 * plan_version may bundle multiple products; per-product claims are derived from
 * plan_component (§8). Only products in APP_SCOPE_CODES participate.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

// Inline the DI token to avoid importing SubscriptionModule (which pulls NestJS
// module-level code that breaks vitest in auth-bff's test scope).
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// D12 target state (arda reply-06 §3, first retiree: arda): tokens carry ZERO
// commercial fields — entitlements are C2-only, never claims. This list is the
// LEGACY exemption set; products never join it going forward, they only leave.
// umbra keeps its tenant-level subscription-claim contract
// (identity-platform-ruyin-contract.md) until its own retirement window.
export const APP_SCOPE_CODES = [
  // umbra = the cross-domain RP at ruyin.ai (ex-ruyin, product_300 §2); the new
  // client-side `ruyin` product stays out of the entitlement engine.
  "umbra",
  "runos",
  "nocus",
  "atlas",
  "ontos",
  "raven",
  "anlan",
  "forge",
  "xuanzhen",
] as const;

export type AppScopeCode = (typeof APP_SCOPE_CODES)[number];

export interface AppScopeClaim {
  subscribed: boolean;
  plan?: string;
  tier?: string; // effective tier (override applied); products interpret it
  status?: string;
  trial_end_at?: string;
}

interface SubscriptionRow {
  id: string;
  product_code: string;
  plan_code: string;
  tier_code: string;
  status: string;
  trial_end_at: Date | null;
  had_trial_at: Date | null;
}

@Injectable()
export class AppScopeResolver {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /**
   * Resolve subscription claims for all `{product_code}:subscription` scopes
   * present in `requestedScopes`. Returns a flat map of `{ [productCode]: claim }`.
   * Only products with an active or trial subscription emit a `subscribed: true`
   * claim; unsubscribed products are omitted (RP treats absence as false).
   *
   * @param workspaceId  The active workspace UUID (= metering.subscriptions.workspace_id)
   * @param requestedScopes  Set of scope strings from the token request
   */
  async resolveClaims(
    workspaceId: string,
    requestedScopes: Set<string>,
  ): Promise<Record<string, AppScopeClaim>> {
    const neededProducts = APP_SCOPE_CODES.filter((code) =>
      requestedScopes.has(`${code}:subscription`),
    );
    if (neededProducts.length === 0) return {};

    // A workspace subscription points to a plan_version that may bundle multiple
    // products (plan_component); a product is "subscribed" when any active/trial
    // subscription's version includes a component for it (§8).
    const res = await this.pool.query<SubscriptionRow>(
      `SELECT ts.id, prod.product_code, p.plan_code, ts.status, ts.trial_end_at, ts.had_trial_at,
              COALESCE(o.override_tier_code, pc.tier) AS tier_code
       FROM metering.subscriptions ts
       JOIN product.plan_versions pv ON pv.id = ts.plan_version_id AND pv.is_locked = true
       JOIN product.plans p ON p.id = pv.plan_id
       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
       JOIN product.products prod ON prod.id = pc.product_id
       LEFT JOIN metering.subscription_entitlement_overrides o
         ON o.subscription_id = ts.id AND o.product_id = prod.id
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
       WHERE ts.workspace_id = $1
         AND prod.product_code = ANY($2::text[])
         AND ts.status IN ('active', 'trialing')
         AND ts.deleted_at IS NULL
       ORDER BY ts.created_at DESC`,
      [workspaceId, neededProducts],
    );

    // Keep only the latest subscription per product (ORDER BY created_at DESC above).
    const byProduct = new Map<string, SubscriptionRow>();
    for (const row of res.rows) {
      if (!byProduct.has(row.product_code))
        byProduct.set(row.product_code, row);
    }

    // CAS stamp: write had_trial_at once for any trial sub not yet stamped.
    const unstampedIds = res.rows
      .filter((r) => r.status === "trialing" && r.had_trial_at === null)
      .map((r) => r.id);
    if (unstampedIds.length > 0) {
      await this.pool.query(
        `UPDATE metering.subscriptions
         SET had_trial_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[])
           AND status = 'trialing'
           AND had_trial_at IS NULL`,
        [unstampedIds],
      );
    }

    const claims: Record<string, AppScopeClaim> = {};
    for (const code of neededProducts) {
      const row = byProduct.get(code);
      if (!row) continue; // absent = not subscribed; omit from claims
      claims[code] = {
        subscribed: true,
        plan: row.plan_code,
        tier: row.tier_code,
        status: row.status,
        ...(row.status === "trialing" && row.trial_end_at
          ? { trial_end_at: row.trial_end_at.toISOString() }
          : {}),
      };
    }
    return claims;
  }
}
