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

// SSR 主题启动脚本是纯字符串、天然 server-safe，而它唯一的消费场景恰是
// server 布局的 <head>（首帧前同步主题）。此前只从客户端 barrel 导出，
// server 组件拿不到（vxture-platform#320）；从本入口导出后，消费方在
// server layout 里 `import { themeBootstrapScript } from
// "@vxture/design-system/server"` 即可。
export { themeBootstrapScript } from "./theme/script";
