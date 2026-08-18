# @vxture/design-system — 更新日志

发布走 `publish-design-system.yml`（GitHub Packages `npm.pkg.github.com`）。版本规则见
`docs/10-standards/050-design-system-release.md` §2。

---

## 6.0.0 — 2026-08-18

DS 治理批次收口：2026-08-18 全面审查（报告存档）+ shell-template 退役战役（#288–#295
八个 PR 当日走完）。判据「DS 只收通用、无业务含义的件」全面落地；下层 design-ui 3.0.0
major 向上传导，伞包按 major 处理。

**外部消费方迁移总表**（从 `5.0.0` 升级）：

| 变更                                                                     | 消费方要做的                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 认证族删除（AuthLogin 及 auth.css）                                      | 认证 UI 归 accounts 门户；外部仓自建或参照 accounts 实现                               |
| ai-elements 五件删除（ModelBadge 等）                                    | 已归 agent-studio/varda；AI 会话件从 varda 包取                                        |
| `./styles/{admin,website}-tokens.css` 删除                               | 产品取值桥归各自门户 assets；外部仓自带                                                |
| `./styles/shell-template{,-user-panel}.css` 删除                         | 外壳走 DS 组件 + T2 工具类（opera/console/admin 同款路线）；用户面板走 `ShellUserMenu` |
| `./styles/brands/ruyin.css`、`./styles/fullscreen.css` 删除              | ruyin 品牌由其外部仓自带；fullscreen 样式随 `globals.css` 分发，无需单独引             |
| `DENSITY_PRESETS` 删除                                                   | 密度落地走 `densityClass` + CSS token 重映射，px 预设表从未被运行时读取                |
| `FullscreenContainer` / `FullscreenToggle` / `Portal` 删除（经 ui 传导） | 改用 `FullscreenProvider` + `useFullscreen` / 伞包 `ShellFullscreenToggle`             |

### 💥 Breaking

- 上表七类公开入口/导出删除（各删除的判据与过程详见 2026-08-18 审查报告与
  #279/#284/#285/#291/#292/#295）。

### ✨ 新增

- **`ShellDock`**（+ `ShellDockMode` / `ShellDockProps`）——工作台停靠面板：外壳
  右缘停靠列（助手、检查器一类伴随内容），narrow 420px / wide clamp(480,46vw,760)
  / full 全屏接管三档。自 shell-template 的 `.assistant` 同值收编，console/admin
  的 Varda 停靠列共用，opera 可复用。
- **`ShellUserMenuAction.danger`**——用户菜单危险动作（登出等）走 destructive
  语气；console/admin/opera 三端登出已接。
- **`::selection` 品牌选区色**入 `globals.css`（brand-100，与原 shell 同值）。
- Dialog `width` 档位、`ShellPanelRow.danger`、T2 `panel-xl`、T1 `radius-full`、
  `font/sans` CJK 系统回退——经下层包传导，见 design-ui 3.0.0 / design-tokens 2.1.0。

---

## 5.0.0 — 2026-08-17

admin → DS 收敛批次收口。major 号在批次开启时已定（删除公开导出属破坏性），按 050 §2.1
批次内不重复决策，故正式版沿用同一个号。

收口判据是那份 PENDING 清单**已空**：`check-component-classes.mjs` 实测 103 个组件全部
重写完成、1116 处类名全部由配方生成、无手写视觉片段、无豁免。此前 `5.0.0-alpha.0`
只发到 dist-tag `alpha`，正式版才回 `latest`。

**外部消费方需要做的 —— 注意跨度比版本号看起来更大。** registry 上此前发布的最新版是
**`2.0.0`**：`2.1.0` 与 `4.0.0` 都写在本文件里，但**从未发布**（`3.0.0` 是重构分支内的
中间态，其变更已并入 4.0.0）。所以从 `^2.0.0` 升到 `5.0.0` 要一次跨过三批变更：

| 版本  | 消费方要做的                                                                     |
| ----- | -------------------------------------------------------------------------------- |
| 2.1.0 | 无（纯新增：`./next` 并行入口与 T1/T2/T3 token 层，无视觉变更）                  |
| 4.0.0 | **移除公开入口 `./next` 与 `./styles/tokens.css`**；拆三包但入口不变，拆包不可见 |
| 5.0.0 | 三个 nav cookie 函数改从 `@vxture/shared` 引入；依赖 TS token 表取值处改用工具类 |

`^2.0.0` 不会自动升上来，这是有意的——major 跨越必须是一次显式决定。

### 💥 Breaking

- **`navCollapsedCookieName` / `readNavCollapsed` / `writeNavCollapsed` 迁出**至
  `@vxture/shared`。侧栏收起状态是 cookie 契约不是视觉件，服务端 layout 要在渲染前
  读到它，留在 DS 会把纯服务端组件拖进 DS 的客户端依赖。仓内三个门户的调用点已全部
  改从 `@vxture/shared` 引入；外部消费方需同样改引入源，行为不变。

### ✨ 新增

- **`ShellNavItem.subLabel?`**——导航项副名，渲染成主名下方一行小字（收起态两行都不
  显）。为中文主名 + 英文代号的双语菜单而加：此前只有单行 `label`，双语要么挤在一行
  括号里、要么只能二选一。**纯增量**——不传时行高与渲染与旧版逐像素一致（`NavItemRow`
  由 `h-control-xl` 改成 `min-h-control-xl`，单行项不受影响），副名在选中态不跟随高亮。
- **`ShellNavSection.brandPosition?`**（`"prefix" | "suffix" | "none"`，缺省
  `"prefix"`）——分组标题里产品代号的染色位置。原 `splitBrandTitle` 只认前缀，
  `模型管理 · Atlas` 这类后置写法会把中文主名当成代号染掉。**不做启发式判断**（"哪段
  像代号"在 `安全审计 · RBAC` 上必然误判），由调用方显式声明；`"none"` 表示整条标题
  不分段。类型同为可选，五个消费方门户不传即旧行为。
- **公开入口** `./styles/admin-tokens.css`（admin 遗留 token 桥，收敛期间的过渡资产）
  与 `./styles/workbench.css`。
- **公开入口** `./styles/website-tokens.css`——website 的同类 token 桥。3d5ef7c 退役
  legacy token 层时 admin 补了桥、website 没有，于是营销页两处同时失效：68 个
  `--vx-website-*` 版面刻度随 `tokens-website.css` 一起删除（`min-height` /
  `grid-template-columns` / `padding` 全部 invalid at computed-value time，栅格塌成
  单列），且 `--color-vx-*` 命名空间的 `@theme` 注册被删，源码里 975 处 `text-vx-*` /
  `bg-vx-*` 共 123 个类名一个都不再产出 CSS。两类失效都不报错。桥恢复这批取值，但
  **不复刻 legacy 色值**：数值色阶挂 T1 对应色族（gray→neutral、error→red、
  success→emerald、warning→amber、info→sky），角色型挂 T2 语义槽，故这批第一次
  跟随暗色模式。与 admin 桥同样是过渡资产，逐族换成 T2 类名后即可缩小消失。
- **公开入口** `./styles/fonts.css`（dd8eea5 自托管字体时引入，此前漏登记）。
- **`FieldTier`**（经 design-ui 再导出）——表单字段的分层容器，把「主字段 / 次要字段」
  的分层从各页手写的 `div` + 间距类收进一件组件，使同类表单在不同页上的疏密一致。
  纯新增导出，不影响任何既有入口。
- **组件** `MetricListCard`、`PanelCard` / `PanelItem` / `PanelList`、`FactList` /
  `LabeledValue`、`LevelMarker`——均从 admin 的重复实现里提炼。
- **浮层宽度梯** `OVERLAY_WIDTHS` 与 `overlayWidthClass` / `overlayMinWidthClass`。
  取名 overlay 而非 control：`--spacing-control-*` 已占用同名命名空间，Tailwind v4 的
  `w-*` 解析顺序会让 `--container-control-*` 被高度档影响掉（实测 `min-w-control-xs`
  解析成 1.5rem 的高度值）。

### 🔧 内部

- `@vxture/design-ui` 新增 `./styles` 子入口，只导出配方层（`interactive` 等纯字符串
  常量）。刻意不并进主入口：伞包用 `export *` 转发主入口，配方进主入口就会成为产品
  可见的公开面，产品侧便能拿它手搓控件——那正是配方层要杜绝的。

---

## 4.0.0 — 2026-08-01

设计系统重构收口。`3.0.0` 是本次重构分支内的中间态，从未发布，其变更并入本条。

### 💥 Breaking

- **拆为三包。** 本包成为**伞包 + 运行时接线**：只持有主题 / 密度 / 字号 provider、
  shell 与 auth，其余转发 `@vxture/design-tokens`（token 两层 CSS）与
  `@vxture/design-ui`（无状态组件层）。**消费方仍只依赖本包**，入口不变，拆包不可见。
  对另两包用精确版本——本包把它们的类型原样 re-export，caret 会在转发边界上产生
  类型不匹配。
- **移除公开入口** `./next`（cva 组件的过渡入口，迁移已完成）、`./styles/tokens.css`
  （迁至 `@vxture/design-tokens/styles/tokens.css`）、`./styles/components.css`。
- **移除 11 张 TS token 表**（`colors` / `spacing` / `typography` / `radius` / `shadow` /
  `gradients` / `motion` / `easing` / `duration` / `animation` / `motionPresets`）。
  它们的 `var()` 目标多数早已不存在，且零消费者。取值的出口是工具类，不是 JS 字符串。
- **色板换为 Tailwind v4 的 oklch / P3**，并收窄到六个色相加品牌色。原先停在 v3 的
  hex，且多出 5 个只为图表各取一档的色相；`chart-2..6` 已改用保留色相，
  **图表配色可辨识度下降**。
- **遗留样式层退役**（155 个文件、约 12.3k 行）。批次开启时有 43 个组件仍依赖其中的
  BEM 类名、当时渲染无样式；**收口时已全部重写完毕**（`check-component-classes.mjs`
  的 PENDING 清单为空，103 个组件 1116 处类名全部由配方生成）。
- **排版规则化。** 行高改取字号档自带的值（display 与品牌标题收紧到 `leading-tight`）；
  字距统一为零，仅 `overline` 因全大写保留放开。原先逐角色写死的 72 个行高里
  有七组同字号不同值，规则化后这类分歧在结构上不可能存在。
- Button 合并：cva 版本取代原实现，`.vx-btn` 随遗留层消失。

### ✨ Added

- `DENSITIES` / `FONT_SIZES` / `densityClass` / `fontSizeClass`，由与 CSS 同一份策略生成。
- 中文排版轴：`:lang(zh)` 自动加大行高，作用于任何角色。
- T1 扩展档：`text-3xs/2xs`、`breakpoint-xs/3xl/4xl/5xl`、`font-brand/cjk`。

### 🛠 Internal

- T1 改为直接读 Tailwind `theme.css` 生成，一致性由构造保证；全部偏离登记在
  `foundation-policy.mjs`，逐条带理由。
- token 输入全部迁入 DS 自有的 `*-policy.mjs`，设计导出文件退役。
- 新增守卫 `lint:design-classes`（组件类名必须真能产出）与两条包依赖方向规则。

---

## 2.1.0 — 2026-07-31

### ✨ Added

- **`@vxture/design-system/next`** —— 按 shadcn 惯例（cva + Radix）重写、只绑 T2 语义层的组件并行入口。首个组件为 `Button`。根入口的既有组件保持不变，消费方可按自身节奏迁移；两处同名导出属预期。
- T1/T2/T3 三层 token 已完整落入 `src/styles/{foundation,semantic,components}`，并通过 `styles/tokens.css` 聚合。本版本尚无组件消费新层，**无视觉变更**。

---

## 2.0.0 — 2026-06-29

外壳样式体系统一 + 旧 console 外壳包下线。**包含一处破坏性变更（删除 `styles/console.css` 入口）**，故升 major。当前外部消费者（多个业务智能体）均在早期开发阶段，影响有限——请按下方迁移建议一次性切齐，避免遗留技术债。

### ⚠️ Breaking

- **删除导出 `@vxture/design-system/styles/console.css`**（及其整包子模块：`console-base / console-shell-layout* / console-shell-chrome* / console-shell-drawer / console-tenant-switcher* / console-assistant / console-responsive`）。
  - 这是模板化之前的旧 console 外壳 CSS（`.vx-shell-*`、`.vx-tenant-switcher__*`、`.vx-assistant-*`、`.vx-appcenter`、`.console-loading` 等），已被新的共享外壳体系取代，平台内部已无人使用。

### ✨ Added

- **`@vxture/design-system/styles/shell-template.css`** —— 共享外壳视觉系统（逐字转写自设计稿的 `.app / .vxh / .sidebar / .assistant / .vela-*` 外壳 chrome + 其 token），console 与 admin 同源消费，是新外壳的唯一来源。
- **`@vxture/design-system/styles/shell-template-user-panel.css`** —— 仅"头像 + 用户下拉菜单"切片（template tokens + `.vxh-*` 用户面板规则，不含全局 reset / 完整外壳 chrome）。供只需要用户菜单、不要整套 app 外壳的应用（如门户/营销站）使用。
- Phosphor 图标字体不内置：宿主应用在 `app/layout.tsx` 用 `<link>` 加载 `@phosphor-icons/web`（外壳用 `ph ph-*` 类）。

### 🔧 Internal（对消费者无影响）

- `src/components/ui/*` 组件文件统一重命名为 PascalCase（如 `page-header.tsx` → `PageHeader.tsx`）。**公共导出符号不变**——`import { Button, PageHeader, … } from "@vxture/design-system"` 照常工作。仅当你绕过公共 `exports`、深路径 import 内部文件时才受影响（不应这样用）。

### 📦 消费者迁移建议（业务智能体）

1. 依赖升到 `^2.0.0`。
2. **若曾 `@import "@vxture/design-system/styles/console.css"`**：
   - 你渲染的是**应用外壳**（header/侧栏/助手三分区）→ 改用 `@vxture/design-system/styles/shell-template.css`，并按需用 `.app / .vxh / .sidebar / .assistant` 类（参考 console/admin portal 的 `layout/template/` 实现）。
   - 你只用了**用户头像下拉菜单** → 改用 `@vxture/design-system/styles/shell-template-user-panel.css`。
   - 你只用了**加载转圈 `.console-loading`** 等零散类 → 这些已随外壳下线移出 DS；请改用 DS 现有基础组件（如 `Skeleton`），或在你的应用内自留极小副本。
3. 组件按符号从包根导入即可，**不要深路径 import 内部文件**（`ui/` 已 PascalCase，公共 API 未变）。
4. 别忘了宿主 `app/layout.tsx` 用 `<link>` 加载 Phosphor 图标字体。

### 验证

- 平台内 console / admin / website 三端构建通过；design-system guardrail 0 violations；已上生产 `develop=beta=main`。
