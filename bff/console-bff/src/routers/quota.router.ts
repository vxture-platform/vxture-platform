/**
 * quota.router.ts - 租户配额总览路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 配额管理页(/quotas 重建,owner 2026-08-20 用量配额线)的读侧聚合:
 *   GET /api/quota/overview — 当前租户默认工作空间的配额全景:
 *     - storage: WS 级总账(product_220 §4.4)——limit = Σ 全来源池
 *       (ws_base 底池 + 订阅贡献 + 加油包),used = Σ 各产品 gauge 水位切片,
 *       remaining 不钳制(可为负 = 超冲,R4);
 *     - aiCredit: 池明细(来源/额度/本期已用/剩余/周期/效期,懒重置周期感知
 *       视图与 C2 同口径)+ 共享策略参与产品;
 *     - products: 按产品的池明细(产品级指标 + 平台指标贡献)+ 存储切片。
 *
 * 只读直查(console-bff 约定:SELECT only,写一律走 service);全部聚合
 * 一次往返四条查询。全页无 UUID 出口——产品用 product_code 可视标识。
 */

import {
  Controller,
  BadRequestException,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import type { RequestContext } from "../types/console.types";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// ============================================================================
// View types (mirrored by portals/console/src/api/console-bff.ts)
// ============================================================================

export interface QuotaPoolView {
  metric: string;
  /** subscription / manual_override / ws_base / addon_purchase */
  source: string;
  /** NULL = WS 级池(底池/加油包,不属任何产品) */
  productCode: string | null;
  productName: string | null;
  limit: number;
  /** 周期感知已用(懒重置视图:周期已翻篇按 0 计,与 C2 同口径) */
  used: number;
  /** 池内剩余,钳 0(总账层的负剩余由 storage.remaining 表达) */
  remaining: number;
  resetPeriod: string;
  expiresAt: string | null;
}

export interface StorageSliceView {
  productCode: string;
  productName: string;
  usedBytes: number;
  observedAt: string;
}

export interface ProductQuotaView {
  productCode: string;
  productName: string;
  metrics: {
    metric: string;
    limit: number;
    used: number;
    remaining: number;
    resetPeriod: string;
  }[];
  /** 该产品上报的存储水位切片;未上报为 null */
  storageUsedBytes: number | null;
}

export interface ConsoleQuotaOverview {
  storage: {
    limitBytes: number;
    usedBytes: number;
    /** 不钳制:负值 = 超冲(R4,产品侧准入自愈) */
    remainingBytes: number;
    sources: QuotaPoolView[];
    slices: StorageSliceView[];
  };
  aiCredit: {
    limit: number;
    used: number;
    remaining: number;
    pools: QuotaPoolView[];
    /** ai.credit 共享策略参与产品(默认共享 = 系统预置策略行,可后台调整) */
    sharingProducts: { productCode: string; productName: string }[];
  };
  products: ProductQuotaView[];
}

interface PoolSqlRow {
  metric_key: string;
  pool_source: string;
  product_code: string | null;
  product_name: string | null;
  quota_limit: string;
  effective_used: string;
  reset_period: string;
  expires_at: Date | null;
  platform_kind: string | null;
}

interface GaugeSqlRow {
  metric_key: string;
  product_code: string;
  product_name: string;
  value: string;
  observed_at: Date;
}

interface SharingSqlRow {
  metric_key: string;
  product_code: string;
  product_name: string;
}

// ============================================================================
// QuotaRouter
// ============================================================================

@Controller("api/quota")
export class QuotaRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  @Get("overview")
  async getOverview(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleQuotaOverview> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const [pools, gauges, sharing] = await Promise.all([
      this.queryPools(workspaceId),
      this.queryGauges(workspaceId),
      this.querySharing(workspaceId),
    ]);

    const toView = (r: PoolSqlRow): QuotaPoolView => {
      const limit = Number(r.quota_limit);
      const used = Number(r.effective_used);
      return {
        metric: r.metric_key,
        source: r.pool_source,
        productCode: r.product_code,
        productName: r.product_name,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetPeriod: r.reset_period,
        expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
      };
    };

    // ── storage: WS 总账(gauge — used 来自水位切片,池的 used 无意义) ────────
    const storagePools = pools
      .filter((r) => r.metric_key === "storage.bytes")
      .map(toView);
    const storageSlices = gauges
      .filter((r) => r.metric_key === "storage.bytes")
      .map((r) => ({
        productCode: r.product_code,
        productName: r.product_name,
        usedBytes: Number(r.value),
        observedAt: r.observed_at.toISOString(),
      }));
    const storageLimit = storagePools.reduce((s, p) => s + p.limit, 0);
    const storageUsed = storageSlices.reduce((s, g) => s + g.usedBytes, 0);

    // ── ai.credit: 池明细 + 共享参与 ─────────────────────────────────────────
    const creditPools = pools
      .filter((r) => r.metric_key === "ai.credit")
      .map(toView);
    const creditLimit = creditPools.reduce((s, p) => s + p.limit, 0);
    const creditUsed = creditPools.reduce((s, p) => s + p.used, 0);
    const sharingProducts = sharing
      .filter((r) => r.metric_key === "ai.credit")
      .map((r) => ({
        productCode: r.product_code,
        productName: r.product_name,
      }));

    // ── products: 按产品聚合池明细 + 存储切片 ────────────────────────────────
    const byProduct = new Map<string, ProductQuotaView>();
    const ensureProduct = (code: string, name: string): ProductQuotaView => {
      let v = byProduct.get(code);
      if (!v) {
        v = {
          productCode: code,
          productName: name,
          metrics: [],
          storageUsedBytes: null,
        };
        byProduct.set(code, v);
      }
      return v;
    };
    for (const r of pools) {
      if (!r.product_code) continue; // WS 级池不属任何产品
      const view = toView(r);
      ensureProduct(
        r.product_code,
        r.product_name ?? r.product_code,
      ).metrics.push({
        metric: view.metric,
        limit: view.limit,
        used: view.used,
        remaining: view.remaining,
        resetPeriod: view.resetPeriod,
      });
    }
    for (const g of storageSlices) {
      ensureProduct(g.productCode, g.productName).storageUsedBytes =
        g.usedBytes;
    }

    return {
      storage: {
        limitBytes: storageLimit,
        usedBytes: storageUsed,
        remainingBytes: storageLimit - storageUsed,
        sources: storagePools,
        slices: storageSlices,
      },
      aiCredit: {
        limit: creditLimit,
        used: creditUsed,
        remaining: creditPools.reduce((s, p) => s + p.remaining, 0),
        pools: creditPools,
        sharingProducts,
      },
      products: [...byProduct.values()].sort((a, b) =>
        a.productCode.localeCompare(b.productCode),
      ),
    };
  }

  /**
   * 活跃可用池(与 consume/C2 同门:活跃、未过期、订阅池须订阅 live——D10)。
   * effective_used = 懒重置周期感知视图(周期翻篇按 0 计,只读不落库,归零
   * 仍归 consume 写路径),UTC 口径与引擎 needsReset 一致。
   */
  private async queryPools(workspaceId: string): Promise<PoolSqlRow[]> {
    const res = await this.pool.query<PoolSqlRow>(
      `select qp.metric_key, qp.pool_source,
              prod.product_code, prod.product_name,
              qp.quota_limit::text as quota_limit,
              (case
                 when qp.reset_period = 'day'
                      and qp.current_period_start is not null
                      and date_trunc('day', qp.current_period_start at time zone 'UTC')
                          <> date_trunc('day', now() at time zone 'UTC') then 0
                 when qp.reset_period = 'month'
                      and qp.current_period_start is not null
                      and date_trunc('month', qp.current_period_start at time zone 'UTC')
                          <> date_trunc('month', now() at time zone 'UTC') then 0
                 else qp.quota_used
               end)::text as effective_used,
              qp.reset_period, qp.expires_at,
              plm.kind as platform_kind
         from metering.quota_pools qp
         left join product.products prod on prod.id = qp.product_id
         left join product.platform_metrics plm on plm.metric_key = qp.metric_key
        where qp.workspace_id = $1
          and qp.status = 'active'
          and (qp.expires_at is null or qp.expires_at > now())
          and (qp.subscription_id is null or exists (
                 select 1 from metering.subscriptions ts
                  where ts.id = qp.subscription_id
                    and ts.status in ('active', 'trialing')
                    and ts.deleted_at is null))
        order by qp.metric_key asc, qp.priority asc, qp.effective_at asc`,
      [workspaceId],
    );
    return res.rows;
  }

  /** 各产品最新水位切片(usage_gauges,LWW 快照)。 */
  private async queryGauges(workspaceId: string): Promise<GaugeSqlRow[]> {
    const res = await this.pool.query<GaugeSqlRow>(
      `select ug.metric_key, prod.product_code, prod.product_name,
              ug.value::text as value, ug.observed_at
         from metering.usage_gauges ug
         join product.products prod on prod.id = ug.product_id
        where ug.workspace_id = $1
        order by prod.product_code asc`,
      [workspaceId],
    );
    return res.rows;
  }

  /** 共享策略参与行(空 = 全保留,product_220 §4.3 安全默认)。 */
  private async querySharing(workspaceId: string): Promise<SharingSqlRow[]> {
    const res = await this.pool.query<SharingSqlRow>(
      `select rsp.metric_key, prod.product_code, prod.product_name
         from metering.resource_sharing_policies rsp
         join product.products prod on prod.id = rsp.product_id
        where rsp.workspace_id = $1
        order by prod.product_code asc`,
      [workspaceId],
    );
    return res.rows;
  }

  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `select id from tenancy.workspaces
        where tenant_id = $1 and is_default and deleted_at is null
        limit 1`,
      [tenantId],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }
}
