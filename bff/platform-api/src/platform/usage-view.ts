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
import type { CreateSystemNoticeInput } from "@vxture/service-notice";
import {
  OPS_NOTICE_INFO_TTL_MS,
  OPS_SIGNAL_REFERENCE_TYPE,
  opsNoticeDayKey,
  opsNoticeReferenceId,
  opsNoticeTenantLabel,
} from "../notifications/ops-notice";
import type { QuotaPoolView } from "./entitlement-view";
// C3 consume response body now lives in @vxture-platform/shared (single SoT); re-export
// so existing `from "./usage-view"` importers stay unchanged.
import type { ConsumeResponseBody } from "@vxture-platform/shared";
export type { ConsumeResponseBody } from "@vxture-platform/shared";

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
  /**
   * 该池当前计费周期的起点（metering.quota_pools.current_period_start）。可选：
   * 只有配额耗尽那条运营通告要它（一个周期一条的去重键），既有调用方与既有 spec
   * 不必因此改形状。不重置的池本来就是 null。
   */
  periodStart?: Date | null;
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

/* ── 配额耗尽 → 一条运营通告（2026-09-28 第二批 C-2）───────────────────────── */

/**
 * 「本次调用没被配额覆盖」这件事，此前在库里**一行都不留**：gated 只出现在回给调用方的
 * 响应体里，metering.usage_events 记的是实际扣减，运营这边看不出任何异常。owner
 * 2026-09-28「把信息做全做多」，所以这一刻要留一条通告。
 *
 * 一个计费周期一条，不是一次请求一条：gated 是**持续状态**，客户的集成多半会接着重试，
 * 按请求发会在半分钟里刷满整页。去重键带周期起点，所以下一个周期它会自己再播一次
 * （那时才是新信息）。判重的两道：进程内的一层（不必每次都打库）与表上的部分唯一索引
 * （多实例、重启后仍然一事一条）。
 */
export interface QuotaExhaustedFacts {
  /** 只进去重键，不进标题正文——通告里不出现 UUID。 */
  readonly workspaceId: string;
  readonly productCode: string;
  readonly metric: string;
  /** 本次请求量（引擎是 bigint 值，按串传）。 */
  readonly amount: string;
  /** 扣减后的可用合计。原子超限调用一分不扣，所以它可能仍大于 0。 */
  readonly remainingTotal: number;
  /** 计费周期起点的日期键（quotaPeriodStartKey 算的）。 */
  readonly periodStartKey: string;
  readonly tenant: {
    readonly no: string | null;
    readonly name: string | null;
    readonly workspaceName: string | null;
  };
  readonly now?: Date;
}

/**
 * 计费周期起点 → 日期键（**Asia/Shanghai 日历日**，见 opsNoticeDayKey）。
 *
 * 取候选池里**最晚**的那个 current_period_start：瀑布里可能既有按月重置的池、又有
 * 一次性的加油包（后者 period_start 恒为 null），最晚的那个就是当前这一格的起点。
 * 一个都没有（全是不重置的池）时回落到**当月 1 日**——那类池没有周期概念，按自然月收敛
 * 成「一个月最多一条」，也不至于变成「这辈子只播一条」（漏播比多播坏）。
 *
 * 两处都按 Asia/Shanghai 判「哪一天 / 哪一月」，不按 UTC（此前两处都是 toISOString）：
 *   · 起点：库里按北京时间 10/01 00:00 重置的池，UTC 看是 09/30 16:00，键会写成上个月；
 *   · 回落：每月 1 日的 00:00–08:00 会被算进上个月那一格，于是月初那八小时与随后的
 *     同一件事各播一条。
 */
export function quotaPeriodStartKey(
  pools: PoolIdentity[],
  now: Date = new Date(),
): string {
  let latest: number | null = null;
  for (const p of pools) {
    const start = p.periodStart;
    if (!start) continue;
    const t = start.getTime();
    if (latest === null || t > latest) latest = t;
  }
  if (latest !== null) return opsNoticeDayKey(new Date(latest));
  /* 当前这一天的 YYYY-MM 就是当前这一月——月首日不必再算一次时区。 */
  return `${opsNoticeDayKey(now).slice(0, 7)}-01`;
}

/**
 * 纯函数：事实 → 一条待写的系统通告。severity=warning、planes 只给 admin
 * （配额是客户经营事实，不是运维或治理的事）。
 *
 * 保留 30 天：它是一个周期的信号，不是一件等人处理的事——下个周期会有新的一条，
 * 留着旧的只会让列表越读越长（批一给 info 档定的同一个数）。
 */
export function composeQuotaExhaustedNotice(
  facts: QuotaExhaustedFacts,
): CreateSystemNoticeInput {
  const who = opsNoticeTenantLabel(facts.tenant);
  const ws = facts.tenant.workspaceName?.trim() || "（空间名未知）";
  const now = facts.now ?? new Date();
  const body = [
    `${who} 的工作空间 ${ws} 在产品 ${facts.productCode} 的 ${facts.metric} 上配额不足：` +
      `本次请求 ${facts.amount}，扣减后可用合计 ${facts.remainingTotal}。`,
    `计费周期起点 ${facts.periodStartKey}；同一周期同一指标只播一条，下一周期会再播。`,
    "调用方已收到 gated 标记（请求本身仍是 200，平台只记录不裁决），" +
      "接着调用会一直被拦。客户侧的出路是加购加油包或换更高档位；" +
      "运营侧可在该租户的订阅里核对这个指标的池、上限与重置周期。",
  ].join("\n");
  return {
    targetPlanes: ["admin"],
    severity: "warning",
    title: `配额已耗尽：${who} · ${facts.productCode} / ${facts.metric}`.slice(
      0,
      256,
    ),
    body,
    link: facts.tenant.no
      ? `/tenants/${encodeURIComponent(facts.tenant.no)}`
      : null,
    referenceType: OPS_SIGNAL_REFERENCE_TYPE,
    /*
     * 键含 workspace uuid（36）+ product_code（≤32）+ metric_key（≤64），最长会到 161，
     * 而 reference_id 是 varchar(128)：越界是 22001，通告静默丢一条。所以过 128 时由
     * opsNoticeReferenceId 截断并缀内容哈希（仍然一事一条）。
     */
    referenceId: opsNoticeReferenceId(
      `quota_exhausted:${facts.workspaceId}:${facts.productCode}:${facts.metric}:${facts.periodStartKey}`,
    ),
    expiresAt: new Date(now.getTime() + OPS_NOTICE_INFO_TTL_MS),
  };
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
