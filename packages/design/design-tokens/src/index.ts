/**
 * index.ts - @vxture/design-tokens 公共 API。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category Index
 *
 * 本包是 DS 的**词汇表**：T1 原子（Tailwind v4 theme 的镜像）与 T2 语义两层
 * CSS，加上 CSS 表达不了的那一小块 TypeScript——叠放次序的数值、模式轴的取值
 * 与类名。零运行时依赖，可被服务端与构建脚本安全引入。
 *
 * 样式经 package exports 的 `./styles/*` 引入，不从本入口导出。
 *
 * ⚠ 这里**不再**提供 colors / spacing / typography 之类的 TS 常量表。它们曾以
 *   `var(--vx-color-gray-500)` 这类字符串存在，指向的变量多数早已不存在，且没有
 *   任何消费者——取值的正确出口是工具类，不是 JS 字符串。
 */

export * from "./generated";
