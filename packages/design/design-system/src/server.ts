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
export * from "@vxture/design-ui/server";

// 这里**不能**转出 `@vxture/design-ui` 的类型面（vxture-platform#268，2026-08-21）。
// 源码写 `export type *` 看着是安全的，但 tsup 的 dts rollup 会把 `type` 修饰符
// 擦掉，产出 `export * from '@vxture/design-ui'`——于是 282 个客户端组件名同时
// 落进 .d.ts 的**值空间**，而 server.mjs 运行时只有 27 个。后果是消费方能写出
// `import { Button } from "@vxture/design-system/server"`：tsc 零错误、构建全绿、
// 渲染时 Button 是 undefined。类型系统主动为错误写法背书，是最贵的一类缺陷。
// 客户端组件有哪些，是主入口的类型该说的事，不是 /server 的。
// 由 check-packed-consumability.mjs 的类型/运行时同面检查守住。

// SSR 主题启动脚本是纯字符串、天然 server-safe，而它唯一的消费场景恰是
// server 布局的 <head>（首帧前同步主题）。此前只从客户端 barrel 导出，
// server 组件拿不到（vxture-platform#320）；从本入口导出后，消费方在
// server layout 里 `import { themeBootstrapScript } from
// "@vxture/design-system/server"` 即可。
export { themeBootstrapScript } from "./theme/script";
