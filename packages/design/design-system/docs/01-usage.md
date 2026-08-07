# 01 使用契约

版本：1.0.0 ｜ 日期：2026-08-02 ｜ 适用：所有 `@vxture/design-system` 消费方

Design System（DS）是 UI 的规则层、基准层和通用能力层。应用端负责业务语义组装，不重新定义基础控件、UI 引擎、设计 token 或通用模式。

## 1. 分层归属 L0–L5

| 层级                 | 归属     | 允许内容                                                                     |
| -------------------- | -------- | ---------------------------------------------------------------------------- |
| L0 Foundation        | DS       | token、字体、主题、密度、Tailwind `@theme` 映射                              |
| L1 Primitive         | DS       | Button/Input/Card/Dialog/Icon 等基础组件                                     |
| L2 Platform Pattern  | DS       | DataTable、FilterBar、ActionMenu、DialogForm、StatusBadge、MetricCard 等模式 |
| L3 Portal Experience | Portal   | 导航、门户 chrome、工作区体验、产品气质                                      |
| L4 Domain Assembly   | 业务模块 | 业务实体页面的语义布局和状态组装                                             |
| L5 Runtime Dynamic   | 调用现场 | 坐标、进度、背景图 URL、动画延迟等运行时值                                   |

判据：应用可以组装 DS 能力，但不能把组装写成新的基础定义。

## 2. Token 分层 T1–T4：T2 是唯一公开契约

L0–L5 是组件归属分层，T1–T4 是 token 取值分层，两者正交，编号不可混用。

| 层           | 定义                                     | 公开契约         | 应用侧       |
| ------------ | ---------------------------------------- | ---------------- | ------------ |
| T1 Primitive | 原子值，无语义（Tailwind v4 theme 镜像） | 否               | **禁止引用** |
| T2 Semantic  | 意义绑定，引用 T1                        | **是（主契约）** | 可引用       |
| T3 Component | 已退役，组件尺寸由 cva variant 承担      | —                | —            |
| T4 Page      | 页面/实例样式，在各产品仓库              | 不适用           | —            |

T2 全族清单与档位见 [`04-tokens-contract.md`](./04-tokens-contract.md)。

### 取值约束

| 规则                      | 判据                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 一律用 T2 工具类          | 裸数值（`p-4` / `h-9` / `z-500`）不跟随密度与字号三档，等于把该处排除在用户偏好之外；仅限一次性布局微调且需知情 |
| 禁止任意值语法            | `h-(--control-height-lg)` 一类写法不接受                                                                        |
| 暗色层级靠 surface 与描边 | 不靠阴影递增                                                                                                    |

## 3. 组件尺寸的三根轴

组件的"大小"不是一个轴，是三个，它们**相乘**而非相加：

| 轴                                                     | 谁决定 / 何时 | 作用域                | 载体                      |
| ------------------------------------------------------ | ------------- | --------------------- | ------------------------- |
| 用户偏好：字号三档、密度三档                           | 用户，运行时  | 全局，`html` 上一个类 | T2 模式块（变量重定向）   |
| 上下文尺寸：工具栏 sm、英雄区 lg                       | 设计，放置时  | 单个放置点            | cva `size` variant        |
| 意图与状态：primary/destructive、hover/active/disabled | 设计，放置时  | 单个实例              | T2 语义色 + cva `variant` |

相乘是自动的：cva 给出 `h-control-md`，密度类改写变量取值。**组件不需要知道密度存在**，故密度不做成 cva variant。

## 4. 包与层映射

行业通用的 Token → System → UI 单向依赖在本仓成立，但载体与包名**不一一对应**，按包名读会读错架构：

| 行业层 | 载体                                                                                                                  | 说明                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Token  | `@vxture/design-tokens`                                                                                               | 唯一数据源，policy 驱动生成                                    |
| System | **分布式，无独立包**：本 docs（原则/判据）+ `recipes.ts`（交互范式）+ `tone.ts`（语气刻度）+ 守卫脚本（机器可验约束） | 规则层刻意不建包——规则要么进文档要么进守卫，建包只会多一层空转 |
| UI     | `@vxture/design-ui`                                                                                                   | 纯 UI，零业务、零平台依赖，可独立发布                          |

**`@vxture/design-system` 不是 System 层**。它是**伞包 + 运行时接线**：原样转发 tokens 与 ui，自持仅限需要 React context（主题/密度/字号）或平台依赖（`@vxture/shared`、Turnstile）的组件——AuthLogin / ShellChrome 留在伞包正是因为这些依赖不得进入 design-ui。消费方只从伞包一个入口引。

依赖方向：`design-system → design-ui → design-tokens`，单向，禁止反向引用。

## 5. 接入与入口

安装（消费仓库使用已发布版本，不得用 `workspace:*`）：

```ini
@vxture:registry=https://npm.pkg.github.com
```

```bash
pnpm add @vxture/design-system
```

peer dependencies 由消费项目提供：`react`、`react-dom`、`next-themes`、`tailwindcss`、`tailwindcss-animate`、`@phosphor-icons/react`。

应用根入口先引 globals，再选**一个**品牌入口（平台级 `brands/vxture.css`，如影产品级 `brands/ruyin.css`；禁止同时引两个，禁止应用侧复制品牌 token）：

```tsx
import "@vxture/design-system/styles/globals.css";
import "@vxture/design-system/styles/brands/vxture.css";
```

允许的子入口只有：`@vxture/design-system`、`/tokens`、`/types`、`/server` 与 package exports 明确暴露的 `styles/*`。

CI 安装私有包：`actions/setup-node` 配 `registry-url: https://npm.pkg.github.com` + `scope: "@vxture"`，token 用只读 secret 注入 `GITHUB_PACKAGES_TOKEN`；真实 token 不入仓。接入验收至少跑：`pnpm install --frozen-lockfile` / `type-check` / `lint` / `build`。

## 6. 应用层禁止事项

| 禁止                                                                 | 判据                            |
| -------------------------------------------------------------------- | ------------------------------- |
| 从 `@vxture/design-system/src/**` 或未导出子路径导入                 | 公开契约只有 exports 声明的入口 |
| 直接依赖 `@phosphor-icons/react`、`lucide-react`、`@radix-ui/*` 等   | 图标与原语经 DS 隔离层供给      |
| 手写 `button`、`input`、`select`、`textarea`、`table` 等基础控件     | 基础控件是 L1，归 DS            |
| 定义 `--vx-*` custom property、复制品牌色                            | token 数据源唯一                |
| 新增硬编码颜色、字号、间距、圆角、阴影，或用 inline style 承载设计值 | 设计值一律走 T2 工具类          |
| 业务源码定义新的 `.dark {}` 块或为暗色复制颜色                       | 暗色由 DS token 重映射          |

允许的应用 CSS 只表达业务组装语义（布局排列、状态组合、实体信息密度）。若某结构具备跨应用复用价值，先补 DS，再迁移应用调用；禁止应用端先临时实现再计划回收。

## 7. 品牌标识组合

DS 提供 `.vx-brand-lockup` / `.vx-brand-mark` / `.vx-brand-name` / `.vx-brand-local-name` / `.vx-brand-separator` 五个组合类，只承载品牌字体、间距、颜色和图标尺寸基线。应用端可组合表达品牌上下文，不得重新定义其中任何基线；现有类不够先扩 DS。
