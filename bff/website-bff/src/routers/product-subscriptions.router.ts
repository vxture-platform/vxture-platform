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
import { SUBSCRIPTION_STATUSES, TIERS } from "@vxture-platform/shared";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";
import type { RequestContext } from "../types/auth.types";

// 授予权益的「在用」状态（含 overdue 宽限）；据此判 subscribed。
const LIVE_STATUSES = new Set<string>(["active", "trialing", "overdue"]);

export interface ProductSubscriptionState {
  productCode: string;
  subscribed: boolean;
  tier: string | null;
  status: string;
  /**
   * 产品自己的工作台入口（product.product_webhooks.home_url）；未登记为 null。
   * 官网卡片「进入工作台」直达它——此前一律跳 console 首页，客户还得再找一次
   * （owner 2026-09-02）。
   */
  homeUrl: string | null;
  /**
   * 当前档之上还有可售（已发布 current 版本）的档位。没有就不该给「升级」按钮——
   * 顶档也显示「升级」是此前的问题之一。
   */
  canUpgrade: boolean;
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
      home_url: string | null;
      can_upgrade: boolean;
    }>(
      `with ranked as (
         select prod.id as product_id, prod.product_code, ts.status, pc.tier,
                -- 代表行：状态优先级 → 档位高者优先（付费行压过 free）→ 周期末最新。
                -- 此前次序是 end_at desc nulls first：free 行 end_at 为 NULL 时压过付费行，
                -- 付费租户在官网被提示「升级」到自己已有的档（owner 2026-09-03 caimc 案）。
                row_number() over (
                  partition by prod.product_code
                  order by array_position($2::text[], ts.status) asc,
                           array_position($3::text[], pc.tier) desc nulls last,
                           ts.end_at desc nulls last
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
       select r.product_code, r.status, r.tier,
              pw.home_url,
              -- 当前档之上是否还有可售档：同产品、current 已发布版本、primary 组件的
              -- tier 在五档阶梯（$3）里排在当前档之后。当前档为空（越梯/自定义）→ false。
              exists (
                select 1
                  from product.plans p2
                  join product.plan_versions cv
                    on cv.id = p2.current_version_id and cv.status = 'published'
                  join product.plan_components pc2
                    on pc2.plan_version_id = cv.id and pc2.component_role = 'primary'
                 where pc2.product_id = r.product_id
                   and p2.deleted_at is null and p2.status = 'active'
                   and r.tier is not null
                   and array_position($3::text[], pc2.tier) > array_position($3::text[], r.tier)
              ) as can_upgrade
         from ranked r
         left join product.product_webhooks pw on pw.product_id = r.product_id
        where r.rn = 1`,
      [req.tenantId, [...SUBSCRIPTION_STATUSES], [...TIERS]],
    );

    return res.rows.map((r) => {
      const subscribed = LIVE_STATUSES.has(r.status);
      return {
        productCode: r.product_code,
        subscribed,
        tier: r.tier,
        status: r.status,
        homeUrl: r.home_url,
        canUpgrade: subscribed && r.can_upgrade,
      };
    });
  }
}
