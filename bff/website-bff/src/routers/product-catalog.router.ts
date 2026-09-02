/**
 * product-catalog.router.ts - 公开产品目录（website 侧）
 * @package @vxture/bff-website
 *
 * GET /api/products/catalog —— 客户可见产品的公开属性。**公开端点**（无需登录）：
 * AuthMiddleware 非阻断，匿名亦可读。
 *
 * 口径（opera/40-product-registry.md §1 / §4）：product.products 是「平台上有哪些
 * 产品」的唯一权威，官网只读这张表、只加与公开营销相符的一层过滤
 * （`status='active' AND is_customer_visible`），不另起清单、不按产品码点名。
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
  /** 成熟度轴：ga=正式版 / beta=公测版 / developing=开发中。官网据此判徽标与订阅按钮。 */
  releaseStage: string;
  /** 营销内容（DB 权威源,替代官网写死）；未录入为 null。 */
  marketing: MarketingContent | null;
}

interface ProductCatalogRow {
  product_code: string;
  product_name: string;
  product_nick: string | null;
  product_type: string;
  description: string | null;
  release_version: string | null;
  release_stage: string;
  marketing: MarketingContent | null;
}

@Controller("api/products")
export class ProductCatalogRouter {
  constructor(@Inject(WEBSITE_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get("catalog")
  async getCatalog(): Promise<ProductCatalogItem[]> {
    const res = await this.pool.query<ProductCatalogRow>(
      `select product_code, product_name, product_nick, product_type,
              description, release_version, release_stage, marketing
         from product.products
        where is_customer_visible = true
          and status = 'active'
          and deleted_at is null
        order by sort asc, product_code asc`,
    );
    return res.rows.map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      productNick: r.product_nick,
      productType: r.product_type,
      description: r.description,
      releaseVersion: r.release_version,
      releaseStage: r.release_stage,
      marketing: r.marketing,
    }));
  }
}
