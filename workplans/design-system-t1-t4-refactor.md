# Design System 重构：三包架构 + Tailwind v4 全面化

日期：2026-07-31 ｜ 范围：`@vxture/design-tokens`、`@vxture/design-ui`、`@vxture/design-system`、Figma `Vxture-Design-System`

## 前提变更（2026-07-31）

业务系统仍在开发期、无生产消费者。据此推翻两条早期决策：

| 原决策      | 现决策                                         | 原依据为何失效                                 |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| D2 不做删除 | **允许删除，但必须 codemod 驱动 + 等价性验证** | "已有外部消费者、删除公开入口=major"不再成立   |
| D3 单包     | **拆三包**                                     | "外部消费刚建立，过早拆包成本高"——窗口现在最宽 |

## 决策

| #   | 决策                                                 | 理由                                                       |
| --- | ---------------------------------------------------- | ---------------------------------------------------------- |
| D1  | Token 分层用 **T1–T4**                               | 避开 `060` 已被 lint 强制的 L0–L5 组件归属分层             |
| D2′ | **允许删除，codemod 驱动**                           | CSS 对未定义变量静默失效，手工删除会留下无声的坏引用       |
| D3′ | **三包**：tokens / ui / system                       | 见 `040` §1.1                                              |
| D4  | T3 公开只读，禁止覆写                                | 引用允许，赋值由守卫拦截                                   |
| D5  | 基座 shadcn 惯例 + Radix + cva                       | shadcn 作源码生成器，非分发机制                            |
| D7  | T2 规范名采用 **shadcn 约定**                        | 与 Figma、shadcn 组件三方对齐                              |
| D8  | **命名不带层号**                                     | 三家都靠命名空间而非 `t1/t2` 前缀区分                      |
| D9  | 取值以 **Figma 为准**，preset 仅作结构参考           | preset 是 violet + Tailwind v4 P3 值，与品牌和设计稿都不符 |
| D10 | 中性色全面切 **neutral**                             | 与 Figma、shadcn `baseColor=neutral` 对齐                  |
| D13 | **全面 v4**：T2 全量进 `@theme`，组件用真工具类      | 任意值语法是 v3 思维残留；已实测 `@theme` 支持命名档位     |
| D14 | **单一词汇**，遗留 `--vx-*` 语义名经 codemod 后删除  | 现状两套并行：遗留 1245 处工具类 vs 新 169 处              |
| D15 | 排版角色**只认设计稿那 24 档**，代码里多出的一律分流 | 见下表；孤儿角色从未进过设计系统                           |
| D16 | DS 内**禁用业务与产品专名**，一律用通用组件名        | `console-*` / `admin-*` / `platform-*` 都会绑死到某个产品  |
| D17 | 三个工作台共用一套通用图案，website 自成一路         | 工作台同形，官网是营销站，两者设计目标不同                 |

层级定义见 `060` §1.1，T1/T2 边界与构建规则见 `065`，包结构见 `040`。

### D15 附：8 个孤儿排版角色的分流

Figma 设计稿的排版角色恰为 24 档（display×5 / heading×5 / body×5 / label×5 /
code×2 / caption / overline）。手写 CSS 里另有 8 个名字，**在设计稿中一个都不存在**。
按性质分流，一个都不进 T2：

| 孤儿                                            | 历史取值                                          | 去向                                   |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| `display-hero` / `metric-lg` / `brand-subtitle` | `clamp(…, 8vw, …)` 等流体值                       | T3 或断点变体——刻度层不容纳视口函数    |
| `cjk-heading` / `font-display` / `font-number`  | 分别等于 `heading-2` / `font-brand` / `font-sans` | 直接删，零损失                         |
| `cjk-body` 行高字距                             | `1.75` / `0.01em`                                 | 应做成 `:lang(zh)` 模式轴，非新角色    |
| `logo` / `logo-large` 字距                      | `-0.025em` / `-0.04em`                            | 字标组件的修饰，取 T1 `tracking-tight` |

`font-number` 想表达的是等宽数字，那是 `font-variant-numeric: tabular-nums`
一个属性，做成字体族纯属空转。

**CJK 行高字距是 T2 目前唯一真实的缺口**：中文正文需要更大行高与正字距，且该
需求作用于**任何**角色，与暗色 / 密度 / 字号同属模式轴，不应为每个角色复制一套
`cjk-` 变体。待单独设计。

## 已完成（前提变更前）

T1–T3 三层已从 Figma DTCG 导出全量生成，四个生成器 + 断言体系就位：

- **T1** 14 文件全裸值（不引用其他 T1）；排版按子命名空间归入 `foundation/typography/`
- **T2** 13 文件按命名空间分（一个命名空间对应一族工具类）
- **T3** 20 族 192 项，modal 已按治理门槛收敛
- **守卫**：exports 快照、token 同步、取值一致性、z-index 互异、撞名断言
- **对齐 Tailwind**：radius 按取值对齐消除工具类遮蔽；字距改 em；duration/ease 改名；container 改名 `--layout-page-*` 并与断点对齐

设计稿缺陷已回报并部分修复（描述错误 5、codeSyntax 缺前缀 13、撞名 22 组、缺失 198、表面阶梯偏离 4、modal 越界、z-index 同值 2 组）。

## 待办

### A. 拆包

1. 建 `@vxture/design-tokens`：T1/T2/T3 CSS + TS 引用 + zIndex + Density/FontSize 类型。零依赖。
2. 建 `@vxture/design-ui`：组件 74 + icons 5 + hooks 6 + utils 2 + `components-*.css` 13 + `platform-*.css` 70。依赖 tokens。
3. `@vxture/design-system` 瘦身为运行时接线 + 伞包：theme / density / fontSize + 品牌入口 + auth 体验 + shell 模板 + re-export。
4. `ShellChrome.tsx` 的 `Density` 类型改从 tokens 引入——这是唯一阻碍依赖图线性化的点。
5. `lint:boundaries` 加硬门：**ui 禁止 import system**。
6. 伞包对另两包用精确版本。

### B. v4 全面化

1. T2 全量注册 `@theme`，产出真工具类。✅（含 `--font-*` 4 族、`--text-*` 24 档）
2. Button 试点改用工具类，去掉任意值语法。
3. 其余 11 个 Radix 组件按 Button 样板 cva 化。

排版角色走 v4 的 `--text-<role>--<modifier>` 子键机制：一个 `text-body-md`
同时落 font-size / line-height / letter-spacing / font-weight。手写的
`.text-heading-1` / `.font-brand` 与生成的同名工具类互相遮蔽，且不跟随字号
模式轴，已随 `typography.css` 一并删除。

### C. 退役遗留 ✅

原计划是"codemod 迁移后再删"。实测推翻了这个前提：165 个遗留样式文件对
T1/T2/T3 的引用数为 **0**，两层完全不相交，没有可迁移的等价关系——迁移的成本
等于重写，而重写目标本就是 cva 组件。故改为直接删除。

已完成：删 155 个文件（约 12.3k 行）+ 手写排版层 `typography.css`；
三个 barrel 留空壳使 portal 仍可构建；顺带清掉三处重复（shadcn 桥接、
两个品牌色阶副本）。DS 样式层的悬空引用已清零。

### C2. 通用工作台图案

#### 产品扫描结论（2026-08-01）

对 console / admin / opera 三个产品自有 `.tsx` 全量扫描，推翻了先前"重复在
admin ↔ DS 之间"的判断。

规模：console 62 文件 11,871 行；admin 121 文件 41,552 行；opera 5 文件 439 行。
opera 近乎空白，是**验收样本**——图案抽对了，opera 应当几乎全靠它拼出来。

**名字在 ≥2 个产品各自实现的 9 组：**

| 组件                | console | admin | opera |
| ------------------- | ------: | ----: | ----: |
| `TemplateHeader`    |     787 |   483 |       |
| `AppShell`          |     466 |   331 |       |
| `TemplateSidebar`   |     179 |   181 |       |
| `TemplateDrawer`    |     146 |   146 |       |
| `TemplateAssistant` |      46 |    47 |       |
| `Shell`             |     110 |       |   218 |
| `SessionProvider`   |     286 |   102 |   103 |
| `BillingPage`       |     220 |  1177 |       |
| `RolesPage`         |     890 |  1885 |       |

`TemplateDrawer` 146 vs 146、`TemplateSidebar` 179 vs 181——不是相似，是拷贝。
外壳一族在 console + admin 之间重复约 **1,600 行**，而 DS 里一个都没有（856 行的
`ShellChrome` 零消费方）。

**结构特征出现的文件数：**

| 特征     | console | admin | opera | 合计 | DS 现状                            |
| -------- | ------: | ----: | ----: | ---: | ---------------------------------- |
| 页头     |      21 |    49 |     2 |   72 | `PageHeader`                       |
| 状态标   |      11 |    39 |       |   50 | `StatusBadge`                      |
| 空态     |       4 |    44 |       |   48 | `EmptyState`                       |
| 筛选栏   |       2 |    30 |       |   32 | `FilterBar`                        |
| 弹窗表单 |       3 |    20 |       |   23 | `DialogForm`                       |
| 批量操作 |       3 |    17 |       |   20 | `BulkActionBar`                    |
| 设置分栏 |       4 |    14 |       |   18 | `SettingsSplitPage` / `SectionNav` |
| 详情抽屉 |       3 |     4 |       |    7 | `DetailDrawer`                     |
| 表格     |       4 |     1 |       |    5 | `DataTable`                        |
| 指标卡   |       2 |     2 |       |    4 | `MetricCard` / `MetricGrid`        |

**DS 现有图案件选型正确**：前七名全部已有对应件。它们不是投机建设，而是**建对了
但没接上**——样式层退役后集体哑火，产品于是各写各的。C2 的性质因此从"提炼新图案"
改为"把既有图案件重新上样式并接回产品"。

#### 执行清单

第一梯队（≥18 次）✅ 全部完成：`PageHeader`→`ViewHeader`、`StatusBadge`、
`EmptyState`、`FilterBar`、`DialogForm`、`BulkActionBar`、
`SettingsSplitPage`→`SplitViewLayout`、`SectionNav`。

第二梯队 ✅ 全部完成：`MetricCard` / `MetricGrid`、`NativeSelect`、
`DataTable`、`Banner`、`PageSizePicker` + `ViewModeSwitch` → 合并为
`SegmentedControl`。`DetailDrawer` 已并入 `Drawer`。

合并依据：两件形状完全相同（一串按钮、一个选中），只是一个装数字一个装图标；且
两者的选中态都靠调用方挂 `.is-active`，该类随遗留样式层删除后**选中态已不可见**。

**`_pending` 已清空并删除**，图案层 18 件全部落位。余下 7 件在
`scripts/guardrails/pending-components.mjs`：5 件归 agent-studio、2 件 C3 删除。

其余自有件：命中上表的留；≤1 消费方的回产品；零消费的删。`ai/` 五件归 agent-studio。

命名遵循 D16：不带任何产品前缀。

### C3. 外壳族 `WorkbenchShell`（延后）

DS 唯一完全缺失、且重复最重（~1,600 行）的一块。`TemplateHeader` 787 vs 483 的差异
说明 console / admin 已经开始分叉，拖越久越贵。

前置：读 `TemplateHeader` 两份做差异分析，判定哪些是通用骨架、哪些是 console 专属，
据此定 `NavItem` 之外的数据字段。设计为**数据驱动**（`nav={NavItem[]}`，
`icon: IconName`、`label: string`），不开 slot，产品无法写 markup。

同批删除零消费方的 `ShellChrome`（856 行）与 `AuthLogin`（1,742 行）——accounts 有自己的
`login/` 路由，console 有自己 109 行的 `ConsoleShell.tsx`。

### C4. 业务属性面板（延后，不进 DS）

`UserPanel` / `TenantPanel` 一类带业务归属的共享面板，不进设计系统、不发独立包，
落在本仓 `@vxture/domain-ui`（`packages/domain/ui`，`private: true`），供三个产品共用。
边界由 depcruise 规则守：需要 `@vxture/shared` 的进 domain-ui，不需要的进 design-ui。

### C5. 产品侧遗留类名清理（延后）

产品侧约 990 个引用已退役 BEM 类名的死类，需在图案件接回后统一清。

### D. 发布体系改造

1. `050` 升 2.0.0：三包有序发布（tokens → ui → system）。
2. `publish-design-system.yml` 改造为三包流水线。
3. exports 快照与 `lint:design*` 按包拆分。

## 产品实测反馈（opera，2026-08-03）

opera 十三个页面全部改造完成，**零本地 CSS**（`globals.css` 只有 DS import），
过程中暴露两项 DS 待办。收录判据照旧：**看实据，不看设想**——只有一个产品踩到的
先记着，出现第二例再改默认。

| 项                          | 现状                                                                                                     | 待办                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SegmentedControl` 默认宽度 | 默认铺满容器，四档挤在左侧、右边拖一条空轨道；opera 在调用侧收 `w-fit`                                   | 分段控件的常规形态是内容宽，铺满是特例（移动端底部切换）。**待第二例**再把默认改为内容宽、铺满交给 `w-full`            |
| `NativeSelect` 宽度落点     | 宽度必须给 `wrapperClassName`——箭头锚包裹层右缘。写成 `className` 会同时导致筛选行裂行、箭头飞到页面最右 | props 注释已写明仍被踩（本次实测）。**待定**：宽度类自动转发到包裹层，或开发期加运行时告警。两条都改变现有契约，需先定 |

`DataTable` 的 `emptyTitle` / `emptyDescription` / `sortable` / `loading` 四项内建能力
产品侧不必自搭，本轮实测可用；`DialogForm` 内嵌 `DataTable` 排版正常。这两条**无待办**，
记录在此是为了下次有人想在产品侧重造时能查到。

## 未决

| 项                                                   | 说明                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| gap / inset / control-inset-x 三条刻度五档中三档同值 | 是否合并为一条？影响 `@theme` 能否干净注册（`--spacing-*` 是单一命名空间） |
| 排版角色行高吸附刻度（方案 A）                       | 24 角色、最大偏移 4px、平均 1.1px；已确认采纳，待执行                      |
| `layout-semantic` 拆分                               | `field-*`/`panel-*` 是宽度刻度，`sidebar-*`/`topbar-*` 是组件尺寸          |
| T1 栅格断言                                          | T1 改裸值后失去"自动落在 4px 栅格"的保证，需补断言                         |
| `radius/2xl`（20px）                                 | Tailwind 刻度无对应，未发出，待设计侧确认                                  |
| ~~图标字典缺 `download` / `lock` / `pause`~~         | 已销号（2026-08-03 复核，三个键均在字典内，opera 直接用了 `pause`/`play`） |

## 不做事项

不拆出更多包（icons 被几乎所有组件依赖，单独拆只服务罕见场景）；不并入 `@vxture/shared`；不开放 `src/**` 深层导入；不建 shadcn Registry。
