/**
 * form-labels.ts — DS `FieldLabel` 的必填 / 帮助两处读屏文案。
 * @package @vxture/opera
 *
 * DS 的默认文案是英文（基准语），产品在调用点覆盖。opera 的表单都是中文，每个
 * `FieldLabel` 各写一遍 `requiredLabel="必填" hintLabel="说明"` 迟早有漏写的——漏了
 * 读屏就在中文界面里念一句 "Required"。收成一个常量，展开到用了 `required` 或
 * `hint` 的标签上。
 */
export const FIELD_LABEL_A11Y = {
  requiredLabel: "必填",
  hintLabel: "说明",
} as const;

/**
 * FieldTier 三档的中文标题。
 *
 * DS 的 FieldTier 按惯例零文案、默认英文（Identity / Details / Advanced），由消费方传
 * `title`。opera 此前大多数调用点没传，表单里夹着三个英文分组名（v0.26.176 线上走查）。
 * 调用点自己有更贴切的标题时照旧写自己的。
 */
export const FIELD_TIER_TITLE = {
  identity: "基本信息",
  details: "详细配置",
  advanced: "高级选项",
} as const;
