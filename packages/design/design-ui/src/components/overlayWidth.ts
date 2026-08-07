/**
 * overlayWidth.ts - 控件与浮层的宽度挡位，base 层各浮层件共用。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components
 *
 * 五档来自 T2 的 `--container-overlay-*`：8 / 10 / 14 / 18 / 24rem（逐档偶数，步长随挡位增大）。
 * 这一族存在的理由是上游 container 刻度从 16rem 起步——它喂的是容器最大宽——而
 * 下拉、菜单、气泡落在它底下，整段没有挡位。缺挡的症状是 `Select` 曾写
 * `min-w-[8rem]` 任意值、`DropdownMenu` 与 `ContextMenu` 写裸数字 `min-w-32`。
 *
 * 挡位是**按设计定的，不是照抄这些现值**（判据见 semantic-policy 的 OVERLAY_WIDTHS）。
 * 各件的默认档因此会与它从前写死的数不同，那是搬上梯子的正常代价。
 *
 * 单独成文件而不是挂在某一件上：理由同 [tone.ts]——Select 的下拉和 DropdownMenu 的
 * 菜单说的是同一件事，同一个挡位在两处有两个名字迟早对不上。
 *
 * ⚠ 类名必须写成**完整字面量**。Tailwind 扫的是源码文本，`min-w-overlay-${w}` 这种
 *   拼接扫不到，产不出工具类，且不报错。
 *
 * ⚠ 别把它改回 `control`。`--spacing-control-*`（控件高度）先注册，而 `min-w` 按
 *   `--min-width → --spacing → --container` 依次解析，`min-w-control-xs` 会命中
 *   1.5rem 的高度挡而不是 8rem 的宽度挡——不报错，只是值不对。详见 semantic-policy。
 *
 * ⚠ 挡位不随密度变（T2 里就是这么定的）。与 `--space-control-*`（控件高度，随密度）
 *   刻意不对称：密度收的是纵向节奏，控件变窄只会截断文字。
 */

/**
 * 五档的**运行时数组**，类型由它推导。预览面要遍历全部档位时引这里，别手抄。
 * 下方两个 Record<OverlayWidth, string> 以此类型为键，加档漏填在编译期即报。
 */
export const OVERLAY_WIDTHS = ["xs", "sm", "md", "lg", "xl"] as const;

export type OverlayWidth = (typeof OVERLAY_WIDTHS)[number];

/**
 * 菜单类浮层用**下限**：挡位是起点，内容更宽就撑开。
 * 下拉、上下文菜单、选择器的选项文字长度不可预知，钉死宽度会截断。
 */
export const overlayMinWidthClass: Record<OverlayWidth, string> = {
  xs: "min-w-overlay-xs",
  sm: "min-w-overlay-sm",
  md: "min-w-overlay-md",
  lg: "min-w-overlay-lg",
  xl: "min-w-overlay-xl",
};

/**
 * 气泡类浮层用**定宽**：内容是排版好的一段，宽度是设计决定的，不该随内容浮动。
 */
export const overlayWidthClass: Record<OverlayWidth, string> = {
  xs: "w-overlay-xs",
  sm: "w-overlay-sm",
  md: "w-overlay-md",
  lg: "w-overlay-lg",
  xl: "w-overlay-xl",
};
