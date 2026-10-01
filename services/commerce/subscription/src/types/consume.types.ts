// Usage-consume contract (platform-data-architecture-schema.md §8.3). The commerce
// consume service is the SINGLE writer of usage: product/Model Platform call it and
// never write metering.usage_* directly.

export interface ConsumeInput {
  workspaceId: string;
  productId: string;
  metricKey: string;
  /** requested amount (>0); bigint-valued */
  amount: number | string;
  /** global-unique idempotency key (usage_idempotency PK) */
  idempotencyKey: string;
  requestId?: string;
  /**
   * End user the product attributes this call to (bare UUID → account.users,
   * 边界#2 no FK). Optional: products that don't attribute yet omit it and the
   * event lands in the "unattributed" bucket (NULL) — tolerant by design
   * (owner 2026-08-20, per-user usage analytics).
   */
  endUserId?: string;
  /**
   * 这次调用的**意图**，决定额度不足时平台怎么办（owner 2026-10-01）。
   *
   *   · `"report"`（默认，不传即此）—— **事后报账**。调用方已经把事做了，这是上报。
   *     平台永远记账、永远回 200；`gated` 是信息不是指令。这一档完全保留 2026-08-10
   *     的裁定：拒绝写下来并不能让它没发生，只会丢掉那个数。
   *   · `"reserve"` —— **事前问许可**。调用方还没做事。此时如果指标是硬限
   *     （`cost_class='cost_bearing'`，或键在 `platform_metrics` 里）且额度不足，
   *     平台**拒绝并且不记账**——没做事就没有用量。
   *
   * 为什么要这根轴：同一个端点上原本混着两种语义。C3 契约把它写成「用量/事件上报」，
   * 产品侧按 `local_usage` 缓冲 + 上报 Job 实现；而 `ai.credit` 在目录里标着
   * `atomic(预扣)`，那条路调用方本来就是事前问。一律拒会让上报作业收到 409 并重试/卡住，
   * 还会把「the usage happened, the record did not」那个旧缺陷带回来；一律放行则封不住
   * 成本上界。分语义是唯一能同时成立的做法。
   */
  intent?: "reserve" | "report";
}

export interface ConsumePoolTake {
  poolId: string;
  took: string; // bigint as string
}

export interface ConsumeResult {
  /**
   * ok = fully consumed；insufficient = atomic reject (consumed=0) 或 divisible 部分覆盖；
   * denied = **预留被拒**（`intent="reserve"` + 硬限 + 额度不足）——这一档**没有写任何
   * 用量事件**，因为调用方还没做事。只有它会让 HTTP 层回 409，其余两档照旧 200。
   */
  status: "ok" | "insufficient" | "denied";
  consumed: string; // bigint as string; = SUM(perPool.took)
  perPool: ConsumePoolTake[];
  eventId?: string;
  /** true when this was an idempotent replay (prior result returned, no new deduction) */
  replayed: boolean;
}
