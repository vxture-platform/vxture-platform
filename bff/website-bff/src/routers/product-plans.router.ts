/**
 * product-plans.router.ts - 公开套餐阶梯（website 侧）
 * @package @vxture/bff-website
 *
 * GET /api/products/:code/plans —— 单产品的公开套餐阶梯（档位 × 周期价 ×
 * 权益键），为官网定价页提供 DB 真源（替代 i18n 硬编码价格的第一步）。
 * **公开端点**（无需登录）：AuthMiddleware 非阻断，匿名亦可读。
 *
 * 口径与 console-bff subscribe-context 的 queryPlanLadder 同源：active plan、
 * current_version 指向、published 即 is_locked 的版本、primary 组件（bundled 无商业
 * 档位，不进阶梯）。website 额外收紧产品可见性轴（is_customer_visible +
 * status='active'，对齐 product-catalog.router 的公开目录口径）。
 *
 * 邀请档（owner 2026-09-28）：`is_public = false` 的档**也进阶梯**，每档带
 * `access: public | invite`。邀请订阅是套餐级的机制（admin 按档设 is_public，运营给
 * 账号定向发邀请券，console-bff 只对持券人露出那一档）；官网此前把它整个产品级地
 * 拦在门外——阶梯只回公开档，一个产品只要全是邀请档，定价页就只剩一块空态，档位、
 * 价格、权益全看不见。现在阶梯照回，档位卡按 access 换 CTA：公开档「订阅」，邀请档
 * 「邀请订阅」（弹窗讲怎么拿到邀请 / 已有邀请去 console）。与 console-bff 的差别只在
 * 「露不露邀请档」：console 只给持券人看（那是下单的门），官网给所有人看（那是营销面）。
 *
 * 承诺等级（release_stage，2026-09-27）也参与 subscribeAccess：preview / sunset 不接
 * 新订阅，一律判 none；阶梯本身照回（停售的要留给老客户参考，画不画由页面按档决定）。
 * 此前这根轴在本端点上完全没读——目录卡把停售产品指到 /pricing，落地页照样给「订阅」，
 * 再往下 console 下单撞 409。
 *
 * 容错契约（对齐 product-catalog / console 深链降级）：产品不存在、不可见或
 * 无已发布套餐 → { product: null | …, plans: [] }，不抛 4xx/5xx；对比表的
 * 标签文案仍走 i18n，此处只供权威数据（价格/周期/features/quota + 档位名与
 * 描述——2026-08-30 官网定价页去掉 i18n 假价后，档位名/描述也改读 product.plans
 * 真列，不再另写一份）。
 *
 * TODO(shared-ladder): 本查询与 console-bff queryPlanLadder 是同一口径的两份
 * SQL；若第三处出现，应抽到共享查询层（如 @vxture/service-catalog）统一维护。
 */
import { Controller, Get, Inject, Logger, Param } from "@nestjs/common";
import type { Pool } from "pg";
import { TIERS } from "@vxture-platform/shared";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";
import {
  readMaintenance,
  type ProductMaintenance,
} from "./product-catalog.router";

/** 与 console-bff subscription.router 相同的产品码形状约束。 */
const PRODUCT_CODE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** 席位在 quota jsonb 中的指标键（seed/biz-260 口径）。 */
const SEATS_QUOTA_KEY = "member.max";

/**
 * 承诺等级里能接新订阅的档：beta / stable；preview / sunset 与未登记值一律不可订。
 *
 * 镜像 packages/core/utils/src/release-stage.ts 的 RELEASE_STAGE_DEFS[].subscribable
 * （isReleaseStageSubscribable）。本包没有依赖 @vxture/core-utils，而那条判据按其头注
 * 是过渡态（将换成「存在在售的公开套餐」）——不为一个要退役的谓词新拉一条包依赖。
 * 两处若分叉，console-bff 下单那道门是最终裁定；这里只决定官网给不给入口。
 */
const SUBSCRIBABLE_RELEASE_STAGES: ReadonlySet<string> = new Set([
  "beta",
  "stable",
]);

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
  /** product.plans.description 原样透传（可空；官网档位卡副标题）。 */
  description: string | null;
  tier: string;
  /**
   * 该档的订阅入口：public = 自助可买（is_public）；invite = 凭邀请（非 is_public，
   * 运营定向发券、持券人登录 console 才看得到这一档）。官网档位卡据此换 CTA。
   */
  access: "public" | "invite";
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
    /** 承诺等级（preview / beta / stable / sunset）：页面按它决定空态还是「停售中」。 */
    releaseStage: string;
  } | null;
  plans: ProductPlanOption[];
  /**
   * 订阅入口三态（owner 2026-09-22）：public 阶梯里有公开档 / invite 只有邀请档 /
   * none 一档都没有。2026-09-28 起直接从 `plans` 的 access 归纳（阶梯已含邀请档，
   * 不再另问一次计数）；保留这一项是给目录卡与「一档都没有」的空态用。
   *
   * 承诺等级不可订（preview / sunset）时恒为 none，与阶梯里有没有档无关。
   */
  subscribeAccess: "public" | "invite" | "none";
  /**
   * 产品级升级维护窗口（owner 2026-09-27）：非空 = 升级维护中，`until` 预计恢复（ISO）。
   * 与目录端点同一形状、同一真源（product.products 两列），定价页据此把每张卡的 CTA 换成
   * 状态字「升级维护中，暂不可订阅」。
   *
   * **不动 `subscribeAccess`**：维护是临时运行态，正常流程里的判定（承诺等级、公开档 /
   * 邀请档）照算——窗口一结束，页面拿掉状态字就回到原样，不用再问一次。
   * 产品不存在 / 非法码时与其它字段一样回空（null）。
   */
  maintenance: ProductMaintenance | null;
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
      return {
        product: null,
        plans: [],
        subscribeAccess: "none",
        maintenance: null,
      };
    }

    const productRes = await this.pool.query<{
      product_code: string;
      product_name: string;
      product_nick: string | null;
      release_version: string | null;
      release_stage: string;
      maintenance_window_id: string | null;
      maintenance_until: Date | string | null;
    }>(
      `select product_code, product_name, product_nick, release_version,
              release_stage, maintenance_window_id, maintenance_until
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
      return {
        product: null,
        plans: [],
        subscribeAccess: "none",
        maintenance: null,
      };
    }

    const ladderRes = await this.pool.query<{
      plan_code: string;
      plan_name: string;
      description: string | null;
      tier: string;
      is_public: boolean;
      features: string[];
      quota: Record<string, unknown> | null;
      prices: ProductPlanPrice[];
    }>(
      /* 邀请档（is_public = false）也进阶梯——它是套餐级的属性，由每档的 access 说话；
         此前这里有一句 pl.is_public = true，把整个产品的定价页拦成空态。 */
      `select pl.plan_code, pl.plan_name, pl.description, pl.is_public, pc.tier, pc.features, pc.quota,
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
          and pl.is_customer_visible = true
         left join product.plan_prices pp on pp.plan_version_id = pv.id
        where prod.product_code = $1 and pc.tier is not null
        group by pl.plan_code, pl.plan_name, pl.description, pl.is_public, pc.tier, pc.features, pc.quota`,
      [productCode],
    );

    const rank = (t: string) => {
      const i = (TIERS as readonly string[]).indexOf(t);
      return i < 0 ? Infinity : i;
    };
    const plans = ladderRes.rows
      .map(
        (r): ProductPlanOption => ({
          planCode: r.plan_code,
          planName: r.plan_name,
          description: r.description ?? null,
          tier: r.tier,
          /* 只有明确的 true 才算公开：列是 NOT NULL boolean，正常拿不到别的值；万一拿到，
           把邀请档误标成「订阅」会把人送进 console 一个看不见的档，比反过来更糟。 */
          access: r.is_public === true ? "public" : "invite",
          features: r.features ?? [],
          quota: publicQuota(r.quota),
          seats: readSeats(r.quota),
          prices: r.prices,
        }),
      )
      .sort((a, b) => rank(a.tier) - rank(b.tier));

    /*
     * 订阅入口三态（owner 2026-09-22）直接从阶梯归纳：有公开档 = public；一个公开档
     * 都没有但有邀请档 = invite；一档都没有 = none。2026-09-28 之前阶梯不含邀请档，
     * 这里要另打一次库数邀请档；现在邀请档就在 `plans` 里，多问那一次没有意义。
     *
     * 承诺等级不可订时入口一律 none：邀请档也不接新进（邀请解锁的是「能买」，停售
     * 与预览连「能买」都没有）。
     */
    const stageOpen = SUBSCRIBABLE_RELEASE_STAGES.has(productRow.release_stage);
    const hasPublicTier = plans.some((p) => p.access === "public");

    return {
      product: {
        code: productRow.product_code,
        name: productRow.product_name,
        nick: productRow.product_nick,
        releaseVersion: productRow.release_version,
        releaseStage: productRow.release_stage,
      },
      plans,
      subscribeAccess: !stageOpen
        ? "none"
        : hasPublicTier
          ? "public"
          : plans.length > 0
            ? "invite"
            : "none",
      maintenance: readMaintenance(
        productRow.maintenance_window_id,
        productRow.maintenance_until,
      ),
    };
  }
}

/** quota["member.max"] → 席位数；缺失或非有限数值 → null。 */
/**
 * 以 `_` 开头的配额键是套餐的内部配置（如 `_pricing.consumable_share`，折抵权重），
 * 不是客户能用的额度。此前原样透传，官网「对比所有功能」把 `_pricing {"consumable_share":0.5}`
 * 当一行配额打了出来（2026-09-27 实测 tenderforge）。
 */
function publicQuota(
  quota: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!quota) return quota;
  return Object.fromEntries(
    Object.entries(quota).filter(([key]) => !key.startsWith("_")),
  );
}

function readSeats(quota: Record<string, unknown> | null): number | null {
  const raw = quota?.[SEATS_QUOTA_KEY];
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
