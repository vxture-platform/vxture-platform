/**
 * components/templates/index.ts - 模板层导出入口。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Index
 *
 * 本目录放**页面级骨架**（design-system/docs/03-patterns-guide.md §7–8）：只定结构与区块占位，零新样式，纯组合
 * 下两层。判据比 patterns/ 更严：
 * 1. **全部内容经槽位进来**。模板没有文案默认值、没有业务语义——列表页
 *    "长什么样"在这里，"列什么"永远在产品侧。
 * 2. **零新视觉**。只用布局类排布 + 组合现有组件；分隔线只引 recipes 的
 *    hairline，语气只引 tone.ts 的刻度。
 * 3. **不带产品专名**（D16），与 patterns/ 同规。
 */

export * from "./DashboardTemplate";
export * from "./DetailPageTemplate";
export * from "./FormPageTemplate";
export * from "./ListPageTemplate";
export * from "./ResultPageTemplate";
