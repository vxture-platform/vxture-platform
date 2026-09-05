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

## 路由结构

> 2026-09-05（批 8）按实际目录重写。带「→」的目录只剩一个 `redirect()` 壳，为旧链接保留。

```
app/
├── layout.tsx                        ← 根布局
├── [locale]/
│   ├── (auth)/signin/                ← 登录页
│   └── (console)/
│       ├── layout.tsx                ← Console 布局（外壳 / 侧栏 / 租户面板）
│       ├── page.tsx                  ← 数据总览
│       ├── inbox/                    ← 待办与消息（todos/ → 此处 ?filter=todo）
│       ├── profile/                  ← 账号信息（security/ → 此处 ?panel=sessions）
│       │   └── verification/         ← 个人实名（骨架）
│       ├── tenant/                   ← 租户信息（organization/ personal-tenant/ settings/ tenant-settings/ → 此处）
│       │   └── verification/         ← 企业认证（organization/verification/ → 此处）
│       ├── members/                  ← 成员管理
│       ├── roles/                    ← 角色管理
│       ├── invitations/              ← 邀请记录
│       ├── accept-invitation/        ← 接受邀请（?token=）
│       ├── subscription/             ← 产品订阅
│       ├── subscribe/                ← 订阅下单
│       │   └── pay/[orderId]/        ← 订单付款
│       ├── billing/                  ← 账单管理
│       ├── vouchers/                 ← 我的卡券
│       ├── quotas/                   ← 配额管理
│       │   └── addon-pay/[orderNo]/  ← 加油包付款
│       ├── usage/                    ← 用量分析
│       ├── notifications/            ← 通知提醒
│       ├── audit-logs/               ← 审计日志
│       ├── atlas/                    ← 模型接入（tenant.model.read，owner）
│       └── onboarding/               ← 首次补齐
└── api/                              ← 健康检查等
```

## BFF 接口（console-bff）

| Router 文件                | 职责                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `oidc-auth.router.ts`      | OIDC 登录回调 / 登出 / 静默续期                                                    |
| `me.router.ts`             | 当前用户：资料 / 偏好 / 安全 / 通知偏好 / 组织资料与改名 / 转为组织租户 / 删除账号 |
| `tenant-context.router.ts` | 租户上下文与切换                                                                   |
| `iam.router.ts`            | 成员 / 角色 / 邀请（含接受邀请）                                                   |
| `verification.router.ts`   | 企业认证                                                                           |
| `subscription.router.ts`   | 订阅 / 订单 / 下单 / 付款申报 / 权益                                               |
| `billing.router.ts`        | 账单 / 发票 / 抬头簿（服务端分页）                                                 |
| `promotion.router.ts`      | 卡券                                                                               |
| `quota.router.ts`          | 配额 / 加油包                                                                      |
| `usage.router.ts`          | 用量趋势                                                                           |
| `inbox.router.ts`          | 站内消息（游标分页 / 已读）                                                        |
| `audit.router.ts`          | 审计日志（服务端分页 + 动作筛选）                                                  |
| `atlas.router.ts`          | 模型接入（models / quotas / usage；quotas 走 `tenant.quota.read`）                 |
| `capabilities.router.ts`   | 能力列表                                                                           |
| `applications.router.ts`   | 应用中心磁贴                                                                       |
| `search.router.ts`         | 全局搜索                                                                           |
| `health.router.ts`         | 健康检查                                                                           |

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

| 一级模块  | 二级页面                                            | 权限要求                                                                                            |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Overview  | Dashboard、关键指标                                 | —                                                                                                   |
| Workspace | 成员管理 / 角色管理 / 邀请记录                      | `tenant.member.read` / `tenant.member.manage` / `tenant.role.assign`                                |
| Commerce  | 产品订阅 / 账单 / 卡券                              | `tenant.billing.read` / `tenant.billing.manage` / `tenant.payment.manage` / `tenant.invoice.manage` |
| Platform  | 模型接入 `/atlas`                                   | `tenant.model.read`（仅 owner）                                                                     |
| Usage     | 配额管理 / 用量分析                                 | `tenant.quota.read`                                                                                 |
| Settings  | 租户信息 `/tenant` / 通知提醒 / 审计日志 / 账号信息 | `tenant.settings.manage` / `tenant.audit.read`；账号信息与通知登录即可                              |

设计规范见 [`docs/30-design/console.md`](../../../30-design/platform/20-console.md)。

---

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/core-locale
✅ console-bff（HTTP only）
❌ @vxture/service-* / core-auth / core-api / core-config / core-tenant
❌ @vxture/model-runtime-client / agent-server/*
```
