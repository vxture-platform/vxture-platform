/**
 * product-catalog.router.ts - 公开产品目录（website 侧）
 * @package @vxture/bff-website
 *
 * GET /api/products/catalog —— 客户可见产品的公开属性。**公开端点**（无需登录）：
 * AuthMiddleware 非阻断，匿名亦可读。
 *
 * 口径（opera/40-product-registry.md §1 / §4）：product.products 是「平台上有哪些
 * 产品」的唯一权威，官网只读这张表、只加与公开营销相符的一层过滤
 * （`status IN ('active','developing') AND is_customer_visible`），不另起清单、
 * 不按产品码点名。`developing` 2026-09-24 接入：DDL 给它的定义就是「官网可预告」。
 * 官网三处消费面都靠它：/products 的产品矩阵、/appcenter 的智能体广场（两页按
 * `product_type` 分区），以及 /products/[slug] 的存在性判定（不在目录里 = 404）。
 *
 * 回传的每一列都是目录真列：产品码 / 主名 / 副名 / 类型 / 描述 / 对外发布号。
 * 营销文案（价值主张、图标）仍在官网 i18n 里按 product_code 查，查不到就退回
 * 这里的名与描述——所以这里不做任何「补齐」，目录里没写的就回 null。
 */
import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";

/** marketing jsonb 的单语部分（营销文案富字段,全部可缺）。 */
export interface MarketingLocale {
  tagline?: string;
  value?: string;
  highlights?: string[];
  tags?: string[];
  industries?: string[];
  detail?: string;
}
/** product.products.marketing jsonb：双语营销内容,官网据此渲染。 */
export interface MarketingContent {
  zh?: MarketingLocale;
  en?: MarketingLocale;
  /** 推荐度 0–3（语言无关）：未订阅产品卡右上角按数量画奖章；0/缺省不画。 */
  recommend?: number;
  /** 预期发布日期（YYYY-MM-DD，语言无关）：开发中的产品卡片底部「预期发布：日期」；上线后忽略。 */
  expectedReleaseAt?: string;
}

export interface ProductCatalogItem {
  productCode: string;
  /** 主名/品牌名（product_name） */
  productName: string;
  /** 译名/副名（product_nick），目录里没填就是 null */
  productNick: string | null;
  /** 受管枚举 product_type：{general,industry}_{platform,agent} / undefined（历史值仍可能出现） */
  productType: string;
  description: string | null;
  releaseVersion: string | null;
  /** 对外发布时间（released_at，ISO 字符串）；未填为 null。卡片底部「v x.y.z at 日期」用。 */
  releasedAt: string | null;
  /**
   * 承诺等级轴：stable=正式版 / beta=公测版 / preview=预览版 / sunset=停售中。
   * 官网据此画徽标。**它不决定能不能订**——那是下面 `status` 与 `subscribeAccess`
   * 的事。（这行注释曾写着旧词表 `ga / developing`，2026-09-24 随下面那一列订正。）
   */
  releaseStage: string;
  /**
   * 生命周期轴：本端点只放出 `active`（已上线）与 `developing`（开发中）两值。
   *
   * 为什么官网非得知道它：`developing` 的定义是「信息已登记、可对外预告，但东西
   * 还没建好」。这种产品**不可订**，而下游的定价/套餐端点（product-plans.router）
   * 一直在按 `status = 'active'` 过滤产品——卡片若只看承诺等级就给「订阅」按钮，
   * 客户点进去是一张空的定价页。**入口承诺一件做不到的事**，与 owner 2026-09-22
   * 定 `subscribeAccess` 时说的是同一个毛病。
   *
   * 不靠「承诺等级也会是 preview」来代替它：那是两根轴碰巧一致，没有任何东西
   * 保证它们一致，而它们一旦分叉，症状就是那颗假按钮。
   */
  status: "active" | "developing";
  /** 营销内容（DB 权威源,替代官网写死）；未录入为 null。 */
  marketing: MarketingContent | null;
  /**
   * 订阅入口三态——卡片上那颗按钮该写什么，由它决定（owner 2026-09-22）。
   *
   *   public  有公开可买的档            → 「订阅」
   *   invite  只有邀请档（非 is_public）→ 「邀请订阅」
   *   none    一档都没有                → 不给购买入口
   *
   * 为什么要有这一列：按钮此前只按成熟度 × 订阅态决定，不知道有没有公开档。把所有
   * 档改成邀请订阅之后，卡上照样写「订阅」，点进去落到「暂未开放订阅」——入口在
   * 承诺一件做不到的事。而「有邀请档」与「一档都没有」也必须分开：前者该指路
   * （登录看你的邀请 / 申请邀请），后者只能如实说还没开卖。
   */
  subscribeAccess: "public" | "invite" | "none";
}

interface ProductCatalogRow {
  product_code: string;
  product_name: string;
  product_nick: string | null;
  product_type: string;
  description: string | null;
  release_version: string | null;
  released_at: Date | string | null;
  release_stage: string;
  status: string;
  marketing: MarketingContent | null;
  public_plan_count: number | string | null;
  invite_plan_count: number | string | null;
}

@Controller("api/products")
export class ProductCatalogRouter {
  constructor(@Inject(WEBSITE_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get("catalog")
  async getCatalog(): Promise<ProductCatalogItem[]> {
    const res = await this.pool.query<ProductCatalogRow>(
      `select p.product_code, p.product_name, p.product_nick, p.product_type,
              p.description, p.release_version, p.released_at, p.release_stage,
              p.status, p.marketing,
              /*
               * 订阅入口三态（owner 2026-09-22）。卡片上那颗按钮此前只按成熟度 ×
               * 订阅态决定，**完全不知道这个产品还有没有公开可买的档**——于是把所有
               * 档改成邀请订阅之后，卡上照样写「订阅」，点进去落到「暂未开放订阅」。
               * 入口与落地页各说各话，而错的是入口在承诺一件做不到的事。
               *
               * 这里数两类：能自助买到的（is_public）与凭邀请才能买的（非 is_public）。
               * 除可见性之外的条件两边完全一样——都得是 active、当前版本已发布冻结、
               * 客户可见、挂在某个档位上。判据与本文件下方 product-plans 那条同源。
               */
              coalesce(sell.public_count, 0) as public_plan_count,
              coalesce(sell.invite_count, 0) as invite_plan_count
         from product.products p
         left join lateral (
           select count(*) filter (where pl.is_public)     as public_count,
                  count(*) filter (where not pl.is_public) as invite_count
             from product.plan_components pc
             join product.plan_versions pv
               on pv.id = pc.plan_version_id and pv.is_locked = true
             join product.plans pl
               on pl.id = pv.plan_id and pl.current_version_id = pv.id
              and pl.deleted_at is null and pl.status = 'active'
              and pl.is_customer_visible = true
            where pc.product_id = p.id
              and pc.component_role = 'primary'
              and pc.tier is not null
         ) sell on true
        /* 2026-09-24：developing（开发中）也要出。DDL 给这一档写的定义就是
           「admin 可录营销、官网可预告」，而官网这一半从没实现——于是「信息填好了、
           东西还没建」的产品只能挂在 active 上，opera 与 admin 双双显示「已上线」。
           客户那一侧不受影响：能不能订由承诺等级与在售公开套餐决定，不由这个轴决定。
           注意本注释在 SQL 模板串里，不能出现反引号——它会当场截断字符串。 */
        where p.is_customer_visible = true
          and p.status in ('active', 'developing')
          and p.deleted_at is null
        order by p.sort asc, p.product_code asc`,
    );
    return res.rows.map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      productNick: r.product_nick,
      productType: r.product_type,
      description: r.description,
      releaseVersion: r.release_version,
      releasedAt:
        r.released_at instanceof Date
          ? r.released_at.toISOString()
          : (r.released_at ?? null),
      releaseStage: r.release_stage,
      /* WHERE 只放这两值进来；认不得的值按「不可订」处理——宁可少给一颗按钮，
         不能把一个查不到的状态当成「已上线」。 */
      status: r.status === "active" ? "active" : "developing",
      marketing: r.marketing,
      /*
       * 有公开档就是公开订阅；一个公开档都没有但有邀请档 = 邀请订阅；两者都没有
       * = 还没开卖。先判公开再判邀请：混卖时（公开档 + 邀请档并存）对匿名访客来说
       * 它就是个能买的产品，邀请档不进公开阶梯，不该把整个产品标成邀请制。
       */
      subscribeAccess:
        Number(r.public_plan_count ?? 0) > 0
          ? "public"
          : Number(r.invite_plan_count ?? 0) > 0
            ? "invite"
            : "none",
    }));
  }
}
