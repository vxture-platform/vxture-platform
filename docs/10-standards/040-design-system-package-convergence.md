# Design System 包结构规范

版本：2.0.0
日期：2026-07-31
范围：`@vxture/design-tokens`、`@vxture/design-ui`、`@vxture/design-system`

> **2.0.0 取代 1.0.0 的单包结论。** 1.0.0 判定"不建议拆出更多包"，依据是"外部消费刚建立，过早拆包会增加安装、版本联动和权限配置成本"。该前提已不成立：业务系统仍在开发期、无生产消费者，拆包窗口现在最宽。

## 1. 三包结构

| 包                      | 职责                                                                                    | 依赖        |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------- |
| `@vxture/design-tokens` | T1/T2/T3 token（CSS + TS 引用）、z-index、Density/FontSize 类型                         | **零依赖**  |
| `@vxture/design-ui`     | 组件、图标、hooks、`cn`、组件样式、平台模式样式                                         | tokens      |
| `@vxture/design-system` | ThemeProvider / 密度 / 字号运行时、品牌入口、auth 体验、shell 模板；并 re-export 另两包 | tokens + ui |

**应用只安装 `@vxture/design-system`**，另两包按需单独消费。

### 1.1 各包的存在理由

**tokens 零依赖是核心价值。** v4 下 token 层是纯 CSS。与 React 组件库捆在一起时，任何只要品牌色的消费方（营销页、邮件模板、Figma 反向同步、未来的移动端）都要背上 React / Radix / Phosphor 的 peer 依赖。

**ui 独立可测。** 与运行时机制解耦后可单独跑视觉回归、单独发版，不受主题与外壳改动牵连。

**system 是运行时接线 + 单一安装点。** 提供把 token 接入运行应用的机制（主题、密度、字号），并让应用免于自行协调三包版本。

## 2. 硬约束

### 2.1 依赖图必须严格线性

```
design-tokens  →  design-ui  →  design-system
```

**`design-ui` 永不 import `design-system`。** 这是保持线性的唯一规则，由 `lint:boundaries`（depcruise）硬门强制。

实测依据：组件对运行时机制的依赖仅一处（`ShellChrome.tsx` 引 `Density` 类型），无组件使用 `useTheme`，`theme/density/layers` 不反向依赖组件。`Density`/`FontSize` 类型下沉 tokens 后该处解开。

### 2.2 伞包精确 pin 版本

`design-system` 对另两包用**精确版本**（`"@vxture/design-tokens": "1.2.3"`），不用 `^`。否则消费方会装到三包版本错配的组合。

### 2.3 样式归属

`platform-*.css`（70 个）归 **ui** 而非 system——它们是 DataTable / FilterBar 等组件的样式，必须与组件同包，否则组件包不完整。

## 3. 发布

三包有序发布，前者发布成功后者才能发：

```
design-tokens  →  design-ui  →  design-system
```

发布流程、SemVer 判定、dry-run 与发布后验证见 `050-design-system-release.md`（同步升 2.0.0）。

守卫按包拆分：exports 快照、`lint:design*` 各包各一套。

## 4. Tailwind v4 约定

### 4.1 T2 全量注册 `@theme`

所有 T2 语义 token 注册进 `@theme`，组件使用真工具类（`h-control-lg`、`gap-md`、`ease-standard`），**禁止任意值语法**（`h-(--control-height-lg)`）。后者是 v3 时代"token 运行时拿不到"的思维残留，v4 无此限制——已实测 `@theme` 支持命名档位。

例外：`--radius-*` 等与 Tailwind 内置同名的命名空间，取值必须与内置一致后方可注册（见 `065-design-token-pipeline.md` §3.1.3）。

### 4.2 单一词汇

只保留 shadcn / Tailwind 命名。遗留 `--vx-*` 语义名与 `bg-vx-*` 工具类经 codemod 迁移后删除。

**T1 保留 `--vx-` 前缀**——它不进 `@theme`、不产出工具类，前缀用于与 T2/Tailwind 命名空间区隔。

### 4.3 删除必须由 codemod 驱动

前提变化后允许删除遗留资产，但**删除必须由 codemod 驱动，且 codemod 必须有前后等价性验证**。当前遗留面：`var(--vx-*)` 引用 24,965 处（119 个 CSS 文件）、`bg-vx-*` 类工具类 1,245 处、`tokens-*.css` 63 个。

手工删除或让引用悬空一律禁止——CSS 对未定义变量静默失效，不会报错。

## 5. 关联文档

- `docs/10-standards/050-design-system-release.md` —— 三包发布与 SemVer
- `packages/design/design-system/docs/` —— 对外使用规范（随包发布）
- `docs/10-standards/060-design-system.md` —— DS 内部工程规范
- `docs/10-standards/065-design-token-pipeline.md` —— token 构建与 T1/T2/T3 边界
- `workplans/design-system-t1-t4-refactor.md` —— 推进记录
