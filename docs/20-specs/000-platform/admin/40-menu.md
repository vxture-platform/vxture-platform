# Admin 双域菜单规格

> 版本：1.2.0 | 更新：2026-08-31
> 权威来源：`src/config/navigation.ts`（代码优先，本文档为设计规格参考）
> 1.2.0：摘掉四个上线前仍为空的菜单项——密钥管理 `/platform-secrets`、审批中心 `/approval-center`（读的 `admin.governance_record` 从未建表）、字典管理 `/data-dictionaries`、通知渠道 `/notification-channels`（占位页）。owner 2026-08-30 裁定；对应的 `admin.menu.*` 权限行与 `security:signing_key.manage` / `security:oidc_client.manage` 两个无处可达的操作码由 `deploy/database/migrations/2026-08-31-admin-retire-empty-menus.sql` 退役。有数据源之日再按本规格挂回。

---

## 命名原则

- 中文名称：四字，以"对象/能力"为主，避免"管理/配置/中心"等泛化词
- `code`：`snake_case`，语义稳定，面向权限模型，不使用拼音或弱语义词
- `i18n`：前缀 `menu.platform.*`（自治域）/ `menu.operation.*`（运营域）
- `path`：`kebab-case`，路径稳定不随命名调整，现有路径原则上不迁移

---

## 一、平台自治域（Platform Domain）

> 平台能力供给侧 — 管理平台自身的身份、资源、运行、安全、系统配置与通知能力

| 分组     | 菜单项   | path                 | code                | i18n                              | 状态    |
| -------- | -------- | -------------------- | ------------------- | --------------------------------- | ------- |
| 平台总览 | 平台总览 | `/platform`          | `platform_overview` | `menu.platform.overview`          | active  |
| 身份权限 | —        | —                    | `identity_access`   | `menu.platform.identity_access`   | active  |
| 身份权限 | 平台用户 | `/platform-admins`   | `platform_admin`    | `menu.platform.admin_user`        | active  |
| 身份权限 | 平台角色 | `/admin-roles`       | `platform_role`     | `menu.platform.admin_role`        | active  |
| 身份权限 | 权限策略 | `/admin-permissions` | `permission_policy` | `menu.platform.permission_policy` | active  |
| 平台资源 | —        | —                    | `platform_resource` | `menu.platform.platform_resource` | active  |
| 平台资源 | 模型平台 | `/model-platform`    | `model_gateway`     | `menu.platform.model_gateway`     | active  |
| 运行保障 | —        | —                    | `runtime_ops`       | `menu.platform.runtime_ops`       | active  |
| 运行保障 | 服务监控 | `/service-monitor`   | `service_monitor`   | `menu.platform.service_monitor`   | active  |
| 运行保障 | 任务调度 | `/platform-jobs`     | `job_scheduler`     | `menu.platform.job_scheduler`     | active  |
| 安全审计 | —        | —                    | `security_audit`    | `menu.platform.security_audit`    | active  |
| 安全审计 | 审计日志 | `/audit-logs`        | `audit_log`         | `menu.platform.audit_log`         | active  |
| 系统配置 | —        | —                    | `system_setting`    | `menu.platform.system_setting`    | planned |
| 系统配置 | 参数配置 | `/system-parameters` | `system_parameter`  | `menu.platform.system_parameter`  | planned |
| 系统配置 | 开关控制 | `/feature-toggles`   | `feature_toggle`    | `menu.platform.feature_toggle`    | planned |
| 通知中心 | —        | —                    | `notification_hub`  | `menu.platform.notification_hub`  | planned |
| 通知中心 | 发送记录 | `/notification-logs` | `notification_log`  | `menu.platform.notification_log`  | planned |

---

## 二、运营管理域（Operation Domain）

> 商业消费侧 — 承载租户、产品、订阅、交易、财务、客户服务等业务数据

| 分组     | 菜单项   | path                     | code                    | i18n                                   | 状态   |
| -------- | -------- | ------------------------ | ----------------------- | -------------------------------------- | ------ |
| 运营总览 | 运营总览 | `/`                      | `operation_overview`    | `menu.operation.overview`              | active |
| 运营总览 | 运营待办 | `/ops-todos`             | `operation_todo`        | `menu.operation.todo`                  | active |
| 租户账号 | —        | —                        | `tenant_account`        | `menu.operation.tenant_account`        | active |
| 租户账号 | 租户信息 | `/tenants`               | `tenant_profile`        | `menu.operation.tenant_profile`        | active |
| 租户账号 | 账号体系 | `/accounts`              | `account_system`        | `menu.operation.account_system`        | active |
| 租户账号 | 实名认证 | `/verifications`         | `identity_verification` | `menu.operation.identity_verification` | active |
| 产品体系 | —        | —                        | `product_system`        | `menu.operation.product_system`        | active |
| 产品体系 | 产品能力 | `/products`              | `product_capability`    | `menu.operation.product_capability`    | active |
| 产品体系 | 解决方案 | `/product-solutions`     | `solution_package`      | `menu.operation.solution_package`      | active |
| 产品体系 | 服务套餐 | `/service-plans`         | `service_plan`          | `menu.operation.service_plan`          | active |
| 产品体系 | 营销优惠 | `/promotions`            | `promotion_campaign`    | `menu.operation.promotion_campaign`    | active |
| 订阅交易 | —        | —                        | `subscription_trade`    | `menu.operation.subscription_trade`    | active |
| 订阅交易 | 订阅管理 | `/subscriptions`         | `subscription`          | `menu.operation.subscription`          | active |
| 订阅交易 | 交易订单 | `/orders`                | `order_record`          | `menu.operation.order_record`          | active |
| 订阅交易 | 用量计费 | `/usage-metering`        | `usage_billing`         | `menu.operation.usage_billing`         | active |
| 订阅交易 | 优惠核销 | `/promotion-redemptions` | `promotion_redeem`      | `menu.operation.promotion_redeem`      | active |
| 商业分析 | 商业总览 | `/commerce-overview`     | `commerce_overview`     | `menu.operation.commerce_overview`     | active |
| 模型技能 | —        | —                        | `model_skill`           | `menu.operation.model_skill`           | active |
| 模型技能 | 模型授权 | `/model-grants`          | `model_access`          | `menu.operation.model_access`          | active |
| 模型技能 | 技能市场 | `/skills`                | `skill_market`          | `menu.operation.skill_market`          | active |
| 财务结算 | —        | —                        | `finance`               | `menu.operation.finance`               | active |
| 财务结算 | 账单中心 | `/billing`               | `billing_center`        | `menu.operation.billing_center`        | active |
| 财务结算 | 收款管理 | `/payments`              | `payment_record`        | `menu.operation.payment_record`        | active |
| 财务结算 | 发票管理 | `/invoices`              | `invoice_record`        | `menu.operation.invoice_record`        | active |
| 客户服务 | —        | —                        | `customer_service`      | `menu.operation.customer_service`      | active |
| 客户服务 | 工单中心 | `/tickets`               | `support_ticket`        | `menu.operation.support_ticket`        | active |
| 客户服务 | 消息公告 | `/announcements`         | `notification_message`  | `menu.operation.notification_message`  | active |

---

## 三、域边界规则

| 关注点 | 平台自治域                 | 运营管理域           |
| ------ | -------------------------- | -------------------- |
| 模型   | 模型平台（技术接入）       | 模型授权（商业授权） |
| 用户   | 平台用户（内部运营）       | 租户账号（客户）     |
| 配置   | 系统配置（参数/字典/开关） | 禁止配置类菜单       |
| 通知   | 通知渠道（能力供给）       | 消息公告（消费侧）   |

---

## 四、TS 初始化数据参考

`src/config/navigation.ts` 菜单数据结构参考，可用于初始化数据库菜单记录或代码配置：

```typescript
export const platformAutonomyMenus = [
  {
    type: "menu",
    name: "平台总览",
    code: "platform_overview",
    path: "/platform",
    i18nKey: "menu.platform.overview",
    status: "active",
  },
  {
    type: "group",
    name: "身份权限",
    code: "identity_access",
    i18nKey: "menu.platform.identity_access",
    status: "active",
    children: [
      {
        type: "menu",
        name: "平台用户",
        code: "platform_admin",
        path: "/platform-admins",
        i18nKey: "menu.platform.admin_user",
        status: "active",
      },
      {
        type: "menu",
        name: "平台角色",
        code: "platform_role",
        path: "/admin-roles",
        i18nKey: "menu.platform.admin_role",
        status: "active",
      },
      {
        type: "menu",
        name: "权限策略",
        code: "permission_policy",
        path: "/admin-permissions",
        i18nKey: "menu.platform.permission_policy",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "平台资源",
    code: "platform_resource",
    i18nKey: "menu.platform.platform_resource",
    status: "active",
    children: [
      {
        type: "menu",
        name: "模型平台",
        code: "model_gateway",
        path: "/model-platform",
        i18nKey: "menu.platform.model_gateway",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "运行保障",
    code: "runtime_ops",
    i18nKey: "menu.platform.runtime_ops",
    status: "active",
    children: [
      {
        type: "menu",
        name: "服务监控",
        code: "service_monitor",
        path: "/service-monitor",
        i18nKey: "menu.platform.service_monitor",
        status: "active",
      },
      {
        type: "menu",
        name: "任务调度",
        code: "job_scheduler",
        path: "/platform-jobs",
        i18nKey: "menu.platform.job_scheduler",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "安全审计",
    code: "security_audit",
    i18nKey: "menu.platform.security_audit",
    status: "active",
    children: [
      {
        type: "menu",
        name: "审计日志",
        code: "audit_log",
        path: "/audit-logs",
        i18nKey: "menu.platform.audit_log",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "系统配置",
    code: "system_setting",
    i18nKey: "menu.platform.system_setting",
    status: "planned",
    children: [
      {
        type: "menu",
        name: "参数配置",
        code: "system_parameter",
        path: "/system-parameters",
        i18nKey: "menu.platform.system_parameter",
        status: "planned",
      },
      {
        type: "menu",
        name: "开关控制",
        code: "feature_toggle",
        path: "/feature-toggles",
        i18nKey: "menu.platform.feature_toggle",
        status: "planned",
      },
    ],
  },
  {
    type: "group",
    name: "通知中心",
    code: "notification_hub",
    i18nKey: "menu.platform.notification_hub",
    status: "planned",
    children: [
      {
        type: "menu",
        name: "发送记录",
        code: "notification_log",
        path: "/notification-logs",
        i18nKey: "menu.platform.notification_log",
        status: "planned",
      },
    ],
  },
];

export const operationMenus = [
  {
    type: "menu",
    name: "运营总览",
    code: "operation_overview",
    path: "/",
    i18nKey: "menu.operation.overview",
    status: "active",
  },
  {
    type: "menu",
    name: "运营待办",
    code: "operation_todo",
    path: "/ops-todos",
    i18nKey: "menu.operation.todo",
    status: "active",
  },
  {
    type: "group",
    name: "租户账号",
    code: "tenant_account",
    i18nKey: "menu.operation.tenant_account",
    status: "active",
    children: [
      {
        type: "menu",
        name: "租户信息",
        code: "tenant_profile",
        path: "/tenants",
        i18nKey: "menu.operation.tenant_profile",
        status: "active",
      },
      {
        type: "menu",
        name: "账号体系",
        code: "account_system",
        path: "/accounts",
        i18nKey: "menu.operation.account_system",
        status: "active",
      },
      {
        type: "menu",
        name: "实名认证",
        code: "identity_verification",
        path: "/verifications",
        i18nKey: "menu.operation.identity_verification",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "产品体系",
    code: "product_system",
    i18nKey: "menu.operation.product_system",
    status: "active",
    children: [
      {
        type: "menu",
        name: "产品能力",
        code: "product_capability",
        path: "/products",
        i18nKey: "menu.operation.product_capability",
        status: "active",
      },
      {
        type: "menu",
        name: "解决方案",
        code: "solution_package",
        path: "/product-solutions",
        i18nKey: "menu.operation.solution_package",
        status: "active",
      },
      {
        type: "menu",
        name: "服务套餐",
        code: "service_plan",
        path: "/service-plans",
        i18nKey: "menu.operation.service_plan",
        status: "active",
      },
      {
        type: "menu",
        name: "营销优惠",
        code: "promotion_campaign",
        path: "/promotions",
        i18nKey: "menu.operation.promotion_campaign",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "订阅交易",
    code: "subscription_trade",
    i18nKey: "menu.operation.subscription_trade",
    status: "active",
    children: [
      {
        type: "menu",
        name: "订阅管理",
        code: "subscription",
        path: "/subscriptions",
        i18nKey: "menu.operation.subscription",
        status: "active",
      },
      {
        type: "menu",
        name: "交易订单",
        code: "order_record",
        path: "/orders",
        i18nKey: "menu.operation.order_record",
        status: "active",
      },
      {
        type: "menu",
        name: "用量计费",
        code: "usage_billing",
        path: "/usage-metering",
        i18nKey: "menu.operation.usage_billing",
        status: "active",
      },
      {
        type: "menu",
        name: "优惠核销",
        code: "promotion_redeem",
        path: "/promotion-redemptions",
        i18nKey: "menu.operation.promotion_redeem",
        status: "active",
      },
    ],
  },
  {
    type: "menu",
    name: "商业总览",
    code: "commerce_overview",
    path: "/commerce-overview",
    i18nKey: "menu.operation.commerce_overview",
    status: "active",
  },
  {
    type: "group",
    name: "模型技能",
    code: "model_skill",
    i18nKey: "menu.operation.model_skill",
    status: "active",
    children: [
      {
        type: "menu",
        name: "模型授权",
        code: "model_access",
        path: "/model-grants",
        i18nKey: "menu.operation.model_access",
        status: "active",
      },
      {
        type: "menu",
        name: "技能市场",
        code: "skill_market",
        path: "/skills",
        i18nKey: "menu.operation.skill_market",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "财务结算",
    code: "finance",
    i18nKey: "menu.operation.finance",
    status: "active",
    children: [
      {
        type: "menu",
        name: "账单中心",
        code: "billing_center",
        path: "/billing",
        i18nKey: "menu.operation.billing_center",
        status: "active",
      },
      {
        type: "menu",
        name: "收款管理",
        code: "payment_record",
        path: "/payments",
        i18nKey: "menu.operation.payment_record",
        status: "active",
      },
      {
        type: "menu",
        name: "发票管理",
        code: "invoice_record",
        path: "/invoices",
        i18nKey: "menu.operation.invoice_record",
        status: "active",
      },
    ],
  },
  {
    type: "group",
    name: "客户服务",
    code: "customer_service",
    i18nKey: "menu.operation.customer_service",
    status: "active",
    children: [
      {
        type: "menu",
        name: "工单中心",
        code: "support_ticket",
        path: "/tickets",
        i18nKey: "menu.operation.support_ticket",
        status: "active",
      },
      {
        type: "menu",
        name: "消息公告",
        code: "notification_message",
        path: "/announcements",
        i18nKey: "menu.operation.notification_message",
        status: "active",
      },
    ],
  },
];
```

---

## 五、AI Coding 规则

- 菜单渲染从 `src/config/navigation.ts` 配置读取，禁止硬编码中文名称在业务逻辑中
- 权限判断使用 `code` 字段
- 路由跳转使用 `path` 字段
- `planned` 状态菜单显示「待建设」Badge，对应路由走 `[...slug]/page.tsx` 兜底
- 禁止删除 `planned` 菜单定义，后续数据库和权限模型需要预留 `code`
- 新增菜单必须先在本文档确认 path/code/i18n/status，再写代码
