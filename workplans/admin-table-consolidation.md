# admin 列表收敛到 DS DataTable —— 分析与排期

**上游**：`admin-ds-adoption-plan.md`（admin 接入 DS 的总规划）。那份的批 1/2 收的是
**重复组件**（指标卡、详情字段、分区标题、分页），本文收的是**列表本体**。

---

## 一、盘点

**29 个手搓列表页，约 3279 行行渲染代码。** 它们用到的能力，对照 DS `DataTable`：

| 能力       | 用量  | DataTable                               |
| ---------- | ----- | --------------------------------------- |
| 表头       | 29/29 | `columns[].header` ✅                   |
| 行操作菜单 | 26/29 | `rowActions` ✅                         |
| 序号列     | 25/29 | `indexStart` ✅                         |
| 整行点击   | 20/29 | `onRowClick` ✅                         |
| 选择框     | 19/29 | `selectedKeys` + `onSelectionChange` ✅ |
| **行语气** | 15/29 | `rowTone` 曾补、后退役，见 §三          |
| 卡片视图   | 6/29  | 与 list 是两段独立渲染，互不阻塞        |

## 二、结论：参数多不是障碍

`DataTable` 有 25 个 props（写这一节时是 20），**必填只有 3 个**（`columns` / `rows` / `rowKey`）。唯一在用它的
`ServiceHealthPage` 实际只传了 4 个：

```tsx
<DataTable
  className="…"
  columns={columns}
  rows={services}
  rowKey={(s) => s.id}
/>
```

其余是**可选能力目录**，用不到就不写。因此**不拆分组件**——拆开会把"这张表长什么样"
变成必须逐件去推，`MetricListCard` 当初没做成 `ListCard` 可选槽正是同一判断。

> **2026-08-06 修订。** 上面这条只对**与表体同生共死**的部分成立（选择列、序号列、
> 操作列——它们必须和表格一起画）。owner 当日定下 DS 的两条规矩：只提升必要的、
> 宁可多建件也不要把一件做复杂。按这条重看，25 props 里有两组站不住：排序三件
> （`sort` / `onSortChange` / `column.sortable`）**全仓 0 处在用**，是预备役；三态四件
> （`emptyTitle` / `emptyDescription` / `emptyAction` / `loadingRows`）只是在描述"没数据时
> 长什么样"，本该是一个 `empty` 槽，与既有的 `footer` 槽同理——迁移这 29 页时我每页都在
> 重复拼那三个参数。收敛计划见任务 #36，等调用点全部到位后一次做。

## 三、唯一的真缺口：补了又退役

15/29 的页面给行挂业务语气（`vx-billing-row--${status}` 一族），DataTable 原先没有对外的口子
——而且它的文件头记着当初**刻意删掉过** `getRowClassName`。

本轮补的是那条判断的正面表达：

|              | `getRowClassName`（已拒） | `rowTone`（`9dda0129`） |
| ------------ | ------------------------- | ----------------------- |
| 调用方给什么 | 任意类名                  | 语气档（六选一）        |
| 谁决定长相   | 调用方                    | **DS**                  |
| 能画出几种行 | 无限                      | 六种，全站一致          |

渲染为行首 2px 色缘，**不铺整行**（一屏几十行会读成色块；且 DataTable 已在每个单元格画了
半透明底，再叠一层就是它自己文件头记的两层半透明合成）。

**`rowTone` 已于 2026-08-05 owner 实测后退役**（`950ac3ae`），全仓 0 处引用：一屏几十行时
左缘的彩色短线读成一列断续的碎点，既不成列也不成块。行的业务语气改由**状态列**表达
（`StatusBadge`，见 `DataTable` 文件头），行只表达交互态。业务状态→语气映射表
（`modules/shared/status-tone.ts`）仍然有效，只是消费方从行缘换成了状态列。

---

## 四、排期

**实际落地顺序与本表相反**（2026-08-06 复核）：先做的是 T5 与 T4 的一部分，T1–T3 未动。
范式因此已由 T5 建立，不必再等 T1。当前 13 个文件在用 `DataTable`（含 `ServiceHealthPage`
与 `PlatformAutonomyPage` 两个非清单页）。

| 批  | 页数 | 已迁 | 说明                                   |
| --- | ---- | ---- | -------------------------------------- |
| T1  | 6    | 6    | ✅ **整批清零**（2026-08-06）          |
| T2  | 5    | 5    | ✅ **整批清零**（2026-08-06）          |
| T3  | 4    | 4    | ✅ **整批清零**（2026-08-06）          |
| T4  | 5    | 5    | ✅ **整批清零**（2026-08-06 收尾三页） |
| T5  | 9    | 9    | ✅ **整批清零**（2026-08-06 收尾三页） |

前置已完成。以下按**结构相似度**分批，同批内一份 `columns` 写法可直接复用到下一页。

### 批 T1 · 商业域（6 页 / 约 1090 行）

`BillingPage` · `PaymentsPage` · `InvoicesPage` · `OrdersPage` · `SubscriptionsPage` ·
`UsageMeteringPage`

全部有 tone + 选择框，金额/状态/时间三段式列结构最一致，**先做这批建立范式**。
状态→语气映射已在 `status-tone.ts` 就位（`BILL_STATUS_TONE` / `ORDER_STATUS_TONE` /
`INVOICE_STATUS_TONE` / `RECONCILIATION_TONE` / `SUBSCRIPTION_OPERATION_TONE` /
`USAGE_RISK_TONE`），本批不需要新建映射。

**已完成（2026-08-06）。** 六页的行渲染各自封在一个 `*ListRows` 组件里（143–192 行，
合计 1051 行），一对一换成 `use*Columns()` 后 tsx 合计 5949 → 5451，CSS 90 条规则退役
（8617 → 7866 行，`admin-management-directory-commerce-transactions.css` 整个清空后删除）。

**前置的 DS 缺口**：`DataTable` 的表头复选框原本把整个选中集替换成本页 key（或清成
空集），而这六页加 `PromotionsPage` / `PromotionRedemptionsPage` 共 8 页正用
`BulkActionBar` 消费跨页选中集——第 1 页全选 20 条、翻页再全选会得到 20 而不是 40，
"取消全选"还会连别页选的一起清掉。`toggleAll` 已改为只对本页 key 做并集/差集，
页外选中项不动，这正是这些页面手写时的行为。T5 那三页没人消费选中集，所以没暴露。

**行内状态标保持 pill 不动**（`vx-billing-pill--*` 一族）。与 T5 相反：T5 那三页的状态
类是页面自己的四五档语气、跟着行网格一起死，就地换 `StatusBadge` 更省事；T1 这些属于
批 4 的业务值域着色表，整族一起改才不会出现半迁状态。

`Tag` 只收字符串，图标要并排放在它外面（`UsageMeteringPage` 的风险列）。

### 批 T2 · 身份与租户（5 页 / 约 894 行）

`TenantsPage` · `VerificationsPage` · `AccountsPage` · `PlatformUsersPage` · `AdminRolesPage`

租户风险档映射在 `tenants/tenant-utils.ts`（`TENANT_RISK_TONE` 等）已有；账号/角色/平台用户
三页无 tone，只迁结构。

**已完成（2026-08-06）。** 五页 tsx 6053 → 5576（−477），CSS 80 组选择器退役、
7702 → 7140 行，`admin-management-directory-{operations-accounts,platform-users,roles}.css`
三个文件清空后删除。`AccountsPage` 的租户列随 `showTenantContext` 出没，写成
`useAccountColumns(showTenantContext)` 里的一段条件展开——列的**有无**也是列定义的一部分，
不该退回调用点去拼两份 columns。

**状态记号图标必须放在标内。** 这几页原先是「彩色圆点 + pill」两件：圆点
（`vx-tenant-status-dot--*`）是个实心圆底 + 白色图标 + 光晕，颜色由它自己带。迁移时我
先把图标摘出来摆在 pill **外面**，它就失去了着色来源，退成表格正文灰——一列状态里
只有它没有语气。改成放进 pill 内部，靠 pill 的文字色着色，与 T1 的写法一致。

**顺带纠正 T1/T4 的同类问题**：那两批里我把 `vx-billing-status-dot` 等 6 族圆点样式
当死码删了（`bf74046a` / `b47ef325`），图标当时是放进 pill 里的，所以没有失色，但
「实心圆底 + 光晕」那层视觉确实没了。这不补回来——DS 的 `StatusBadge` 文件头已经
写明状态列的终局是**三件一体（表意图标 + 语气底色 + 文字）**，圆点是它的前身；
批 4 把 pill 换成 `StatusBadge` 时这三件会一起回来，现在另建一个 `StatusDot` 等于
给一条要退役的路加新件（owner 2026-08-06「只提升必要的」）。

### 批 T3 · 产品与营销（4 页 / 约 615 行）

`ProductsPage` · `ProductSolutionsPage` · `PromotionsPage` · `PromotionRedemptionsPage`

产品发布态用 `CAPABILITY_STATUS_TONE`；促销两页无 tone。

**已完成（2026-08-06）。这一批把整条线收口了**——29 个手搓列表页全部迁完，
`grep vx-tenant-directory-list__header` 归零，`DataTable` 覆盖 31 个文件。
四页 tsx 2977 → 2679，CSS 103 组选择器退役、7140 → 6484 行。

**行网格框架层随之整体退役。** `vx-tenant-directory-list` / `vx-tenant-directory-row`
是 22 个页面共用的栅格骨架，最后一个消费方走掉后 `admin-directory-list.css` 从 178 行
缩到 17 行，只剩两个跟卡片有关的规则和 `__unset`（缺失值弱化，OrdersPage 仍在用）。
`admin-directory-status.css` 与 `admin-management-directory-commerce-{growth,subscriptions}.css`
清空后删除。

**守卫抓到一个我没想到的连带问题**：删到最后 `admin-management-directory.css` 只剩一条
`@import`，撞上 `ds/no-redundant-style-wrapper`——「非 globals 直连的 import-only wrapper
不能只转发一个子模块」。这条规则平时没存在感，正好在清理把中间层掏空时报警。折叠掉那层，
让 `admin-management.css` 直接 import 唯一剩下的子模块。**清 CSS 到文件级别时要留意这条**。

### 批 T4 · 运营与治理（5 页 / 约 500 行）

`TicketsPage` · `AnnouncementsPage` · `AuditLogsPage` · `SkillsPage` · `OpsTodosPage`

工单分级尚无共享值域，映射先落 admin 侧（同 `status-tone.ts` 的边界判据）。

**已完成（2026-08-06）。收益是全部五批里最小的一批，如实记下来**：三页 tsx
2257 → 2207，只减 50 行。`TicketsPage` 减 80，而 `AnnouncementsPage` 与 `SkillsPage`
反而各涨了 22 / 8——原先列表与卡片共用一段加载/空态/翻页，拆开后卡片那一支要自己
写一份。行渲染本来就薄的页面，迁进 DataTable 并不省代码，省的是**一致性**：三态、
选择、序号、列对齐从此和其余 19 个列表同一个来源。CSS 减 38 条规则、164 行，
`admin-operations-tickets.css` 清空后删除。

**跨域借用的着色类就地换掉。** `SkillsPage` 与 `AnnouncementsPage` 的状态/类型标
原先借 `vx-admin-role-status-pill--*` 和 `vx-platform-user-status-pill--*`——那是
角色域与平台用户域的类，跟本页毫无关系，批 4 重排那两族时会连带变色。它们本身
只是页面自己的几档语气，换 `StatusBadge` 即可（判据同 T5）。换之前先查了原色值：
`--enabled`=success、`--disabled`=neutral、`--pending`=**info（蓝，不是黄）**、
`--attention`=warning，照着映射才不会改变观感。`TicketsPage` 的 `vx-commercial-pill--*`
是商业域各页共用的一族，留给批 4。

**清死 CSS 的脚本要先摘注释再拆选择器。** `.vx-ticket-operation-row` 头上那句注释里
带逗号（"ops-todo is read-only, no row selection"），按逗号切分组选择器时把注释切成了
两段，其中一段不匹配死类，整条规则就被判成"还活着"而留了下来。同理，分组里只有
一部分死掉时（`.vx-usage-*` 死、`.vx-promotion-*` 还活着）要删的是**那几段**，不是整条规则。

### 批 T5 · 轻量页（9 页 / 约 180 行）

`ModelPlatformPage` · `ModelGrantsPage` · `PlatformGovernanceListPage` · `RiskRecordsPage` ·
`MaintenanceWindowsPage` · `ComplianceEventsPage` · `SystemParametersPage` ·
`NotificationLogsPage` · `FeatureTogglesPage`

这批本身很薄（多数 ≤45 行），放最后是因为它们收益最小、且部分结构与主流不同，
适合在范式稳定之后一次扫掉。

**已完成（2026-08-06）。** 收尾三页 `ModelPlatformPage` / `ModelGrantsPage` /
`PlatformGovernanceListPage` 其实不薄（2102 / 1133 / 659 行），薄的是它们的**行渲染**——
迁完三页共减 345 行 tsx、613 行 CSS。四点判据记下来：

1. **状态列必须换 `StatusBadge`。** 这三页的状态标原是 `Badge` + 各自的颜色类
   （`vx-platform-governance-status--*` / `vx-model-strategy-pill--*` /
   `vx-model-link-pill--*`）。它们不属于批 4 的 pill 族——那族是业务值域着色表，
   这几个是页面自己的四五档语气，跟着行网格一起死，就地换掉比留到批 4 更省事。
2. **卡片视图里的同一个状态要一起换**，否则同一条记录在 list 与 cards 两个视图里
   颜色不同。`ModelGrantsPage` 与 `PlatformGovernanceListPage` 都踩到这一点。
3. **读取失败是第三态**，`DataTable` 只认加载 / 空 / 有数据，错误分支得留在外层。
4. **加载提示不能两处都出。** 列表态交给 `DataTable` 的骨架行，卡片态没有骨架，
   原来那句"正在加载"要收窄成 `loading && viewMode === "cards"`。

跨页全选的语义有变：`DataTable` 的表头复选框是"选中本页 / 清空"，不再向跨页集合累加。
这三页的选中集只用于行高亮，没有批量动作消费，故无功能损失；T1–T3 若有批量动作页要先确认。

---

## 五、每批验收

- `pnpm --filter @vxture/admin type-check` / `lint` / `build` 绿
- `pnpm lint:design` 不退化（基线 33）
- **登录态实测**：该批每页的行渲染、选择、行操作、行语气色缘逐项对照迁移前
- 行数复测：迁移后该批行渲染代码应显著低于迁移前（预计整体 3279 → 约 2300）

## 六、不在本工作线内

- **卡片视图（6 页）**：list 与 cards 是两段独立渲染，本线只动 list；cards 归
  `admin-ds-adoption-plan.md` 的批 5（卡表同源）。
- **pill 色调族（244 选择器）**：归那份的批 4。行内状态标换 `Badge` 与本线的行语气
  同源但不同批，避免一次改动跨两个语义面。
- **页面骨架 `ListPageTemplate`**：归那份的批 3。本线只换表格本体，不动页面三段式。

---

## 七、已知风险

**dev server 在连续 CSS/组件热更新后会崩**（2026-08-05 遇到两次，表现为整页
`Internal Server Error`，而 dev-panel 显示服务 healthy、`curl` 返回正常 307）。
回退改动无效，重启 admin dev 即恢复。迁移期间会频繁触发，遇到直接重启，不要按代码问题排查。
