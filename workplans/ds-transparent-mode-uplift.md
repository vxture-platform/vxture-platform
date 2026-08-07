# DS 视觉提升二期 · 透明模式 + 清单补齐

分支：`feat/ds-token-tier-phase0`（接批 A–G）。批次编号续用 H–N。

## 0. 依据与边界

| 条       | 内容                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 来源     | owner 指令 2026-08-02：透明模式（参照 admin）、shadcn 目录补齐、布局/icon+内容组合设计 |
| 视觉权威 | admin 内容区（`portals/admin/src/styles/`）的语法，不是它的代码                        |
| 结构权威 | shadcn vega preset（`--base radix`），批 A–G 已对齐                                    |
| 边界     | T1/T2 token 不动值，仅在必要处**新增**语义；不改 admin；产品侧对接留待 DS 打好后       |

## 1. 从 admin 提炼的视觉语法（判据）

| #   | 规则                                                                                   | admin 证据                                                           |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| V1  | 页面唯一实色底；一切容器为半透明白叠层（58/68/72%）                                    | `admin-base-document.css:3`、各卡 `color-mix(white N%, transparent)` |
| V2  | sidebar 与内容区同底、零分隔                                                           | DS `app.css:318` `background: transparent`                           |
| V3  | 语义色只走顶部 2px 描边，永不填卡片底                                                  | `admin-management-core.css:48`                                       |
| V4  | 实线=区块起始（brand 10–16%）；虚线=行/字段/footer 分隔                                | `admin-directory-list.css` / `admin-directory-cards.css:83`          |
| V5  | 表格无容器卡：透明行、水平 padding 0、grid gap 定列距、虚线行分隔                      | `admin-directory-layout.css:3-11`                                    |
| V6  | 页头三栏 grid `auto\|1fr\|auto`；icon 裸色无底块（一级 40 / 二级 32）；copy gap 0.5rem | `admin-overview-core-heading.css`                                    |
| V7  | 图标承载语义色，文字保持中性                                                           | `admin-directory-list.css` 行图标 tone、文字 secondary               |
| V8  | hover = 淡 brand 底（4–10%）+ 前景转 brand，不动 border/shadow/位置                    | §7 交互态表                                                          |
| V9  | 次要操作父容器 hover 渐显（opacity 0→1 + pointer-events）                              | 标题复制按钮等                                                       |

## 2. 不参考清单（admin 的缺陷）

| #   | 缺陷                                              | DS 处理                   |
| --- | ------------------------------------------------- | ------------------------- |
| X1  | 表头 `justify-items:center` vs 行 left 对齐轴冲突 | header/row 同轴           |
| X2  | 720–860 七档字重                                  | 收敛 400/500/600/700      |
| X3  | off-grid 尺寸 2.4rem/.85rem/.94rem                | 落 DS 现有刻度            |
| X4  | 硬编码 `#94A3B8`                                  | 全走 token                |
| X5  | sidebar 清 focus ring                             | 保留 `interactive` 焦点环 |
| X6  | 10 层 `:not()` 选择器                             | 每列语义类名              |

## 3. 批次

### 批 H — 透明表面层（零 token 改动，纯配方）

- veil 三档 = `bg-card/{58,68,72}`（透明度修饰符作用于现有 `--card`，明暗自适应）
- hairline = `border-primary/10 dark:/20`（≈ admin `#1e51ff1f`），实线/虚线分工入配方
- `revealOnHover` 配方（V9）
- T1/T2 无任何改动（owner 规则：token 改动需批准，颜色优先靠现有 DS）
- 附带：generate-foundation 修单值色 alpha 合成的本体解析 bug（`white-alpha-*` 会被误剔）

### 批 I — 标题族（V6）

- ViewHeader / SectionHeader 重写为 icon|copy|actions 三栏语法；level 阶对应 icon 40/32/无、字级取 DS 现有 type 刻度
- 二级带虚线下边框；正文与 icon 轴对齐的缩进规则
- X2/X3 修正落地

### 批 J — Card 族（V1/V3/V4）

- Card 默认透明叠层（veil）+ 1px 边框 + 8px 圆角
- MetricCard 对齐 KPI 卡语法（icon 轨 + tone 顶描边）
- 入口卡形态（icon 色块底 40px）并入 Card 组合或新 pattern

### 批 K — Table/DataTable（V5 + X1/X6 修正）

- 去容器卡：透明行、表头 caption 样式（12px/实线下边框）、行虚线分隔、hover tint
- 行操作列标准化：ghost icon trigger + DropdownMenu、`justify-self:end`
- 分页 footer：虚线上边框、总数左/操作右

### 批 L — 清单补齐·纯 Radix（装分包即可）

alert-dialog, accordion, collapsible, progress, radio-group, slider, toggle, toggle-group, scroll-area, table 原语, hover-card, context-menu, aspect-ratio（13 件）
（menubar / navigation-menu 缓：控制台形态用 sidebar 导航，无消费场景；**alert 不引**：Banner 已以六档 tone 占 inline callout 位，再引=同一严重度两套名字）

### 批 M — 清单补齐·重依赖（收窄）

- 引入：command/combobox（cmdk）、calendar/date-picker（react-day-picker）——控制台筛选/日期区间刚需
- 缓：carousel / chart / resizable / input-otp / form(react-hook-form)——当前无消费场景，按需再引

### 批 N — 预览面 + 全量验证（已完成）

- 预览外壳本身改为 V2 活演示（sidebar 透明零分隔）；axes 全量补齐（63 条目，派生优先）
- 实测抓出并修复三个"生成≠正确"缺陷：border-t-medium 被 tw-merge 误分类挤掉（cn 补 border-width 组）、
  **max-w-lg 命中同名 spacing 档致 Dialog 塌宽 24px**（新增 panel 宽度族 448/512/672 + 守卫拦裸容器档）、
  Checkbox 16px 字形溢出 16px 盒（图标降 12）
- 新增 T2：`--spacing-sidebar-{expanded,collapsed,rail}`（owner 拍板 256/64/48）、`--container-panel-{sm,md,lg}`

### 批 O — 最后两件 pending 重写（进行中）

- AuthLogin（1741 行 / 88 处遗留类）+ ShellChrome（855 行 / 59 处）：T2 + 配方重写，公开 API 冻结
  （accounts 6 文件 / website Header 消费中），ShellBrand 默认 label 去真实域名
- 完成判据：守卫 72 组件全绿、消费方 type-check 零新增错误、PENDING_COMPONENTS 清空

### 批 T — 目录分类法重构（已完成，`22ca6ccc`）

- ui→base、patterns→composite、ai→ai-elements；StatusBadge/NativeSelect/SegmentedControl/Banner/EmptyState
  移 base，SplitViewLayout/ViewLayout 移 layout（实测零视觉类）；tone.ts 上提 components/ 层级
- 判据一句话（03 §8）：单件进 base，组合进 composite，零视觉纯排布进 layout，页面骨架进 templates；看消费不看构造
- 根入口不变，消费方零感知；preview 的 atom/pattern 是构造粒度轴，刻意不对齐（跟进项）
- owner 拍板：base/（弃 primitive，避 T1 与 Radix 双撞名）；"图案性样板"= preview blocks 区，后续计划

### 批 S — 上游目录补齐七件（已完成）

- Spinner / Kbd+KbdGroup / ButtonGroup+Text / InputGroup 族 / Field 族 / InputOTP / Resizable，全进 base/
- 不引：Form(RHF，UI 层零框架绑定)、Menubar/NavigationMenu/Carousel(无场景)、Chart(归 domain-ui)、Item(与现有件撞语义)
- 新依赖：input-otp、react-resizable-panels v4（API 与 shadcn 文档的 v2 不同代，按 data-separator/aria-orientation 重写）
- 守卫 84 组件 / 828 类名列表全绿；Button 归集 base/Button/ 目录（约定：多文件成目录，单文件平铺）
- **浏览器实测已完成（2026-08-03）**：七件计算值全对（Spinner 五档+spin 动画、Kbd 16px/muted/等宽、
  ButtonGroup 接缝清角+-1px、InputGroup 焦点环包整组（放大截图确认）+失效红、Field alert 语义、
  OTP 32×32 槽、Resizable 鼠标/键盘双通道调宽实测）；expandable 展开高亮修复实测生效（bg=muted）；
  console 零产品错误（仅测量脚本自伤伪影）；教训：computer 工具坐标=截图空间(×0.8167)非 CSS 空间

### 批 U — muted token + 展开高亮静默失败修复（已完成，`cb184042`）

- **实弹**：expandable 配方 `aria-expanded:bg-muted` 引用不存在的 token——所有菜单/下拉触发器
  的展开高亮从未生效；守卫多数票启发式放走"两 token 恰好一半失效"的串
- owner 拍板建 `muted`（neutral-200/800）：上游 muted/muted-foreground 本是一对，此前只建了后者；
  与 accent 分工写入 04 §2（accent=品牌微染交互反馈，muted=静态中性弱底）
- Skeleton/Kbd/ButtonGroupText 迁 bg-muted；守卫对 recipes.ts 取消多数票（命中一个即全串实测）

### 批 V — base 五组 / composite 三组功能分目录（已完成）

- base：form 17 / display 15 / navigation 3 / overlay 9 / feedback 4；composite：form 3 / data 7 / structure 4
- 归属以 preview 分组字段为准（同一分类法两个视图）：Calendar/Accordion/Collapsible/Skeleton 归
  display、Command 归 overlay，与初表不同处均从 preview
- 根入口不变，churn 全在仓内 import 与两个目录 index

### 批 W — 统计卡对齐 admin + Card 竖向节奏 + 第三例 twMerge 静默丢类（已完成）

- opera 对照线上 admin 首屏（owner 实测"差距很大"）：MetricCard 全落 neutral 档发灰。
  修 DS 而非 opera：tone 默认改 `brand`（admin KPI 卡默认即品牌蓝），读数继承语气色
  （neutral 档回落 foreground）+ font-bold；图标随卡根语气色自动着色
- 统计卡两形态（owner 拍板）：`variant="default"`（带 icon 松散款，≤4/行）/
  `"compact"`（无 icon 紧凑款，>4/行，只收 padding 行距、读数不缩、icon 传了不渲染）；
  MetricGrid 整排透传；preview 补 compact 轴与示例排
- **第三例 twMerge 静默丢类（与 vx-type / border-width 同族）**：T2 间距档不在
  tailwind-merge 内置刻度表，`cn("p-xl pt-none", "p-xl")` 三条全存活、CSS 顺序裁决，
  CardContent 的 `pt-none` 压掉调用方 padding→指标卡顶部内边距归零（owner 抓到）。
  修法：theme.spacing 登记档名文法谓词（none/2xs…6xl/row-_/control-_），全间距组生效
- Card 竖向节奏对齐上游现行模型：`py-xl + gap-xl` 落 Card 本体，Header/Content 只管
  `px-xl`，Footer `pt-md`（底由 Card py 收）；`pt-none`（假设内容永远跟在页头后）退役
- 亮/暗双模式浏览器实测：四指标卡品牌蓝顶缘+同色读数、padding 四向对称、Router 独立
  CardContent 卡顶部不再归零

### 批 X — 列表页五要件（admin 租户列表语法，已完成）

- owner 拍板（2026-08-03，参照 admin /tenants）：两行行模式保留、辅助行字重按 DS 收
  （admin 700+ 字重靠字重打层次，DS 靠字号+前景色）；列语法、工具行、翻页三段定型
- DataTable：`indexStart` 序号列（翻页由调用方递进）+ `rowActions` 锁定操作列
  （sticky right，自铺 bg-background 垫底、行 hover/选中态同步上铺，横向滚动不透底）
- 新件 TableTitleCell：icon + 主信息（可点进详情）+ 辅助行 body-sm/muted；
  归 DataTable 预览条目 covers
- FilterBar 升级为工具行：{list/cards 视图切换(SegmentedControl)}-{计数}-{children
  搜索/筛选组}-{actions 主操作}，view/count 不传即退回纯筛选行
- Pagination：左"共 N 条记录 / 当前筛选 M 条"，右{每页 N 条(NativeSelect)}+{翻页}
- opera Provider 页为参考实现（选择+批量启停、序号翻页递进、卡片视图、每页条数），
  浏览器实测：翻页/选择/批量/切视图全通
- 快照 minor +1（TableTitleCell 具名导出）
- **二次修订（owner 三点，2026-08-03）**：①组件化确认（工具行/表格/翻页/两行主列全在
  DS，页面只传数据）；②list/cards 切换升为清单页常备段——新件 ListCard/ListCardGrid
  （行卡语法固定：两行主列+右上状态/操作+底部 meta；与 EntryCard 分工=引路 vs 数据行；
  Grid 统一断点），六个清单页全部有 cards 形态；③FilterBar 布局定型：居左【切换+计数】
  —自适应留白—居右【搜索+筛选组+主操作】，主操作从 ViewHeader 移入工具行；快照 minor
  （ListCard/ListCardGrid 具名导出）
- **全清单页推开（owner 指出只改一页≠通用）**：Models/Endpoints/Keys（全套：选择+批量、
  序号、两行主列、锁定操作列、计数、翻页）+ Logs/Audit（只读：计数+序号+翻页）+
  RBAC（4 固定角色：序号+两行主列+锁定操作列，不设翻页）；opera 新增 useListPagination
  hook（翻页状态公共化，接 BFF 分页只换数据源）；Dashboard 摘要表与 Metering 聚合表
  刻意保持轻量——五要件是清单页语法，不是所有表格的语法

### 批 Y — opera 全页巡检三项（已完成）

- owner 三项巡检指令（2026-08-03）：card / 非历史表格上 list 模式 / 二级标题同构
- 表尾细化（同日多轮）：每页条数按钮化=SegmentedControl（承旧 PageSizePicker，
  Pagination 误用下拉被 owner 纠正）→ 去标签纯数字 → [auto|10|20|50|100]，auto=
  按可视高度测首行算整页行数（hook 探测 main 首行，无 ref 接线），中英文都显示 auto
- 工具行单行修正：搜索框 w-full 的假想宽度提前触发 flex-wrap→改 grow+basis-media-3xl
  （192 基准、384 上限、真挤才折行）；搜索框换 InputGroup+放大镜（上游 Input 本无图标，
  放大镜是 InputGroup 组合出来的，批 S 已引入但清单页未用）
- 巡检落地：Dashboard Provider 状态表换两行主列+板块头补描述与"查看全部"；最近事件
  按"历史纯表"保留；Router 端点卡换 ListCard；Metrics/Metering 板块头补描述；
  Metrics Endpoint 表与 Metering 聚合表按"统计纯表"保留（无管理动作不套清单语法）
- 二级标题本身早已同构（SectionHeader level 2=icon 24+title-md+描述+action），
  缺的是页面没传 description/action——补齐即可，DS 零改动

## 4. 判断记录（owner 未逐条拍板、由本计划定）

| 决策                              | 取向                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 透明叠层落点                      | 零新增：现有 token + 透明度修饰符（`card/58`、`primary/10`）                                                       |
| hover/pressed 换 brand 微染（V8） | **已批（2026-08-02 "accent 改"）**：`accent`=brand-600-alpha-08/15、`surface-active`=15/22，与 selected 成连续刻度 |
| 焦点环                            | 保留（X5）                                                                                                         |
| 重依赖范围                        | 仅 cmdk + react-day-picker，其余缓                                                                                 |
| menubar/navigation-menu           | 缓，无消费场景                                                                                                     |
| Toast/Drawer/DataTable 自研件     | 保留自研，不换 sonner/vaul/tanstack                                                                                |
