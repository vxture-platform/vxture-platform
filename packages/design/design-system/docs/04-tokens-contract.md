# 04 Token 契约（T2 全族）

版本：1.0.0 ｜ 日期：2026-08-02 ｜ 事实来源：`@vxture/design-tokens` 的 `styles/semantic/*`（生成物，本文与之核对）

T2 是唯一公开 token 契约（T1 禁引，见 [`01-usage.md`](./01-usage.md) §2）。每族都产出真工具类，取值一律走工具类。

## 1. 全族总表

| 族              | T2 名 → 工具类                                                                | 命名空间                               | 模式轴                       |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- |
| 色彩            | `--primary` → `bg-primary`                                                    | `--color-*`                            | 明暗（`.dark`）              |
| 排版角色        | `--body-md-*` → `text-body-md`                                                | `--text-*`                             | 字号三档（`html.vx-font-*`） |
| 间距 / 控件高度 | `--space-md` → `p-md`、`h-control-lg`                                         | `--spacing-*`                          | 密度三档（`.density-*`）     |
| 图标 / 媒体尺寸 | `--spacing-icon-md` → `size-icon-md`                                          | `--spacing-*`                          | 无                           |
| 圆角            | `--radius-md` → `rounded-md`                                                  | `--radius-*`                           | 无                           |
| 视觉高度        | `--shadow-raised` → `shadow-raised`                                           | `--shadow-*`                           | 无                           |
| 叠放次序        | `--z-index-modal` → `z-modal`                                                 | `--z-index-*`                          | 无                           |
| 时长 / 缓动     | `--transition-duration-fast` → `duration-fast`、`--ease-enter` → `ease-enter` | `--transition-duration-*` / `--ease-*` | 无                           |
| 透明度          | `--opacity-disabled` → `opacity-disabled`                                     | `--opacity-*`                          | 无                           |
| 描边宽度        | `--border-width-thin` → `border-thin`                                         | `--border-width-*`                     | 无                           |
| 页面 / 内容宽度 | `--container-page-lg` → `max-w-page-lg`                                       | `--container-*`                        | 无                           |

## 2. 色彩

六个意图族由"色相 × 阶型"派生，阶型按对比度定档（A=600 填充配白字；B=700 填充配白字，给 emerald/sky；C=400 填充配深字，给 amber）。

| 组       | 成员                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 表面     | `background` `surface-1` `card` `surface-3` `popover` `scrim` `accent` `surface-active` `surface-selected` `surface-selected-hover` `muted` `surface-inverse`；`accent` 是品牌微染的交互反馈（hover/展开），`muted` 是静态中性弱底（占位、键位、非交互成员）——分工不混用 |
| 内容     | `foreground` `muted-foreground` `content-tertiary` `content-disabled` `content-on-fill` `content-on-inverse` `link` `link-hover`                                                                                                                                         |
| 描边     | `border` `input` `stroke-emphasis` `stroke-disabled` `ring`                                                                                                                                                                                                              |
| 意图六族 | `primary` / `destructive` / `ai` / `success` / `info` / `warning`，每族十槽：`-hover` `-active` `-foreground` `-muted` `-muted-hover` `-muted-active` `-muted-foreground` `-border` `-text`                                                                              |
| 图表     | 基线 `chart-other` `chart-grid` `chart-axis` `chart-tooltip-bg`；分类 `chart-1`…`chart-6`；顺序 `chart-seq-1`…`5`；发散 `chart-div-1`…`5`                                                                                                                                |
| 渐变     | `gradient-brand-from/to` `gradient-ai-from/to` `gradient-surface-from/to` `gradient-glow-from/to`                                                                                                                                                                        |

### AI 色彩语义

**定位（owner 拍板 2026-08-02）：`ai` 是 AI 板块的局部强化品牌色——性质相当于
"brand-2"，不是反馈语气**。它不在 tone 六档里：Toast / Banner / StatusBadge 无 ai
档；AI 语气由 AI 组件族（ModelBadge / GenerationStream / PromptInput 等）自身承载。

槽位与六个意图族同构（`ai` / `-hover` / `-active` / `-foreground` / `-muted` 系列 /
`-border` / `-text`），另有渐变端点 `--gradient-ai-from/to`：

| 用途                                 | token                                     |
| ------------------------------------ | ----------------------------------------- |
| AI 专属 UI 填充：助手 chrome、AI CTA | `bg-ai` + `text-ai-foreground`            |
| AI 板块弱化底 / 生成中面板           | `bg-ai-muted`                             |
| AI 描边 / 文字着色                   | `border-ai-border` / `text-ai-text`       |
| AI 重点视觉渐变                      | `from-gradient-ai-from to-gradient-ai-to` |

判据：`ai` 只用于"这里是 AI 能力"的标识与氛围，**不作通用 CTA**（那是 `primary`
的位置）；生成态短暂动效用 `animate-pulse` + ai 着色表达，无独立动效色。

## 3. 排版角色

七族十九档，每档五个属性变量（family/size/weight/line-height/letter-spacing），工具类 `text-{族}-{档}`。默认字号档取值：

| 族       | 档位（px）                            |
| -------- | ------------------------------------- |
| display  | `lg` 72 / `md` 60 / `sm` 48           |
| heading  | `1` 36 / `2` 30 / `3` 24              |
| title    | `xl` 20 / `lg` 18 / `md` 16 / `sm` 14 |
| body     | `xl` 18 / `lg` 16 / `md` 14 / `sm` 12 |
| label    | `xl` 18 / `lg` 16 / `md` 14 / `sm` 12 |
| code     | `md` 14 / `sm` 12                     |
| overline | 单档 12                               |

字号三档（`vx-font-small/default/large`）对全族整体平移一档；任何档下最小 12px。

## 4. 间距与控件高度（密度轴）

默认档取值（`--vx-spacing` = 4px 基数）：

| 组                        | 档位（默认密度，px）                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| inset `space-*`           | `none` 0 / `2xs` 4 / `xs` 8 / `sm` 10 / `md` 16 / `lg` 24 / `xl` 32 / `2xl` 40 / `3xl` 48 / `4xl` 56 / `5xl` 64 / `6xl` 80 |
| row `space-row-*`         | `sm` 48 / `md` 56 / `lg` 64 / `xl` 80 / `2xl` 96 / `3xl` 112 / `4xl` 128                                                   |
| control `space-control-*` | `3xs` 16 / `2xs` 20 / `xs` 24 / `sm` 28 / `md` 32 / `lg` 36 / `xl` 40 / `2xl` 48 / `3xl` 56                                |

密度三档（`.density-compact/default/comfortable`）是档位平移而非等比缩放；compact 收 inset/row 也收 control，comfortable 只放 control 与 inset 局部——具体值以生成物为准。

## 5. 图标 / 媒体 / 侧栏尺寸

| 组                   | 档位（px）                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| icon `size-icon-*`   | `xs` 12 / `sm` 16 / `md` 20 / `lg` 24 / `xl` 32 / `2xl` 48              |
| media `size-media-*` | `xs` 32 / `sm` 48 / `md` 64 / `lg` 80 / `xl` 96 / `2xl` 128 / `3xl` 192 |
| sidebar              | `expanded` 256 / `collapsed` 64 / `rail` 48                             |

## 6. 圆角

基数 `--radius: 0.625rem`，七档 `sm/md/lg/xl/2xl/3xl/4xl` 按倍率派生；倍率表与组件选档见 [`02-visual-spec.md`](./02-visual-spec.md) §1。

## 7. 视觉高度（elevation）

`shadow-flat` / `raised` / `sticky` / `overlay` / `dialog` / `notification`。与叠放次序相关但不可互相推导：tooltip 叠放最高、阴影却应当很轻。elevation 允许多角色共用一档。

## 8. 叠放次序（z-index）

`0–99` 归局部堆叠自由使用；超过 99 一律取语义档（逐档互异是硬要求——同值时叠放次序取决于 DOM 顺序而非设计意图）：

| 档                | 值     | 依据                                        |
| ----------------- | ------ | ------------------------------------------- |
| `base` / `raised` | 0 / 10 | 文档流基线 / 同层轻微抬起                   |
| `sticky`          | 100    | 让位给 portal 化的 dropdown                 |
| `dropdown`        | 200    | Radix portal 菜单须压过粘性表头，否则被裁切 |
| `overlay`         | 300    | 浮层遮罩                                    |
| `drawer`          | 400    | 低于 modal——模态可从抽屉内唤起              |
| `modal`           | 500    |                                             |
| `popover`         | 600    | 高于 modal——气泡可用在模态内                |
| `toast`           | 700    | 全局反馈，不应被浮层遮挡                    |
| `notification`    | 800    | 常驻更久且可堆叠，压在 toast 之上           |
| `tooltip`         | 900    | 必须最高，否则被它所描述的元素遮挡          |
| `max`             | 9999   | 逃生档，新增使用需在 PR 说明                |

## 9. 时长 / 缓动

| 档                 | 用途                      |
| ------------------ | ------------------------- |
| `duration-instant` | 状态色切换等无位移反馈    |
| `duration-fast`    | hover / focus 等即时反馈  |
| `duration-base`    | 默认过渡：展开、切换      |
| `duration-slow`    | 浮层进出、抽屉滑动        |
| `duration-slower`  | 页面级转场                |
| `ease-enter`       | 入场减速：元素从无到有    |
| `ease-exit`        | 退场加速：元素离场        |
| `ease-standard`    | 位置 / 尺寸变化的默认曲线 |

业务层不得声明全局 keyframes 或字面时长。

## 10. 透明度 / 描边宽度

| 档                 | 值   | 用途                             |
| ------------------ | ---- | -------------------------------- |
| `opacity-disabled` | 0.45 | 禁用态整体压暗                   |
| `opacity-overlay`  | 0.5  | 遮罩                             |
| `opacity-subtle`   | 0.6  | 次要信息：时间戳、辅助说明       |
| `opacity-muted`    | 0.75 | 弱化但仍需阅读：占位、提示       |
| `border-thin`      | 1px  | 默认描边：卡片、输入框、分隔     |
| `border-medium`    | 2px  | 强调描边：选中态、焦点框         |
| `border-thick`     | 4px  | 结构性描边：侧栏指示条、状态色条 |

## 11. 页面 / 内容宽度与断点

| 组                | 档位                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `max-w-page-*`    | `xs` 375 / `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280 / `2xl` 1536 / `3xl` 1920 / `4xl` 2560 / `5xl` 3840（px）                           |
| `max-w-content-*` | `narrow-lg` 1024（正文/表单）/ `base-xl` 1280（列表与详情）/ `wide-2xl` 1536（数据密集面板）/ `ultra-3xl` 1920（2K/4K 上限，再宽应改分栏） |
| `max-w-panel-*`   | `sm` 448（确认框）/ `md` 512（默认对话框）/ `lg` 672（宽对话框）（px）                                                                     |

断点用 Tailwind 变体（`sm:`…`2xl:`）与 DS 扩展档（`xs:` / `3xl:` / `4xl:` / `5xl:`）；业务 CSS 不得在 media query 中复制 `640px` 等断点值。
