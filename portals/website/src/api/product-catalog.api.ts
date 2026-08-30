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

export interface ProductCatalogItem {
  productCode: string;
  /** 主名/品牌名（product_name） */
  productName: string;
  /** 译名/副名（product_nick），目录里没填就是 null */
  productNick: string | null;
  /** 目录真列 product_type：model_platform / capability_platform / data_platform / knowledge_platform / agent / client / external … */
  productType: string;
  description: string | null;
  releaseVersion: string | null;
}

/** 目录 `product_type` 里属于「平台级产品」（L1/L2）的四型——/products 的读取口径。 */
export const PLATFORM_PRODUCT_TYPES: readonly string[] = [
  "model_platform",
  "capability_platform",
  "data_platform",
  "knowledge_platform",
];

export function isPlatformProduct(item: ProductCatalogItem): boolean {
  return PLATFORM_PRODUCT_TYPES.includes(item.productType);
}

/** /appcenter 的读取口径：目录里 product_type='agent' 的产品。 */
export function isAgentProduct(item: ProductCatalogItem): boolean {
  return item.productType === "agent";
}

/** 展示名：副名（通常是品牌/英文名）优先，退回主名——与 /pricing 的 pricing-model 同判。 */
export function catalogDisplayName(item: ProductCatalogItem): string {
  const nick = item.productNick?.trim();
  return nick ? nick : item.productName;
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
