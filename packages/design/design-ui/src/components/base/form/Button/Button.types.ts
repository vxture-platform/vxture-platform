/**
 * Button variant / size — defined alongside the Button component.
 * @package @vxture/design-ui
 *
 * 两族都是**运行时数组**，类型由它推导。预览面、图案件要遍历全部挡位时引这里，
 * 不再各自手抄一份——手抄的清单加了挡位不会跟着加，且不报错。
 */

export const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  /** 入口用：行内删除、菜单危险项。淡底，见 design-system/docs/03-patterns-guide.md §3 危险两档。 */
  "destructive",
  /** 落锤用：确认对话框的提交。实心。 */
  "destructive-strong",
  "link",
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/**
 * 档名 = `--space-control-*` 的档名，默认密度下：
 * **xs 24 · sm 28 · md 32 · lg 36 · xl 40**。默认档是 `md`。
 * 五个 icon 档是同高的正方形，用于只有图标没有文字的按钮。
 *
 * 想知道一个按钮多高，读档名即可，不用回来查表——这正是 2026-08-04 那次
 * 对齐要解决的事（此前 `sm` 指 control-md、`lg` 指 control-xl，整体错位
 * 一格，而 control-sm/control-lg 叫不出名字）。理由见 Button.tsx 的尺寸表。
 */
export const BUTTON_SIZES = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "icon-xs",
  "icon-sm",
  "icon-md",
  "icon-lg",
  "icon-xl",
] as const;

export type ButtonSize = (typeof BUTTON_SIZES)[number];
