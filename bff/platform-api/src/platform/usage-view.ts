/**
 * usage-view.ts — pure request/response mapping for the C3 consume API
 * (product_310 P2.2; contract = ADR-11 §11.7 ③ / product_200 §4.1).
 *
 * The consume engine (single writer, waterfall) returns pool takes keyed by
 * pool id; the contract breakdown is keyed by subscription. This module maps
 * engine results + a post-consume period-aware pool read into the contract
 * body, and decides 200 vs 409 (gated):
 *   engine status "ok"           → 200 { gated:false, consumed, remaining_total, per_pool_breakdown }
 *   engine status "insufficient" → 200 { gated:true,  reason:"quota_exhausted", … }
 *
 * Both are 200 since 2026-08-10: `gated` reports that quota did not cover the
 * call, and the caller decides what that means for it. `consumed` is what the
 * caller USED, not what the pools covered — the two differ exactly when quota
 * ran out, which is the case worth measuring. remaining_total is the real
 * post-consume total, not the literal 0 of the ADR example: an atomic
 * over-limit call deducts nothing and can leave a positive balance.
 */
import type { QuotaPoolView } from "./entitlement-view";
// C3 consume response body now lives in @vxture/shared (single SoT); re-export
// so existing `from "./usage-view"` importers stay unchanged.
import type { ConsumeResponseBody } from "@vxture/shared";
export type { ConsumeResponseBody } from "@vxture/shared";

/** Engine result shape (services/commerce/subscription consume.types). */
export interface EngineConsumeResult {
  status: "ok" | "insufficient";
  consumed: string;
  perPool: { poolId: string; took: string }[];
  eventId?: string;
  replayed: boolean;
}

/** Pool identity read alongside the view (poolId → subscription linkage). */
export interface PoolIdentity {
  poolId: string;
  subscriptionId: string | null;
  view: QuotaPoolView;
}

export function buildConsumeResponse(
  result: EngineConsumeResult,
  pools: PoolIdentity[],
  metric: string,
): { statusCode: 200; body: ConsumeResponseBody } {
  const byPoolId = new Map(pools.map((p) => [p.poolId, p]));
  const remainingTotal = pools.reduce((s, p) => s + p.view.remaining, 0);

  const body: ConsumeResponseBody = {
    gated: result.status === "insufficient",
    consumed: Number(result.consumed),
    remaining_total: remainingTotal,
    per_pool_breakdown: result.perPool.map((t) => {
      const pool = byPoolId.get(t.poolId);
      return {
        subscription_id: pool?.subscriptionId ?? null,
        metric,
        took: Number(t.took),
        remaining: pool?.view.remaining ?? 0,
      };
    }),
    ...(result.replayed ? { replayed: true as const } : {}),
    // Echo the usage event id whenever the engine wrote one (platform#220).
    // Deliberately NOT restricted to the 200 path as the request suggested: a
    // divisible partial success answers 409 with consumed>0, and that call did
    // write an event — dropping the id exactly there would leave the hardest
    // rows to reconcile as the only ones without a correlation key.
    ...(result.eventId ? { event_id: result.eventId } : {}),
  };
  // Always 200 (owner determination 2026-08-10): this endpoint records usage and
  // reports coverage; it does not decide what the caller should do about a gap.
  // `gated` stays in the body as INFORMATION — "your quota did not cover this" —
  // and the caller acts on it (disable the control, keep serving, upsell). It
  // used to be a 409, which made the platform's opinion look like an error the
  // caller had to obey, and callers who disagreed simply failed open and served
  // anyway. The signal is the same; only the pretence of authority is gone.
  if (result.status === "insufficient") {
    body.reason = "quota_exhausted";
  }
  return { statusCode: 200, body };
}

const PRODUCT_CODE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const METRIC_KEY_RE = /^[a-z][a-z0-9_.\-]{0,63}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** metering.usage_idempotencies.idempotency_key is varchar(128). */
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,128}$/;

export interface ParsedConsumeBody {
  workspaceId: string;
  productCode: string;
  metric: string;
  /** positive integer, forwarded as string (engine is bigint-valued) */
  amount: string;
  idempotencyKey: string;
  /**
   * Optional end-user attribution (bare UUID → account.users, 边界#2 no FK).
   * Products that don't attribute yet simply omit it — the event lands in the
   * NULL "unattributed" bucket (owner 2026-08-20, per-user usage analytics).
   */
  endUserId?: string;
}

/**
 * Validate the §11.7 consume body. Throws Error with a stable machine code;
 * the router maps it to 400. `amount` accepts a positive integer as number or
 * numeric string (bigint-safe: digits-only strings pass without Number()).
 */
export function parseConsumeBody(body: {
  workspace_id?: unknown;
  product?: unknown;
  metric?: unknown;
  amount?: unknown;
  idempotency_key?: unknown;
  end_user_id?: unknown;
}): ParsedConsumeBody {
  const workspaceId =
    typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!UUID_RE.test(workspaceId)) throw new Error("invalid_workspace_id");

  const productCode = typeof body.product === "string" ? body.product : "";
  if (!PRODUCT_CODE_RE.test(productCode)) throw new Error("invalid_product");

  const metric = typeof body.metric === "string" ? body.metric : "";
  if (!METRIC_KEY_RE.test(metric)) throw new Error("invalid_metric");

  let amount: string;
  if (typeof body.amount === "number") {
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0) {
      throw new Error("invalid_amount");
    }
    amount = String(body.amount);
  } else if (
    typeof body.amount === "string" &&
    /^[1-9]\d{0,17}$/.test(body.amount)
  ) {
    amount = body.amount;
  } else {
    throw new Error("invalid_amount");
  }

  const idempotencyKey =
    typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw new Error("invalid_idempotency_key");
  }

  // Absent/null/"" = unattributed (tolerant by design); PRESENT but malformed
  // is still a 400 — a product that claims to attribute must attribute validly.
  let endUserId: string | undefined;
  if (body.end_user_id != null && body.end_user_id !== "") {
    const raw =
      typeof body.end_user_id === "string" ? body.end_user_id.trim() : "";
    if (!UUID_RE.test(raw)) throw new Error("invalid_end_user_id");
    endUserId = raw;
  }

  return {
    workspaceId,
    productCode,
    metric,
    amount,
    idempotencyKey,
    ...(endUserId ? { endUserId } : {}),
  };
}

export interface ParsedGaugeBody {
  workspaceId: string;
  productCode: string;
  metric: string;
  /** absolute water level, bigint-valued, >= 0 (gauge allows 0). */
  value: string;
  observedAt: Date;
}

/**
 * Validate the PUT /usage/gauge body (data_commerce_240 §3). Throws Error with
 * a stable machine code; the router maps it to 400. `value` is an ABSOLUTE
 * non-negative water level (unlike consume's positive delta); `observed_at` is
 * an ISO-8601 timestamp used as the last-write-wins ordering key.
 */
export function parseGaugeBody(body: {
  workspace_id?: unknown;
  product?: unknown;
  metric?: unknown;
  value?: unknown;
  observed_at?: unknown;
}): ParsedGaugeBody {
  const workspaceId =
    typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!UUID_RE.test(workspaceId)) throw new Error("invalid_workspace_id");

  const productCode = typeof body.product === "string" ? body.product : "";
  if (!PRODUCT_CODE_RE.test(productCode)) throw new Error("invalid_product");

  const metric = typeof body.metric === "string" ? body.metric : "";
  if (!METRIC_KEY_RE.test(metric)) throw new Error("invalid_metric");

  let value: string;
  if (typeof body.value === "number") {
    if (!Number.isSafeInteger(body.value) || body.value < 0) {
      throw new Error("invalid_value");
    }
    value = String(body.value);
  } else if (
    typeof body.value === "string" &&
    /^(0|[1-9]\d{0,18})$/.test(body.value)
  ) {
    value = body.value;
  } else {
    throw new Error("invalid_value");
  }
  // bigint(8) upper bound
  if (BigInt(value) > 9223372036854775807n) throw new Error("invalid_value");

  const observedRaw =
    typeof body.observed_at === "string" ? body.observed_at : "";
  const observedAt = new Date(observedRaw);
  if (observedRaw === "" || Number.isNaN(observedAt.getTime())) {
    throw new Error("invalid_observed_at");
  }

  return { workspaceId, productCode, metric, value, observedAt };
}
