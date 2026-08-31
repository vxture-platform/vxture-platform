/* next-intl 的全局类型声明。
 *
 * `useLocale()` 默认回 `string`，而平台的 locale 是 `@vxture-platform/shared` 里那个
 * 两值联合。不声明的话每个用到 locale 的地方都要写一次 `as Locale`——单个断言在
 * 这里是无害的（provider 拿到的值确实来自 `SUPPORTED_LOCALES`），但十几个断言会
 * 让真正需要被质疑的那一个混在里面看不出来。
 *
 * ## 为什么没有一并声明 `Messages`
 *
 * 试过。next-intl 支持 `Messages: typeof zhCN`，那会让 `t("settings.foo")` 的键过
 * 类型检查——拼错是编译错误而不是运行时渲染出一串键路径。但在这个规模上它
 * 不成立，两个原因：
 *
 *   ① admin 的词条有 1004 条，TS 直接报
 *      `TS2590: Expression produces a union type that is too complex to represent`。
 *   ② 有一批键**本来就不是字面量**：侧栏分组的键由工作域配置驱动，角色名的键
 *      来自库里的伴生 `_key` 列（data_platform §3.2.5）。它们不可能被穷举成联合。
 *
 * 所以「键必须存在、且中英对齐」这件事交给守卫
 * （`scripts/guardrails/check-message-catalogs.mjs`），不交给类型系统——那是它在
 * 这个规模上做不到的事。
 */
import type { Locale } from "@vxture-platform/shared";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
  }
}
