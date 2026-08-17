# @vxture/design-system

> 对外使用规范：[`packages/design/design-system/docs/`](../../../../packages/design/design-system/docs/README.md)（随包发布）；内部工程规范：[`docs/10-standards/060-design-system.md`](../../../10-standards/060-design-system.md)
> 发布规范：[`docs/10-standards/design-system-release.md`](../../../10-standards/050-design-system-release.md)
> 审计记录：[`docs/60-operations/audit/checklist-ds.md`](../../../60-operations/audit/20-checklist-ds.md)

## 包信息

| 项     | 值                                            |
| ------ | --------------------------------------------- |
| 包名   | `@vxture/design-system`                       |
| 版本   | `1.3.2`                                       |
| 路径   | `packages/design/design-system/`              |
| @layer | `Presentation`                                |
| 消费方 | `portals/*` · `agent-studio/*` · 外部业务仓库 |

## 公共入口

| 入口                                             | 用途                                       |
| ------------------------------------------------ | ------------------------------------------ |
| `@vxture/design-system`                          | 客户端组件、Icon、主题、密度、hooks、utils |
| `@vxture/design-system/tokens`                   | server-safe token 引用                     |
| `@vxture/design-system/types`                    | server-safe 类型                           |
| `@vxture/design-system/server`                   | server-safe 工具入口                       |
| `@vxture/design-system/styles/globals.css`       | 标准全局样式入口                           |
| `@vxture/design-system/styles/brand.css`         | 品牌标识组合基础样式                       |
| `@vxture/design-system/styles/components.css`    | 基础组件语义类                             |
| `@vxture/design-system/styles/console.css`       | Console portal style pack                  |
| `@vxture/design-system/styles/fullscreen.css`    | 全屏基础设施样式                           |
| `@vxture/design-system/styles/tokens.css`        | token 运行时值源                           |
| `@vxture/design-system/styles/typography.css`    | 字体和排版基线                             |
| `@vxture/design-system/styles/brands/vxture.css` | Vxture 平台级品牌入口                      |
| `@vxture/design-system/styles/brands/ruyin.css`  | Ruyin 产品级品牌入口                       |

其他 `@vxture/design-system/*` 路径默认禁止。

跨仓库消费方式见 `docs/10-standards/design-system.md` 的“跨仓库消费最小标准”。消费项目优先显式依赖 `@vxture/design-system`；仅当业务代码直接使用 shared 类型、常量或工具时，才额外声明 `@vxture/shared`。

## 目录结构

```
src/
├── tokens/       # TS token 引用，运行时值源在 styles/tokens.css
├── styles/       # globals/tokens/components/platform/console/auth/fullscreen
├── theme/        # ThemeProvider / useTheme
├── density/      # density 配置、类型与导出
├── icons/        # Icon 组件、字典和注册表
├── components/
│   ├── ui/       # 47 个 UI primitive 和平台 pattern
│   ├── ai/       # 5 个 AI 组件
│   ├── auth/     # 统一认证模板组件
│   ├── shell/    # ShellChrome
│   └── layout/   # Container / Stack / Grid / Fullscreen
├── layers/       # z-index
├── hooks/        # 通用前端 hooks
├── utils/        # cn 等工具
├── types/        # 公共类型
├── index.ts      # 客户端公共入口
├── tokens-entry.ts
├── types-entry.ts
└── server.ts
```

## UI 组件清单

当前公共组件共 52 个：`src/components/ui` 47 个 `.tsx` 组件，`src/components/ai` 5 个 AI 组件。

UI：`ActionButton`、`ActionMenu`、`Avatar`、`Badge`、`Breadcrumb`、`BulkActionBar`、`Button`、`Card`、`Checkbox`、`DataTable`、`DetailDrawer`、`DetailPanel`、`DetailSectionHeading`、`Dialog`、`DialogForm`、`Drawer`、`DropdownMenu`、`EmptyState`、`EntityListPage`、`EntityTableSection`、`FilterBar`、`Input`、`Label`、`MetricCard`、`MetricGrid`、`NativeSelect`、`PageActions`、`PageHeader`、`PageSection`、`PageSizePicker`、`PageStack`、`Pagination`、`Popover`、`SectionCard`、`SectionNav`、`Select`、`Separator`、`SettingsSplitPage`、`Skeleton`、`StatusBadge`、`Switch`、`TableToolbar`、`Tabs`、`Textarea`、`Toast`、`Tooltip`、`ViewModeSwitch`。

AI：`AIAssistantBubble`、`GenerationStream`、`ModelBadge`、`PromptInput`、`TokenCounter`。

## CSS 分层

- `tokens.css` 是 token runtime 稳定入口，只聚合 `tokens-*` 分层模块；外部消费者不得直接引用 `tokens-*`。
- `tokens-foundation-radius-space.css`、`tokens-foundation-shadow.css`、`tokens-foundation-motion.css` 与 `tokens-foundation-type-layout.css` 持有 spacing、radius、shadow、motion、keyframes 与默认字号运行时值；`tokens-density.css` 只覆盖密度相关尺度；`tokens-theme-foundation.css` 只负责 Tailwind spacing/radius/shadow/text/animate 映射。
- `tokens-colors-primitives.css` 持有品牌、状态和 AI primitive 色阶；`tokens-colors-semantic.css` 才是应用消费边界。
- `tokens-gradients.css` 只定义品牌和 AI 场景渐变 token，不承载组件结构规则；`tokens-theme-gradients.css` 只负责 Tailwind `bg-vx-gradient-*` 映射。
- `brand.css` 是品牌标识组合基线，提供 `.vx-brand-*` 语义类，并由 `globals.css` 默认聚合；单独使用时通过 `@vxture/design-system/styles/brand.css` 引入。
- `platform.css` 是 L2 平台模式稳定入口，只聚合 `platform-*` 模块。
- `console.css` 是 Console portal style pack 稳定入口，只聚合 `console-*` 模块。
- `globals.css` 是标准消费者入口，聚合 DS 全局基线。
- `*-bindings.css` 只用于选择器作用域内的变量组装，不作为 runtime token 值源。
- 应用端样式入口和大 CSS 文件应保持 import-only，具体规则放入分层模块。
- `packages/design/*.css` 迁移 patch 文件不得长期保留；迁入完成后必须删除，正式实现只落在 `packages/design/design-system/src/styles/*` 与 `src/tokens/*`。

## 依赖约束

允许：

- `@vxture/shared`
- Radix UI、Phosphor、next-themes、Tailwind 等 DS 内部 UI 引擎依赖

禁止：

- `@vxture/core-*`
- `@vxture/service-*`
- `@vxture/bff-*`
- `@vxture/platform-*`
- 任意 portal、business、agent-studio 内部模块

## 开发约束

- 所有图标通过 `<Icon name="..." />` 使用；应用不得直接导入底层图标库。
- CSS 变量运行时值只在 `styles/tokens.css` 入口及其 `tokens-*` 分层模块维护；TS token 文件只暴露 `var(--vx-*)`。
- Foundation 尺度、阴影和动效只能在 DS token owner 中定义；应用端只能消费 `--vx-space-*`、`--vx-radius-*`、`--vx-shadow-*`、`--vx-motion-*`、`--animate-vx-*` 或对应 Tailwind `vx-*` 映射，不得复制固定视觉值。
- AI 色彩的 primitive 色阶只允许 DS 内部组装；应用只能消费 `--vx-color-ai`、`--vx-color-ai-soft`、`--vx-color-ai-cyan`、`--vx-color-spark`、`--vx-gradient-aurora` 等语义 token。
- Quantum AI 已完整迁入 DS：brand ramp、AI primitive、AI semantic、gradient、Tailwind bridge、auth visual、shell brand 与 guardrail 同步收敛。
- 品牌标识使用 `.vx-brand-lockup`、`.vx-brand-mark`、`.vx-brand-name`、`.vx-brand-local-name`、`.vx-brand-separator` 组合；应用不得在本地复制品牌字体、字号、间距和颜色基线。
- DS semantic CSS 不直接消费 `--vx-component-metric-*` 兜底 token。
- 新增公共能力必须同步 `package.json` exports、guardrail 白名单和使用文档。
- 基础组件和跨应用 pattern 从 DS 导出；应用侧只做业务组装。

## 验收门控

```bash
pnpm lint:design
pnpm --filter @vxture/design-system lint
pnpm --filter @vxture/design-system type-check
pnpm --filter @vxture/design-system build
```

消费者变更追加对应应用的 `lint` / `type-check` / `build`。
