/**
 * product-catalog.api.ts - 公开产品目录读取（website 侧）
 * @package @vxture/website
 * @layer Presentation
 * @category API
 *
 * 官网展示的产品 = `GET /api/products/catalog` 回传的产品，一个不多、一个不少
 * （opera/40-product-registry.md §1：product.products 是唯一产品清单，其它面只读它，
 * 不得以硬编码的产品码集合代替查询）。本文件是官网读这张清单的唯一入口：
 *
 *  - `fetchPublicProductCatalog()` 在**服务端组件**里调用——/products、/appcenter、
 *    /products/[slug] 三个 page.tsx 都声明 `dynamic = "force-dynamic"`，逐请求取目录再
 *    渲染，于是不在目录里的 slug 能返回真正的 404（客户端判定只能画一个"像 404"的页）；
 *  - `isPlatformProduct` / `isAgentProduct` 是两张清单页各自的读取口径：按目录真列
 *    `product_type` 分区（§3 的类型→层级判定：platform 四型 = L1/L2，agent = L3），
 *    不按产品码点名。`client`（如影桌面端）与 `external` 有各自的营销入口，不进这两页，
 *    但 /products/[slug] 对目录里任何产品都解析。
 *
 * 服务端基址按顺序取：`WEBSITE_BFF_INTERNAL_URL`（容器内网地址，同 console 的
 * CONSOLE_BFF_INTERNAL_URL 先例；生产 compose 尚未设置——未设时下一档也能走通，只是
 * 从容器出去绕公网 nginx 再回来）→ `WEBSITE_BFF_DEV_URL`（本地 dev 代理目标）→ 浏览器
 * 用的公开基址（生产镜像烘入的 NEXT_PUBLIC_WEBSITE_BFF_URL；本地默认 localhost:3001）。
 */

import { API_BASE_URL } from "./client";

/** marketing jsonb 的单语部分（营销文案富字段,全部可缺）。镜像 website-bff。 */
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

/** 推荐度归一：非整数 / 越界一律夹到 0–3。 */
export function marketingRecommend(
  marketing: MarketingContent | null | undefined,
): number {
  const raw = Number(marketing?.recommend ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(3, Math.round(raw)));
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

/** 取当前 locale 的营销单语块（zh-* → zh,其余 → en,缺则回退另一语）。 */
export function marketingForLocale(
  marketing: MarketingContent | null | undefined,
  locale: string,
): MarketingLocale | null {
  if (!marketing) return null;
  const primary = locale.toLowerCase().startsWith("zh")
    ? marketing.zh
    : marketing.en;
  return primary ?? marketing.zh ?? marketing.en ?? null;
}

/**
 * /products 的读取口径：目录里**平台级产品家族**（L1/L2）。
 *
 * 与 agent 家族同理，平台型也是 `<限定>_platform` 的分层 taxonomy：`general_platform`
 * （通用平台）、`external_platform`（外部平台），历史上还有 model/capability/data/
 * knowledge_platform。**按后缀 `_platform` 归族**，新增子型无需改这里。保留常量供别处
 * 引用历史四型，但判定不再靠它点名。
 */
export const PLATFORM_PRODUCT_TYPES: readonly string[] = [
  "general_platform",
  "external_platform",
  "model_platform",
  "capability_platform",
  "data_platform",
  "knowledge_platform",
];

export function isPlatformProduct(item: ProductCatalogItem): boolean {
  return item.productType.endsWith("_platform");
}

/**
 * /appcenter 的读取口径：目录里**智能体家族**的产品。
 *
 * agent 类型是分层 taxonomy：`general_agent`（通用智能体）、`industry_agent`（行业智能体），
 * 后续可能有 software/embodied 等子型。product_type 是自由文本(DDL 无 CHECK),因此按
 * **后缀 `_agent`** 归族(外加历史裸 `agent`),而不是点名单个串——新增子型无需改这里。
 */
export function isAgentProduct(item: ProductCatalogItem): boolean {
  return item.productType === "agent" || item.productType.endsWith("_agent");
}

/** 展示名：副名（通常是品牌/英文名）优先，退回主名——与 /pricing 的 pricing-model 同判。 */
/**
 * 展示名按 locale 取:中文页用主名 product_name(如「专注训练智能体」),英文页用副名
 * product_nick(品牌/英文名);各自缺省时互相退回,再退回 code。避免中文页显英文名的混排。
 */
export function catalogDisplayName(
  item: ProductCatalogItem,
  locale?: string,
): string {
  const name = item.productName?.trim();
  const nick = item.productNick?.trim();
  if (locale?.toLowerCase().startsWith("en")) {
    return nick || name || item.productCode;
  }
  return name || nick || item.productCode;
}

function resolveServerBffBaseUrl(): string {
  const internal =
    process.env.WEBSITE_BFF_INTERNAL_URL?.trim() ||
    process.env.WEBSITE_BFF_DEV_URL?.trim();
  if (internal) return internal.replace(/\/+$/, "");
  return API_BASE_URL;
}

/**
 * 服务端读公开目录。读不到就抛：没有目录就没有产品清单。调用方决定后果——详情页
 * 无法区分"不存在"与"暂时读不到"，只能让错误冒出去（500 而不是假 404）；清单页
 * 用 `fetchPublicProductCatalogOrNull` 降级成「目录暂时不可用」。
 */
export async function fetchPublicProductCatalog(): Promise<
  ProductCatalogItem[]
> {
  const res = await fetch(`${resolveServerBffBaseUrl()}/api/products/catalog`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `[product-catalog] GET /api/products/catalog -> HTTP ${res.status}`,
    );
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as ProductCatalogItem[]) : [];
}

/** 清单页用：目录读不到时回 null，由页面渲染不可用态而不是整页 500。 */
export async function fetchPublicProductCatalogOrNull(): Promise<
  ProductCatalogItem[] | null
> {
  try {
    return await fetchPublicProductCatalog();
  } catch (error) {
    console.error("[product-catalog] public catalog unavailable:", error);
    return null;
  }
}
