# @vxture/design-ui — 更新日志

发布走 `publish-design-system.yml`（GitHub Packages `npm.pkg.github.com`）。版本规则见
`docs/10-standards/050-design-system-release.md` §2。

---

## 3.1.0 — 2026-08-21

新增组件属 minor（050 §2）。

- **新增：`BarChart` 柱状图（Components - Pattern）。** DS 首件数据可视化原语
  （owner 2026-08-21：用量分析各板块「上图下表」，图为全宽柱状图）。等宽柱铺满
  容器、组内最大值归一；柱体 `bg-primary` 与 Progress 填充同色，零值留
  `bg-accent` 基线刻度；柱高为运行时数据走内联 style（Progress 先例）；横轴
  标签抽样显示（`labelEvery`），逐柱精确数值归下方配套表格。预览面已注册。
- **修订：`DataTable` 操作列 定宽 64px → min 64px**（owner 2026-08-21 表格
  规范修订）。支持「主操作按钮 + ⋯ 菜单」同格的单操作列（订单表先例）；
  单图标场景仍收敛回 64px，选择/序号列保持定宽不变。

## 3.0.0 — 2026-08-18

DS 治理批次（2026-08-18 审查 + shell-template 退役战役）收口。删除公开导出属破坏性
——major。

### 💥 Breaking

- **全屏死零件删除**：`FullscreenContainer`、`FullscreenToggle`、`Portal` 三件组件
  及其 props 类型（`FullscreenContainerProps` / `FullscreenContainerRef` /
  `FullscreenToggleProps` / `FullscreenPortalProps`）——全仓零消费（owner 批）。
  **存活链不变**：`FullscreenProvider` + `useFullscreen`（经伞包
  `ShellFullscreenToggle` 消费）照常；迁移即改用它们。
- **`SegmentedControl` 选中态视觉改判**（API 不变）：胶囊槽 + 品牌实底滑块 →
  `rounded-lg` 槽 + `rounded-sm` 浮起面片（`bg-card` + `text-primary` +
  `shadow-xs`，同心圆角），向用户面板原型收敛、全 token 实现。视觉变更故随
  major 批说明；调用方零改动。

### ✨ 新增

- **`DialogContent.width` 档位 prop**（`sm 28 / md 32 / lg 42 / xl 58rem`，缺省
  md）与配套导出 `DIALOG_WIDTHS` / `DialogWidth`。xl 档为 T2 panel 梯新档的
  @theme 字面量消费方。
- **`ShellPanelRow.danger`**（经伞包生效）：面板动作行 destructive 语气——红字 +
  hover 淡红底，与 ActionMenu 的 danger 同一判断。

---

## 2.0.0 — 2026-08-17

首个版本。从 `@vxture/design-system` 拆出的**无状态组件层**：基础组件、平台图案、
图标、hook 与工具函数。不含任何运行时接线——主题、密度、字号偏好这些带 React
context 的东西留在伞包。

### 内容

- `components/ui` —— 基础组件与平台图案
- `components/ai` —— AI 形态组件
- `components/layout` —— container / stack / grid / fullscreen
- `icons`、`hooks`、`utils`、`types`

### 入口

- `.` —— 全量，带 `"use client"`
- `./server` —— 可在 RSC 中渲染的纯叶子子集，**刻意不带** `"use client"`

### 已知状态

**重写已收口。** `scripts/guardrails/check-component-classes.mjs` 实测：103 个组件、
1116 处类名全部由配方生成，无手写视觉片段，无豁免，PENDING 清单为空。

批次开启时还有 43 个组件依赖已退役的遗留 BEM 类名、当时渲染无样式——那一档是本包
从 `@vxture/design-system` 拆出来的起点，不是现在的状态。

版本号从 2.0.0 起：本包虽是首次发布，但按 050 §2.1「major 号在批次开启时已定，批次内
不重复决策」，随三包同批的号走，而不是自己另起一个 1.0.0。

### 依赖说明

对 `@vxture/design-tokens` 的依赖是**样式依赖，不是代码依赖**：组件里没有一行
`import` 指向它，但组件用的每个工具类（`bg-primary` / `p-md` / `shadow-raised`）
都由它的 CSS 注册。不装它，组件渲染出来没有任何样式。
