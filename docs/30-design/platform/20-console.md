# Console UI 设计规范

> 跨包能力域设计索引：[`docs/30-design/00-index.md`](../00-index.md)
> 包实现上下文：[`docs/40-implementation/packages/portals/console.md`](../../40-implementation/packages/portals/20-console.md)

---

## 产品定位

`portals/console` 是统一后台控制台，覆盖平台运营、工作区管理、商业订阅与 AI 辅助工作流。

**视觉目标：** 接近 Vercel / Stripe 的现代云控制台——轻量、精确、专业，风格参考但不照搬。

**禁止倾向：**

- 传统 admin 模板外观 / 大面积深色顶栏或左侧栏
- ERP 式密集表格铺满整屏
- 卡片墙 + 无层级大屏仪表板
- 装饰性渐变背景、厚重阴影

---

## 设计原则

**视觉：** 优先用留白和背景分层区分层次，而不是边框。中性色调为主，主色（科技蓝 `#3B82F6` 附近）点缀。排版层级承担主要信息组织。

**交互：** 内容是主角，导航辅助，助手居后。详情优先在当前上下文附近展开（Drawer > 新页面）。所有异步操作须有可见反馈。

**结构：** 一套 shell 服务所有角色；capability 控制可见性，不拆成多个独立应用。

---

## Shell 规格

### 布局模式

```
默认：   [Sidebar] [Content]
扩展：   [Sidebar] [Content] [Assistant]
窄页面： [Content] [Assistant]
```

空间收缩顺序：Assistant → Sidebar 标签 → 次级工具栏 → 表格次要列（主内容宽度最后牺牲）。

### 尺寸目标

| 元素            | 范围                             |
| --------------- | -------------------------------- |
| Header 高度     | 64px – 72px                      |
| Sidebar 宽度    | 248px – 272px（折叠：icon-only） |
| Assistant 宽度  | 320px – 360px                    |
| 页面水平内边距  | 20px – 24px                      |
| Section 间距    | 16px                             |
| 卡片 / 面板圆角 | 16px – 24px                      |

### Shell 模型

```tsx
<AppShell>
  <Sidebar />
  <Main>
    <Header />
    <Body>
      <Content />
      <AssistantPanel /> {/* 路由感知，大多数页面默认隐藏 */}
    </Body>
  </Main>
</AppShell>
```

---

## Header

```
[☰] [面包屑 / 页面上下文]  ···  [搜索] [Assistant] [用户]
```

可选扩展：Workspace Switcher、通知入口、环境标识 chip。

**规则：** 背景保持白色或极浅中性色，用细分隔线与内容区分开。左侧承载上下文，右侧承载工具与身份。页面级操作属于内容区页头，不放入 shell header。

---

## Sidebar

导航结构（全部按 capability 过滤）：

```
工作空间
  数据总览 · 待办与消息

账户与租户
  账号信息 · 租户信息 · 成员管理

订阅与计费
  产品订阅 · 费用中心 · 我的卡券 · 配额管理 · 用量分析

高级设置
  通知提醒 · 审计日志

平台能力（tenant.model.read，仅 owner）
  模型接入
```

> 2026-09-05（批 8）按 `navigation.ts` 现状重写；权威源是 `deploy/database/seed/seed-catalog.mjs` 的 `TENANT_MENU_TREE`（守卫 `lint:permission-catalog` 三处比对）。
>
> 2026-09-06（批 9，owner 裁定）：「成员与权限」整组撤销，租户侧最终只留**账号信息 / 租户信息 / 成员管理**三个板块。邀请记录、角色管理、权限管理都收成成员管理的**三个二级页**（`/members/invitations`、`/members/roles`、`/members/permissions`，入口在成员管理页头右侧）——它们是成员管理的下一层，不是同一层的几件事；角色与权限目录都是平台整体定义、租户不可自定义，**只提供查看**。两页的呈现照治理平面既有的 `AdminRolesPage` / `AdminPermissionsPage`（指标排带 help 与 tags、主辅走 `TableTitleCell`、权限树可展开收起 + 搜索与层级筛选、单角色明细走对话框），不搬写侧那一整套。二级页不进菜单树（`/tenant/verification` 同例），旧地址 `/roles`、`/invitations` 只保留跳转。
>
> 2026-09-06（同批，owner）：**角色一律 tag 模式（icon + 角色名）**。这个设计原本就在账号信息页身份卡里，但图标表是那个文件的私有常量、角色名有四份一模一样的副本（且已飘：`profilePage` 只有三档、owner 一处写「所有者」三处写「拥有者」）。收成门户件 `components/role-tag`：图标表、显示名、固定序各一份权威，角色名提到顶层 `role.*` 命名空间（四个消费方，与 `table.*`、`pagination.*` 同一处理）。图标是三档分组——所有者 `medal` / 管理者 `shield-check` / 普通成员 `user`；语气统一一档，角色是类目不是严重度，区分交给图标与名字。权限矩阵的列头用轻量版（图标 + 名，不套贴标）：五列各塞一枚贴标会把表头撑成两倍高。
>
> 2026-09-07（owner 走查后重定）：**智能体页两张卡共用一条排布规则**——**右上角**放这张卡的「一眼判断」（已订阅看状态；推荐卡这一格空着，它的判断就是名字与简介本身，**价格不在这一页露**），**内容区**放支撑判断的事实、末行统一「版本号 · 发布时间」，**卡底**放动作。「更新时间」取 `products.released_at`（这一版什么时候发出来的），**不是 `updated_at`**——那是行审计列，后台改一句描述也会变，对客户不构成「产品有更新」；两个字段本轮从 console-bff 的两条产品查询补出。
>
> 2026-09-07（owner）：**「免费」一词从面向用户的文案里清干净**。`0.00` 是**短期验证档**的价格，也可能是折扣或折扣券之后的结果；产品线有 SaaS 与私有化两条，说「免费版」会被读成**私有化也免费**，客户带着错误预期进销售对话。根因是档位名本身已是专名（`Free / Starter / Pro / Business / Enterprise` 全不翻译），却被中文散文意译成了「免费」——等于把 `Pro` 写成「专业的」。console 侧六处已清：周期徽章不再把 ¥0 档写成「免费」（¥0 照样按月/年到期）、统计与空态改用「Free 档」、租户面板套餐名读不到时显示「未订阅」而不是编一个「免费套餐计划」。
>
> 2026-09-07（owner 裁定）：**智能体页只装两块**——已订阅（展示 + 入口）与热门推荐（产品介绍 / 订阅两个按钮）。原来的「控制台板块」去掉：那三个入口是**控制台的内容**，控制台视图的侧栏里本来就有，摆在智能体页等于把另一个域的导航搬过来，域切换就失去意义。页头名字从「应用中心」改成「智能体」——切换器一直叫智能体，页面却自称应用中心。两张卡都为这一页新写：已订阅卡**借订阅卡的信息、去掉它的管理操作**（留档位/周期/状态/有效期，去掉收藏★、自动续费、退订、升级续费、进度条、版本号；动作只有「打开」）；推荐卡砍掉收藏★、标签行、两行描述与版本号，只留价格，高度从五段降到两段。
>
> 2026-09-07（owner 裁定）：**新品推荐从产品订阅页去掉**。那一页是**资产视图**——只答「我现在有什么、什么时候到期」；「还没订的产件」是**选购**，去处是产品市场（页头右上角那个外链）。把推荐塞在自己的资产清单下面，等于在「我有什么」里混进「你还可以买什么」。两次减法之后这一页只剩「我的订阅」一块。件（`RecommendedProductCard`）与 `/api/subscription/recommended-products` **保留**——去掉的是位置不是能力，去处未定。
>
> 2026-09-06（owner 裁定）：**订单归费用中心**。判据是订单是钱这条链的第一环——下单 → 出账 → 付款 → 开票，后三环本就在这一页，唯独第一环在产品订阅页，一笔交易出了问题人要在两页之间来回跳。两页各答一个问题：**产品订阅 = 资产视图**（我现在有什么、什么时候到期），**费用中心 = 交易视图**（这笔钱是怎么回事）。行业同构（阿里云 / 腾讯云 / AWS 的费用中心一律收订单 + 账单 + 发票；M365 / Google 更把订阅本身也放在 Billing 下）。页面随之更名「账单管理」→「费用中心」——装了三样之后「账单」只是其中一块。**发票记录与开票抬头**是台账，降为二级页 `/billing/invoices`；**「申请发票」**是账单行上的动作，留在费用中心——动作要发生在对象所在的那一页。拆开补三个连接点：订单行「查看订阅」、产品订阅页待付订单横幅（带「去费用中心支付」）、「申请发票」两个入口收敛成账单行那一个。
>
> 2026-09-06（同批，owner 裁定）：**角色目录里的「所有者」与成员表姓名后的「主管理员」不要统一**。同一个人身上两个词看着像词条飘了，其实各答各的问题——角色说的是**角色定义**（这个人被授予了哪一档治理权限），那一枚标说的是**隶属与管理关系**（这个租户的主管理员是谁）。差异是有意的，两处代码注释里都钉住了。

**规则：** 每项 = icon + label，无副标题无描述。选中态清晰但轻量，不用厚重高亮块。折叠模式保留 icon + hover tooltip + 选中指示。sidebar 视觉融入 shell，不做深色独立面板。

---

## Assistant 面板

**用途：** 理解当前页面上下文、触发建议操作、起草重复任务，不离开工作流使用 AI。

- 大多数路由默认隐藏；AI 价值明确的路由可默认展开
- 独立滚动，路由感知，关闭无副作用
- 视觉风格比页面内容更安静，不得看起来像独立产品

---

## 内容区与页面模板

### 通用页面栈

```
面包屑
页面标题（+ 最多 1 个主操作）
可选摘要行（指标卡）
工具栏 / 筛选 / Tabs
主内容
上下文详情层（Drawer）
```

### Dashboard

入口而非分析大屏。指标 3–5 个（高信号），短列表优于图表，图表须回答一个明确问题。禁止等权重卡片墙和装饰性趋势图。

### 列表页

表格/结构化列表为主，核心列 5–7 列，行点击开 Drawer，长内容在 Drawer 承载。Tabs 做语境分段，Filter bar 置于 Tabs 下方。

### 详情体验

优先 Drawer（列表维持可见）。对象复杂或流程多步时才用全页详情。

### 设置页

左侧分类导航 + 右侧表单。Section 分组，表单控件间距充足，不把所有控件压缩进一个块。

### Billing / Subscription 页

先呈现当前套餐状态和配额摘要，再呈现账单历史。不以财务表格开场。

---

## 视觉系统

### 色彩

| 层次         | 方向                                    |
| ------------ | --------------------------------------- |
| 页面背景     | `#F5F7FB` – `#F8FAFC`（极浅灰蓝）       |
| 表面（卡片） | `#FFFFFF`                               |
| 主色         | `#2F6FED` – `#3B82F6`（科技蓝，偏清透） |
| 文字         | 深石板色，非纯黑                        |
| 辅助文字     | 冷中性                                  |
| 边框         | 低对比度中性色                          |

背景 → 表面 → 浮层 → 遮罩须有清晰视觉分层，禁止所有层用同一白色。

### 圆角

- 小控件（Input / Button）：10px – 14px
- 面板 / 卡片：18px – 24px
- 徽章 / 标签：全圆角

### 阴影

用于：菜单、Dialog、Assistant、粘性面板。禁止：每张卡片都加阴影，多重阴影叠加。

### 排版层级

须建立稳定梯度：**页面标题 → Section 标题 → 卡片标题 → 正文 → 辅助文字 → 标签/帮助文字**

---

## 核心组件规则

**Button：** 一个页面区域最多 1 个强主按钮。次级操作用 outline / ghost。危险操作弱化，需二次确认后执行。

**Input / Select：** 统一高度，稳定圆角，安静背景，清晰 focus 态，无厚重蓝边。

**Table：** 现代运营表格风。冷静表头，中等行高，轻分隔线，hover 反馈。禁止 10+ 列密铺，复杂信息通过 Drawer 承载。

**Drawer / Dialog：** Drawer 用于详情查看和轻量编辑；Dialog 用于确认、危险操作批准、短表单。

**Tabs：** 紧凑轻量，通过颜色 + 下划线体现当前状态，不做厚重 pill 填充。

**Card：** 用于摘要模块、设置分组、有边界内容区域；不作为列表行的替代。

---

## 状态设计

每个核心页面必须覆盖：

| 状态          | 要求                                                         |
| ------------- | ------------------------------------------------------------ |
| Loading       | 骨架屏，保留页面布局结构                                     |
| Empty         | 说明缺失原因 + 引导下一步操作                                |
| Error         | 平白语言解释失败 + 保留用户上下文 + 暴露重试                 |
| No-permission | 明确说明是角色 / capability / 上下文原因，不作为通用报错展示 |

---

## 动效与反馈

- Hover / Focus 过渡：120ms – 180ms
- 面板开关：180ms – 240ms
- 必须有反馈的场景：保存成功 / 操作失败 / 加载中 / 危险确认 / 内联校验

---

## 响应式与无障碍

**响应式：** Desktop-first，Tablet / Mobile 可用。折叠顺序：Assistant → Sidebar → 工具栏 → 表格列。

**无障碍：** 色彩对比达标；focus 态始终可见；icon-only 操作提供 label；Drawer / Dialog focus 管理正确；导航选中态不仅依赖颜色。

---

## Workspace Switcher 设计

> **术语纠偏（2026-08-21）：本节的 "workspace" 指的是 `tenancy.tenants`，不是
> `tenancy.workspaces`。**
>
> 本节写作时，UI 层用 "workspace" 指代租户——它自己的类型定义就是证据
> （`WorkspaceContextState.currentTenantId`）。平台后来引入了 `tenancy.workspaces`
> 这个**独立子实体**（workspace 是 tenant 的下级，归属走 `workspaces.tenant_id`；
> 编号自 2026-09-05 §11 v4 起与租户号解耦、每租户空间数无上限），于是同一个词在本文档里和在 DDL 里指两样东西。
>
> 照本节实现时的对应关系：
>
> | 本节的说法                  | 实际指                   | 现状                                                                |
> | --------------------------- | ------------------------ | ------------------------------------------------------------------- |
> | 切换 workspace              | 切换**租户**             | 已实现，见 `portals/console/src/features/tenant/TenantProvider.tsx` |
> | 创建 organization workspace | 创建**组织租户**         | 已实现                                                              |
> | 一个用户属于多个 workspace  | 一个用户属于多个**租户** | 成立                                                                |
>
> **真正的 Workspace 实体口径以
> [`docs/20-specs/20-vxture-tenant-console-info-spec.md`](../../20-specs/20-vxture-tenant-console-info-spec.md)
> §3.1 / §四 为准**：当前阶段 1 租户 = 1 默认 Workspace，本期弱化展示、预留入口；
> 后续演进 1:N。**本期不开放租户自建 workspace**（裁定见
> [`docs/70-workplan/60-console-p1-open-decisions.md`](../../70-workplan/60-console-p1-open-decisions.md)
> 决策 2）——所以本节「创建逻辑」那段**不适用于 Workspace 实体**，它描述的是建租户。
>
> 本节的交互设计（面板分区、切换流程、权限差异）仍然有效，只需把 "workspace"
> 读作 "tenant"。

### 业务规则

- **命名约定：** 产品 / UI 层统一用 workspace；数据 / 权限层用 tenant，二者一对一
- 一个用户可属于多个 workspace，任一时刻只有一个 current workspace
- **自主注册用户：** 默认拥有 1 个 personal workspace，可创建多个 organization workspace
- **受邀注册用户：** 初始无 personal workspace，绑定邀请来源；后续支持创建最多 1 个 personal workspace
- 一个用户最多只能有 1 个 personal workspace

### 数据模型

```typescript
type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  type: "personal" | "organization";
  role: "owner" | "admin" | "member";
  isCurrent: boolean;
};

type WorkspaceContextState = {
  currentTenantId: string | null;
  currentWorkspace: WorkspaceListItem | null;
  workspaceList: WorkspaceListItem[];
  hasPersonalWorkspace: boolean;
  switchWorkspace: (id: string) => void;
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<void>;
};
```

### 顶部入口（WorkspaceSwitcher）

展示：当前 workspace 头像 + 名称（超长省略）+ 下拉箭头。

交互：点击开启面板；Esc / 点击外部关闭；高度紧凑，无厚重边框，hover 轻背景变化。

### 弹出面板（WorkspaceSwitcherPanel）

宽度 320px – 360px，中间列表区可滚动，分 4 个区域：

| 区域           | 内容                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Header         | 标题 "Switch workspace" + 关闭按钮                                                                           |
| 当前 Workspace | 头像、名称、类型标签、"使用中"高亮，视觉区别于普通列表项                                                     |
| Workspace 列表 | 全部可访问 workspace；每项：头像、名称、类型标签、角色、当前项勾选态                                         |
| 操作区         | Create workspace / Create personal workspace（无 personal 时显示）/ Join workspace（预留）/ Manage workspace |

### 切换逻辑

```
点击列表项 → 更新 currentTenantId → 更新 currentWorkspace → 关闭面板 → 路由同步到 /t/:slug
```

预留扩展：API 请求头自动注入 tenantId；页面级权限重新校验；tenant 不可访问时自动 fallback。

### 创建逻辑

字段：name + slug + type（默认 organization；从"Create personal workspace"入口进入时固定为 personal）。  
成功后：插入 workspaceList → 自动切换到新 workspace → 关闭 dialog → 关闭 panel。

### 权限差异

owner / admin 可见 Manage workspace；member 可切换但管理能力弱化或隐藏。
