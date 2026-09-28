/**
 * severity.ts — 运营通告严重度的取值与语气，一处定。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 值域是 `admin.operator_notices` 的 `chk_operator_notices_severity`（也就是
 * `@vxture/service-notice` 的 `NOTICE_SEVERITIES`）在前端的投影。**文案不在这里**
 * ——文案走 `t("operatorNoticesPage.severity.*")`，两本词典各一份。
 *
 * 语气与顺序收在这里是因为页面与「需要处理」那一块都要用：各写一份的话，同一档
 * 在一屏的两个地方会染成两个颜色，而那不报错。
 */

/** 由轻到重。界面上排序、以及「先看哪一档」都按它。 */
export const NOTICE_SEVERITIES = ["info", "warning", "critical"] as const;

export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/** 需要人去看一眼的两档。「需要处理」那一块只列它们。 */
export const URGENT_SEVERITIES: readonly NoticeSeverity[] = [
  "critical",
  "warning",
];

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `info` 走中性而不是绿——六档里 `success` 的语义是**达成了一件事**，而「一般」
 * 不是一项达成。与维护窗口页、admin 的读侧同源。
 */
export function severityTone(
  severity: NoticeSeverity,
): "danger" | "warning" | "neutral" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}
