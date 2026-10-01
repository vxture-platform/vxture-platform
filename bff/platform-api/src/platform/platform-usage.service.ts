/**
 * platform-usage.service.ts — C3 consume orchestration for the platform API
 * (product_310 P2.2). Thin layer over the commerce single-writer engine:
 * resolves product_code → product_id, delegates the transactional waterfall
 * to ConsumeService, then reads the post-consume period-aware pool state for
 * the contract's remaining_total / per_pool_breakdown enrichment (read-only —
 * this layer never touches quota_used).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { ConsumeService } from "@vxture/service-subscription";
import { PgNoticeRepository } from "@vxture/service-notice";
import {
  resolveOpsNoticeWorkspace,
  type SystemNoticeWriter,
} from "../notifications/ops-notice";
import { buildQuotaPoolView } from "./entitlement-view";
import {
  composeQuotaExhaustedNotice,
  quotaPeriodStartKey,
  type EngineConsumeResult,
  type PoolIdentity,
} from "./usage-view";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

interface PoolIdentitySqlRow {
  id: string;
  subscription_id: string | null;
  metric_key: string;
  quota_limit: string;
  quota_used: string;
  priority: number;
  reset_period: string;
  current_period_start: Date | null;
  period_anchor: Date | null;
}

@Injectable()
export class PlatformUsageService {
  private readonly logger = new Logger(PlatformUsageService.name);
  /**
   * 通告写侧。懒建而不是构造器注入：本模块拿到的是 COMMERCE_PG_POOL，
   * 而 NoticeModule 自带另一个池令牌（同名 token 在一个容器里会静默互相覆盖，
   * 见 @vxture/service-notice 的 tokens.ts）。库是同一个，直接用手上的池即可——
   * 与 services/notification/dispatch 里 new PgNoticeRepository(pool) 同一手法。
   */
  private noticeWriter: SystemNoticeWriter | null = null;
  /**
   * 本进程已播过的「工作空间 × 产品 × 指标 × 周期」。gated 是持续状态，客户端会重试，
   * 这一层挡住「每个请求都去打一次库」；跨实例与重启后的一事一条由表上的部分唯一索引兜。
   * 只在**写成功之后**记：写失败就不记，下一次 gated 请求会再试一次。
   */
  private readonly noticedQuotaPeriods = new Set<string>();
  /** 上限只是防无界增长（键含指标与周期，正常量级远小于此）；满了整体清空，代价是再写一条。 */
  private static readonly QUOTA_NOTICE_CACHE_MAX = 500;

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(ConsumeService) private readonly consumeService: ConsumeService,
  ) {}

  private notices(): SystemNoticeWriter {
    if (!this.noticeWriter)
      this.noticeWriter = new PgNoticeRepository(this.pool);
    return this.noticeWriter;
  }

  /**
   * 配额耗尽 → 一条运营通告（2026-09-28 第二批 C-2）。**永不抛**：C3 consume 是热路径，
   * 通告写不进去只是运营少一条，把客户的调用打断是另一回事。
   *
   * 一个计费周期一条（去重键带周期起点）。租户可视码解析失败也照发——少一个名字的通告
   * 仍然是一条通告。
   */
  async noteQuotaExhausted(input: {
    workspaceId: string;
    productCode: string;
    metric: string;
    amount: string;
    remainingTotal: number;
    pools: PoolIdentity[];
    /** 预留被拒（409）还是照记（200）——通告文案两档不同，见 QuotaExhaustedFacts。 */
    denied?: boolean;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const periodStartKey = quotaPeriodStartKey(input.pools, now);
    const cacheKey = `${input.workspaceId}:${input.productCode}:${input.metric}:${periodStartKey}`;
    if (this.noticedQuotaPeriods.has(cacheKey)) return;
    const tenant = await resolveOpsNoticeWorkspace(
      this.pool,
      input.workspaceId,
      this.logger,
    );
    try {
      await this.notices().createSystemNotice(
        composeQuotaExhaustedNotice({
          workspaceId: input.workspaceId,
          productCode: input.productCode,
          metric: input.metric,
          amount: input.amount,
          remainingTotal: input.remainingTotal,
          periodStartKey,
          tenant,
          ...(input.denied ? { denied: true as const } : {}),
          now,
        }),
      );
      if (
        this.noticedQuotaPeriods.size >=
        PlatformUsageService.QUOTA_NOTICE_CACHE_MAX
      ) {
        this.noticedQuotaPeriods.clear();
      }
      this.noticedQuotaPeriods.add(cacheKey);
    } catch (err) {
      this.logger.warn(
        `配额耗尽的运营通告写入失败（${cacheKey}）— ${String(err)}`,
      );
    }
  }

  /** product_code → id; null when the code is not in the catalog. */
  async resolveProductId(productCode: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM product.products WHERE product_code = $1 AND deleted_at IS NULL`,
      [productCode],
    );
    return res.rows[0]?.id ?? null;
  }

  async consume(input: {
    workspaceId: string;
    productId: string;
    metricKey: string;
    amount: string;
    idempotencyKey: string;
    requestId?: string;
    /** optional end-user attribution (NULL bucket when absent). */
    endUserId?: string;
    /**
     * 调用意图（owner 2026-10-01）。不传 = report（事后报账，永远记账、永远 200）。
     * reserve = 事前问许可，硬限且额度不足时引擎回 denied、不写用量事件，HTTP 层转 409。
     */
    intent?: "reserve" | "report";
  }): Promise<EngineConsumeResult> {
    return this.consumeService.consume(input);
  }

  /**
   * Post-consume pool state for (workspace, product, metric): identity
   * (pool id → subscription) + period-aware remaining, waterfall order.
   */
  async readPools(
    workspaceId: string,
    productId: string,
    metricKey: string,
  ): Promise<PoolIdentity[]> {
    const res = await this.pool.query<PoolIdentitySqlRow>(
      `SELECT qp.id, qp.subscription_id, qp.metric_key, qp.quota_limit,
              qp.quota_used, qp.priority, qp.reset_period, qp.current_period_start,
              qp.period_anchor
       FROM metering.quota_pools qp
       WHERE qp.workspace_id = $1
         AND qp.metric_key = $3
         AND qp.status = 'active'
         AND (qp.expires_at IS NULL OR qp.expires_at > NOW())
         -- D10 live-coverage gate (parity fix 2026-08-20: this read used to skip
         -- it, so a lapsed contributor's pool inflated remaining_total here
         -- while being invisible to both C2 and the actual deduction).
         AND (qp.subscription_id IS NULL OR EXISTS (
                SELECT 1 FROM metering.subscriptions ts
                 WHERE ts.id = qp.subscription_id
                   AND ts.status IN ('active', 'trialing')
                   AND ts.deleted_at IS NULL))
         -- product_id NULL = WS-level pool (ws_base / addon_purchase): open to
         -- every product, mirrors the consume candidate set.
         AND ( qp.product_id = $2
               OR qp.product_id IS NULL
               OR ( EXISTS (SELECT 1 FROM product.platform_metrics plm WHERE plm.metric_key = $3)
                    AND EXISTS (SELECT 1 FROM metering.resource_sharing_policies pp
                                 WHERE pp.workspace_id = $1 AND pp.metric_key = $3 AND pp.product_id = qp.product_id)
                    AND EXISTS (SELECT 1 FROM metering.resource_sharing_policies px
                                 WHERE px.workspace_id = $1 AND px.metric_key = $3 AND px.product_id = $2) ) )
       ORDER BY (qp.product_id = $2) DESC NULLS LAST, qp.priority ASC, (qp.component_role = 'bundled') DESC,
                qp.effective_at ASC, qp.id ASC`,
      [workspaceId, productId, metricKey],
    );
    const views = buildQuotaPoolView(
      res.rows.map((r) => ({
        productCode: "",
        metricKey: r.metric_key,
        quotaLimit: r.quota_limit,
        quotaUsed: r.quota_used,
        periodAnchor: r.period_anchor,
        priority: r.priority,
        resetPeriod: r.reset_period,
        // 这一处只为算 C3 响应里的 remaining/breakdown，处置档不参与计算；取 soft 是
        // **刻意的保守值**而不是判断——真正决定拒不拒的是 consume 引擎自己解析的成本档
        // （pg-consume.repository），不是这个只读投影。在这里再判一次会出现两套规则。
        enforcement: "soft" as const,
        currentPeriodStart: r.current_period_start,
      })),
    );
    return res.rows.map((r, i) => ({
      poolId: r.id,
      subscriptionId: r.subscription_id,
      view: views[i]!,
      // 配额耗尽那条通告按计费周期去重，周期起点只有这一处读得到（列已在上面选出）。
      periodStart: r.current_period_start,
    }));
  }

  /**
   * True when the metric is a registered gauge platform metric (D5). consume
   * rejects these (they use PUT /usage/gauge); the gauge endpoint requires them.
   */
  async isGaugeMetric(metricKey: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM product.platform_metrics
        WHERE metric_key = $1 AND kind = 'gauge' AND status = 'active' LIMIT 1`,
      [metricKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Record a gauge snapshot (data_commerce_240 §3): absolute water level per
   * (workspace, product, metric), last-write-wins by observed_at. Not written to
   * usage_events (gauge is not a deduction). Returns applied=false when a newer
   * snapshot already exists (idempotent, older report dropped).
   */
  async recordGauge(input: {
    workspaceId: string;
    productId: string;
    metricKey: string;
    value: string;
    observedAt: Date;
  }): Promise<{ applied: boolean; value: string; observedAt: Date }> {
    const upsert = await this.pool.query<{ value: string; observed_at: Date }>(
      `INSERT INTO metering.usage_gauges
         (workspace_id, product_id, metric_key, value, observed_at, updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (workspace_id, product_id, metric_key) DO UPDATE
         SET value = EXCLUDED.value, observed_at = EXCLUDED.observed_at, updated_at = now()
         WHERE EXCLUDED.observed_at >= metering.usage_gauges.observed_at
       RETURNING value::text AS value, observed_at`,
      [
        input.workspaceId,
        input.productId,
        input.metricKey,
        input.value,
        input.observedAt,
      ],
    );
    if (upsert.rows.length > 0) {
      return {
        applied: true,
        value: upsert.rows[0]!.value,
        observedAt: upsert.rows[0]!.observed_at,
      };
    }
    // ON CONFLICT WHERE rejected the update (an equal/newer snapshot exists) — return current.
    const cur = await this.pool.query<{ value: string; observed_at: Date }>(
      `SELECT value::text AS value, observed_at FROM metering.usage_gauges
        WHERE workspace_id = $1 AND product_id = $2 AND metric_key = $3`,
      [input.workspaceId, input.productId, input.metricKey],
    );
    return {
      applied: false,
      value: cur.rows[0]?.value ?? input.value,
      observedAt: cur.rows[0]?.observed_at ?? input.observedAt,
    };
  }
}
