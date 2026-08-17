# @vxture/design-ui — 更新日志

发布走 `publish-design-system.yml`（GitHub Packages `npm.pkg.github.com`）。版本规则见
`docs/10-standards/050-design-system-release.md` §2。

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
