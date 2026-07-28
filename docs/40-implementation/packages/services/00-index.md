# Service 层包文档

> @layer `Domain` | 框架：NestJS | 按域分组，跨 service 调用通过 HTTP
> 架构层参考：[`docs/30-design/architecture/04-service-layer.md`](../../../30-design/architecture/04-service-layer.md)

---

## 包列表

### Model 域

**已退役**（2026-07-28，拆仓至 `vxture-atlas`）：见 [`model-platform.md`](./40-model-platform.md)。所有 agent-server 的 LLM 调用仍必须经过 Atlas，只是它不再是本仓的一个包。

### Identity 域

| 包                                        | 路径                              | 职责                                       |
| ----------------------------------------- | --------------------------------- | ------------------------------------------ |
| [`iam.md`](./20-iam.md)                   | `services/identity/iam/`          | 账号隔离管理、账户生命周期、跨租户身份查询 |
| [`organization.md`](./50-organization.md) | `services/identity/organization/` | 组织结构、部门、成员关系                   |

### Commerce 域

| 包                                        | 路径                              | 职责                         |
| ----------------------------------------- | --------------------------------- | ---------------------------- |
| [`billing.md`](./10-billing.md)           | `services/commerce/billing/`      | 账单生成、支付流水、发票     |
| [`subscription.md`](./70-subscription.md) | `services/commerce/subscription/` | 订阅计划、用量配额、续期逻辑 |

### Notification 域

| 包                        | 路径                          | 职责                                   |
| ------------------------- | ----------------------------- | -------------------------------------- |
| [`mail.md`](./30-mail.md) | `services/notification/mail/` | 邮件发送服务（验证码、通知、重置密码） |
| [`sms.md`](./60-sms.md)   | `services/notification/sms/`  | 短信发送服务（验证码、告警）           |

### Support 域

| 包                            | 路径                       | 职责                                 |
| ----------------------------- | -------------------------- | ------------------------------------ |
| [`ticket.md`](./80-ticket.md) | `services/support/ticket/` | 工单管理：创建、分配、状态流转、消息 |

---

## 核心约束

- **禁止**跨 service 直接 import，跨服务调用必须走 HTTP
- **禁止**向上引用 bff / portals / agent-studio
- PrismaClient 只在 service 层 repository 子层使用，禁止在 BFF 或更高层直接操作数据库
- Atlas 是所有 LLM 调用的唯一入口，禁止绕过直连 provider SDK
