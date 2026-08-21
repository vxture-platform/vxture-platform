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
Overview

Workspace
  Members · Roles · Organization

Commerce
  Subscription · Billing · Quotas

Platform（需 platform.* 能力）
  Tenants · Products · Pricing · Models

Settings
```

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
> 这个**独立子实体**（workspace 是 tenant 的下级，`workspace_no = tenant_no × 1000 + 序号`，
> 每租户上限 999），于是同一个词在本文档里和在 DDL 里指两样东西。
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
