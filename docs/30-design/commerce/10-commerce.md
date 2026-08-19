# Commerce 能力域设计

> ⚠️ **SUPERSEDED · 模型级过时（2026-07-20）——本文档已被 18-schema cutover + ADR-11 取代，仅存档，不得作为实施依据。**
> 取代关系：① 单 `commerce` schema 模型 → 已拆为 `metering`/`billing`/`provisioning`/`promotion` 四子域（权威 = `data_platform_100_architecture.md` §2.2 + `deploy/database/ddl/50_metering.sql` 等；本文 `commerce.tenant_*` 表名全部作废）；② per-tenant 订阅 + Feature Gating → **workspace×product 权益引擎**（[`../decisions/ADR-011-subscription-entitlement-design.md`]、[`../product_220_catalog-resource-model.md`]；`tenant_subscription_quota`/`tenant_subscription_override` 已退役）。本文为**模型级过时**（非命名 lag），故加 banner 而非逐条改表名。删除为独立动作，须 owner 确认。

**版本**：1.0.0
**更新**：2026-05-14
**范围**：订阅管理 / 配额分配 / 用量计量 / 账单 / 付款 / 退款 / Feature Gating

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md](../data_platform_100_architecture.md) + [-schema.md](../data_platform_200_schema.md)（本文不重述平台 DDL，只述本板块内容）。

---

## 1. Positioning

Commerce 域回答三个核心问题：

1. **租户买了什么**（订阅计划、配额、可访问 Agent）
2. **租户用了多少**（Token 消耗、工具调用次数，按维度聚合）
3. **租户欠多少、付了多少**（Invoice、Payment、Transaction 账本）

Commerce 域**不**负责：

- 模型路由和 LLM 调用（`@vxture/service-model-platform` 负责）
- 用户认证和 JWT（`@vxture/bff-auth` 负责）
- 租户创建和组织管理（`@vxture/service-iam` 负责）
- 通知发送（`@vxture/service-mail` / `@vxture/service-sms` 负责）

---

## 2. 三层模型

```
┌──────────────────────────────────────────────┐
│  product.*（产品目录层）                        │
│  plan / feature / plan_feature / plan_price   │
│  plan_agent / agent / agent_feature           │
│  • 静态配置，由运营后台维护                     │
│  • 定义"哪个计划包含哪些功能和配额"              │
└────────────────────┬─────────────────────────┘
                     │ 购买 / 订阅
┌────────────────────▼─────────────────────────┐
│  commerce.tenant_subscription（订阅状态层）    │
│  tenant_subscription_quota（配额快照）         │
│  tenant_subscription_override（定制覆盖）      │
│  • 记录"某租户当前购买了什么"                   │
│  • quota = plan_feature.quota_value 的快照    │
│  • override 用于企业/VIP 定制配额              │
└────────────────────┬─────────────────────────┘
                     │ 消耗 / 账单
┌────────────────────▼─────────────────────────┐
│  commerce.tenant_usage_event（用量事件流）     │
│  commerce.tenant_usage_summary（聚合快照）     │
│  commerce.tenant_invoice（账单）              │
│  commerce.tenant_payment（付款记录）           │
│  commerce.tenant_refund（退款）               │
│  commerce.tenant_transaction（不可变账本）     │
│  • 记录"租户消耗了多少、欠了多少、付了多少"     │
└──────────────────────────────────────────────┘
```

---

## 3. 数据库表概览

所有 Commerce 数据存储于平台主库（阿里云 RDS `vxturestudio_platform_main`）的 `product`（产品目录）与 `commerce`（租户交易状态）两个 Schema。表清单、列、索引、触发器与 Prisma 映射为字段级权威，见 **b（data_platform_200_schema.md）§commerce / §product**；域概览见 **a（data_platform_100_architecture.md）§3.4**。

- `product.*`（产品目录）：静态配置，由运营后台（`@vxture/bff-admin`）维护，变更极少。
- `commerce.*`（租户交易状态）：订阅/配额/用量/账单/付款/退款/账本等，多数随状态流转可更新；`tenant_usage_event` 仅追加、`tenant_transaction` 不可变（见 §9 不变量）。

---

## 4. 关键流程

### 4.1 PLG 注册 → 试用开通

```
租户注册成功（service-iam 触发事件）
  │
  ▼
service-subscription
  自动创建 commerce.tenant_subscription
    plan_code = 'free' 或 'starter-trial'
    status = 'trial'
    trial_ends_at = NOW() + 14 days
  │
  复制 product.plan_feature → commerce.tenant_subscription_quota
  │
  ▼
租户可立即使用 AI 功能（受 trial 配额限制）
```

**关键约束**：试用期内配额来自 `plan_feature.quota_value`，覆盖到 `tenant_subscription_quota`，model-platform 通过查 `tenant_subscription_quota` 校验配额，无需访问 product 层。

### 4.2 试用 → 付费升级

```
用户在 console 选择计划 → 提交支付
  │
  ▼
bff-console → service-billing
  创建 commerce.tenant_invoice（status = 'unpaid'）
  创建 commerce.tenant_payment（status = 'pending'）
  │
  ▼
调用第三方支付网关（微信支付 / 支付宝）
  │
  ├─ 回调 success
  │     service-billing 更新 payment.status = 'paid'
  │     写入 commerce.tenant_transaction（不可变账本）
  │     更新 invoice.status = 'paid'
  │     service-subscription 将 subscription.status 从 'trial' → 'active'
  │     重新写入 tenant_subscription_quota（根据新计划）
  │
  └─ 回调 failed / 超时
        payment.status = 'failed'
        invoice.status = 'overdue'（若超期）
        subscription.status 保持 'trial' 或过期
```

### 4.3 用量计量管道

```
Agent 调用 model-platform（当前 Model Platform 合并实现）
  │
  ▼
model-runtime（实时配额检查）
  查 commerce.tenant_usage_summary（stat_type='summary'）
  比对 commerce.tenant_subscription_quota
  → 配额不足：返回 QUOTA_EXCEEDED，拒绝调用
  → 配额充足：放行，向 LLM Provider 发起请求
  │
  ▼
LLM Provider 返回结果
  │
  ▼
model-runtime 写入 commerce.tenant_usage_event（Append-only）
  input_quota, output_quota, used_quota（CHECK: used = input + output）
  model_code, application_id, application_type, feature_code, tenant_id, request_id
  │
  ▼
异步聚合 Job（定时，非阻塞主路径）
  读取新的 usage_event
  → 更新 tenant_usage_summary（stat_type='detail'，按 agent+feature）
  → 更新 tenant_usage_summary（stat_type='summary'，租户级总计）
```

> **重要**：实时配额检查读 `tenant_usage_summary.summary`，不遍历 `usage_event`，保证低延迟。当前由 `@vxture/service-model-platform` 执行；目标架构中归属 `model-runtime`。

---

## 5. 订阅生命周期

### 5.1 状态定义

| 状态        | 描述                         |
| ----------- | ---------------------------- |
| `trial`     | 试用期，有配额但未付费       |
| `active`    | 付费有效期内                 |
| `expired`   | 到期未续费，功能受限         |
| `suspended` | 因欠款或违规被暂停，功能暂停 |
| `cancelled` | 用户主动取消，按期结束后终止 |

### 5.2 状态流转

```
[注册]
  │
  ▼
trial
  │
  ├─ 付款成功 ──────────────────────────────▶ active
  │                                              │
  ├─ trial 到期，未付款 ──────────────────────▶ expired
  │                                              │
  │                                              ├─ 续费成功 ──────────────▶ active
  │                                              │
  │                                              └─ 管理员操作 ────────────▶ suspended
  │
  └─ 管理员直接挂起 ─────────────────────────▶ suspended
                                                  │
                                                  └─ 恢复 ─────────────────▶ active

active
  │
  ├─ 到期未续费 ─────────────────────────────▶ expired
  │
  └─ 用户取消 ───────────────────────────────▶ cancelled（period end 后终止）
```

---

## 6. Feature Gating 机制

Feature Gating 决定"当前请求是否被允许执行"。检查链路（优先级从高到低）：

```
调用方传入 (tenantId, applicationId, applicationType, featureCode)
  │
  ▼
① 检查 tenant_subscription_override
     是否有针对该 (tenantId, applicationId, applicationType, featureCode) 的定制配额
     → 有：使用 override.quota_value（忽略 plan 配额）
     → 无：继续
  │
  ▼
② 检查 tenant_subscription_quota
     查找 (tenantId, featureCode) 的配额行
     is_unlimited = true → 放行（不检查用量）
     quota_value = 0 → 该 feature 不在当前计划中，拒绝
  │
  ▼
③ 对比 tenant_usage_summary（stat_type='summary'）
     used_quota ≥ quota_value → QUOTA_EXCEEDED
     used_quota < quota_value → 放行
```

**`service-subscription.hasFeature(tenantId, feature)`** 是面向业务层的简化检查接口，内部执行上述逻辑，返回 `boolean`。

---

## 7. 状态机详图

> 各状态列的取值枚举与 CHECK 约束为字段级权威，见 b §commerce（`tenant_payment` / `tenant_invoice` / `tenant_refund`）；本节只描述状态流转语义。

### 7.1 付款状态（`commerce.tenant_payment`）

```
pending → pending_verify → paid
                       └──→ failed
         pending / pending_verify → closed（超时）
         paid → refunding（申请退款）
```

### 7.2 账单状态（`commerce.tenant_invoice`）

`unpaid`（已生成，待付款）→ `paying`（付款进行中）→ `paid`（全额付清） / `partial`（部分付清，余额抵扣）；旁路：`cancelled`（作废）、`overdue`（逾期未付）。

### 7.3 退款状态（`commerce.tenant_refund`）

**审核状态（audit_status）**：`pending → approved | rejected`

**退款状态（refund_status）**：`pending → processing → success | failed`

---

## 8. 跨包职责表

| 包                               | 层           | 负责                                                     |
| -------------------------------- | ------------ | -------------------------------------------------------- |
| `@vxture/service-subscription`   | Domain       | 订阅状态管理、Feature Gating（`hasFeature`）、配额初始化 |
| `@vxture/service-billing`        | Domain       | Invoice 生成、Payment 处理、退款、Transaction 写入       |
| `@vxture/service-model-platform` | Domain       | 用量事件写入（`tenant_usage_event`）、实时配额检查       |
| `@vxture/bff-console`            | Application  | 订阅查询 / 升级 API、用量展示 API、支付发起 / 回调       |
| `@vxture/bff-admin`              | Application  | 订阅管理（挂起 / 恢复）、配额 Override 管理、账单查询    |
| `@vxture/console`                | Presentation | 订阅状态展示、用量仪表盘、升级引导                       |
| `@vxture/admin`                  | Presentation | 租户订阅管理、配额 Override 表单、财务报表               |

**数据所有权**：

| 操作                                    | 唯一写入者                                 |
| --------------------------------------- | ------------------------------------------ |
| `tenant_subscription.*` 状态流转        | `service-subscription`                     |
| `tenant_subscription_quota` 初始化/更新 | `service-subscription`（升降级时触发）     |
| `tenant_subscription_override`          | `bff-admin`（运营操作）                    |
| `tenant_usage_event` 写入               | `service-model-platform`（调用后立即写入） |
| `tenant_usage_summary` 更新             | `service-model-platform`（异步聚合 Job）   |
| `tenant_invoice` 生成                   | `service-billing`                          |
| `tenant_payment` 状态更新               | `service-billing`（支付回调中）            |
| `tenant_transaction` 写入               | `service-billing`（付款成功时，不可变）    |

---

## 9. 不变量与数据完整性约束

> 以下不变量的 DDL 实现（阻止改写的规则/触发器、CHECK 约束等）为字段级权威，见 b §commerce；本节只陈述业务不变量。

### 9.1 不可变账本

`commerce.tenant_transaction` 由数据库规则阻止 `UPDATE` / `DELETE`；需要更正时只能追加反向冲正记录。

### 9.2 用量事件仅追加

`commerce.tenant_usage_event` 是 Append-only：不存在 UPDATE，只有 INSERT；并强制 `used_quota = input_quota + output_quota`（由 CHECK 约束保证）。

### 9.3 配额快照 vs 用量计数器

`tenant_subscription_quota` **不是**计数器，是静态配置快照：

- 记录"租户该有多少配额"（从 plan_feature 复制而来）
- 实际已用量在 `tenant_usage_summary` 中
- 配额检查 = `usage_summary.used_quota` vs `subscription_quota.quota_value`
- 升降级时重写 `subscription_quota`，历史用量不受影响

### 9.4 Override 优先级

`tenant_subscription_override` 完全覆盖 `tenant_subscription_quota`，不叠加：

- Override 存在时：直接使用 override.quota_value，subscription_quota 被忽略
- Override 不存在时：使用 subscription_quota.quota_value

### 9.5 配额检查必须通过 model-platform

任何 LLM 调用必须经过 `service-model-platform`，禁止 agent-server 绕过直接访问 LLM Provider：

- 保证用量事件被完整记录
- 保证配额检查不被绕过
- 保证 API Key 不泄露给 agent-server 层

---

## 10. 当前阶段说明

| 功能            | 状态           | 备注                            |
| --------------- | -------------- | ------------------------------- |
| 订阅状态管理    | ✅ 已有 Schema | `service-subscription` 实现中   |
| Feature Gating  | ✅ 实现        | `hasFeature()` 已使用           |
| 用量事件记录    | ✅ 已有 Schema | model-platform 写入             |
| 用量聚合 Job    | ⚠️ 待实现      | 当前配额检查精度待评估          |
| Invoice 生成    | ⚠️ Schema 已有 | `service-billing` 逻辑待完善    |
| 支付接入        | 🚧 规划中      | 微信支付 / 支付宝回调流程待实现 |
| 退款流程        | 🚧 规划中      | Schema 已就绪，业务流程待实现   |
| 账单地址 / 发票 | 🚧 规划中      | 合规需求驱动，时间待定          |

> 参见 `docs/60-operations/tech-debt.md` 中与 Commerce 相关的技术债务条目。
