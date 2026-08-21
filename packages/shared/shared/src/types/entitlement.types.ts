/**
 * entitlement.types.ts — the C2 entitlement + C3 consume envelope contracts.
 * @package @vxture-platform/shared
 * @description Response-face types for the platform C2/C3 APIs (envelope v2 =
 * product_220 §3 / product_310 D12; merge algorithm heritage = ADR-11 §11.3).
 * These are the authoritative shapes products (and the product-repo template's
 * C2 client / quota.ts) consume — moved here from bff/platform-api so there is
 * a single source of truth and no hand-copied drift. The platform-api engine
 * (row types, Date-bearing rows, parse/merge functions) stays in platform-api.
 *
 * v2 principle: the envelope carries COMMERCIAL FACTS only (what was bought),
 * never functional interpretation (what it unlocks) — tier→feature mapping
 * lives in each product's own versioned capability matrix.
 */
import type { SubscriptionStatus } from "../constants";

/**
 * The representative-subscription projection (single-row story): a SINGLE
 * representative subscription's facts, never mixed across subscriptions — status
 * and its timestamps must tell one coherent story. Representative = highest
 * status precedence (the SUBSCRIPTION_STATUSES array order), tie → latest period
 * end.
 */
export interface SubscriptionFacts {
  /**
   * The representative standalone (primary) subscription's real status, or
   * `null` when the workspace has never subscribed — "no subscription" is
   * absence, NOT a status value: split never-subscribed (null → Subscribe) from
   * lapsed (expired/cancelled/suspended → Renew) by presence.
   */
  status: SubscriptionStatus | null;
  /** ISO date-time; non-null while status=trialing and an end is scheduled. */
  trial_ends_at: string | null;
  /** ISO date-time; non-null while status=active with a bounded period. */
  current_period_end: string | null;
  /** Scheduled lapse: active, bounded, and auto-renew switched off. */
  cancel_at_period_end: boolean;
  /**
   * status=expired only: data kept AT LEAST until this date (owner ruling
   * 2026-07-13: lapse + 90d). A promise floor — wiping later never breaks it.
   */
  data_retention_until: string | null;
}

/**
 * v2 sale axes: merged across ALL live (active/trialing) coverage. tier =
 * highest primary; bundled = any bundled component; limits = numeric max of
 * max-strategy quota keys (the pricing-page ceiling numbers products enforce
 * locally). union/tiered strategy keys are functional semantics and no longer
 * leave the platform.
 */
export interface SaleAxes {
  /** Pure five-value commercial ladder or null (primary components only, D6). */
  tier: string | null;
  /** True when any active bundled component covers the product (product_220 §3). */
  bundled: boolean;
  /** Ceiling-type sales numbers (merge_strategy=max), highest wins, -1 = unlimited. */
  limits: Record<string, number>;
}

/**
 * metering.quota_pools stay separate pools; a period-aware read-only view (the
 * actual zero-out happens on consume via C3).
 */
export interface QuotaPoolView {
  metric: string;
  limit: number;
  remaining: number;
  priority: number;
}

/**
 * v2 envelope per product (product_220 §3). Bundled-only coverage carries
 * `status: null` here (the coverage lives on an agent plan, not a standalone
 * subscription) alongside `bundled: true`. No subscription ever → status null +
 * tier null + empty limits/pools (§11.4).
 */
export interface ProductEntitlementView extends SubscriptionFacts {
  tier: string | null;
  bundled: boolean;
  limits: Record<string, number>;
  quota_pools: QuotaPoolView[];
}

/** C2 single-product HTTP body: `GET /platform/entitlements?workspace_id&product`. */
export type EntitlementResponseSingle = {
  workspace_id: string;
  product: string;
} & ProductEntitlementView;

/** C2 batch HTTP body: `GET /platform/entitlements?workspace_id&products=a,b,c`. */
export interface EntitlementResponseBatch {
  workspace_id: string;
  entitlements: Record<string, ProductEntitlementView>;
}

/**
 * C3 consume response body: `POST /usage/consume` (product_200 §4.1 / ADR-11
 * §11.7).
 *
 * **Always 200 since 2026-08-10** (owner determination). The endpoint records
 * usage and reports coverage; it does not adjudicate. `gated: true` means "your
 * quota did not cover this call" — information, not an instruction. What to do
 * about it belongs to the caller: disable the control, keep serving, upsell.
 * It used to be a 409, which dressed the platform's opinion as an error the
 * caller must obey; callers who disagreed failed open and served anyway, so the
 * only thing the status code bought was ambiguity.
 *
 * `consumed` is what the caller USED, not what the pools covered — they differ
 * exactly when quota ran out, which is the case worth measuring. remaining_total
 * is the real post-consume total (an atomic over-limit call deducts nothing and
 * can leave a positive balance). Idempotent replay adds replayed:true.
 */
export interface ConsumeResponseBody {
  gated: boolean;
  reason?: "quota_exhausted";
  consumed: number;
  remaining_total: number;
  per_pool_breakdown: {
    subscription_id: string | null;
    metric: string;
    took: number;
    remaining: number;
  }[];
  replayed?: true;
  /**
   * The `metering.usage_events.id` this call wrote, echoed back so the caller
   * can store it beside its own request record and reconcile the two ledgers
   * directly (atlas `reqlog.request_records.usage_event_id`, atlas 210 §4).
   * Without it, correlation runs indirectly through `request_id` /
   * `idempotency_key`, which only works while both sides keep those in step.
   *
   * Optional and additive on purpose: absent when the engine wrote no event
   * (an atomic reject consumes nothing), present on a replay — a replay's event
   * id is the ORIGINAL event's, which is exactly what makes it useful for
   * reconciliation rather than a duplicate row.
   */
  event_id?: string;
}
