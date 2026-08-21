/**
 * product-plans.router.ts - 公开套餐阶梯（website 侧）
 * @package @vxture/bff-website
 *
 * GET /api/products/:code/plans —— 单产品的公开套餐阶梯（档位 × 周期价 ×
 * 权益键），为官网定价页提供 DB 真源（替代 i18n 硬编码价格的第一步）。
 * **公开端点**（无需登录）：AuthMiddleware 非阻断，匿名亦可读。
 *
 * 口径与 console-bff subscribe-context 的 queryPlanLadder 完全一致（两端必须
 * 展示同一套可售阶梯）：public active plan、current_version 指向、published
 * 即 is_locked 的版本、primary 组件（bundled 无商业档位，不进阶梯）。website
 * 额外收紧产品可见性轴（is_customer_visible + status='active'，对齐
 * product-catalog.router 的公开目录口径）。
 *
 * 容错契约（对齐 product-catalog / console 深链降级）：产品不存在、不可见或
 * 无已发布套餐 → { product: null | …, plans: [] }，不抛 4xx/5xx；营销文案
 * （档位描述/对比表标签）仍走 i18n，此处只供权威数据（价格/周期/features/quota）。
 *
 * TODO(shared-ladder): 本查询与 console-bff queryPlanLadder 是同一口径的两份
 * SQL；若第三处出现，应抽到共享查询层（如 @vxture/service-catalog）统一维护。
 */
import { Controller, Get, Inject, Logger, Param } from "@nestjs/common";
import type { Pool } from "pg";
import { TIERS } from "@vxture-platform/shared";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";

/** 与 console-bff subscription.router 相同的产品码形状约束。 */
const PRODUCT_CODE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** 席位在 quota jsonb 中的指标键（seed/biz-260 口径）。 */
const SEATS_QUOTA_KEY = "member.max";

export interface ProductPlanPrice {
  cycleUnit: string;
  cycleCount: number;
  /** 定价字符串（FM999999999990.00，与 console-bff 一致，避免浮点漂移）。 */
  price: string;
  currency: string;
}

export interface ProductPlanOption {
  planCode: string;
  planName: string;
  tier: string;
  /** 该档开放功能键（plan_components.features，展示文案由前端 i18n 映射）。 */
  features: string[];
  /** 该档配额键值（plan_components.quota 原样透传，前端提炼展示项）。 */
  quota: Record<string, unknown> | null;
  /** 席位数（quota["member.max"]，无该指标 → null）。 */
  seats: number | null;
  prices: ProductPlanPrice[];
}

export interface ProductPlansResponse {
  product: {
    code: string;
    name: string;
    nick: string | null;
    releaseVersion: string | null;
  } | null;
  plans: ProductPlanOption[];
}

@Controller("api/products")
export class ProductPlansRouter {
  private readonly logger = new Logger(ProductPlansRouter.name);

  constructor(@Inject(WEBSITE_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get(":code/plans")
  async getProductPlans(
    @Param("code") code: string,
  ): Promise<ProductPlansResponse> {
    const productCode = (code ?? "").trim();
    if (!PRODUCT_CODE_RE.test(productCode)) {
      this.logger.warn(
        `product plans: malformed product code "${productCode}" — returning empty ladder`,
      );
      return { product: null, plans: [] };
    }

    const productRes = await this.pool.query<{
      product_code: string;
      product_name: string;
      product_nick: string | null;
      release_version: string | null;
    }>(
      `select product_code, product_name, product_nick, release_version
         from product.products
        where product_code = $1
          and is_customer_visible = true
          and status = 'active'
          and deleted_at is null`,
      [productCode],
    );
    const productRow = productRes.rows[0];
    if (!productRow) {
      this.logger.warn(
        `product plans: unknown or non-public product "${productCode}" — returning empty ladder`,
      );
      return { product: null, plans: [] };
    }

    const ladderRes = await this.pool.query<{
      plan_code: string;
      plan_name: string;
      tier: string;
      features: string[];
      quota: Record<string, unknown> | null;
      prices: ProductPlanPrice[];
    }>(
      `select pl.plan_code, pl.plan_name, pc.tier, pc.features, pc.quota,
              coalesce(
                jsonb_agg(jsonb_build_object(
                  'cycleUnit', pp.cycle_unit, 'cycleCount', pp.cycle_count,
                  'price', to_char(pp.price, 'FM999999999990.00'), 'currency', pp.currency
                ) order by pp.cycle_unit, pp.cycle_count)
                filter (where pp.id is not null), '[]'::jsonb
              ) as prices
         from product.products prod
         join product.plan_components pc
           on pc.product_id = prod.id and pc.component_role = 'primary'
         join product.plan_versions pv
           on pv.id = pc.plan_version_id and pv.is_locked = true
         join product.plans pl
           on pl.id = pv.plan_id and pl.current_version_id = pv.id
          and pl.deleted_at is null and pl.status = 'active'
          and pl.is_public = true and pl.is_customer_visible = true
         left join product.plan_prices pp on pp.plan_version_id = pv.id
        where prod.product_code = $1 and pc.tier is not null
        group by pl.plan_code, pl.plan_name, pc.tier, pc.features, pc.quota`,
      [productCode],
    );

    const rank = (t: string) => {
      const i = (TIERS as readonly string[]).indexOf(t);
      return i < 0 ? Infinity : i;
    };
    const plans = ladderRes.rows
      .map((r) => ({
        planCode: r.plan_code,
        planName: r.plan_name,
        tier: r.tier,
        features: r.features ?? [],
        quota: r.quota,
        seats: readSeats(r.quota),
        prices: r.prices,
      }))
      .sort((a, b) => rank(a.tier) - rank(b.tier));

    return {
      product: {
        code: productRow.product_code,
        name: productRow.product_name,
        nick: productRow.product_nick,
        releaseVersion: productRow.release_version,
      },
      plans,
    };
  }
}

/** quota["member.max"] → 席位数；缺失或非有限数值 → null。 */
function readSeats(quota: Record<string, unknown> | null): number | null {
  const raw = quota?.[SEATS_QUOTA_KEY];
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
