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

| Router 文件                | 职责                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `oidc-auth.router.ts`      | OIDC 登录回调 / 登出 / 静默续期                                                                       |
| `me.router.ts`             | 当前用户：资料 / 偏好 / 安全 / 通知偏好 / 组织资料与改名 / 转为组织租户 / 删除账号                    |
| `tenant-context.router.ts` | 租户上下文与切换                                                                                      |
| `iam.router.ts`            | 成员 / 角色 / 邀请（含接受邀请）                                                                      |
| `verification.router.ts`   | 企业认证                                                                                              |
| `subscription.router.ts`   | 订阅 / 订单 / 下单 / 付款申报 / 权益                                                                  |
| `billing.router.ts`        | 账单 / 发票 / 抬头簿（服务端分页）                                                                    |
| `promotion.router.ts`      | 卡券                                                                                                  |
| `quota.router.ts`          | 配额 / 加油包                                                                                         |
| `usage.router.ts`          | 用量趋势（day 档按请求用户时区重切，响应带 `bucketZone` / `userZone` / `zoneFallbackReason`；裁定 4） |
| `inbox.router.ts`          | 站内消息（游标分页 / 已读）                                                                           |
| `audit.router.ts`          | 审计日志（服务端分页 + 动作筛选）                                                                     |
| `atlas.router.ts`          | 模型接入（models / quotas / usage；quotas 走 `tenant.quota.read`）                                    |
| `capabilities.router.ts`   | 能力列表                                                                                              |
| `applications.router.ts`   | 应用中心磁贴                                                                                          |
| `search.router.ts`         | 全局搜索                                                                                              |
| `health.router.ts`         | 健康检查                                                                                              |

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

## 退出事件流（C6 本地试点）

`src/features/session/session-events.ts` 导出 `startSessionEvents(recheck)`；本包导入示例：`import { startSessionEvents } from "@/features/session/session-events";`。`ConsoleSessionProvider` 仅在已登录时启动，卸载中止请求与定时器。通过同源 fetch 消费 `/auth/events`，使用现有 HttpOnly Cookie；用 HTTP 状态区分未启用、未认证和暂时故障。

事件只调用现有 `refreshSession({silent:true})` 重读当前 Cookie，返回 active/anonymous/unavailable；不依据旧流事件直接清空账号。既有请求版本屏障防止晚到响应恢复旧身份。健康心跳不查询会话，75 秒无字节才重连；503 保留身份展示。接口及退避/事件边界见 [150 §2.3](../../../30-design/identity/150-event-sync-api.md#23-console-退出-sse本地实现默认关闭)。

每个标签页独立连接，现有 BroadcastChannel 上下文同步继续有效。默认保留 300 秒、focus/visibility 兼容刷新；N4 的显式退役模式见下节，其他客户端仍独立验收。服务端开关默认 false，只有启用后页面才能收到退出推送。

## changes-v1 页面通知（本地未发布）

`startSessionEvents` 同时识别 `context-changed` 和 `access-changed`，仅触发当前 Cookie 的 `refreshSession`。不把事件正文当作权限或租户数据，旧流也不能清除新账号。上下文变化沿用 provider 的请求版本屏障和页面重载机制。两种事件的 transport 测试已加入，N4 新增显式协商退役及故障回退，见下节。

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/core-locale
✅ console-bff（HTTP only）
❌ @vxture/service-* / core-auth / core-api / core-config / core-tenant
❌ @vxture/model-runtime-client / agent-server/*
```

## Console 轮询退役协商（N4）

`startSessionEvents(recheck, onEventSync)` 仅在响应头为 `X-Vxture-Session-Sync: events-v1`、connected 触发的当前 Cookie 视图成功、连接仍有效时通知 true。Provider 随之卸载原 300 秒定时器和 focus/visibility 监听；异常/断线通知 false，恢复兼容刷新。旧服务或只有退出模式不会关闭轮询。清理后的异步回调不能覆盖新流状态。

`restoreSession` 对探测和四个子视图使用同一 15 秒信号，子请求失败抛出不可用，避免把 503 当成匿名/空权限。闲置安全时钟、上下文 BroadcastChannel、请求版本屏障继续工作。启用条件与兼容范围见接口文档 §2.6 和运行手册 §10。
