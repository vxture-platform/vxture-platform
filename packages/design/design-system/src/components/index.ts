/**
 * components/index.ts - 伞包自持的组件。
 * @package @vxture/design-system
 *
 * 基础组件与平台图案在 @vxture/design-ui。留在这里的 shell 族**需要运行时
 * 接线**（消费主题 / 密度 / 字号偏好）。
 *
 * 原先还有一个 auth 族，2026-08-18 迁出到 portals/accounts：DS 只收通用、
 * 无业务含义的件，而那一族说的全是登录 / 绑定 / 找回 / MFA——认证业务的
 * 页面语汇。它是 DS 原语的组合，组合的知识归拥有认证面的应用。
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Index
 */

export * from "./shell";
