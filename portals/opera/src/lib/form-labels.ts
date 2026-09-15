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
