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
