/**
 * index.ts - @vxture/design-ui 公共 API。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Index
 *
 * 本包是**无状态的组件层**：基础组件、平台图案、图标、hook 与工具函数。
 * 不含任何运行时接线——主题、密度、字号偏好这些带 React context 的东西在
 * @vxture/design-system。
 *
 * ⚠ 对 @vxture/design-tokens 的依赖是**样式依赖，不是代码依赖**：组件里没有一行
 *   `import` 指向它，但组件用的每个工具类（`bg-primary` / `p-md` / `shadow-raised`）
 *   都由它的 CSS 注册。不装它，组件渲染出来没有任何样式。声明为 dependency 而非
 *   peer，是为了单独安装本包时也能拿到那份 CSS。
 *
 * 依赖方向是单向的：tokens ← ui ← system。ui **禁止** import system，
 * 由 lint:boundaries 硬门守。反过来才对：shell 与 auth 消费 ui。
 */

export * from "./components/base";
export * from "./components/composite";
export * from "./components/templates";
export * from "./components/layout";
export * from "./components/tone";
export * from "./components/overlayWidth";
// ai-elements 已迁出（2026-08-18，owner 判：DS 只收通用、无业务含义的件）——
// 那五件说的是模型部署 / AI 会话 / token 用量，归 agent-studio/varda。
export * from "./icons";
export * from "./hooks";
export * from "./utils";
export * from "./types";
