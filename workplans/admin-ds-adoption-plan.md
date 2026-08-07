# admin 接入 DS —— 分析与规划

**前置**：`admin-css-absorption-inventory.md`（结构盘点，任务 #20 产出）。本文回答的是
盘点之后的问题：**怎么接、按什么顺序接、哪些要先在 DS 侧补齐**。

---

> **2026-08-05 已修复。** 下面这一节记录的是本轮开工时的状态。取值层已按原值恢复
> （DS `assets/admin-tokens/`，545 个变量全部取自 git），失效声明 **33.9% → 0%**。
> 修复的由来见第十节——本文前半程把这些 CSS 当成"待清理的死代码"，那是误判：
> admin 的页面样式是几个应用里效果最好的一套，缺的只是被抽走的取值层。

## 一、开工时的状态：admin 的页面 CSS 有三分之一是失效的

| 量             | 值                                             |
| -------------- | ---------------------------------------------- |
| 页面 CSS 文件  | 145 个 / 12857 行 / 4234 条声明                |
| 引用未定义变量 | 1787 处裸引用（无 fallback 的只有 1 处外全裸） |
| 因此失效的声明 | **1437 条 = 33.9%**，波及 103/145 个文件       |

失效集中在骨架属性上，不是装饰：

```
 380  gap                    298  font-size
 114  padding                 80  grid-template-columns
  78  height                  64  box-shadow
```

`var(--x)` 未定义且无 fallback ⇒ 该声明 invalid at computed-value time ⇒ 属性回落到
继承值/初始值。所以现在 admin 页面上：栅格塌成单列、间距归零、字号继承。

**成因不是事故，是计划内的欠账。** `8ca6284e`（2026-07-31）退役 legacy token 层，
commit message 自己写着 "Products converge to the tier layer in batches" —— admin 就是
那个还没收敛的产品。

### 这件事对规划的三个影响

1. **不存在"迁 DS 会破坏 admin 现有视觉"的风险** —— 没有现有视觉可破坏。这把整件事
   从"高风险替换"降级为"修复"。
2. **旧 CSS 不能当安全网。** 保留它不提供回滚价值，因为回滚回去也是坏的。
3. **owner"不删 admin style"的要求依然成立，且理由变了**：这些 CSS 现在是**设计意图
   的唯一记录**——渲染已不可信，源码还可信。吸收的对象是结构与意图，不是当前渲染。

---

## 二、第二个事实：DS 已经吸收了一部分，admin 没回接

`MetricCard` 的 props 注释里写着：

> 默认 `brand` 而非 `neutral`：admin KPI 卡的既有视觉是"默认即品牌蓝"（顶缘 + 读数 +
> 图标同色）…（2026-08-03 opera 对照 admin 实测）

也就是说 DS 侧的 `MetricCard` / `MetricListCard` **就是照 admin 的结构抽象出来的**，
但 admin 自己仍在用 `SummaryItem`。盘点文档里"A1 待拍板：扩 ListCard 还是新建
MetricListCard"这个悬案，已被后来的工作回答了——`MetricListCard` 已存在，只是全仓
只有 1 个门户文件在用。

**所以"接入 DS"的主体不是新建，是回接已经吸收好的成果。**

---

## 三、admin 现状的量化底盘

| 维度                      | 值                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 页面模块                  | 58 个 tsx / 37003 行，24 个业务域                                                                                           |
| 每页 legacy className     | 27–86 处（TenantDetailPage 86，ModelPlatform 73）                                                                           |
| 每页 DS import 行         | **1–2 行**                                                                                                                  |
| 裸 `div`/`span`/`section` | 751 / 1064 / 194                                                                                                            |
| **同名本地组件重复定义**  | `SummaryItem`×8 · `DetailMetric`×6 · `DetailField`×6 · `SectionHeading`×5 · `Pagination`×5 · `PageSizePicker`×2 = **32 份** |

最后一行是这次的最大杠杆：32 份复制粘贴，对应 DS 里 6 个现成组件。

---

## 四、三分类

### A · 直接换（DS 已有等价物，admin 只是没回接）

| admin 现状                                | 换成                                      | 消灭               | 范例                 |
| ----------------------------------------- | ----------------------------------------- | ------------------ | -------------------- |
| `SummaryItem`（8 份私有定义）             | `MetricCard`                              | 8 份 + 41 处引用   | opera 已用           |
| `DetailField` / `DetailMetric`（各 6 份） | `DetailRow` / `DetailList`                | 12 份 + 153 处引用 | console 9 个文件已用 |
| `SectionHeading`（5 份）                  | `SectionHeader`                           | 5 份               | —                    |
| `Pagination`（5 份私有）                  | `Pagination`（DS）                        | 5 份               | admin 已部分换       |
| `PageSizePicker`（2 份）                  | `SegmentedControl`                        | 2 份               | admin 已部分换       |
| 各页 `*-toolbar`（13 处）                 | `FilterBar`                               | —                  | —                    |
| 页面骨架 `div` 三段式                     | `ListPageTemplate` / `DetailPageTemplate` | —                  | console 9 处已用     |

**判据**：props 形状已经对齐（`SummaryItem{icon,label,value,tags,tone}` vs
`MetricCard{icon,label,value,trend,tone}`），是机械替换，不需要设计决策。

### B · 提升后迁入 —— **owner 2026-08-05 收口**

**剩余 15 个列表页不迁 `MetricListCard`，保留在 admin，基于 DS 的原子件重构。**
理由：它们与业务耦合强；共享件应当等**第二个消费方**出现再建，而不是先造出来等人用。
已迁的四个（tenants / orders / billing / invoices）保持现状——它们已验证 `MetricListCard`
的形状成立，也为将来第二个消费方留下了参照。

`MetricListCard.note` 与 `modules/shared/status-tone.ts` 已落地（`5886d0da`），不作废：
前者是四个已迁页面在用的槽，后者是 admin 自己的映射表，本就该留在 admin。

下面原表保留作为背景，不再是待办。

| #   | admin 结构                               | 出现       | DS 现状               | 要补的                                    | 风险   |
| --- | ---------------------------------------- | ---------- | --------------------- | ----------------------------------------- | ------ |
| B1  | 带卡内指标的列表卡                       | 4 域 17 处 | `MetricListCard` 已在 | **先核实覆盖度**，可能零改动              | 低     |
| B2  | 状态点（无文字纯圆点）                   | 14 处      | `StatusBadge` 有徽章  | `dot` 形态（一个 variant，非新组件）      | 低     |
| B3  | 卡片形态的选中态                         | 13×3       | `DataTable` 只管表格  | `ListCard`/`MetricListCard` 的 `selected` | 中     |
| B4  | **卡表同源：一套列定义驱动表格行与卡片** | **170 处** | `DataTable` 只出表格  | `DataTable` 加 `cards` 渲染模式           | **高** |

B4 是盘点里的 A2，收益最大（170 处，几乎每个域）也最危险——做歪了变成谁都不敢碰的
巨件。**建议压到最后**：A 类做完后重新数一遍，很可能真实需求远小于 170。

### C · 新建

**目前一件都不需要。** 这是盘点之后的新结论——DS 的组件表已经覆盖到 admin 的所有
通用结构。真正 admin 独有的（权限树）属于 D 类。

### D · 不进 DS（业务语义，留在 admin）

| 结构                                                                | 规模                 | 处置                                                                                                             |
| ------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| pill 色调族（`--tier/--bill/--payment/--invoice/--ticket/--quota`） | 244 个选择器、3 文件 | **形状**用 DS `Badge`；**业务状态 → tone 的映射表**留 admin。DS 零业务语义是硬规矩，`tone.ts` 拒收业务状态是先例 |
| `vx-admin-permission-tree-*`                                        | 19                   | admin 独有治理形态，等第二个消费方出现再谈上提                                                                   |
| 各域一次性页面样式                                                  | —                    | 只在一个页面出现，是页面样式不是模式                                                                             |

---

## 五、顺序

原计划按"列表页（3.2）→ 详情页（3.3）"分批。**建议改为按重复度杠杆分批**——因为
`DetailField` 抄了 6 份、`SummaryItem` 抄了 8 份，它们横跨列表页与详情页，按页面切
会把同一次替换切成六次。

| 批    | 内容                                               | 状态                                                                                   |
| ----- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **1** | A 类重复定义 → DS 组件（实际 60+ 份，非 32）       | ✅ `ad33f26a` `11dd3d37` `394cfad4` `862207b7` + 页头修正 `9c7f815a`                   |
| **2** | B1 列表卡                                          | 部分：4 页已迁 + DS `note` 槽 + tone 映射表（`5886d0da`）；**剩 15 页 owner 决定不迁** |
| **3** | 页面骨架换 `ListPageTemplate`/`DetailPageTemplate` | ✅ 30 列表页 + 7 详情页；`ModelGrantsPage` 判定不适用，见 §十二                        |
| **4** | pill 色调族 → `Badge`                              | 进行中：商业域 5 页已收（见 §十三）；剩 ~19 族                                         |
| **5** | B3/B4（卡片选中态、卡表同源）                      | 未评估                                                                                 |
| **6** | 登录态视觉走查                                     | 未开始                                                                                 |

**列表本体的收敛另起一条线**：`admin-table-consolidation.md` —— 29 个手搓列表页约 3279 行，
按结构相似度分 T1–T5 五批（`rowTone` 曾作为唯一缺口补齐，后于 2026-08-05 owner 实测后退役——行的语气改由状态列表达，见 `950ac3ae`）。本份的批 3
（页面骨架）与批 4（pill）与之相邻但不同批：一次改动不跨两个语义面。

**A 类的实际规模是盘点的两倍。** 每一批都炸出同一族的三种形态：裸名定义、带模块前缀的
定义（`TenantSummaryItem` / `ProductPagination`…）、完全不封装的内联 JSX。**按函数名搜会
漏三分之二，类名口径才可靠**——A1 之后改用类名口径，后三批没再漏。

---

## 六、旧 CSS 的处置（需要 owner 认可）

owner 明确要求**不删**。但迁移后它们会变成纯死代码：选择器无人引用，且其中 34% 本就
失效。三种处置：

1. **原样留在 `styles/` 并继续 import** —— 构建产物里带着 12857 行死 CSS，且它们仍会
   参与选择器匹配（有撞名风险）。
2. **移到 `styles/_absorbed/`，从 `globals.css` 摘掉 import** —— 文件保留作为设计意图
   存档，不参与构建。**推荐这个**：满足"不删"，同时不让死代码影响运行时。
3. 删除 —— owner 已否决。

---

## 七、拍板情况

**① B4（卡表同源）做不做？** 未评估，留待批 5。

**② pill 的映射表放哪？** ~~待拍板~~ —— **已由既有文件回答**：
`@vxture/shared/status-tone.constants.ts` 早已存在，写明了为什么放 shared、为什么不放
`catalog-domains.constants.ts`，并划了边界——**只映射 shared 已经拥有值域的状态**，其余
"先有值域契约，再谈它的展示映射"。订单 / 账单 / 发票 / 对账态在 shared 里没有值域，
按这条规矩落在 `admin/modules/shared/status-tone.ts`。

真正待拍的是它的下一步：**哪些状态该向 shared 补值域契约**。那要等 pill 的 244 个
选择器盘完才有依据，属批 4。

**③ 旧 CSS 用第六节的哪种处置？** 仍待拍板。注意这已不只是"死代码"问题——见下节。

---

## 九、上线前必须知道的：迁移只覆盖了失效面的一角

第一节量到 admin 页面 CSS **33.9% 的声明失效**（1437/4234，103/145 个文件）。本轮迁移
换掉的是**重复组件**，不是整套页面样式：`vx-tenant-summary` / `vx-product-capability-*` /
`vx-tenant-pagination` / `admin-overview-heading` 等已彻底无人引用，但 `vx-tenant-directory-*`
（列表行栅格，170 处）、pill 族（244 选择器）、各域一次性页面样式仍在用，其中的失效声明
照旧失效。

**这不是本轮引入的**（`8ca6284e`，2026-07-31），上线不会让情况变差；已迁的部分反而是净
修复——例如列表卡的顶缘色条此前因失效变量根本没渲染，迁到 `MetricListCard` 后恢复了。

要把失效比降下去，靠的是批 3（页面骨架）与批 4（pill），不是继续迁列表卡。

---

## 八、验收（每批都要过）

- `pnpm --filter @vxture/admin type-check` 绿
- `pnpm lint:design` 不退化
- `pnpm --filter @vxture/admin build` 通过
- 该批涉及页面的登录态实际渲染核对（不是截图肉眼，是 DOM 结构遍历）
- 失效声明数复测：批 1–3 后重跑扫描，`33.9%` 应显著下降

---

## 十、取值层恢复（2026-08-05）—— 一次方向性纠偏

### 我误判了什么

本文第一节量到"33.9% 声明失效"之后，我把结论下成了「这些 CSS 是坏的，迁 DS 等于修复」，
于是一路做「判死 → 移出构建 → 存档」。**owner 保留 admin CSS 的本意不是存档留念**：
admin 原本是几个应用里视觉效果最好的，那套样式是资产，应当

1. 在 admin 内继续生效，且
2. 其中通用的部分沉淀进 DS。

我两条都没做，还把页面留在了"除 DS 组件外全是简单堆叠"的状态。

### 真实原因不是 CSS 坏了，是取值层被抽走了

`8ca6284e`（07-31）退役 legacy token 层时，把 admin 页面样式赖以取值的变量一并删了。
CSS 本身没问题——`var()` 找不到值，整条声明才 invalid。

**545 个缺失变量 100% 能从 git 取回**（`8ca6284e~1`），无一处需要臆造：

| 形态           | 数量 | 说明                                                     |
| -------------- | ---- | -------------------------------------------------------- |
| rem 裸值       | 283  | 待逐批换成 T1–T3 语义 token 的引用                       |
| 别名转发       | 210  | 保留不压平——那层记录了原设计的语义分层                   |
| px 裸值        | 29   | 同 rem                                                   |
| 其他（颜色等） | 23   | 其中 6 个 shell 色改指 DS 现存的**主题感知**语义色，见下 |

`--vx-shell-ink` / `-surface` / `-muted` 这类原本是亮 / 暗两份硬编码，或转发到同样已死
的目标。恢复时一律改指 DS 现存的 `--vx-color-shell-*`——主题跟随由被转发者负责，比恢复
两份硬编码更对，也正是"收敛到 tier 层"该走的方向。

### 落点：DS 的 `assets/`，不是 admin

守卫 `ds/no-app-vx-token-definitions` 规定「应用层不能定义 `--vx-*` token，要回收到
`@vxture/design-system`」。同时这些是 admin 的产品绑定层，不该混进 DS 的公共刻度
（`src/styles/`）。`assets/` 正是这类「DS 托管、单一产品消费」样式的既有位置——
`shell-template` 是同一先例。

    packages/design/design-system/assets/admin-tokens.css        ← 入口
    packages/design/design-system/assets/admin-tokens/tokens-admin.css
    package.json exports: "./styles/admin-tokens.css"

### 结果

失效声明 **1437 / 4234 (33.9%) → 0 / 3734 (0%)**。构建产物实测取到值
（`--vx-admin-directory-card-padding:1.5rem`）。

### 它是桥，不是终点

283 个 rem + 29 个 px 裸值应逐批换成 T2 引用，其中通用刻度（卡片内边距、列表行高、
菜单尺寸）值得沉淀进 DS——**这就是 owner 说的"沉淀在 DS 中"**。等 admin 页面 CSS 直接
用上 T2，`admin-tokens` 即可缩小直至消失，那才是 `8ca6284e` 写的
"Products converge to the tier layer in batches"。搭桥再过河，而不是拆了桥让人游过去。

## 十一、状态类与值域的对账（2026-08-06）

起因是一次"死代码排查"：CSS 里定义、tsx 里搜不到的类有 127 个。按类名整体比对会
误判——`vx-order-pill--payment-${status}` 这类是模板拼出来的，尤其带下划线的状态值
（`pending_verify`、`bill_cancelled`）不可能在 tsx 里以字面量出现。改成按前缀逐段
回退匹配后降到 19 个，那 19 个才是批 1 迁 DS 之后的遗留（`vx-btn` / `vx-empty-state` /
`vx-view-mode-switch` / `vx-page-header*`），已随本轮清理退役 213 行。

**判据记下来**：判断 CSS 类是否在用，必须考虑模板拼接。只做字面量比对会删掉线上正在
用的状态色，而且删掉之后页面只是"变灰"，不报错、不崩，测不出来。

余下 108 个逐条对了值域（权威：`@vxture/shared` 的 catalog-domains，以及 admin
`entities/console.ts` 的联合类型）。**没有一个是垃圾**，但对出三类真问题：

### 1. 缺色：状态有值，CSS 没有对应类

| 家族                                                    | 缺的值                                  | 后果                                                                                |
| ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `vx-order-pill--*`                                      | `paid_unprovisioned`、`partial_pending` | product_321 §4.2 新增的两个非终态，CSS 没跟上，标只剩基础样式，与正常订单看不出差别 |
| `*-pill--tier-*`（order / billing / subscription 三处） | `starter`、`business`                   | @shared 的 TIERS 是五档，admin 只写了 free/pro/enterprise，另两档掉进 `other` 灰色  |

第二条是等级色 L1–L5 的实证需求：五档里有两档在视觉上根本不存在。

**去向：批 4**（pill 族 → Badge + 业务状态映射表）。现在临时补 CSS，批 4 时还要拆。
tier 那条直接用已落地的 `--level-1..5`。

### 2. 契约漂移：admin 的订阅状态与 @shared 对不上

```
@shared（唯一权威）：active trialing overdue suspended expired  cancelled
admin 的类型与 CSS ：active trial    overdue suspended expiring cancelled
```

`trialing→trial` 是改名；`expired→expiring` 不是改名——"快到期"与"已过期"是两件事，
admin 侧因此**没有"已过期"这个状态**。CSS 只是跟着 admin 的类型走，根因在 view-model。

**去向：不属于 DS 线**，归 admin-bff view-model 那条（与 console-bff 的同类漂移一并处理）。

### 3. 前缀撞车：一个前缀被两个字段共用

```tsx
vx-invoice-pill--type-${invoice.billType}     // adjust / normal / prepaid / supplement
vx-invoice-pill--type-${invoice.invoiceType}  // electronic / paper / normal_vat / special_vat / other
```

两个值域挤在 `--type-` 下。今天没撞是因为值恰好不重名；将来任一侧新增同名值，颜色会
互相覆盖且无声。**去向：批 4 顺手拆成 `--bill-type-` / `--doc-type-`。**

### 同批的其他排查结论（均无问题）

- 111 份样式文件全在 `globals.css` 的 import 闭包里，无孤儿文件。
- 548 个 `--vx-admin-*` token 全部在用。
  **2026-08-06 复测已不成立**：534 个定义里 74 个无人 `var()` 引用，主要是
  `--vx-admin-platform-*`（33）与 `--vx-admin-overview-*`（32）。核对 git 后确认
  这两族在 HEAD 上就已经没有引用方，**不是 DataTable 迁移造成的**，归批 §十的
  桥收敛（任务 #34）一并清。T5 收尾自己产生的 14 个 `--vx-admin-governance-*`
  孤儿已随改动删除。
- 无人 import 的模块只有 `src/modules/shared/index.ts`（5 行空壳桶），已删。

## 十二、批 3 收尾（2026-08-06）—— 两页判定为不适用

`ListPageTemplate` 覆盖 30 个列表页、`DetailPageTemplate` 覆盖 7 个详情页。本轮补的四页：

| 页面                | 槽位映射                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `OpsTodosPage`      | header / summary / table（table 里是那个带 SegmentedControl 的 `Section`）    |
| `TicketsPage`       | header / summary / filters / table；抽屉与批量对话框留在模板外，用 `<>` 包    |
| `ServiceHealthPage` | header / summary（feedback + 自建的四张概览卡）/ filters（自建工具行）/ table |
| `TenantDetailPage`  | header（返回链接 + 可折叠概要，用 `<>` 包成一段）/ children（分页签主体）     |

**两页判定为不适用，不强套模板**：

- `PlatformAutonomyPage` 已经在用 `DashboardTemplate`——它是仪表盘不是列表页。此前把它
  列进待办，是因为那次扫描的口径是"有 `DataTable` 却没 `ListPageTemplate`"，口径本身错了。
- `ModelGrantsPage` 是**两张互相独立的表**（模型策略 + 覆盖授权），各自带工具行与分页。
  `ListPageTemplate` 只有一个 `table` 槽，把两张塞进去等于取消这个槽的语义，只包第一张
  则更糟。多列表页需要的是另一种模板，不是把这件撑大（owner 2026-08-06「宁可多建件」）。

**踩到的坑**：`TenantDetailPage` 有两个 `ViewLayout`——主体一个，`!tenant` 早退分支一个，
两处 className 完全相同。按"第一个 ViewLayout"定位会把文件从早退分支处截断。改动这类文件
前先数一遍同名根节点。早退分支保持 `ViewLayout` 不动：它是"未找到"占位，没有详情页结构。

## 十三、批 4 第一刀：状态标与分类标要分开算（2026-08-06）

动手前把 247 个 pill 选择器按**实际色值**聚了一次类，结论比"239 个选择器"这个数字有用得多：

| 色                        | 选择器数 | 是什么                                               |
| ------------------------- | -------- | ---------------------------------------------------- |
| `--tenant-amber`          | 61       | 状态 → `warning`                                     |
| `--vx-color-gray-500/600` | 62       | 状态 → `neutral`                                     |
| `--tenant-green`          | 44       | 状态 → `success`                                     |
| `--tenant-rose`           | 37       | 状态 → `danger`                                      |
| `--tenant-blue`           | 19       | 状态 → `brand`（沿用 `status-tone.ts` 的既定对应）   |
| `--vx-color-purple-600`   | 10       | **不是状态**：tier-enterprise ×4、product--model ×3… |
| `--tenant-cyan`           | 8        | **不是状态**：product--agent ×4、tenant--individual… |

**所以这一族其实是三样东西**，处置必须分开：

1. **状态标**（~217）→ `StatusBadge tone=`。语气表 `modules/shared/status-tone.ts` 早就有，
   本轮只补了 `PAYMENT_STATUS_TONE` 与 `QUOTA_RISK_TONE` 两张。
2. **等级标**（tier free/pro/enterprise，紫是 enterprise）→ 归 `--level-1..5` 阶梯。
   **等级是序不是语气**：DS 六档语气里没有"高一级"，套上去只会被读成状态。未做。
3. **分类标**（产品类型 platform/model/agent、主体类型、权限层 L1–L3）→ **留 admin**。
   业务分类不是语气，DS 零业务语义（§四D 早已这么写）。紫、青两色的存在理由就在这里。

### 本轮完成：商业域 5 页

`BillingPage` / `PaymentsPage` / `InvoicesPage` / `OrdersPage` / `SubscriptionsPage`
的账单态、发票态、订单态、支付态、对账态、订阅态、配额风险全部换 `StatusBadge`；
`admin-management-pills-commerce.css` 253 → 83 行。剩在页面里的 pill 只有分类标
（tier / type / tax / source / cycle），这是有意的。

**顺带修掉 §十一 的前缀撞车**：`vx-invoice-pill--type-` 原先被 `billType`
（adjust/normal/prepaid/supplement）与 `invoiceType`（electronic/paper/normal_vat/
special_vat/other）两个值域共用，`normal` 在两边都出现——今天没炸是因为恰好同色。
拆成 `--bill-type-` 与 `--doc-type-`。同时删掉 `.vx-billing-pill--type-*`：全仓无人引用。

**账单异常标的紫色没了**：调整单（蓝）与补录单（紫）原是两色，DS 无紫档，两者同归
`brand`。判据是它们本来就有"调整单""补录单"两个词，区别不必靠记颜色。

### 第二刀：纯状态族（2026-08-06）

四个族**整族都是状态**，页面里各有一个 `*PillClass()` 函数在拼类名，改动收敛在函数上：

| 族                          | 页面                                      | 改成                                                     |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `account-status-pill`       | `AccountsPage`                            | `ACCOUNT_STATUS_TONE` 表                                 |
| `admin-role-status-pill`    | `AdminRolesPage` / `AdminPermissionsPage` | `roleStatusTone()`                                       |
| `platform-user-status-pill` | `PlatformUsersPage`                       | `platformAdminStatusTone()` / `platformRoleStatusTone()` |
| `verification-pill`         | `VerificationsPage`                       | `VERIFIED_TONE` 表                                       |

换之前逐档查了原色，几处**不能想当然**的：`invited` 是蓝不是黄（邀请中不是异常）、
`pending`（平台用户）同理、`archived` 角色是黄不是灰（归档角色仍可能挂着人）、
`unverified` 是灰不是红（还没提交 ≠ 审核不过）。

### 复测

pill 引用 266 → 210 处，选择器 239 → 146 个，admin CSS 6484 → 6273 行。

### 还剩

**五个混合族**——状态、等级、分类挤在同一个前缀下，得逐档拆：

| 族                      | 档数 | 混了什么                                                                                                     |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `tenant-pill`           | 39   | 状态 + 类目（company/individual/member/owner/permission/product/quota/ticket）+ risk-\*/ticket-\* 两套子刻度 |
| `product-pill`          | 18   | 状态（active/draft/archived、access-\*）+ 类目（agent/model/platform/self/partner/data/service）             |
| `product-solution-pill` | 15   | 同上 + tier-\*                                                                                               |
| `service-plan-pill`     | 14   | 同上 + solution-\*                                                                                           |
| `product-plan-pill`     | 10   | 状态（active/inactive、public/private）+ 类目（agent/free/paid/function/quota）                              |

外加**等级标归 `--level-1..5`** 一项（`billing`/`order`/`subscription`/`product-solution`
四族的 `tier-*`，以及 §十一 的缺色 starter/business）。

### 第三刀：六档对应关系 + 产品四族（2026-08-06，owner 全部认可）

**先把六档的语义定死**（写在 `status-tone.ts` 头部，参照 Atlassian Lozenge——业界把
状态标切成六档的现成参照，与我们一一对得上；Ant Design 只有五档、缺 new 那一档）：

| 档      | 语义                         | 典型值                              |
| ------- | ---------------------------- | ----------------------------------- |
| neutral | 没有状态：未开始/归档/不适用 | archived, unverified, not_required  |
| brand   | 新来的，等人接手             | invited, 待激活                     |
| info    | **正在走流程的中间态**       | applying, auditing, sending, paying |
| success | 达成、正常、闭环             | active, paid, verified              |
| warning | 要留意，但还没坏             | trial, expiring, partial, 待审      |
| danger  | 坏了、被拒、被阻断           | failed, rejected, overdue           |

**`info` 此前一直空着**：前两刀的映射表是照 CSS 逐条抄的，而 CSS 里蓝只有一个，
于是所有蓝都写成了 `brand`。按上表回头改了 7 处——发票的四个"…中"（申请中/审核中/
寄送中/已开票）原先全是黄，等于告诉运营有四件事要处理，实际它们是流程在走；
账单 `paying`、支付 `pending`/`refunding` 同理。

**产品四族合成一张表**（新文件 `modules/shared/publish-tone.ts`）。逐档比色后发现
`product` / `product-solution` / `service-plan` / `product-plan` 的状态档**一字不差**
——active 全绿、draft 全黄、archived 全灰、public 全绿、internal 全灰。四个前缀装的是
同一张表，分开写不是在区分什么，是抄了四遍。

同时收敛两处原设计的不一致：

- **「不公开」两个词两个色**：套餐版本 `private` 标黄，方案与服务套餐 `internal` 标灰。
  统一到 `internal`/灰——不对外可见是一种归属，不是需要留意的信号。
- **类目色里有一个红**：产品类型原是 platform=蓝 / model=紫 / agent=青 / data=绿 /
  service=**红** / self=灰 / partner=黄。「服务类产品」的红会和「订单逾期」的红在同一屏
  抢读。**类目一律 `neutral`**（`categoryTone()`）：并列的类目没有严重度，靠文字与图标分。

顺带查出**接入态 CSS 定义了 8 档、值域只有 4 个**——`ready`/`draft`/`partner_config`/
`policy_missing` 是更早一版值域的残留，退役。新表里另纠两处：`testing`（测试中）→ `info`，
`not_required`（无需接入）→ `neutral`，它不是一项达成。

`admin-management-pills-products-service-plans.css` 清空后删除。

**复测**：pill 引用 266 → 173 处，选择器 239 → 93 个，admin CSS 6484 → 6087 行。

### 第四刀：拆掉 `vx-tenant-pill` 这个漏斗（2026-08-06）

39 档、12 个值域共用一个前缀，`.vx-tenant-pill--active` 一条规则同时是「租户正常」
「成员在职」「订阅生效」「模型已启用」。按值域拆成 6 张表（新文件
`modules/shared/tenant-tone.ts`）。

**按值域拆表立刻逼出四个缺口**，全是 `Record` 报出来的，肉眼看不到：

1. **成员态 `invited` 没有颜色**——值域三个值，CSS 只画了两个，已邀请未加入的成员
   一直是默认样式。归 `brand`（新来的，等人接手），与账号态的 `invited` 同档。
2. **策略态 `disabled` 没有颜色**——值域四个值，CSS 画了三个。归 `neutral`：
   "关掉了"不是"配错了"，与 `undefined`（没配）的红分开。
3. **租户详情页的订阅态和订阅列表页不是一个值域**：这里是
   `TenantOperationSubscription.status`（trial/active/**past_due**/cancelled），
   那里是 `SubscriptionOperationStatus`（…/**overdue**/…）。同一件"欠费"两个名字。
   这正是 TD #33 的契约漂移——此前两边都往同一个 CSS 前缀里塞，撞不出来。
   本轮只如实建表，改名连 BFF 与 view-model 一起动，仍归 #33。
4. **`past_due` 不是死档**——我先前按"类名全仓 0 引用"判它已死，错了：它由模板拼接
   产生（`--${subscription.status}`），字面量搜不到。判死码必须考虑模板拼接，
   这条 `admin-table-consolidation.md` 已经记过一次，这里又踩。

**另一处自我纠正**：`modules/tenants/tenant-utils.ts` **早就有**
`TENANT_STATUS_TONE` / `VERIFICATION_TONE` / `TENANT_RISK_TONE` 三张表，而且已经在用
`info`（试用=进行中、待审=流程中）。我一度重建了同名表，且此前说"`info` 从来没被
用过"——那只对 `status-tone.ts` 成立，说过头了。重复的已删，调用点改指既有表。

**复测**：className 用法 266 → 40 处，选择器 239 → 50 个，admin CSS 6484 → 5977 行，
`admin-management-pills-directory.css` 清空后删除。剩下的 40 处全是**分类标与等级标**
（`--source` / `--cycle` / `--tier-*` / 权限层 L1–L3 / 产品能力 mode·tag / 角色 api·menu·button），
按定好的规矩它们本就留在 admin。

### 第五刀：等级标归 L1–L5（2026-08-06，批 4 收尾）

`tier-*` 是这一族里最后一类。**等级不走六档语气**：语气说严重度（好/要留意/坏），
等级说的是别的东西。把 enterprise 映射成 `danger` 或 `brand` 都不对——前者说它出事了，
后者说它是新的。

**第一版做错了，owner 实测后改。** 我先把五档挂在 DS 的 `--level-1..5` 上
（brand-200 → brand-600 逐级加深），结果**文字看不清**：那条阶梯是给色块用的，中间
几档底色已经压下来、前景却还是深字。更要紧的是**五级深浅并没有对应五件事**。

真正要一眼分出来的是**三类客户**：

| 档                       | 是什么       | 表现            |
| ------------------------ | ------------ | --------------- |
| free                     | 还没付费     | 中性描边        |
| starter / pro / business | 云端付费客户 | 品牌淡底        |
| enterprise               | 私有化大客户 | 品牌实底 + 白字 |

三档正好落在 DS `Badge` 已有的三个 variant 上（`outline` / `secondary` / `default`），
配色与对比度由 DS 自己保证——`styles/admin-level-badge.css` 因此不必存在，建了又删。
判据：**先问要分出几件事，再挑表现**；反过来"有一条五级阶梯所以用五级"是拿手段找问题。

**§十一 的缺色一并补齐。** `@vxture/shared` 的 `TIERS` 是五档（free / starter / pro /
business / enterprise，product_220 §1），admin 此前只认三档，starter 与 business 一起
掉进 `other` 的灰——五档里有两档在视觉上根本不存在。现在 `Record<Tier, TierLevel>` 全覆盖。

**筛选下拉是同一个根因，一起收**：此前只有 free/pro/enterprise/其他 四项，starter 与
business 无法单独筛。改成由 `TIER_FILTER_OPTIONS` 数据驱动，五档各自成项；「其他」保留
但含义变窄——只兜不在 `TIERS` 里的自定义套餐名。三页（账单/订单/订阅）各自那份
`tierFilterValue()` 一并退役，收敛成 `tierFilterOf()`。

认不出的套餐名返回中性标而不是 L1：标成最低档等于谎报它的位置，宁可不着色。

**批 4 收官复测**：className 用法 266 → 35 处，选择器 239 → 34 个，
admin CSS 6484 → 5953 行，期间删掉 6 个清空的 CSS 文件。剩下的 35 处全是分类标
（`--source` / `--cycle` / 权限层 L1–L3 / 产品能力 mode·tag / 角色 api·menu·button），
按「分类不给语气色、留 admin」的规矩，它们本就该在。

---

## §十六 测试数据：从"9 张叶子表"到"主干整图"

### 起因

批 4 的语气改动改的是**状态**的颜色，而 admin 本地库里几乎所有状态都只有一两个取值
——没有数据就无从验证。第一版补数据（`seed-bulk.mjs`）灌了 9 张表各 100 行，看起来
交差了，但那 9 张全是**叶子表**：公告、特性开关、维护窗口、流水、券核销、用量月表、
续费、邀请、发票回执。它们不被任何表按外键引用，随手灌就能满。

主干原样没动：**租户 5 / 用户 5 / 订阅 4 / 工单 4 / 技能 0**。owner 当场点破。

偷懒的真实原因是主干表**互相引用**：用户 → 租户 → 工作区 → 成员 → 订阅 → 账单 →
支付 → 工单，必须按依赖顺序生成一整张一致的图，比灌叶子表贵得多。

### 系统性盘点方法

不靠肉眼翻页，用两步机检定位"哪些页面没数据"：

1. 正则扫 `bff/admin-bff/src/routers/*.ts` 里所有 `from|join|into|update <schema>.<table>`
   → 得到 **BFF 实际触及的 48 张表**；
2. 对活库逐表 `count(*)`，与第 1 步做 join。

只有这个交集才是"页面没数据"的准确集合——全库 138 张表里 69 张是空的，但其中大部分
根本没有页面在读，为它们造数据是白费。

### 结果

新增 `deploy/database/seed/seed-bulk-core.mjs`（⑤ 主干批量种子，`pnpm db:seed:bulk-core`），
UUID 段 `d000`（catalog=a000、demo=b000、bulk=c000）。执行顺序：

    catalog → sample → demo → **bulk-core** → bulk

bulk-core 排在 bulk 之前是有原因的：bulk 里的模型授权受
`uq_model_policies_model_tenant` 约束，租户与模型各只有 5、6 个时天花板是 30 行，
主干铺开后重跑才到 100。

BFF 触及的 48 张表中,**41 张 ≥20 行**。剩 7 张逐张有判据,不是漏掉的：

| 表                           | 行数   | 判据                                          |
| ---------------------------- | ------ | --------------------------------------------- |
| `admin.governance_record`    | 不存在 | **BFF 在查一张没有 DDL 的表**，缺陷不是缺数据 |
| `admin.settings`             | 1      | 单例配置表                                    |
| `access.roles`               | 10     | 角色目录，属治理数据不批量造                  |
| `admin.operator_role`        | 8      | 同上                                          |
| `product.products`           | 18     | owner 定的口径（从 website appcenter 取）     |
| `product.product_webhooks`   | 16     | 主键即 product_id，**上限等于产品数**         |
| `product.product_categories` | 100    | 已补（三层树，id 占 500 段）                  |

技能市场 0 条是**另一类问题**：`skills.router.ts` 通篇 32 行，`listSkills()` 直接
`return []`，注释写着"数据层待接入"。没有表，也就没有数据可造——归 #35 占位路由。

### 造数据的两条硬规矩（都是踩出来的）

**① 值域必须对着库里的 CHECK 抄，不能照页面猜。** 第一版公告类型编了
`release`/`policy`，而 BFF 的 `ANNOUNCEMENT_TYPES` 只认 system/maintenance/marketing/
security。`mapAnnouncementRow` 对认不出的值**静默退回 `system`**，于是 50 行错数据在
界面上毫无异样、全都好端端显示成"系统"，是去查 API 才发现的。

这个兜底模式在 BFF 里有 13 处（`admin-roles` / `commercial` / `payments` / `tickets` …）。
它防的是崩溃，代价是**把错数据显示成一条看起来正确的信息**。而 `announcement_type`
列上并没有 CHECK 约束，数据库那道闸也是开的。两个收口方向待 owner 判：兜底改成显示
原值（错就露出来），或给列补 CHECK（错数据写不进去）。倾向后者，归 #33。

**② 有默认值 ≠ 可以传 null。** `model_price_rules.request_unit_price` 有默认值但仍是
NOT NULL，显式传 `null` 会顶掉默认值直接违约。批量插入时"不关心的列"要么整列不写，
要么给真实值，不能传 null 占位。

### 顺带记下的展示层缺陷

**工单状态是有损映射**：库里 7 个状态（open/pending/in_progress/resolved/closed/
reopened/cancelled），`normalizeTicketStatus` 只映到 4 个，`resolved`/`reopened`/
`cancelled` 全被最后那句 `return "closed"` 兜成"已关闭"。**重开的工单显示为已关闭**，
这是错误信息不是降级显示。种子按库里的 7 个值造，不迁就展示层。

---

## §十七 会话为什么会过期（走查中断的原因）

走查走到一半 admin 跳回登录页。两套会话寿命差两个数量级：

| 会话                       | Redis key            | 寿命                                         |
| -------------------------- | -------------------- | -------------------------------------------- |
| RP 会话（admin-bff 自己）  | `vx:rp:admin:sess:*` | **30 天固定**（`RP_SESSION_TTL ?? 2592000`） |
| OP 会话（auth-bff 登录态） | `vx:sess:*`          | **空闲 30 分钟** + 绝对 8 小时（见下）       |

    OPERATOR_SESSION_IDLE_TTL = 1800    # 30 分钟无活动即失效
    OPERATOR_SESSION_ABS_TTL  = 28800   # 8 小时绝对上限，续不动

实测证据：Redis 连续运行 3 天没重启，10 个 admin RP 会话 TTL 全在 240 万秒以上、
**一个都没过期**；同期 OP 侧只剩 2 个 `vx:sess`。断的不是 RP 会话，是上游 OP 会话。

**"空闲 + 绝对"双闸这个设计本身是对的**，问题不在参数值，在于**谁来 touch 它**：

`touchOidcSession` 只在 admin-bff 回 OP 换票时才被调到，而 admin-bff 有自己的 30 天
RP 会话，**日常请求根本不回 OP**。于是 OP 的空闲计时器看不见用户正在 admin 里连续
操作——人一直在用，OP 却按"闲置 30 分钟"把会话掐了，下一次换票时 302 回登录页。

即"空闲"判据取自错误的观测点：它观测的是 RP↔OP 之间的换票频率，不是用户活跃度。

三件事可做，均待 owner 判：

- RP 侧在用户活跃时主动 touch OP 会话（心跳或随换票节奏前移），让空闲判据看见真实活跃；
- RP 会话 TTL 别比它代表的登录态活得久——30 天 cookie 对 8 小时上限的会话是摆设；
- 静默 302 改成可感知：续期提示或到期前静默刷新，现在是操作到一半整页跳走。

本地走查期间在 `.env.local`（已 gitignore）临时置 `OPERATOR_SESSION_IDLE_TTL=28800`
与绝对上限齐平，只为不让走查每半小时中断一次；生产不受影响。

### 补：数据到位后仍然为空的，是另外两类问题

主干灌满后复测，各主列表端点均返回 100+ 行（tenants 105 / accounts 105 /
subscriptions 104 / tickets 104 / orders 104 / payments 107 / invoices 100 /
platform-admins 101 / risk-records 103 / compliance-events 103 /
notification-logs 106）。但**租户页的 4 张 KPI 卡与 3 个表格列依然是 0**。查了才知道
和数据无关——`tenants.router.ts:698` 起把它们**写死**了：

```ts
// 以下跨域聚合（billing/metering/product/support）此读路径不覆盖，按契约占位。
adminCount: 0, subscriptionCount: 0, productCount: 0, monthlyRevenue: 0,
monthlyCost: 0, grossMarginRate: 0, tokenUsed: 0, tokenQuota: 0,
ticketOpenCount: 0, satisfaction: 0, sla: "未设置",
riskLevel: "normal",   // 退役 tenant_setting 无后继（tickets 同口径）
```

"试用租户 0" 是同一类但更彻底：`tenancy.tenants.status` 的 CHECK 只有
active/suspended/deleted，**库里根本不存在 trial 这个态**，`normalizeStatus` 的注释也
写着"无 trial 来源"。这张卡片统计的是一个不存在的值域成员，永远是 0。

所以"页面没数据"实际是三类，混在一起看就会误判：

| 类别           | 症状                     | 归属             | 本轮处置              |
| -------------- | ------------------------ | ---------------- | --------------------- |
| ① 数据缺失     | 列表只有个位数行         | seed             | **已修**（bulk-core） |
| ② 字段写死占位 | 列表有行，某几列恒为 0/— | BFF 读路径未实现 | 待办，见下            |
| ③ 整个路由是桩 | 页面全空                 | 无表 / mock 常量 | 归 #35                |

③ 的完整清单：`skills.router.ts`（`return []`，无表）、products 的
solutions / service-plans / releases / model-policies（三个 mock 常量数组，
`products.router.ts:54/315/502`，去 mock 被产品目录设计阻塞）、
`admin.governance_record`（**BFF 在查一张没有 DDL 的表**）。

② 需要 owner 判的是口径而不是工时：租户列表要不要为了几个统计数字去 join
billing/metering/support 三个域（列表页 N+1 的代价），还是把这些数字从列表挪到详情页。
现在的状态是最差的一种——**位置留着、永远显示 0**，看起来像数据错了。

---

## §十八 登录态视觉走查（#23）

数据铺满之后才做得动——此前每页只有个位数行，状态色根本铺不开，看不出对错。

### 已走过的页与所见

| 页       | 行数 | 结果                                                           |
| -------- | ---- | -------------------------------------------------------------- |
| 消息公告 | 100  | 类型/状态色对；**造错 50 行类型被静默吞成"系统"**（见 §十六）  |
| 租户信息 | 105  | 状态/认证铺开；**4 张 KPI 卡 + 3 列恒为 0**（BFF 写死，#38）   |
| 账号体系 | 105  | **状态标出现双勾**（已修）；加载态谎报 0（#41）                |
| 工单中心 | 104  | **状态列整列失效、全灰**（已修，见下）                         |
| 收款管理 | 107  | 批 4 的语气改动在这页最全：支付中=蓝 / 线下待核=琥珀 / 失败=红 |
| 订单管理 | 104  | 状态按档分组正常；「业务方案」整列未设置（方案仍是 mock，#35） |
| 实名认证 | 70   | 四态铺开，通过率 40%                                           |
| 功能开关 | 91   | 正常（默认过滤已归档 9 条）                                    |
| 维护窗口 | 100  | 正常；**严重度「一般」原为绿，owner 判改中性**（已改）         |
| 平台角色 | —    | **状态标双勾**（已修）                                         |

### 修掉的三类缺陷

**① 图标渲染两次。** `accounts` 与 `admin-roles` 的状态标同时传了 `icon` 属性又在
children 里手写了一遍 `<Icon>`，于是"✓✓ 正常"。迁移时加了属性没删旧标记。

**② 工单三枚标共用一个 `ticketTone()`。** 那个函数同时看 priority 和 status，
于是「待处理」被 p0 染成红——**一枚标同时说两件事**，读者无从判断红的是"很急"
还是"出事了"。拆成状态 / 优先级 / 行业三路取色，优先级新建 `TICKET_PRIORITY_TONE`
（紧急度恰好就是语气表达的东西，与套餐档不同——那里五档是商业分类，见
`tier-level.ts`）；行业是类目，走朴素 `Badge`。

**③ 严重度的绿与状态的绿撞义。** 同一页里「一般严重度」和「已完成」都是绿，而
六档里 `success` 的语义是**达成**。低严重度不是一项达成，改中性（owner 判）。

### 顺带定的一条 DS 规矩

`toneIcons.neutral` 从 ⓘ 改为短横（owner 判）。ⓘ 说的是"这里有信息"，`neutral`
说的是"没有状态"，两者对不上——「已停用」「已作废」「未认证」顶着一个不表达任何
东西的信息图标。短横占住图标位保持横向对齐，但不再声称有信息可读。顺带解掉一处
撞车：改之前 `neutral` 与 `info` 用的是同一张图，两档只靠颜色区分。

### 最有价值的一条：**pill 遗留类大面积失效**（#42）

工单页三种状态实测计算出来是同一个蓝灰。查下来是两条独立机制叠加：

1. **文字色全失效**：`Badge variant="outline"` 带 `text-foreground`，Tailwind 的
   utilities 层压过 admin CSS 的 `layer(components)`。**每一枚 pill 的文字色都
   没生效**，无论哪个修饰符都是近黑。
2. **一半背景色被基类压死**：outline 不设背景，背景归 pill CSS 管；但基类
   `.vx-tenant-pill` 自带背景，在 `globals.css` 排第 34 行，而 `admin-management.css`
   （含 commercial / invoice / order / payment / subscription / billing 全部色调）
   在第 32 行——**同层、同特异度，后写的赢**。排在基类之后的族（admin-roles /
   permissions / directory / governance / operations，37–40 行）反而正常。

这直接推翻了批 4 收尾时的一个结论：当时判定"剩下 35 处全是分类标，本就该留"。
其中排在基类之前的那些**根本没在显示**，是死类不是保留项。

**方法论**：判死码不能只看引用。此前踩过模板拼接那条（`--${status}` 搜不到字面量，
§十三），这次是反面——类名有引用、文件有导入、选择器也匹配得上，**只有量计算样式
才知道它被压掉了**。两条合起来：静态搜索既会漏报也会误报，视觉走查不可省。

### 批 4 补漏：把真坏的两族收掉（#42 第一步）

`globals.css` 的 `layer(components)` 导入序共 12 位，基类 `admin-management-pills.css`
在第 6 位。**第 1–5 位定义的色调修饰符全被基类的背景压死**，第 7–12 位的正常。
逐文件核下来只有两族在死区：

| 族                          | 修饰符 | 调用点                                |
| --------------------------- | ------ | ------------------------------------- |
| `vx-commercial-pill--*`     | 8      | `CommercialUtils.Tag`（商业三页共用） |
| `vx-model-provider-pill--*` | 2      | `ModelPlatformPage` 厂商标            |

其余 25 个修饰符背景是活的——但**文字色六族全死**（`Badge` 的 `text-foreground`
在 utilities 层，压过 `layer(components)`），所以它们实际只剩背景在起作用。

处置：两族退役。`Tag` 改出 `StatusBadge`（`normal`→success / `warning` / `danger` /
其余→neutral），厂商标是类目改朴素 `Badge`。删掉
`admin-management-commerce-commercial-pill-tones.css` 整个文件与它的 `@import`，
以及 model-provider 两条规则。顺带删了零调用点的 `tierTone()`（`tier-level.ts` 的残留）。

**中途踩的一个坑值得记**：第一版让 `Tag` 自己按 `tone === "muted"` 判"这是类目"
走朴素 Badge。当场就错了——`statusTone` 的 `paused`、`billStatusTone` 的 `cancelled`
返回的也是 `muted`，于是「已暂停」「已作废」被当成类目画。**语气名不携带"是状态
还是类目"这个信息，只有调用点知道**，组件不该猜。改成 `Tag` 一律出状态标，四个
真类目（投放范围 / 优惠类型 / 计量单位 / 产品类型）在调用点直接用 `Badge`。

**连带炸出两个**（用量计费页）：

1. **第三处双勾**。风险列的图标当年因为"`Tag` 只收文字"而并排挂在标外面；`Tag` 改出
   `StatusBadge` 后自带语气图标，外挂那个就成了第二个勾。删外挂，`riskIcon()` 一并退役。
   这与 accounts / admin-roles 两处同源：**迁移到自带图标的组件时，要回头删调用点
   原来自己画的那个**。
2. **空徽章**。计量单位缺失时渲染出一个什么都不写的小圆圈（BFF 对无单位计量项回空串）。
   缺就不画。

剩下的 25 个修饰符（发票三族 / 订单来源 / 收款来源 / 订阅周期 / 产品能力 mode·tag /
角色 api·menu·button / 权限层 L1–L3）背景仍在生效、文字色不在，**整族退役是更大的
视觉改动，另议**。方向倾向退役：它们按分类学都是类目，本就该是朴素描边标，退役后
这套"顺序决定生死"的脆弱性也一并消失。

---

## §十九 走查续：两次清理叠出一个线上回归（#42 之外的发现）

权限策略页的表头塌成一列——七个列名竖着排。查下来不是一次失误，是**两次各自
讲得通的清理叠在一起**：

1. `5f91f314`（08-05）按"tsx 里已无引用"归档 22 个样式表。逐个复核发现
   **4 个仍有活选择器**：`admin-permissions-tree`（表头网格）、
   `admin-permissions-tree-node-detail`、`admin-roles-auth-dialog`（7 个类，整个
   授权对话框）、`admin-roles-cards`。
2. 样式表一离开构建，它引用的 token 就显得无人使用，于是后一次 token 清理顺手
   删掉 9 个。**只恢复 CSS 不够**：`grid-template-columns` 引用未定义变量属
   invalid at computed-value time，`display:grid` 回来了、列还是塌的。

9 个值取自 `8ca6284e~1`——`tokens-admin.css` 文件头记着**同一类事故的上一次**
（07-31 退役 legacy token 层，"栅格塌成单列、间距归零"），那次按同一来源恢复了
545 个变量并写明"无一处臆造"。这 9 个是那次的漏网。**按命名推是会推错的**：
`track-22r` 看着像 2.2rem，git 里是 22rem。

判据沉淀：**判死码不能只看引用**。此前踩的是模板拼接（`--${status}` 搜不到字面量，
§十三），这次是反面——类名有引用、文件有导入、选择器也匹配得上，但层叠顺序或
token 缺失让它不生效。静态搜索既会漏报也会误报，只有量计算样式才作数。

## §二十 UUID 不外露：核销台账补编号

核销台账主列摆着一张 UUID。owner 定的规则是**UUID 只走内部，对外一律 `*_no`**，
而 schema 里这条规则已有 25 处实现（tenant_no / user_no / bill_no / pay_order_no /
ticket_no / order_no / refund_no…），只有 promotion 域一个都没有——`56_promotion.sql`
自己的表头还写着"vouchers.code 为可视码，永不作 FK 目标（铁律二）"。

**修的方向差点错**。第一版我把主列改成显示券码——那是在展示层绕开缺陷。规则给出
之后才看清：问题不是"该显示什么"，是**表里缺一列**。加 `redemption_no` +
唯一约束，`98_column_locks.sql` 把它放进锚而不是可更新列（编号一经生成不改）。

种子还得把核销行挂到同租户的账单明细与订阅上，否则整条链断在第一环：优惠金额走
`invoice_item_id → invoice_items.bill_id → invoices.discount_amount`，不挂就是整列
¥0.00 + 「未关联订单」，而这正是这张台账要看的东西。关联按 `tenant_id` 而不是按
序号——核销行由工作区推出租户，与主干种子编号不同序，算术猜会错配到别人的账单。

顺带全仓核了一遍：UUID 外泄只此一处。

## §二十一 一类缺陷：把未知与失败显示成事实

走查里反复撞见同一件事——界面拿一条看起来正常的信息，覆盖掉一个未知或一次失败。
四种形态，四种改法：

| 形态           | 实例                                 | 改法                    |
| -------------- | ------------------------------------ | ----------------------- |
| 吞异常         | 运营总览裸 `Promise.all` 无 `.catch` | 逐路兜底 + 降级提示     |
| 失败说成没匹配 | 模型授权、atlas                      | 失败态与空态分流        |
| 加载中断言 0   | 26 个列表页的 KPI 卡                 | `MetricGrid` 加 loading |
| 筛选背锅       | 审批中心 / 任务调度 / 密钥管理       | 按筛选是否生效分流      |

**总览那条最重**：七路 `Promise.all` 没有 `.catch`，Atlas 一挂七个 setter 全不执行，
六份数据静默停在初始空值，界面显示成"平台确实没有模型/方案/发布"，同时抛两条未处理
拒绝。而 `fetchDevServices` 单独挂了 `.catch`——有人知道其中一个会失败，却没管整条链。

**假字段是同一病灶的另一面**：`redemptionNo: row.id`、`actionLabel: row.action`——
契约里留了字段没有真实来源，就拿手边的值顶上。前者顶的是 UUID（违反 §二十 的规则），
后者顶的是它自己（标题与描述逐字相同）。没有译名就不装作有，字段退役。

**正面样板**（改的时候照它们，不用另发明）：`/platform` 的"模型资源读取失败 /
Atlas is unavailable"、运营总览两张卡的"状态 待建设"、字典管理与通知渠道的
"待建设模块"——都明说，不假装。

**口径改过一次**：加载态起初判"页面自己传 `loading ? "—" : n` 即可，不必给 DS 加
API"。实际是 26 页 × 4 张卡，**漏一个就是一页在谎报**，一个组件开关的面积远小于
八十多个调用点。这是"必要才提升"的必要。用横杠不用 0——「还不知道」和「是零」是
两个断言。

## §二十二 同一个错犯到第四次就该上护栏

双图标（`icon` 属性 + children 里手写同一个 `<Icon>`）在 accounts、admin-roles、
usage-metering、platform-admins 各出现一次。根因一致：**迁到自带图标的组件时，
调用点原来自己画的那个忘了删**。

第四次之后加了 `ds/no-duplicate-status-badge-icon`。**规则不验一次就不算加上**——
把缺陷注回 `PlatformUsersPage` 确认它精确报在 `:261`，还原后全绿。一条永远不报的
规则和没有规则没区别。

同类还有一处值域分叉：风险档的 `normal` 在 `tenant-utils.ts` 是 `neutral`，而
`RiskRecordsPage` 自己另写了个 `levelTone()` 返回 `success`——**两张表对同一个值域
说了两种话**。改成复用权威表。这与批 4 拆 `vx-tenant-pill` 十二路是同一条规矩：
同一值域只该有一张表。

---

## §二十三 会话模型定稿（#40）

§十七 记的是症状。这一节记目标形态——它是 owner 与我来回四轮之后定的，中间我给出过
两个错的设计，错法都写在下面，因为错的方式比结论更值得记。

### 根因：三个时钟缠在一起，两个测在错的地方

| 时钟         | 回答什么           | 该由谁测                         |
| ------------ | ------------------ | -------------------------------- |
| 凭证时效     | 一张票据被接受多久 | OP。爆炸半径旋钮，**对人不可见** |
| 在场（闲置） | 人还在不在         | **页面**——人坐在它前面           |
| 总时效       | 一次身份证明管多久 | OP。从认证起算，**不因活动延长** |

今天的实现让 OP 以"空闲"的名义管一件它测不到的事：它看不见用户点击，只看得见换票。
于是修 `touchOidcSession`、加心跳、调阈值，**都是在让 OP 更努力地猜一件它没有信息去
判断的事**。

### 走过的两条弯路

**弯路一：把在场定义成"发出过 HTTP 请求"。** 这只是把 OP 的错误换个地方再犯一遍——
"换票频率"和"请求频率"都是代理指标，都不是在场。一个人读长表格、填长表单、对着屏幕
想事情，全程在工作、一个请求都不发，按这个设计会被当成闲置。

**弯路二：给到期加"要不要继续"弹窗。** owner 判：一直在操作的人被定期打断是荒谬的。
更根本的是，**弹窗确认是 UX 惯例（主要来自网银），不是安全要求**——NIST 800-63B 通篇
没有任何地方要求它。把惯例当必需品，是我这一步的错。

### 定稿

| 时钟   | 值      | 行为                                           |
| ------ | ------- | ---------------------------------------------- |
| 闲置   | 30 分钟 | 与页面无交互即计时，到点**静默登出**，不问不弹 |
| 总时效 | 24 小时 | 从登录起算，不因活动延长                       |
| 凭证   | 15 分钟 | 后台静默换票，对人不可见                       |

两个时钟在登录时同时重置。运营员需要理解的全部内容：**离开半小时要重登；每天登一次。**

### 为什么总时效是 24 小时而不是 8 小时

owner 的诉求是**连续工作不能被打断**。这个诉求与标准并不冲突——冲突的是 8 小时这个
取值，它正好卡在一个工作日的长度上，必然切断正在干活的人。

NIST 800-63B AAL2：总时效 SHALL 存在、建议 ≤ 24 小时；闲置建议 ≤ 1 小时。抬到 24 小时
之后，连续操作一整天碰不到总时效（业务不中断、不提示），而会话仍有确定终点，不会因为
有人一直点就无限续下去。**两边都满足。**

顺带：定稿的两个值都比 AAL2 的建议上限更严（30 分钟 < 1 小时，24 小时 = 上限）。

### 已知边界：切到别的标签页会被判闲置

交互事件只在页面获得焦点时触发。运营员切去查资料或开会，页面收不到交互，30 分钟后
照样登出——**哪怕人一直坐在电脑前**。

这不是缺陷，是这类机制的固有边界：**任何应用都无法区分"人去开会了"和"人走了"**，
而标准防的正是 unattended terminal。AWS / Azure / Salesforce 全部按"与本应用的活动"
计时，业界共识是接受它。

两个必须做对的细节：

- **后台定时器与轮询一律不算活动**——这正是会话被养成不死的原因（console 的 2s 轮询
  就是这个毛病）。定时心跳按秒发，人在不在都发，它不是在场信号。
- **切回来的那一刻算活动**——focus + 交互立即重置，29 分 59 秒回来也不掉。

### 实施顺序

1. 闲置钟移到门户，由真实交互事件驱动；OP 不再猜
2. OP 侧 `OPERATOR_SESSION_IDLE_TTL` 退役，`ABS_TTL` 8h → 24h 并成为唯一的 OP 侧时钟
3. `touchOidcSession` 删除——目标形态里没有"续期"这个动作
4. RP 会话的 30 天 TTL 消失，会话由两个时钟共同界定

跨门户影响：console / website 共用同一套 OP，模型同样成立（在场归各自门户管），但 C 端
的闲置阈值通常宽得多，取值需各自定。**这一条尚未调研，不当结论。**
