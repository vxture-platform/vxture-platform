# Vxture Design System

版本：1.3.2
最后更新：2026-06-23

`@vxture/design-system` 是 Vxture 前端的设计系统包，负责设计 token、基础 UI 原语、平台级可复用模式、主题、密度、图标隔离层和稳定样式入口。应用端负责业务语义组装，不在本地重新定义基础控件、底层 UI 引擎或 `--vx-*` token。

## 使用入口

```tsx
import {
  Button,
  DataTable,
  DialogForm,
  Icon,
  ThemeProvider,
  FullscreenProvider,
} from "@vxture/design-system";
import "@vxture/design-system/styles/globals.css";
```

允许的公共入口：

- `@vxture/design-system`
- `@vxture/design-system/tokens`
- `@vxture/design-system/types`
- `@vxture/design-system/server`
- `@vxture/design-system/styles/brand.css`
- `@vxture/design-system/styles/components.css`
- `@vxture/design-system/styles/fullscreen.css`
- `@vxture/design-system/styles/globals.css`
- `@vxture/design-system/styles/tokens.css`
- `@vxture/design-system/styles/typography.css`
- `@vxture/design-system/styles/brands/vxture.css`
- `@vxture/design-system/styles/brands/ruyin.css`

禁止从 `@vxture/design-system/src/**` 或其他未导出的子路径导入。

跨仓库消费项目应先引入 `styles/globals.css`，再选择一个品牌入口。平台级应用使用 `brands/vxture.css`，如影产品级应用使用 `brands/ruyin.css`；禁止同时引入两个品牌入口。完整使用规范随包发布，见本包 [`docs/`](./docs/README.md)。

## Root Layout

```tsx
import { FullscreenProvider, ThemeProvider } from "@vxture/design-system";
import "@vxture/design-system/styles/globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="system" defaultDensity="default">
          <FullscreenProvider>{children}</FullscreenProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

## 当前能力

### UI 组件（47 个）

| 组件                         | 说明           |
| ---------------------------- | -------------- |
| `ActionButton`               | 行为按钮封装   |
| `ActionMenu`                 | 行操作菜单     |
| `Avatar`                     | 头像           |
| `Badge`                      | 徽章           |
| `Breadcrumb`                 | 面包屑         |
| `BulkActionBar`              | 批量操作栏     |
| `Button`                     | 按钮           |
| `Card`                       | 卡片           |
| `Checkbox`                   | 复选框         |
| `DataTable`                  | 数据表格       |
| `DetailDrawer`               | 详情抽屉       |
| `DetailPanel`                | 详情面板       |
| `DetailSectionHeading`       | 详情区块标题   |
| `Dialog`                     | 对话框         |
| `DialogForm`                 | 弹窗表单组合   |
| `Drawer`                     | 侧滑面板       |
| `DropdownMenu`               | 下拉菜单       |
| `EmptyState`                 | 空状态         |
| `EntityListPage`             | 实体列表页框架 |
| `EntityTableSection`         | 实体表格区块   |
| `FilterBar`                  | 筛选工具栏     |
| `Input`                      | 输入框         |
| `Label`                      | 标签           |
| `MetricCard`                 | 指标卡         |
| `MetricGrid`                 | 指标栅格       |
| `NativeSelect`               | 原生选择器封装 |
| `PageActions`                | 页面动作区     |
| `PageHeader`                 | 页面标题区     |
| `PageSection`                | 页面区块       |
| `PageSizePicker`             | 分页大小选择   |
| `PageStack`                  | 页面纵向栈     |
| `Pagination`                 | 分页           |
| `Popover`                    | 弹出层         |
| `Select`                     | 选择器         |
| `Separator`                  | 分隔线         |
| `SectionCard`                | 区块卡片       |
| `SectionNav`                 | 区块导航       |
| `SettingsSplitPage`          | 设置分栏页     |
| `Skeleton`                   | 加载占位       |
| `StatusBadge`                | 状态徽章       |
| `Switch`                     | 开关           |
| `Tabs`                       | 标签页         |
| `TableToolbar`               | 表格工具栏     |
| `Textarea`                   | 多行输入       |
| `Tooltip`                    | 提示           |
| `ToastProvider` / `useToast` | 全局通知       |
| `ViewModeSwitch`             | 视图模式切换   |

### AI 组件（5 个）

| 组件                | 说明              |
| ------------------- | ----------------- |
| `ModelBadge`        | 模型身份徽章      |
| `GenerationStream`  | AI 流式生成展示面 |
| `PromptInput`       | AI Prompt 输入框  |
| `AIAssistantBubble` | AI 对话气泡       |
| `TokenCounter`      | Token 用量条      |

### 其他导出

- 图标：统一通过 `<Icon name="..." />` 使用，应用不得直接导入 `@phosphor-icons/react`。
- 布局：`Container`、`Stack`、`HStack`、`VStack`、`Grid`、全屏 Provider/Container/Portal/Toggle。
- 主题与密度：`ThemeProvider`、`useTheme`、density 配置和类型。
- Tokens：TS token 文件只暴露 `var(--vx-*)` 引用，运行时值源在 `styles/tokens.css`。
- Hooks：`useBreakpoint`、`useMediaQuery`、`useMounted`、`useControllableState`、`useFullscreen`。
- Utils：`cn()`。

### AI 色彩语义

DS 1.3.0 将 Quantum AI 色板沉淀为 Foundation primitive、semantic token、Tailwind `@theme` bridge 三层，并同步替换品牌主色、auth 视觉和 shell brand。应用端只能消费 `--vx-color-ai`、`--vx-color-ai-soft`、`--vx-color-ai-cyan`、`--vx-color-spark` 和 `--vx-gradient-aurora` 等语义值；`--vx-color-ai-500`、`--vx-color-ai-cyan-500`、`--vx-color-spark-400` 这类 primitive 色阶只允许 DS 内部组装。

`@vxture/design-system/tokens` 同步暴露 `colors.semantic.ai*` 与 `gradients.*` 引用，值仍全部指向 `var(--vx-*)`。`@theme` 同步提供 `bg-vx-gradient-aurora`、`bg-vx-gradient-brand`、`bg-vx-gradient-ai-duo`、`bg-vx-gradient-spark-pulse` 映射。`components.css` 提供 `.vx-ai-surface`、`.vx-ai-chip`、`.vx-ai-dot`、`.vx-ai-gradient-text`、`.vx-ai-ambient` 五个 AI 通用语义类；应用可以组合这些类表达业务结构，但不得在应用层重新定义 AI 颜色、渐变、发光和 badge 基线。

### Foundation 尺度与动效

Foundation 层统一维护 spacing、radius、shadow、motion 和 animation keyframes。运行时值源拆分在 `styles/tokens-foundation-radius-space.css`、`styles/tokens-foundation-shadow.css`、`styles/tokens-foundation-motion.css` 与 `styles/tokens-foundation-type-layout.css`，由 `styles/tokens.css` 聚合；`styles/tokens-density.css` 负责密度覆盖，`styles/tokens-theme-foundation.css` 负责 Tailwind `@theme` 映射，`src/tokens/*.ts` 只暴露 `var(--vx-*)` 引用。

已开放的新增能力包括 `--vx-space-3xl/4xl`、`--vx-radius-xs/2xl/3xl`、`--vx-shadow-xs/xl/2xl/glow/focus-ring/focus-ring-ai`、`--vx-duration-*`、`--vx-ease-*`、`--vx-motion-*` 和 `--animate-vx-*`。应用端不得重新定义阴影、圆角、动效曲线或关键帧；AI 发光、shimmer 和 pop 动效只能通过 DS 语义 token 或 DS 组件组合使用。

临时迁移 patch 文件不得作为 DS 长期源码保留。Foundation 与字体迁入完成后，正式来源只认 `src/styles/*`、`src/tokens/*`、`docs/10-standards/design-system.md` 和 `docs/10-standards/font-system.md`。

### 品牌标识组合

`styles/brand.css` 提供轻量品牌标识组合基线，并已由 `styles/globals.css` 聚合。应用可直接组合 `.vx-brand-lockup`、`.vx-brand-mark`、`.vx-brand-name`、`.vx-brand-local-name` 与 `.vx-brand-separator` 表达产品名、子品牌和本地化名称；这些类只承载字体、间距、颜色和图标尺寸基线，不绑定具体文案、链接目标或业务上下文。

需要单独引入品牌标识基线且不加载完整全局样式时，可以使用 `@vxture/design-system/styles/brand.css`。应用不得在本地重新定义品牌字体、字号、间距或颜色，应通过这些类和 DS token 组合。

## CSS 分层

| 层级                 | 归属                    | 内容                                                                    |
| -------------------- | ----------------------- | ----------------------------------------------------------------------- |
| L0 Foundation        | DS                      | `tokens.css`、`typography.css`、`tailwind.css`、theme/density/font 基线 |
| L1 Primitive         | DS                      | 基础 UI 组件和 `.vx-*` primitive 语义类                                 |
| L2 Platform Pattern  | DS                      | `platform.css` 聚合入口与 `platform-*` 模块，承载跨应用模式             |
| L3 Portal Experience | Portal / DS portal pack | `console.css` 聚合入口与 `console-*` 模块，或各 portal 自有 chrome      |
| L4 Domain Assembly   | 应用模块                | 业务实体页面的语义组装                                                  |
| L5 Runtime Dynamic   | 调用现场                | 坐标、进度、背景图 URL、动画延迟等运行时值                              |

`platform.css`、`console.css` 和 `admin-management.css` 这类大入口只能保留 `@import` 聚合。具体规则必须进入同目录分层模块，并由 `pnpm lint:design` 阻断回流。

## 禁止事项

```tsx
// 禁止：内部路径
import { Button } from "@vxture/design-ui/src/components/base/Button";

// 禁止：应用直接使用底层图标库
import { User } from "@phosphor-icons/react";

// 禁止：业务源码手写基础控件
<button>Submit</button>;

// 禁止：设计型 inline style
<div style={{ color: "#666", padding: 16 }} />;
```

应用端可以用业务 class 组装 DS 组件，但不能定义 `--vx-*` token，不能写硬编码颜色、字号、间距、圆角、阴影，不能复制 DS primitive。

## 验收

```bash
pnpm lint:design
pnpm --filter @vxture/design-system lint
pnpm --filter @vxture/design-system type-check
pnpm --filter @vxture/design-system build
```

消费者变更还必须运行对应应用的 `lint` / `type-check` / `build`。

## 关联文档

- `docs/10-standards/design-system.md`：应用侧使用规范
- `docs/40-implementation/packages/design/design-system.md`：包实现约束
- `docs/60-operations/audit/checklist-ds.md`：DS 审计记录与收敛任务
