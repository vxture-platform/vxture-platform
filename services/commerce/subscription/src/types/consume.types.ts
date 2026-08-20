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
}

export interface ConsumePoolTake {
  poolId: string;
  took: string; // bigint as string
}

export interface ConsumeResult {
  /** ok = fully consumed; insufficient = atomic reject (consumed=0) or divisible partial */
  status: "ok" | "insufficient";
  consumed: string; // bigint as string; = SUM(perPool.took)
  perPool: ConsumePoolTake[];
  eventId?: string;
  /** true when this was an idempotent replay (prior result returned, no new deduction) */
  replayed: boolean;
}
