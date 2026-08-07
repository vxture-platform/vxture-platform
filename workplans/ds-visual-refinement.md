# Design System 视觉精修：补齐 style 层

日期：2026-08-02 ｜ 范围：`@vxture/design-tokens`、`@vxture/design-ui`、`docs/10-standards/060-design-system.md`

## 问题

T2 做到了工业级，**style 那一层根本不存在**。46 个组件的类名是逐个手写的，没有横切规则：A 有 focus ring、B 没有；A 用 `transition-colors`、B 用 `transition-all`；没有一个组件有按压反馈，没有一个菜单触发器有展开态。

"组件不好看"的根因不是某个组件差，是**同一情境下不同组件做了不同的事**。不一致本身就是丑的来源。

shadcn 的分层是 theme（变量）+ style（**烤进组件源码的类名**），换 style 要重装组件。我们缺的正是后者。

## 决策

| #   | 决策                                                      | 依据                                                                 |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| V1  | 组件视觉规格取 **shadcn vega**                            | 经典 shadcn 观感；maia 的 26px 胶囊输入框与 FilterBar 一行六控件冲突 |
| V2  | 原语基座保持 **Radix**                                    | 见下"基座实测"                                                       |
| V3  | 页面级组合规格取 **admin 线上实拍**，只作视觉参照不迁代码 | admin 的 12,857 行 CSS 引用 501 个已删变量，代码不可用               |
| V4  | 品牌色不换 violet，图标库保持 phosphor，字体栈保持 Inter  | 三项本来就与 preset 一致；品牌色是资产不是风格选项                   |
| V5  | 圆角改 **单基数 + 比例派生**，基数 `--radius: 0.625rem`   | 产品要调只调一个数，整梯等比跟随                                     |
| V6  | 密度默认档**上移一档**，三档值不动，只挪 `:root` 指针     | 可逆，改动最小                                                       |
| V7  | 危险语气改淡底，但**用实色 muted 阶，不用 alpha**         | 见下"为什么不照抄 alpha"                                             |
| V8  | 跨组件恒定的类名片段抽成**配方层**，不散在 46 个 cva 里   | shadcn 散在 62 个组件源码里，规则不可见、不可校验、改一处要改 46 处  |

### 基座实测（vega 在三个基座上各 scaffold 一份）

圆角类名**三者逐字相同**——style 与基座正交，换基座不改变任何视觉。差别只在原语 API：

| 基座      | 组合 API             | 状态钩子            | 依赖                    |
| --------- | -------------------- | ------------------- | ----------------------- |
| **radix** | `Slot` / `asChild`   | `data-[state=open]` | `radix-ui` 单包         |
| base      | `render`/`useRender` | `data-open`         | `@base-ui/react`        |
| aria      | 无                   | `data-entering`     | `react-aria-components` |

选 radix 的三条理由：**零翻译**（批 B–F 逐字照抄 `radix-vega`）、**零公开 API 破坏**（`asChild` 在 5 个组件上公开、产品侧 10+ 文件在用）、**零动效重写**（40+ 处 `data-[state=open]:animate-in`）。

已知代价：上游默认自 2026-07 起是 Base UI，我们长期处在"支持但非默认"分支；Radix 复杂组件（Combobox / 多选）更新慢。**对冲**：两个库可共存，真要 Combobox 时单独引 Base UI 那一个包或用 `cmdk`，不必为未写的组件换整个基座。

### 为什么不照抄 alpha

vega 写 `bg-destructive/10` + `dark:bg-destructive/20`，是因为它**没有 muted 阶**——alpha 不自适应暗色，所以必须补一行。我们的 T2 有十档 destructive，明暗各有真实值，实色结果确定，暗色不用另写。

采纳的是 vega 的**判断**（危险动作用淡底不用实心），不是它的**手段**。判据：

> **填充用实色 muted 阶**（底色确定）；**描边与光环用 alpha**（要透出下面的内容）。

## 选档表（`--radius: 0.625rem` 派生）

梯子：`sm ×0.6=6` `md ×0.8=8` `lg ×1.0=10` `xl ×1.4=14` `2xl ×1.8=18` `3xl ×2.2=22` `4xl ×2.6=26`

| 组件                           | 档          | 像素       |
| ------------------------------ | ----------- | ---------- |
| Button / Input / Select 触发器 | `md`        | 8          |
| Card / Dialog / Drawer         | `xl`        | 14         |
| Badge / StatusBadge            | `4xl`       | 26（胶囊） |
| DropdownMenu 面板 / 条目       | `md` / `sm` | 8 / 6      |
| Tabs 容器 / 标签               | `lg` / `md` | 10 / 8     |

小控件封顶：`rounded-[min(var(--radius-md),8px)]`——防止基数调大时 24/32px 控件变胶囊。**这是"一个基数换基调"能安全成立的前提。**

## 配方清单

| 配方          | 内容                                                                                                  | 现状     |
| ------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| `interactive` | `focus-visible:ring-3` + `focus-visible:border-ring` + `disabled:opacity-disabled` + `transition-all` | 各写各的 |
| `pressable`   | `active:not-aria-[haspopup]:translate-y-px`（菜单触发器排除，否则面板跟着抖）                         | **没有** |
| `expandable`  | `aria-expanded:bg-muted`                                                                              | **没有** |
| `iconInset`   | `has-data-[icon=inline-start]:pl-*` 单侧收紧                                                          | **没有** |
| `invalid`     | `aria-invalid:border-destructive` + `aria-invalid:ring-3`                                             | **没有** |
| `elevation`   | 叠层的阴影 / 圆角 / 边框固定搭配                                                                      | 各写各的 |
| `tone`        | default / muted / destructive 的填充语气                                                              | 不一致   |

落在 `design-ui/src/styles/recipes.ts`，所有 cva 引用。**规则只写一次，改基调改一处。**

## 密度指针

三档的值一个都不动，只把 `:root` 从 `.density-default` 挪到 `.density-comfortable` 的取值。

| 变量                 | 今天 default | 上移后 |
| -------------------- | ------------ | ------ |
| `--space-md`         | 12px         | 16px   |
| `--space-lg`         | 16px         | 24px   |
| `--space-xl`         | 24px         | 32px   |
| `--space-control-lg` | 36px         | 40px   |
| `--space-row-md`     | 48px         | 56px   |

代价：表格一屏少 3 行左右。已确认接受。

## 分批

批内组件必须互相一致，故按依赖顺序而非字母序。

| 批    | 内容                                                                                                                                | 数量 | 规格来源                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------- |
| **A** | 视觉基座：圆角梯 + 密度指针 + 配方层 + 060 规范 + 守卫扩展                                                                          | —    | vega                       |
| B     | 表单控件：Button / Input / Textarea / Select / NativeSelect / Checkbox / Switch / Label                                             | 8    | vega                       |
| C     | 容器叠层：Card / Dialog / Drawer / Popover / Tooltip / DropdownMenu / Toast                                                         | 7    | vega                       |
| D     | 导航状态：Tabs / Breadcrumb / Pagination / SegmentedControl / SectionNav / Badge / StatusBadge / Skeleton                           | 8    | vega + admin               |
| E     | 数据展示：DataTable / MetricCard / MetricGrid / EmptyState / Banner / Avatar / Separator                                            | 7    | **admin 为主**             |
| F     | 页面组合：ViewHeader / ViewLayout / Section / SectionHeader / FilterBar / BulkActionBar / ActionMenu / SplitViewLayout / DialogForm | 9    | **admin 为主**             |
| G     | AI 族 5 件                                                                                                                          | 5    | 暂缓，随 agent-studio 迁移 |

**A 必须先做**，B–D 依赖它，E/F 依赖 B–D。每批做法固定：对着参照把规格写死 → 改组件 → 预览面验收。

## 批 A 任务

| #   | 任务                                                                      | 落点                                             |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| A1  | 圆角改单基数比例派生，`--radius: 0.625rem`                                | `scripts/design-tokens/semantic-policy.mjs`      |
| A2  | 密度 `:root` 指针上移一档                                                 | `scripts/design-tokens/semantic-policy.mjs`      |
| A3  | 新建配方层                                                                | `design-ui/src/styles/recipes.ts`                |
| A4  | 060 补：选档表、配方清单、填充/描边 alpha 判据、小控件封顶规则            | `docs/10-standards/060-design-system.md`         |
| A5  | 守卫扩展：交互组件必须引用 `interactive`，菜单触发器必须引用 `expandable` | `scripts/guardrails/check-component-classes.mjs` |

## 遗留

- MetricGrid 列数已是 prop（`2|3|4`），按业务需要扩到 `5|6`——既有设计，非新增能力
- 12 个 `@radix-ui/react-*` 分包可并入 `radix-ui` 单包，捎带整理
- 消费端 269 个类型错误是**合并 main 的前置条件**，与本工作线独立
