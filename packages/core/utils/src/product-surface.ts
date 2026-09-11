/**
 * product-surface.ts - 产品「可露出的端」(product_surfaces)的单一权威源
 *
 * @package @vxture/core-utils
 * @description
 *   平台有 N 个产品，但**不是每个产品都适合每个端**——owner 2026-09-11:
 *   「平台 N 个产品，但 ruyin 可同步使用的 M 个产品，不是每个都能到 ruyin 端」。
 *
 *   这是**产品自身的形态属性**，与租户无关（owner 明确：按产品能不能，与租户无关）。
 *   要按租户开关的是权益，那挂在订阅 / 套餐上，不在这里。
 *
 * ── 为什么键是「端类型」而不是客户端凭据 ──
 * 一个端类型可能有**多套凭据**（移动端的 iOS 与 Android 是两个 OIDC 客户端），
 * 但产品支持的是「移动端」这**一件事**，不该登记两行；反过来，换一次凭据也不该
 * 让产品的形态属性跟着晃。
 *
 * 也**不要**加一列 `is_ruyin_available`——把某个具体客户端的名字焊进结构，正是
 * `APP_SCOPE_CODES` 犯过的错（那个集合今天明写着「products never join it going
 * forward, they only leave」，因为退不掉也扩不了）。
 *
 * ── 与其他几根轴正交 ──
 *   - `is_customer_visible` / `is_workforce_visible` = **realm** 轴（客户域 / 运营域）
 *   - `release_stage` = 成熟度、`status` = 生命周期、`product_type` / `origin` = 类型 / 来源
 *   端是**第五根**：同一个产品可以「客户域可见 + 只在 web 与桌面露出」。
 */

/** 受管的端全集。新增一个端 = 在这里加一项 + 迁移里放宽 CHECK。 */
export const PRODUCT_SURFACES = [
  "web",
  "desktop",
  "app",
  "miniprogram",
] as const;

export type ProductSurface = (typeof PRODUCT_SURFACES)[number];

export interface ProductSurfaceDef {
  readonly value: ProductSurface;
  readonly labelZh: string;
  readonly labelEn: string;
  /** 一句话说清「这个端指什么」，给登记页的提示用。 */
  readonly hintZh: string;
}

/** 值 → 展示定义。顺序即勾选框的呈现顺序（覆盖面广→窄）。 */
export const PRODUCT_SURFACE_DEFS: readonly ProductSurfaceDef[] = [
  {
    value: "web",
    labelZh: "网页端",
    labelEn: "Web",
    hintZh: "浏览器内使用，console 应用中心可直达",
  },
  {
    value: "desktop",
    labelZh: "桌面端",
    labelEn: "Desktop",
    hintZh: "如影等桌面客户端内可用",
  },
  {
    value: "app",
    labelZh: "移动端",
    labelEn: "Mobile app",
    hintZh: "iOS / Android 原生应用内可用",
  },
  {
    value: "miniprogram",
    labelZh: "小程序",
    labelEn: "Mini program",
    hintZh: "微信等小程序宿主内可用",
  },
] as const;

/** 值是否在受管全集内。写入面用它挡下域外值。 */
export function isValidProductSurface(value: string): value is ProductSurface {
  return (PRODUCT_SURFACES as readonly string[]).includes(value);
}

/**
 * 取展示标签（缺省 zh）。未登记值退回原字符串，便于过渡期**显影而非静默**。
 *
 * 与 `productTypeLabel` 同形，也同一个理由：定义里带着 `labelZh` / `labelEn` 两份
 * 文案，而调用点各自写 `locale.startsWith("en") ? d.labelEn : d.labelZh` 的话，
 * 漏一处就是那一处永远显示中文——而它在英文界面里看起来只是「这一列没翻译」，
 * 没人会去追是哪一行代码。收成一个函数，locale 的判据只有一处。
 */
export function productSurfaceLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = PRODUCT_SURFACE_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}
