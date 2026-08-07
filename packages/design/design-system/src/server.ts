/**
 * server.ts - Server-safe 导出入口（伞包转发）。
 * @package @vxture/design-system
 *
 * 实际内容在 @vxture/design-ui/server 与 @vxture/design-tokens；本文件只做转发，
 * 使既有的 `@vxture/design-system/server` 引用不变。
 *
 * server-safe 的判据与名单在 design-ui 侧维护——那里才是组件的家。
 */

export * from "@vxture/design-tokens";
export type * from "@vxture/design-ui";
export * from "@vxture/design-ui/server";
