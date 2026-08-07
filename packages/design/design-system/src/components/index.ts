/**
 * components/index.ts - 伞包自持的组件。
 * @package @vxture/design-system
 *
 * 基础组件与平台图案在 @vxture/design-ui。留在这里的两个都**需要运行时接线**：
 * shell 消费主题 / 密度 / 字号偏好，auth 消费 Turnstile 与登录流程状态。
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Index
 */

export * from "./auth";
export * from "./shell";
