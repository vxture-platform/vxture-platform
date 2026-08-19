# Admin 运营后台产品规格

> 版本：1.0.0 | 更新：2026-05-11
> 技术实现：[`docs/40-implementation/packages/portals/admin.md`](../../../40-implementation/packages/portals/10-admin.md)
> BFF：[`docs/40-implementation/packages/bff/admin.md`](../../../40-implementation/packages/bff/10-admin.md)

---

## 定位

Admin（`y.vxture.com`）是面向**平台运营者**的后台管理系统。

采用**双域架构**：

| 域                      | 职责                                             | 核心用户          |
| ----------------------- | ------------------------------------------------ | ----------------- |
| 平台自治域（Platform）  | 平台能力供给侧：身份、资源、运行、安全、系统配置 | 平台技术/运维人员 |
| 运营管理域（Operation） | 商业消费侧：租户、产品、订阅、交易、财务、客服   | 平台商务/运营人员 |

Varda 智能助手嵌入 Admin（`VardaAdminChat.tsx`），贯穿两个域提供操作辅助。

---

## 功能模块实现状态

### 平台自治域

| 菜单分组 | 菜单项   | 路由                     | 状态                           |
| -------- | -------- | ------------------------ | ------------------------------ |
| 平台总览 | 平台总览 | `/platform`              | ⚠️ 占位页                      |
| 身份权限 | 平台用户 | `/platform-admins`       | ✅ 已接入                      |
| 身份权限 | 平台角色 | `/admin-roles`           | ✅ 已接入                      |
| 身份权限 | 权限策略 | `/admin-permissions`     | ✅ 已接入                      |
| 平台资源 | 模型平台 | `/model-platform`        | ✅ 已接入                      |
| 平台资源 | 密钥管理 | `/platform-secrets`      | ⚠️ 治理列表页                  |
| 运行保障 | 服务监控 | `/service-monitor`       | ✅ 已接入                      |
| 运行保障 | 任务调度 | `/platform-jobs`         | ⚠️ 治理列表页                  |
| 安全审计 | 审计日志 | `/audit-logs`            | ✅ UI 完成（BFF 数据层待接入） |
| 安全审计 | 审批中心 | `/approval-center`       | ⚠️ 治理列表页                  |
| 系统配置 | 参数配置 | `/system-parameters`     | 📋 待建设                      |
| 系统配置 | 字典管理 | `/data-dictionaries`     | 📋 待建设                      |
| 系统配置 | 开关控制 | `/feature-toggles`       | 📋 待建设                      |
| 通知中心 | 通知渠道 | `/notification-channels` | 📋 待建设                      |
| 通知中心 | 发送记录 | `/notification-logs`     | 📋 待建设                      |

### 运营管理域

| 菜单分组 | 菜单项   | 路由                     | 状态                           |
| -------- | -------- | ------------------------ | ------------------------------ |
| 运营总览 | 运营总览 | `/`                      | ✅ 已接入                      |
| 运营总览 | 运营待办 | `/ops-todos`             | ✅ 已接入（实时聚合）          |
| 租户账号 | 租户信息 | `/tenants`               | ✅ 已接入                      |
| 租户账号 | 账号体系 | `/accounts`              | ✅ 已接入                      |
| 租户账号 | 实名认证 | `/verifications`         | ✅ 已接入                      |
| 产品体系 | 产品能力 | `/products`              | ✅ 已接入                      |
| 产品体系 | 解决方案 | `/product-solutions`     | ✅ 已接入                      |
| 产品体系 | 服务套餐 | `/service-plans`         | ✅ 已接入                      |
| 产品体系 | 营销优惠 | `/promotions`            | ✅ 已接入                      |
| 订阅交易 | 订阅管理 | `/subscriptions`         | ✅ 已接入                      |
| 订阅交易 | 交易订单 | `/orders`                | ✅ 已接入                      |
| 订阅交易 | 用量计费 | `/usage-metering`        | ✅ 已接入                      |
| 订阅交易 | 优惠核销 | `/promotion-redemptions` | ✅ 已接入                      |
| 商业分析 | 商业总览 | `/commerce-overview`     | ✅ 已接入                      |
| 模型技能 | 模型授权 | `/model-grants`          | ✅ 已接入                      |
| 模型技能 | 技能市场 | `/skills`                | ✅ UI 完成（BFF 数据层待接入） |
| 财务结算 | 账单中心 | `/billing`               | ✅ 已接入                      |
| 财务结算 | 收款管理 | `/payments`              | ✅ 已接入                      |
| 财务结算 | 发票管理 | `/invoices`              | ✅ 已接入                      |
| 客户服务 | 工单中心 | `/tickets`               | ✅ 已接入                      |
| 客户服务 | 消息公告 | `/announcements`         | ✅ UI 完成（BFF 数据层待接入） |

**图例**：✅ 已接入 BFF 数据 | ⚠️ 页面存在但为占位/治理列表 | 📋 菜单已定义，路由走 slug 兜底

---

## 域边界原则

**模型**：平台自治域做技术接入（模型平台），运营管理域做商业授权（模型授权）。两者分离，不混用。

**用户**：平台自治域管理平台内部用户（ops.admin），运营管理域管理租户账号（tenant_user）。

**配置**：全部在平台自治域（系统配置分组），运营管理域禁止出现配置类菜单。

**通知**：平台自治域管通知渠道（能力侧），运营管理域使用消息公告（消费侧）。

---

## 数据库依赖

Admin 通过 admin-bff 访问平台主库（阿里云 RDS `vxturestudio_platform_main`），涉及 schema：

| Schema     | 用途                                 |
| ---------- | ------------------------------------ |
| `ops`      | 平台用户、角色、权限、配置、治理记录 |
| `tenant`   | 租户、成员、认证管理                 |
| `product`  | 产品、解决方案、套餐配置             |
| `commerce` | 订阅、订单、支付、发票、用量         |
| `model`    | AI 模型目录与授权                    |
| `support`  | 工单、工单事件、审计日志             |

详见 [`docs/30-design/db/00-index.md`](../../../30-design/db/00-index.md)。

---

## 登录与鉴权

- 运营后台**仅支持邮箱密码登录**，不接入钉钉/飞书/企业微信（禁止在 admin-bff 配置第三方 OAuth）
- JWT `userType = operator`，`authScope = platform_admin`
- 权限判断使用菜单 `code` 字段，见 [`menu.md`](./40-menu.md)

---

## 目录结构

> 范围：`portals/admin/src/` | 更新：2026-05-03

### 路由 → 模块索引

| 路由                                       | 页面模块                                                 |
| ------------------------------------------ | -------------------------------------------------------- |
| `/`                                        | `src/app/(admin)/page.tsx`                               |
| `/login`                                   | `src/app/login/page.tsx`                                 |
| `/accounts`                                | `src/modules/accounts/AccountsPage.tsx`                  |
| `/admin-permissions`                       | `src/modules/admin-permissions/AdminPermissionsPage.tsx` |
| `/admin-roles`                             | `src/modules/admin-roles/AdminRolesPage.tsx`             |
| `/announcements`                           | `src/modules/announcements/AnnouncementsPage.tsx`        |
| `/approval-center`                         | `src/modules/platform/PlatformGovernanceListPage.tsx`    |
| `/audit-logs`                              | `src/modules/audit-logs/AuditLogsPage.tsx`               |
| `/billing`                                 | `src/modules/billing/BillingPage.tsx`                    |
| `/billing/[billId]`                        | `src/modules/billing/BillingDetailPage.tsx`              |
| `/commerce-overview`                       | `src/modules/commercial/CommerceOverviewPage.tsx`        |
| `/invoices`                                | `src/modules/invoices/InvoicesPage.tsx`                  |
| `/model-platform`                          | `src/modules/ai/ModelPlatformPage.tsx`                   |
| `/model-grants`                            | `src/modules/ai/ModelGrantsPage.tsx`                     |
| `/ops-todos`                               | `src/modules/ops/OpsTodosPage.tsx`                       |
| `/orders`                                  | `src/modules/orders/OrdersPage.tsx`                      |
| `/orders/[orderId]`                        | `src/modules/orders/OrderDetailPage.tsx`                 |
| `/payments`                                | `src/modules/payments/PaymentsPage.tsx`                  |
| `/platform`                                | `src/modules/platform/PlatformAutonomyPage.tsx`          |
| `/platform-admins`                         | `src/modules/platform/PlatformUsersPage.tsx`             |
| `/platform-jobs`                           | `src/modules/platform/PlatformGovernanceListPage.tsx`    |
| `/platform-secrets`                        | `src/modules/platform/PlatformGovernanceListPage.tsx`    |
| `/product-solutions`                       | `src/modules/products/ProductSolutionsPage.tsx`          |
| `/product-solutions/[solutionCode]`        | `src/modules/products/ProductSolutionDetailPage.tsx`     |
| `/products`                                | `src/modules/products/ProductsPage.tsx`                  |
| `/products/[productCode]`                  | `src/modules/products/ProductCapabilityDetailPage.tsx`   |
| `/promotion-redemptions`                   | `src/modules/commercial/PromotionRedemptionsPage.tsx`    |
| `/promotions`                              | `src/modules/commercial/PromotionsPage.tsx`              |
| `/service-monitor`                         | `src/modules/ops/ServiceHealthPage.tsx`                  |
| `/service-plans`                           | `src/modules/products/ServicePlansPage.tsx`              |
| `/service-plans/[solutionCode]/[tierCode]` | `src/modules/products/ServicePlanDetailPage.tsx`         |
| `/skills`                                  | `src/modules/skills/SkillsPage.tsx`                      |
| `/subscriptions`                           | `src/modules/subscriptions/SubscriptionsPage.tsx`        |
| `/subscriptions/[subscriptionId]`          | `src/modules/subscriptions/SubscriptionDetailPage.tsx`   |
| `/tenants`                                 | `src/modules/tenants/TenantsPage.tsx`                    |
| `/tenants/[tenantId]`                      | `src/modules/tenants/TenantDetailPage.tsx`               |
| `/tickets`                                 | `src/modules/support/TicketsPage.tsx`                    |
| `/usage-metering`                          | `src/modules/commercial/UsageMeteringPage.tsx`           |
| `/verifications`                           | `src/modules/tenants/VerificationsPage.tsx`              |
| `/* planned`                               | `src/modules/shared/AdminRoutePlaceholderPage.tsx`       |

### 关键共享文件

| 文件                                            | 职责                                         |
| ----------------------------------------------- | -------------------------------------------- |
| `src/config/navigation.ts`                      | 双域 Workspace、分组、菜单、路由、权限元数据 |
| `src/api/admin-bff.ts`                          | Admin BFF 请求封装                           |
| `src/entities/console.ts`                       | Admin 前端实体类型定义                       |
| `src/layout/AdminShell.tsx`                     | 后台主框架（侧边栏、顶部栏、工作区切换）     |
| `src/layout/VardaAdminChat.tsx`                 | Admin 内置 Varda 助手入口                    |
| `src/features/session/AdminSessionProvider.tsx` | 登录会话、用户与权限上下文                   |
| `src/modules/shared/AdminPlaceholderPage.tsx`   | planned 菜单通用占位页                       |
| `src/shared/mock-console-data.ts`               | ⚠️ 临时 mock 数据，需逐步数据库化            |

### 架构边界注意事项

1. `src/app/(admin)/plans/` 和 `src/app/(admin)/product-plans/` 存在但不在当前导航主菜单，属于历史路由，需确认是否保留。
2. `PlatformGovernanceListPage.tsx` 被密钥管理、任务调度、审批中心三个页面复用，是通用治理列表视图。
3. `planned` 菜单统一走 `src/app/(admin)/[...slug]/page.tsx` + `AdminRoutePlaceholderPage` 兜底，无需为每个待建设路由单独建文件。
4. `src/shared/mock-console-data.ts` 仍存在，需逐页确认依赖并优先替换为真实 BFF 接口。
5. 路由层（`src/app/`）只做路由入口，页面实现委托给 `src/modules/**`。

---

## 关联文档

| 文档                                                                                                           | 内容                                                            |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`menu.md`](./40-menu.md)                                                                                      | 双域完整菜单规格（path / code / i18n / status / TS 初始化数据） |
| [`docs/30-design/data_platform_100_architecture.md §14`](../../../30-design/data_platform_100_architecture.md) | 平台治理记录表设计草案                                          |
| [`docs/30-design/data_platform_100_architecture.md §15`](../../../30-design/data_platform_100_architecture.md) | 工单与运营待办 DB 设计                                          |
| [`docs/30-design/auth.md § 钉钉配置参考`](../../../30-design/identity/010-auth.md)                             | 钉钉 OAuth 配置（仅用于 website-bff，admin 禁用）               |
