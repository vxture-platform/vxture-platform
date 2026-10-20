# Commerce 域细化设计：provisioning（开通生命周期 + webhook 投递）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_commerce_220`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 姊妹文件：[`data_commerce_200_metering.md`](./data_commerce_200_metering.md)（计量）、[`data_commerce_210_billing.md`](./data_commerce_210_billing.md)（账务）
> 取代范围：本文取代 [`data_platform_200_schema.md`](./data_platform_200_schema.md) §10（commerce provisioning）字段级内容。
> 命名清理：`tenant_app_provisioning`/`app_webhook_delivery` 因 schema 名（`provisioning`）已限定上下文，简化为 `provisionings`/`webhook_deliveries`。

---

## 0. 定位：开通与订阅正交，方向与 consume 相反

### 2026-10-20：Atlas 健康看门持久化（#562，待迁移/发布）

沿用后台作业宿主 schema，增加三张独立状态表：`health_watch_state`（watcher 主键、事件游标、首次同步标记、连续存活失败次数）、`health_watch_events`（源事件 id 主键，重放去重）、`health_watch_subjects`（对象类型+对象键复合主键、状态指纹、通知轮次及当前通知引用）。不保存凭据、用户或工作区标识。

作业持有 session advisory lock，跨副本串行；存活结果独立事务落库，三次失败告警、成功恢复。完整拉完事件后，在同一事务处理去重、对象状态、Admin 通知和最终游标；任一失败整体回滚。首次同步静默消化历史，仅根据当前快照通知异常。对象恢复结束当前通知，再次故障以持久化轮次建立新通知。源事件不清理，游标丢失重放仍受事件 id 去重保护。

通知仍通过 notice 包唯一系统写路；`svc_platform_api` 仅新增通知的 `expires_at/updated_at` 更新权限。迁移是独立增量文件，不运行重置或全量 seed。

| 维度     | 订阅（metering/billing）                                    | 开通（本 schema）                                                                                     |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 表达     | 商业权利：workspace 买了哪个 plan_version、配额池余量、账单 | 业务空间初始化：外部产品仓这个 workspace 的业务空间是否已建/已拆                                      |
| SoT      | `metering.subscriptions` + `quota_pools`                    | `provisionings`（状态机）                                                                             |
| 触发关系 | 订阅创建/变更触发开通事件                                   | 开通不等于订阅：可"已订未开(pending)"、"退订但延迟拆除(仍 provisioned)"、"跨 plan 升降级期间保持不变" |

**方向性**：`webhook_deliveries` = 平台→产品（outbound、异步、webhook 推送）；metering 的 consume = 产品→平台（inbound、同步）。两者方向/协议/SoT 全不同，不可复用同一通道。

---

## 1. `provisionings`（开通状态机）

| 字段                        | 类型        | 约束                                 | 说明                                               |
| --------------------------- | ----------- | ------------------------------------ | -------------------------------------------------- |
| `id`                        | uuid        | PK                                   |                                                    |
| `workspace_id`              | uuid        | NOT NULL, FK→`tenancy.workspaces.id` | 开通主体（真实主体）                               |
| `tenant_id`                 | uuid        | NOT NULL, FK→`tenancy.tenants.id`    | 结算/rollup 反查                                   |
| `product_id`                | uuid        | NOT NULL, FK→`product.products.id`   |                                                    |
| `status`                    | varchar(32) | NOT NULL DEFAULT `'pending'`, CHECK  | pending/provisioned/deprovisioned                  |
| `version`                   | int         | NOT NULL DEFAULT 0                   | 单调递增，乐观锁+投递排序键                        |
| `provisioned_at`            | timestamptz | NULL                                 |                                                    |
| `deprovisioned_at`          | timestamptz | NULL                                 |                                                    |
| `metadata`                  | jsonb       | NULL                                 | 开通上下文（区域/初始化参数/产品侧 space_id 回执） |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()               |                                                    |

约束：`UNIQUE(workspace_id, product_id)`——每 workspace+product 至多一条。

**状态机**（三态，不超前加 transient/failed）：`pending`（订阅已建、待推送开通）→ `provisioned`（产品回执成功）→ `deprovisioned`（退订后拆除完成）。重新订阅 = **复用同一行**（受唯一约束），`deprovisioned → pending → provisioned` 回流，每跳 `version += 1`。

**`version` 双职**：① 乐观锁，防并发状态迁移互相覆盖；② 投递排序键——`webhook_deliveries` 携带迁移时的 `version`，产品端据此丢弃乱序到达的旧事件。

**不含 `plan_id`**（落实正交）：开通生命周期不依赖具体 plan——同一 workspace 跨 plan 升降级期间保持 `provisioned` 不变，"开通时挂哪个 plan" 属审计信息，归 §2 投递 payload。

**操作人（actor）**：本表是**系统触发型**（状态迁移由订阅操作/退订/系统级联触发），**不设独立 actor 字段**——问责落在触发源（`metering.subscriptions` 变更的 `actor`）+ 中央 `support.audit_logs`，遵 [`data_commerce_200_metering.md §0.1`](./data_commerce_200_metering.md) 约定。若未来支持"运营手工强制开通/拆除"，再按 §0.1 补 `actor_type`+`actor_id`。`webhook_deliveries` 同为系统投递，无人工 actor。

## 2. `webhook_deliveries`（投递记录：retry / lease / 幂等 / 终态）

平台 → 产品 的 outbound 投递队列（可变工作队列；不套 append-only、无需分区）。

| 字段                                                 | 类型         | 约束                                 | 说明                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                 | uuid         | PK                                   |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `idempotency_key`                                    | varchar(128) | UNIQUE NOT NULL                      | **修正**：派生须含 `workspace_id`——product_id 被同产品所有 workspace 共享、provisioning_version 每行各自从 0 起(非全局唯一)，仅靠二者不同 workspace 首个 provisioned 会撞键。开通类：`hash(workspace_id+product_id+event_type+provisioning_version)`；**非升版事件**(subscription_changed/quota_warning，不自增 version)另加**事件实例判别键**(如源记录 id/时间戳)，否则第二次同类事件被误判重复 |
| `provisioning_id`                                    | uuid         | NULL, FK→`provisionings.id`          | 可空：非开通类生命周期事件                                                                                                                                                                                                                                                                                                                                                                       |
| `provisioning_version`                               | int          | NULL                                 | 入队时的开通版本                                                                                                                                                                                                                                                                                                                                                                                 |
| `workspace_id`                                       | uuid         | NOT NULL, FK→`tenancy.workspaces.id` |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tenant_id`                                          | uuid         | NOT NULL, FK→`tenancy.tenants.id`    | rollup 反查                                                                                                                                                                                                                                                                                                                                                                                      |
| `product_id`                                         | uuid         | NOT NULL, FK→`product.products.id`   |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `event_type`                                         | varchar(64)  | NOT NULL                             | provisioned/deprovisioned/subscription_changed/quota_warning                                                                                                                                                                                                                                                                                                                                     |
| `payload`                                            | jsonb        | NOT NULL                             | 事件负载（含触发时的 plan_version_id 等审计上下文）                                                                                                                                                                                                                                                                                                                                              |
| `status`                                             | varchar(32)  | NOT NULL DEFAULT `'pending'`, CHECK  | pending/delivering/delivered/failed/dead                                                                                                                                                                                                                                                                                                                                                         |
| `attempts`                                           | int          | NOT NULL DEFAULT 0                   |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `max_attempts`                                       | int          | NOT NULL DEFAULT 8                   | 超过转 dead                                                                                                                                                                                                                                                                                                                                                                                      |
| `response_code`                                      | int          | NULL                                 | 末次 HTTP 响应码                                                                                                                                                                                                                                                                                                                                                                                 |
| `last_error`                                         | varchar(512) | NULL                                 |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `signature`                                          | varchar(256) | NULL                                 | HMAC 头值（`product.product_webhooks.webhook_secret_ref` 签发）                                                                                                                                                                                                                                                                                                                                  |
| `leased_by`                                          | varchar(64)  | NULL                                 | 抢占该行的 worker 标识                                                                                                                                                                                                                                                                                                                                                                           |
| `leased_until`                                       | timestamptz  | NULL                                 | 租约到期                                                                                                                                                                                                                                                                                                                                                                                         |
| `last_attempt_at` / `next_retry_at` / `delivered_at` | timestamptz  | NULL                                 |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `created_at` / `updated_at`                          | timestamptz  | NOT NULL DEFAULT now()               |                                                                                                                                                                                                                                                                                                                                                                                                  |

索引：`idx_claim (status, next_retry_at)`（投递队列领取）、`(workspace_id, product_id)`、`provisioning_id`。

**投递语义**：

- **入队幂等**：`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`。
- **lease 领取**：`UPDATE ... SET status='delivering', leased_by=:w, leased_until=now()+lease WHERE ... status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at<=now()) AND (leased_until IS NULL OR leased_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT :n`——`SKIP LOCKED` 多 worker 并行不抢锁；租约过期即可被另一 worker 接管。
- **retry/终态**：成功 → `delivered`；可重试失败 → `failed` + 指数退避 `next_retry_at`；`attempts>=max_attempts` → `dead`（死信，转人工/告警）。
- **签名**：投递前按 `product_id` 查 `product.product_webhooks` 取端点+密钥，HMAC 签名（平台自签密钥，非 Provider Key）。
- **非 append-only**：本表是**可变工作队列**，不套用 metering 的 append-only 触发器；亦无需分区（量远低于用量事件）。留存靠定期归档 `delivered` 旧行。

---

## 3. 与 `product.product_webhooks` 的分工

| 维度   | `product.product_webhooks`（静态端点配置） | `webhook_deliveries`（每次投递记录） |
| ------ | ------------------------------------------ | ------------------------------------ |
| 粒度   | 每产品一行                                 | 每次投递一行                         |
| 回答   | 发到哪、用哪个签名                         | 发了什么、结果如何                   |
| 性质   | 配置态，长存只读                           | 运行态，随事件产生、可归档           |
| schema | `product`                                  | `provisioning`                       |

调用链：`subscriptions` 变更 / `quota_pools` 预警 → `provisionings` 状态迁移(`version++`) → 幂等 `INSERT webhook_deliveries` → worker lease 领取 → 按 `product_id` join 端点+密钥 → HMAC 签名 POST → 落 `status`/`response_code`。

---

## 4. 跨 schema FK 速查表

| 从                                                           | 到                                           | 类型  | 依据                 |
| ------------------------------------------------------------ | -------------------------------------------- | ----- | -------------------- |
| `provisionings.workspace_id`                                 | `tenancy.workspaces.id`                      | 真 FK | 普通引用（本次修正） |
| `provisionings.tenant_id`                                    | `tenancy.tenants.id`                         | 真 FK | 普通引用             |
| `provisionings.product_id` / `webhook_deliveries.product_id` | `product.products.id`                        | 真 FK | 沿用既有先例         |
| `webhook_deliveries.workspace_id`/`tenant_id`                | `tenancy.workspaces.id`/`tenancy.tenants.id` | 真 FK | 普通引用（本次修正） |
| `webhook_deliveries.provisioning_id`                         | `provisionings.id`                           | 真 FK | 同 schema            |

---

## 5. 待办 / 开放项

- 迁移步骤由实施文档另定。
- `delivered` 旧行归档策略待定。
