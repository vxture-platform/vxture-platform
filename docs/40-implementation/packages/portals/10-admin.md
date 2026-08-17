# @vxture/admin

> 架构层参考：[`docs/30-design/architecture/00-index.md`](../../../30-design/architecture/00-index.md)

---

## 包信息

| 项     | 值                       |
| ------ | ------------------------ |
| 包名   | `@vxture/admin`          |
| 路径   | `portals/admin/`         |
| @layer | `Presentation`           |
| 框架   | Next.js 15（App Router） |

## 职责

平台运营后台：面向平台运营者，管理租户、账单、用户、配置、工单等。
Varda 智能助手嵌入点（admin surface），入口文件 `src/layout/VardaAdminChat.tsx`。

## 路由结构

单一路由组 `(admin)/`，所有运营页面在此组下。

```
app/
├── login/                      ← 登录页（无 layout）
├── (admin)/
│   ├── layout.tsx              ← AdminShell（含 Varda 入口）
│   ├── accounts/               ← 账号管理
│   ├── admin-roles/            ← 平台管理员角色
│   ├── admin-permissions/      ← 平台权限管理
│   ├── announcements/          ← 公告管理
│   ├── approval-center/        ← 审批中心
│   ├── audit-logs/             ← 审计日志
│   ├── billing/ [billId]/      ← 账单管理
│   ├── commerce-overview/      ← 商务概览
│   ├── data-dictionaries/      ← 数据字典
│   ├── feature-toggles/        ← 功能开关
│   ├── invoices/               ← 发票管理
│   ├── model-platform/          ← 模型平台配置
│   ├── model-grants/           ← 模型授权管理
│   ├── notification-channels/  ← 通知渠道配置
│   ├── notification-logs/      ← 通知日志
│   ├── ops-todos/              ← 运营待办
│   ├── orders/ [orderId]/      ← 订单管理
│   ├── payments/               ← 支付记录
│   ├── plans/                  ← 计划管理
│   ├── platform/               ← 平台配置
│   ├── platform-admins/        ← 平台管理员
│   ├── platform-jobs/          ← 平台任务
│   ├── platform-secrets/       ← 平台密钥
│   ├── product-plans/          ← 产品方案
│   ├── products/ [productCode]/← 产品管理
│   ├── product-solutions/      ← 产品解决方案
│   ├── promotion-redemptions/  ← 促销兑换
│   ├── promotions/             ← 促销管理
│   ├── service-monitor/        ← 服务监控
│   ├── service-plans/          ← 服务套餐
│   ├── skills/                 ← 技能管理
│   ├── subscriptions/ [id]/    ← 订阅管理
│   ├── system-parameters/      ← 系统参数
│   ├── tenants/ [tenantId]/    ← 租户管理
│   ├── tickets/                ← 工单管理
│   ├── usage-metering/         ← 用量计量
│   └── verifications/          ← 租户认证审核
└── api/dev-services/           ← 开发环境 API mock
```

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/core-locale
✅ admin-bff（HTTP only）
❌ @vxture/service-* / core-auth / core-api / core-config / core-tenant
❌ @vxture/model-runtime-client / agent-server/*
```

## Varda 接入

- 入口：`src/layout/VardaAdminChat.tsx`
- Surface：`admin`，userType：`platform_operator`
- 接通状态：✅ 一期完成（`bff/varda-bff` + `agent-server/varda` + `agent-studio/varda` 三端运行中）
