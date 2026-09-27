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

import { formatClock, formatDateTime } from "@vxture-platform/shared";
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
  /** 预期发布日期（YYYY-MM-DD，语言无关）：开发中的产品卡片底部「预期发布：日期」；上线后忽略。 */
  expectedReleaseAt?: string;
}

/** 预期发布日期：只认能解析成日期的字符串，其余按未填。 */
export function marketingExpectedReleaseAt(
  marketing: MarketingContent | null | undefined,
): string | null {
  const raw = marketing?.expectedReleaseAt;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

/** 推荐度归一：非整数 / 越界一律夹到 0–3。 */
export function marketingRecommend(
  marketing: MarketingContent | null | undefined,
): number {
  const raw = Number(marketing?.recommend ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(3, Math.round(raw)));
}

/**
 * 产品级升级维护窗口（owner 2026-09-27）：非空 = 产品正在「升级维护中」，`until` 是运营
 * 填的预计恢复时间（ISO）。镜像 website-bff 的 ProductMaintenance；目录端点与套餐端点
 * 同一形状。**无论是否订阅**，这段时间里产品都不可用：未订阅的暂不能订，已订阅的只留
 * 「进入」。呈现优先级：维护 > 停售 > 其他（维护是临时的运行态，先说它）。
 */
export interface ProductMaintenance {
  until: string;
}

/**
 * 部署偏斜防护：旧 BFF 不回这一项 → null，即本字段之前的行为（没有维护态）。形状不对
 * （不是对象 / until 不是字符串）也按没有——宁可少画一枚徽标，不能凭一个读不懂的值
 * 把产品标成维护中。
 */
export function normalizeMaintenance(raw: unknown): ProductMaintenance | null {
  if (!raw || typeof raw !== "object") return null;
  const until = (raw as { until?: unknown }).until;
  return typeof until === "string" ? { until } : null;
}

/**
 * 「预计 {time} 恢复」里的那个 time。
 *
 * 与订阅冻结弹窗（SuspensionDetailDialog）同一形态——长日期 + 短时间（2026/10/01 10:00），
 * 走 shared 的 formatDateTime（lint:datetime-discipline 只认它，时区默认 PLATFORM_TIME_ZONE）。
 * 与弹窗不同的一点：locale 传**站点 locale**而不是运行时默认。目录卡与详情 hero 在服务端
 * 就渲染这一行，服务端与浏览器的运行时 locale 不一致会 hydration 对不上；弹窗只在点开
 * 后才渲染，没有这个问题。
 *
 * until 解析不了 → null，调用方只画徽标不画这一行。
 */
export function maintenanceUntilText(
  maintenance: ProductMaintenance | null | undefined,
  locale: string,
): string | null {
  if (!maintenance) return null;
  const until = new Date(maintenance.until);
  if (Number.isNaN(until.getTime())) return null;
  /* 一行灰字只够放一个时刻：24 小时内只说「02:17」，更远才带短日期。owner 2026-09-28：
     按钮位置塞两行说明「变态」——时间要短到能挤在徽标旁边。 */
  const withinDay =
    Math.abs(until.getTime() - Date.now()) < 24 * 60 * 60 * 1000;
  const text = withinDay
    ? formatClock(maintenance.until, locale, "", { time: "short" })
    : formatDateTime(maintenance.until, locale, "", {
        date: "short",
        time: "short",
      });
  return text || null;
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
  /** 对外发布时间（ISO 字符串）；未填为 null。 */
  releasedAt: string | null;
  /**
   * 承诺等级轴（2026-10-29 由「成熟度」改名）：`preview` 预览版 / `beta` 公测版 /
   * `stable` 正式版 / `sunset` 停售中。官网据此判徽标与订阅按钮。
   *
   * 这句注释曾长期写着旧词表 `ga / developing`——值域改过名，注释没跟，于是读它的人
   * 会去找两个库里不存在的值。2026-09-24 订正。
   */
  releaseStage: string;
  /**
   * 生命周期轴（2026-09-24 接入）：`active` 已上线 / `developing` 开发中。
   *
   * 官网目录此前只放 `active`，于是「信息填好了、东西还没建」的产品只能挂在
   * `active` 上——opera 与 admin 双双显示「已上线」。`developing` 这一档就是用来
   * 把「填了信息」与「上了线」分开的：它**出现在官网**（可预告），但**不可订**。
   *
   * 不可订必须认这根轴，不能只认 `releaseStage === "preview"`：那是两根轴碰巧
   * 一致，而定价端点按 `status = 'active'` 过滤产品——两轴一分叉，卡上就是一颗
   * 点进去落到空阶梯的假按钮。
   *
   * 部署偏斜防护：门户先于 BFF 发布时旧响应没有这一列，回落 `active`——那是本
   * 字段之前的行为（目录里只可能有 active），不会凭空把在售产品标成开发中。
   */
  status: "active" | "developing";
  /** 营销内容（DB 权威源,替代官网写死）；未录入为 null。 */
  marketing: MarketingContent | null;
  /**
   * 订阅入口三态（owner 2026-09-22）——卡片上那颗按钮写什么由它决定。
   *
   *   public  有公开可买的档            → 「订阅」
   *   invite  只有邀请档（非 is_public）→ 「邀请订阅」
   *   none    一档都没有                → 不给购买入口
   *
   * 部署偏斜防护：门户先于 BFF 发布时旧响应没有这个字段，回落 `public`——那是本
   * 字段之前的行为（卡上一律「订阅」），不会凭空把在售产品标成邀请制。
   */
  subscribeAccess: "public" | "invite" | "none";
  /**
   * 两根布尔（owner 2026-09-28）：有没有自助可买的档 / 有没有凭邀请的档。邀请订阅是
   * 套餐级的，混卖（公开档 + 邀请档并存）时卡上要同时画「邀请订阅」与「订阅」——三态
   * 在混卖时只说 public，画不出第二颗按钮。
   *
   * 部署偏斜防护：旧 BFF 不回这两列时由三态推回去（public → 有公开档；invite → 有
   * 邀请档），即本字段之前卡片能画出的那一颗。
   */
  hasPublicTier: boolean;
  hasInviteTier: boolean;
  /**
   * 产品级升级维护窗口；null = 不在维护中。部署偏斜防护：旧响应没有这一项时回落 null，
   * 即本字段之前的行为。见 ProductMaintenance。
   */
  maintenance: ProductMaintenance | null;
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
  return Array.isArray(data) ? data.map(normalizeCatalogItem) : [];
}

/**
 * 部署偏斜防护：门户先于 BFF 发布时旧响应没有 `subscribeAccess`，回落 `public`
 * ——那是这个字段之前的行为（卡上一律「订阅」）。回落成 `invite` 会把在售产品
 * 凭空标成邀请制，那比不标更糟。
 */
function normalizeCatalogItem(raw: unknown): ProductCatalogItem {
  const item = raw as ProductCatalogItem;
  const access = (raw as { subscribeAccess?: unknown }).subscribeAccess;
  const subscribeAccess =
    access === "invite" || access === "none" || access === "public"
      ? access
      : "public";
  const rawPublic = (raw as { hasPublicTier?: unknown }).hasPublicTier;
  const rawInvite = (raw as { hasInviteTier?: unknown }).hasInviteTier;
  return {
    ...item,
    subscribeAccess,
    /* 旧 BFF 不回这两列 → 由三态推回去（那就是旧卡片能画出的那一颗按钮）。 */
    hasPublicTier:
      typeof rawPublic === "boolean" ? rawPublic : subscribeAccess === "public",
    hasInviteTier:
      typeof rawInvite === "boolean" ? rawInvite : subscribeAccess === "invite",
    maintenance: normalizeMaintenance(
      (raw as { maintenance?: unknown }).maintenance,
    ),
  };
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
