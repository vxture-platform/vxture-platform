# @vxture/console

> 架构层参考：[`docs/30-design/architecture/00-index.md`](../../../30-design/architecture/00-index.md)

---

## 包信息

| 项     | 值                       |
| ------ | ------------------------ |
| 包名   | `@vxture/console`        |
| 路径   | `portals/console/`       |
| @layer | `Presentation`           |
| 框架   | Next.js 15（App Router） |

## 职责

租户工作台：面向租户管理员，管理租户成员、订阅、权限、设置等。
Varda 智能助手嵌入点（console surface），入口文件 `app/[locale]/(console)/ConsoleVardaPanel.tsx`。

## 路由结构

```
app/
├── layout.tsx                        ← 根布局
├── [locale]/
│   ├── (auth)/signin/                ← 登录页
│   └── (console)/
│       ├── layout.tsx                ← Console 布局（含 ConsoleVardaPanel）
│       ├── page.tsx                  ← 首页 / 仪表板
│       ├── billing/                  ← 账单管理
│       ├── iam/                      ← 身份与访问管理
│       ├── invitations/              ← 邀请管理
│       ├── members/                  ← 成员管理
│       ├── model-platform/            ← 模型平台配置
│       ├── notifications/            ← 通知设置
│       ├── organization/             ← 组织信息
│       ├── personal-tenant/          ← 个人租户设置
│       ├── profile/                  ← 个人资料
│       ├── quotas/                   ← 配额管理
│       ├── roles/                    ← 角色管理
│       ├── security/                 ← 安全设置
│       ├── settings/                 ← 租户设置
│       ├── subscription/             ← 订阅管理
│       ├── tenant-settings/          ← 高级租户配置
│       └── todos/                    ← 待办事项
├── iam/                              ← （根级路由，待确认用途）
└── subscription/                     ← （根级路由，待确认用途）
```

## BFF 接口（console-bff）

| Router 文件                | 职责                     |
| -------------------------- | ------------------------ |
| `auth.router.ts`           | 登录 / 登出 / token 刷新 |
| `me.router.ts`             | 当前用户信息             |
| `iam.router.ts`            | 成员 / 角色 / 权限查询   |
| `billing.router.ts`        | 账单信息                 |
| `subscription.router.ts`   | 订阅信息 / feature 开关  |
| `capabilities.router.ts`   | 功能能力列表             |
| `tenant-context.router.ts` | 租户上下文               |
| `phone-auth.router.ts`     | 手机号认证               |

## UI 分层框架

| 层               | 路径                    | 职责                                                                                                 |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Shell            | `src/layout/shell/`     | AppShell / Header / Sidebar / AssistantPanel / 跨页面布局                                            |
| Page Layout      | `src/layout/page/`      | ConsolePage / PageCluster / PageActions / EntityListPage / SettingsSplitPage                         |
| Shared Module UI | `src/modules/shared/`   | PageHeader / MetricGrid / TableToolbar / EmptyState / EntityTableSection / DetailDrawer / SectionNav |
| Module           | `src/modules/{domain}/` | 业务组合，路由级装配，仅消费上层原语                                                                 |

导入顺序：`@/layout` → `@/modules/shared` → `@vxture/design-system` → 语义业务组件 → 模块本地。

禁止在 `portals/*` 内创建 `components/ui` 或 `components/primitives`；可跨模块复用的原语须先纳入 `@vxture/design-system`。

---

## 模块规划

| 一级模块  | 二级页面                                        | 权限要求                                           |
| --------- | ----------------------------------------------- | -------------------------------------------------- |
| Overview  | Dashboard、关键指标                             | —                                                  |
| Workspace | Members / Roles / Organization / Access Control | `tenant.user.manage` / `tenant.role.manage`        |
| Commerce  | Subscription / Billing / Quotas                 | `tenant.subscription.read` / `tenant.billing.read` |
| Platform  | Tenants / Products / Pricing / Models           | `platform.*` 系列能力                              |
| Usage     | 用量概览 / 消耗记录                             | `tenant.quota.read`                                |
| Settings  | 租户设置 / 通知 / 个人偏好                      | —                                                  |

设计规范见 [`docs/30-design/console.md`](../../../30-design/platform/20-console.md)。

---

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/core-locale
✅ console-bff（HTTP only）
❌ @vxture/service-* / core-auth / core-api / core-config / core-tenant
❌ @vxture/model-runtime-client / agent-server/*
```
