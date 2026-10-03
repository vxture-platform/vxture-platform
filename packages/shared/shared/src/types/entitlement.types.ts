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
  /**
   * 这个池的额度用尽之后会怎样（owner 2026-10-01）。由指标的成本档派生、不入库：
   * `hard` = 平台会拒绝**预留**（`POST /usage/consume` 带 `intent="reserve"` 时回 409）；
   * `soft` = 照旧只记账。事后报账（默认档）永远 200，与此无关。
   *
   * 产品侧可以据它在动作点之前自己停下来，不必等 409——那是更好的用户体验，而 409 是
   * 平台这一侧的兜底。
   */
  enforcement: "soft" | "hard";
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
 * **2026-10-01 起这句话有了边界（owner 裁定，收窄而非推翻）**：下面说的「永远 200」
 * 管的是 `intent="report"`（默认档，事后报账）。另有 `intent="reserve"`（事前问许可）
 * —— 硬限且额度不足时回 **409** 并且**不记账**：调用方还没做事，所以没有用量可记。
 * 两档的分界正是下面那段推理的另一半：拒绝写下来不能让它没发生，**当且仅当它已经发生**。
 *
 * **Always 200 since 2026-08-10** (owner determination) —— 现在读作「report 档永远 200」。
 * The endpoint records usage and reports coverage; it does not adjudicate. `gated: true` means "your
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
  /**
   * 仅**预留被拒**时出现（HTTP 409）：这一项是硬限，而额度没覆盖住这次预留。
   * 由指标的成本档派生，不是存出来的。见 `QUOTA_ENFORCEMENTS` 的说明。
   */
  enforcement?: "hard";
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
  /**
   * 只在 **token 形态**的 consume（#547，请求体带 `tokens` 而不是 `metric`+`amount`）出现：
   *   · token_event_id —— 这次写下的原始事实行 metering.token_usage_events.id；
   *   · credits_micro  —— 这次换算出的微 credit（1 credit = 1,000,000）；没换算时缺省；
   *   · credits_deducted —— 结转之后真正走池扣掉的整数 credit（0 = 这次只进了结转）；
   *   · credit_skip_reason —— 没换算的原因（TOKEN_CREDIT_SKIP_REASONS），换算了就缺省。
   * 旧形态的调用方看不到这四个字段，形状不变。
   */
  token_event_id?: string;
  credits_micro?: number;
  credits_deducted?: number;
  credit_skip_reason?: "pre_cutover" | "failed_attempt" | "no_rate";
}
