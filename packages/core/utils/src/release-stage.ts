/**
 * release-stage.ts - 产品成熟度轴(release_stage)的单一权威源
 *
 * @package @vxture/core-utils
 * @description
 *   `product.products.release_stage` = 产品**成熟度/发布档位**,与另外几根轴正交:
 *     - `status`(active/inactive/draft/deprecated)= 注册生命周期(draft=技术注册中,未就绪)。
 *     - `is_customer_visible` = 是否上营销站。
 *     - `product_type` / `origin` = 类型 / 来源。
 *
 *   成熟度三态:`ga`(正式版)/ `beta`(公测版)/ `developing`(开发中)。营销页据此显示徽标、
 *   决定订阅按钮(ga/beta 可订,developing→敬请期待)。「开发中」是**已注册(status≠draft)
 *   产品**的成熟度,不是 draft(draft 仍在 opera 技术注册中、不上站不进 admin 产品目录)。
 *
 *   ── 这两个谓词谁在执行（2026-09-17）──
 *   - `isForwardReleaseStageMove` → admin-bff `PATCH capabilities/:code/content`，事务内、
 *     写之前判；倒退回 409。
 *   - `isReleaseStageSubscribable` → console-bff `POST /api/subscription/orders`，拒
 *     `PRODUCT_NOT_RELEASED`。**在此之前它没有调用者**：「开发中不可订」只长在官网
 *     卡片的按钮上，服务端一道门都没有。写了判据而没人调，跟没写是一回事。
 *
 *   口径成文在 `docs/20-specs/000-platform/opera/40-product-registry.md`。
 */

/** 受管的 release_stage 全集。 */
export const RELEASE_STAGES = ["ga", "beta", "developing"] as const;

export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export interface ReleaseStageDef {
  readonly value: ReleaseStage;
  readonly labelZh: string;
  readonly labelEn: string;
  /** 该档位是否可被订阅(developing 只展示不可订)。 */
  readonly subscribable: boolean;
}

/** 值 → 展示定义。顺序即下拉/呈现顺序(成熟→未成熟)。 */
export const RELEASE_STAGE_DEFS: readonly ReleaseStageDef[] = [
  { value: "ga", labelZh: "正式版", labelEn: "Stable", subscribable: true },
  { value: "beta", labelZh: "公测版", labelEn: "Beta", subscribable: true },
  {
    value: "developing",
    labelZh: "开发中",
    labelEn: "In development",
    subscribable: false,
  },
] as const;

/** 写入校验:是否受管枚举内的合法值。 */
export function isValidReleaseStage(value: string): value is ReleaseStage {
  return (RELEASE_STAGES as readonly string[]).includes(value);
}

/** 取展示标签(缺省 zh)。未登记值退回原字符串。 */
export function releaseStageLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = RELEASE_STAGE_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}

/** 该档位能否订阅(未登记值按不可订处理,保守)。 */
export function isReleaseStageSubscribable(value: string): boolean {
  return (
    RELEASE_STAGE_DEFS.find((d) => d.value === value)?.subscribable ?? false
  );
}

/**
 * 成熟度只向前走：`developing → beta → ga`，允许跨级（developing → ga）。
 *
 * 倒退（比如 `ga → developing`）不是一个合法的产品事实：它会让官网当场把一个
 * 已发布产品的订阅入口换成「敬请期待」。要把产品从客户面前收回去，该动的是
 * `is_customer_visible`（上不上站）或 `status`（生命周期）——三根轴各管一件事。
 *
 * 同态（from === to）返回 `true`：反复保存同一张表单不该报错。未登记值一律 `false`（保守）。
 */
export function isForwardReleaseStageMove(from: string, to: string): boolean {
  if (from === to) return true;
  const order = ["developing", "beta", "ga"];
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0) return false;
  return j > i;
}
