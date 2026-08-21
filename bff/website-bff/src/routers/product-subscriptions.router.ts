/**
 * product-subscriptions.router.ts - 当前租户各产品订阅态（website 侧）
 * @package @vxture/bff-website
 *
 * GET /api/me/product-subscriptions —— 登录租户 **default workspace** 各产品的
 * 「代表订阅」态。订阅真实主体是 workspace（metering.subscriptions.workspace_id），
 * tenant_id 仅账单 rollup；每租户唯一一个 default workspace（uq_workspaces_one_default_per_tenant），
 * website 无 workspace 上下文，故统一按 active_org 的 default workspace 取（product_320 §4.5）。
 * 口径与 C2 引擎/console 一致：D10 谓词（从未付费的失效试用视为无）+ @shared 状态优先级，
 * 平票取周期末最新。驱动官网产品卡片的 已开通/升级/进入 分支。
 * 未登录 → []。AuthMiddleware 非阻断，req.tenantId 缺失即视为未登录。
 */
import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { SUBSCRIPTION_STATUSES } from "@vxture-platform/shared";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";
import type { RequestContext } from "../types/auth.types";

// 授予权益的「在用」状态（含 overdue 宽限）；据此判 subscribed。
const LIVE_STATUSES = new Set<string>(["active", "trialing", "overdue"]);

export interface ProductSubscriptionState {
  productCode: string;
  subscribed: boolean;
  tier: string | null;
  status: string;
}

@Controller("api/me")
export class ProductSubscriptionsRouter {
  constructor(@Inject(WEBSITE_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get("product-subscriptions")
  async getProductSubscriptions(
    @Req() req: Request & RequestContext,
  ): Promise<ProductSubscriptionState[]> {
    if (!req.tenantId) return [];

    const res = await this.pool.query<{
      product_code: string;
      status: string;
      tier: string | null;
    }>(
      `with ranked as (
         select prod.product_code, ts.status, pc.tier,
                row_number() over (
                  partition by prod.product_code
                  order by array_position($2::text[], ts.status) asc,
                           ts.end_at desc nulls first
                ) as rn
           from metering.subscriptions ts
           join product.plan_components pc
             on pc.plan_version_id = ts.plan_version_id
            and pc.component_role = 'primary'
           join product.products prod on prod.id = pc.product_id
          where ts.workspace_id = (
                  select id from tenancy.workspaces
                   where tenant_id = $1 and is_default
                   limit 1
                )
            and ts.deleted_at is null
            and not (ts.subscription_kind = 'trial'
                     and ts.status in ('expired', 'cancelled'))
       )
       select product_code, status, tier from ranked where rn = 1`,
      [req.tenantId, [...SUBSCRIPTION_STATUSES]],
    );

    return res.rows.map((r) => ({
      productCode: r.product_code,
      subscribed: LIVE_STATUSES.has(r.status),
      tier: r.tier,
      status: r.status,
    }));
  }
}
