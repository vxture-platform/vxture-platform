# @vxture/design-ui — 更新日志

发布走 `publish-design-system.yml`（GitHub Packages `npm.pkg.github.com`）。版本规则见
`docs/10-standards/050-design-system-release.md` §2。

---

## 1.0.0 — 未发布

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

12 个 Radix 组件已按 shadcn 惯例 + cva 重写，取值全部绑 T2 语义层。另有 43 个组件
仍依赖已退役的遗留 BEM 类名，**当前渲染无样式**，重写进度见
`scripts/guardrails/check-component-classes.mjs` 的 PENDING 清单。

### 依赖说明

对 `@vxture/design-tokens` 的依赖是**样式依赖，不是代码依赖**：组件里没有一行
`import` 指向它，但组件用的每个工具类（`bg-primary` / `p-md` / `shadow-raised`）
都由它的 CSS 注册。不装它，组件渲染出来没有任何样式。
