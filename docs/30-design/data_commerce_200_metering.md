# Commerce 域细化设计：metering（订阅 / 配额 / 用量计量内核）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_commerce_200`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 姊妹文件：[`data_commerce_210_billing.md`](./data_commerce_210_billing.md)（账务）、[`data_commerce_220_provisioning.md`](./data_commerce_220_provisioning.md)（开通）
> 取代范围：本文取代 [`data_platform_200_schema.md`](./data_platform_200_schema.md) §8（commerce 权益域）字段级内容。
> 拆分依据：原 `commerce` schema 24 表混装权益/账务/开通三段。按写入频率、事务特征、生命周期拆为 `metering`/`billing`/`provisioning` 三 schema，互不影响性能（同库跨 schema 零成本），各自独立 PG 角色/连接池。

---

## 0. 定位

计量内核是财务正确性核心：**consume 是唯一写入路径**，`quota_pools` 为实时余量 SoT，用量事件 append-only + 月分区。**计量主表**（`subscriptions`/`quota_pools`/`usage_events`/`usage_event_pools`/`usage_summary_*`/caches）以 `workspace_id` 为成本中心维度（非 `tenant_id`）；**订阅审计/子表**（`subscription_histories`/`subscription_renewals`/`subscription_entitlement_overrides`）挂 `tenant_id` 或仅 `subscription_id`（修正：原"全部表挂 workspace_id"绝对表述与子表实际不符）。

**周期模型（§2.2.4 铁律五，锚定周期、非自然月）**：订阅可在**任意日**开始，配额/计费一律**锚定订阅周期**（周年制——15 号订即每月 15 号刷新/结算），**不用日历自然月**。三个周期必须**同源**：① 配额重置锚点 `quota_pools.period_anchor`、② 计费周期 `subscriptions.start_at`、③ 结算窗口（billing 从 `usage_events` 按 `[cycle_start, cycle_end)` 求和）。**`usage_summary_*` 是纯统计/分析/看板，从不作计费依据**（§9）——否则"日历月汇总对不上锚定周期"必然错账。

**跨 schema FK 修正（铁律一 sweep）**：本文所有 `workspace_id`/`tenant_id`/`subscription_id` 等域内引用，凡属普通引用（非四类边界）一律建真 FK——纠正旧文档"commerce 不建跨 schema FK 到 identity"的表述（该表述已按 §2.2.4 铁律一作废）。

### 0.1 actor 字段约定（commerce 三 schema `metering`/`billing`/`provisioning` 通用）

操作型记录"谁做的"统一按下列规则，取代此前散乱的 `operator_id`/`created_by`/`granted_by` 混用：

- **跨 realm 操作**（同一操作在正常流程下可能由 system / customer / operator 任一发起，如订阅、开票、支付、退款）：用 `actor_type varchar(16) CHECK(system/customer/operator)` + `actor_id uuid`（**loose**，按 `actor_type` 解引用 `account.users` 或 `admin.operator_accounts`，边界#2 不建 FK）。事件/流水/历史表（append-only，一行=一操作）直接用此对；可变实体表用 `created_by_type`+`created_by_id`（表达创建者）。
- **更新轨迹**：若该实体已有专门 history 表（如 `subscriptions`↔`subscription_histories`），主表**不设 `updated_by`**，避免与 history 重复。
- **realm 确定的专职角色**（如审核人 `auditor_id` 恒为 operator）：保留专名字段 + FK 语义注释，不套 `actor_type`。
- **系统型表**（consume 用量、归零、summary、webhook 投递等由 API/Job 驱动）：不设人工 actor，其"谁"是调用服务（`request_id` 串）或定时 Job。
- per-table actor 只承载"本记录语义上的谁"供展示；完整"谁改了什么何时改"的全量轨迹归 `support.audit_logs`（`actor_type`+`actor_id`），二者并存不互相替代。

---

## 1. `subscriptions`（订阅，workspace 化，指向 plan_version）

| 字段                        | 类型          | 约束                                                                                                               | 说明                                                                                                                     |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | uuid          | PK                                                                                                                 |                                                                                                                          |
| `tenant_id`                 | uuid          | FK→`tenancy.tenants.id`                                                                                            | 账单 rollup 反查 org                                                                                                     |
| `workspace_id`              | uuid          | NOT NULL, FK→`tenancy.workspaces.id`                                                                               | 真实主体                                                                                                                 |
| `plan_version_id`           | uuid          | NOT NULL, FK→`product.plan_versions.id`                                                                            | 引用不可变版本                                                                                                           |
| `subscription_kind`         | varchar(16)   | NOT NULL, CHECK(paid/trial/free)                                                                                   | 订阅性质；三类可选周期集不同（见 §1.1，业务端 plan 配置）                                                                |
| `cycle_unit`                | varchar(16)   | NOT NULL, CHECK(day/week/month/year/perpetual)                                                                     | 周期单位（替代旧 `cycle_type`）                                                                                          |
| `cycle_count`               | int           | NOT NULL DEFAULT 1                                                                                                 | 周期倍数：7天=`day×7`、14天=`day×14`、月=`month×1`、季度=`month×3`、年=`year×1`、永久=`perpetual`（count 无意义）        |
| `start_at`                  | timestamptz   | NOT NULL                                                                                                           | 周期锚点，投影为 `quota_pools.period_anchor`（§4）                                                                       |
| `end_at`                    | timestamptz   | NULL                                                                                                               | 当前周期/订阅终止时刻；**NULL = 永久或开放式滚动**（perpetual 或 auto_renew）                                            |
| `trial_end_at`              | timestamptz   | NULL                                                                                                               | 试用到期（kind=trial）；到期 `status→expired`，**仅人工延期**（operator 改期，记 §2 history）                            |
| `had_trial_at`              | timestamptz   | NULL                                                                                                               | 曾试用标记（防重复领试用）                                                                                               |
| `status`                    | varchar(32)   | NOT NULL DEFAULT `'active'`, CHECK                                                                                 | active/trialing/expired/cancelled/suspended（取值集业务定，结构占位）                                                    |
| `auto_renew`                | boolean       | NOT NULL DEFAULT true                                                                                              | 到期是否自动续期。paid=true(续期+计费) / free 周期型=true(续期不计费) / **trial=false(到期人工延期)** / perpetual 无意义 |
| `activation_method`         | varchar(24)   | NOT NULL DEFAULT `'online_purchase'`, CHECK(online_purchase/offline_purchase/redemption/operator_grant/trial/free) | **新增·开通方式**（可追溯来源）；`redemption`=兑换码激活（见 promotion 域）；可扩展枚举                                  |
| `next_renewal_at`           | timestamptz   | NULL                                                                                                               | **新增·自动续订**：下次续订触发时刻（≈ end_at 提前量）；`auto_renew=false` 或 perpetual 时 NULL                          |
| `renewal_source`            | varchar(16)   | NULL, CHECK(mandate/balance/manual)                                                                                | **新增**：续订资金来源。mandate=代扣签约(billing.payment_mandates) / balance=预付余额扣 / manual=人工                    |
| `payment_mandate_id`        | uuid          | NULL, FK→`billing.payment_mandates.id`                                                                             | **新增**：renewal_source=mandate 时绑定的代扣协议                                                                        |
| ~~`order_no`~~              | —             | **已删（product_330 P2-e，2026-09-06）**                                                                           | 订阅可视码 = `current_order_id → billing.orders.order_no`；旧列与 `payment_ttl_minutes` 一并退役                         |
| `pay_amount`                | numeric(12,2) | NULL                                                                                                               | 与 `plan_version.price` 分离                                                                                             |
| `currency`                  | varchar(16)   | DEFAULT `'CNY'`                                                                                                    |                                                                                                                          |
| `created_by_type`           | varchar(16)   | NOT NULL, CHECK(system/customer/operator)                                                                          | §0.1 actor 约定；订阅可客户自助或运营代建，故跨 realm                                                                    |
| `created_by_id`             | uuid          | NULL                                                                                                               | loose，按 type 解引用 account.users / admin.operator_accounts（边界#2）                                                  |
| `created_at` / `updated_at` | timestamptz   | NOT NULL DEFAULT now()                                                                                             |                                                                                                                          |
| `deleted_at`                | timestamptz   | NULL                                                                                                               |                                                                                                                          |

索引：`idx_deleted_at`。同 `(workspace, plan)` 不设唯一约束（同 product 可"附带+单独订"多笔）。续费/升级 = 新增订阅指向新版本，不改老订阅。**更新轨迹见 §2 `subscription_histories`（故本表不设 updated_by）。**

### 1.1 三类订阅 × 周期（周期选项在业务端 plan 配置，本表只记录选定值）

| kind    | 可选周期（plan 配置）                                                  | 续期/到期                                                                         | 计费              |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| `paid`  | 月 / 季度 / 年 = `month×1` / `month×3` / `year×1`                      | `auto_renew=true` 自动续期+计费                                                   | 是（billing §10） |
| `trial` | 7天 / 14天 / 月 = `day×7` / `day×14` / `month×1`                       | `auto_renew=false`；到期 `status=expired`，**仅人工延期**（operator 改期，记 §2） | 否                |
| `free`  | 月 / 季度 / 年 / 永久 = `month×1` / `month×3` / `year×1` / `perpetual` | 周期型续期不计费；`perpetual` → `end_at=NULL` 永不过期                            | 否                |

- **可选组合由 `product.plan_version` 配置**（哪个 plan 提供哪些周期+价格），**不写死 DB CHECK**（cycle_unit/kind 的 CHECK 只是结构枚举）；本表 `subscription_kind`/`cycle_unit`/`cycle_count` 只**记录订阅时选定的具体值**，结构上能表达任意 (kind, unit, count) 组合——满足"全在业务端配置"。
- **结构不变量**（结构级，**须落 DDL CHECK**，修正：原仅文字承诺无约束）：`CHECK (cycle_unit <> 'perpetual' OR end_at IS NULL)`；`CHECK (subscription_kind <> 'trial' OR auto_renew = false)`。
- **周期锚定**：`start_at` → `quota_pools.period_anchor`，配额按此周期刷新（§4）；`perpetual` 的 `quota_pools.reset_period` 可为 `none`（一次性授予）或仍按内含量周期刷新——**订阅期限与配额刷新节奏两个轴独立**。
- **待 product 域**：`product.plan_version` 需承载"该 plan 提供的周期集 + 各周期价格"（cycle_unit/count + price），subscribe 时投影到本表选定值。

## 2. `subscription_histories`（订阅变更审计，append-only）

| 字段                                          | 类型         | 约束                                                         | 说明                                                                                   |
| --------------------------------------------- | ------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `id`                                          | uuid         | PK                                                           |                                                                                        |
| `tenant_id`                                   | uuid         | FK→`tenancy.tenants.id`                                      |                                                                                        |
| `subscription_id`                             | uuid         | FK→`subscriptions.id`                                        |                                                                                        |
| `change_type`                                 | varchar(32)  | NOT NULL                                                     | created/renewed/upgraded/downgraded/cancelled                                          |
| `from_plan_version_id` / `to_plan_version_id` | uuid         | NULL                                                         |                                                                                        |
| `from_status` / `to_status`                   | varchar(32)  | NULL                                                         |                                                                                        |
| `actor_type`                                  | varchar(16)  | NOT NULL DEFAULT `'system'`, CHECK(system/customer/operator) | §0.1 actor 约定（原 `operator_type`，改名——变更可由客户/运营/系统发起，非仅 operator） |
| `actor_id`                                    | uuid         | NULL                                                         | loose，按 actor_type 解引用；边界#2 不建 FK（原 `operator_id`）                        |
| `remark`                                      | varchar(512) | NULL                                                         | 原 `operator_remark`，去 operator 前缀（actor 未必是 operator）                        |
| `client_ip`                                   | varchar(64)  | NULL                                                         |                                                                                        |
| `created_at`                                  | timestamptz  | NOT NULL DEFAULT now()                                       |                                                                                        |

索引：`change_type`、`created_at`、`subscription_id`、`tenant_id`。

### 2.1 `subscription_renewals`（自动续订执行 + 催款/重试，可变工作队列）【结构预留，业务陆续接】

自动续订（`subscriptions.auto_renew=true`）的**执行与催款(dunning)**记录：定时 Job 扫 `next_renewal_at ≤ now()` 的订阅 → 按 `renewal_source` 扣款（代扣/余额）→ 成功则延长周期 + 记 §2 history；失败进重试/催款。区别于 append-only 的 §2 history——本表是**可变队列**（含 attempts/next_retry/dunning）。

| 字段                        | 类型          | 约束                                                                                       | 说明                                          |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `id`                        | uuid          | PK                                                                                         |                                               |
| `subscription_id`           | uuid          | NOT NULL, FK→`subscriptions.id`                                                            |                                               |
| `tenant_id`                 | uuid          | NOT NULL, FK→`tenancy.tenants.id`                                                          |                                               |
| `cycle_seq`                 | int           | NOT NULL                                                                                   | 第几个续订周期（幂等键之一）                  |
| `scheduled_at`              | timestamptz   | NOT NULL                                                                                   | 计划执行时刻                                  |
| `renewal_source`            | varchar(16)   | NOT NULL, CHECK(mandate/balance/manual)                                                    | 快照自订阅                                    |
| `status`                    | varchar(16)   | NOT NULL DEFAULT `'pending'`, CHECK(pending/processing/succeeded/failed/dunning/abandoned) |                                               |
| `attempt_count`             | int           | NOT NULL DEFAULT 0                                                                         |                                               |
| `max_attempts`              | int           | NOT NULL DEFAULT 4                                                                         | 超过转 abandoned（订阅到期/降级）             |
| `next_retry_at`             | timestamptz   | NULL                                                                                       | 催款重试时刻（指数退避）                      |
| `dunning_stage`             | int           | NULL                                                                                       | 催款阶段（提醒/降级/停服）                    |
| `amount`                    | numeric(12,2) | NULL                                                                                       | 本期续订应扣额                                |
| `result_transaction_id`     | uuid          | NULL, FK→`billing.transactions.id`                                                         | 成功扣款流水                                  |
| `result_invoice_id`         | uuid          | NULL, FK→`billing.invoices.id`                                                             | postpaid 出账时                               |
| `new_period_end`            | timestamptz   | NULL                                                                                       | 续订后新周期末（回写 `subscriptions.end_at`） |
| `failure_reason`            | varchar(256)  | NULL                                                                                       |                                               |
| `created_at` / `updated_at` | timestamptz   | NOT NULL DEFAULT now()                                                                     |                                               |

约束：`UNIQUE(subscription_id, cycle_seq)`（每期幂等，防重复续订）。索引：`(status, next_retry_at)`（队列领取）、`(tenant_id)`。

- **可变队列**：不套 append-only；成功续订同时写一条 §2 `subscription_histories(change_type='renewed')`。
- **失败进 dunning**：重试+提醒；`attempt_count ≥ max_attempts` → `abandoned`，订阅 `status→expired`/降级。
- **资金来源**：`mandate`=网关代扣（billing.payment_mandates）；`balance`=从 `billing.credits` 扣（钱包/预付）；`manual`=人工。对齐铁律六（付费模式）。

## 3. `subscription_entitlement_overrides`（运营手工权益覆盖）

| 字段                        | 类型        | 约束                     | 说明                                                                                                       |
| --------------------------- | ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid        | PK                       |                                                                                                            |
| `subscription_id`           | uuid        | FK→`subscriptions.id`    |                                                                                                            |
| `product_id`                | uuid        | FK→`product.products.id` |                                                                                                            |
| `override_tier_code`        | varchar(32) | NOT NULL                 |                                                                                                            |
| `operator_id`               | uuid        | NULL                     | 权益覆盖是**运营专属操作**，realm 确定=operator（§0.1 保留专名）→ 逻辑引用 admin.operator_accounts，边界#2 |
| `reason`                    | text        | NULL                     |                                                                                                            |
| `expires_at`                | timestamptz | NULL                     | NULL=长期有效                                                                                              |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()   |                                                                                                            |

约束：`UNIQUE(subscription_id, product_id)`。

## 4. `quota_pools`（实时余量 SoT，瀑布定序扣减）

| 字段                        | 类型         | 约束                                               | 说明                                                                                                                                                 |
| --------------------------- | ------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid         | PK                                                 |                                                                                                                                                      |
| `workspace_id`              | uuid         | NOT NULL, FK→`tenancy.workspaces.id`               |                                                                                                                                                      |
| `subscription_id`           | uuid         | NULL, FK→`subscriptions.id`                        | 可空（manual_override）                                                                                                                              |
| `product_id`                | uuid         | NOT NULL, FK→`product.products.id`                 |                                                                                                                                                      |
| `metric_key`                | varchar(64)  | NOT NULL                                           |                                                                                                                                                      |
| `quota_limit`               | bigint       | NOT NULL                                           |                                                                                                                                                      |
| `quota_used`                | bigint       | NOT NULL DEFAULT 0                                 | **禁裸读**，见 §4.1                                                                                                                                  |
| `priority`                  | int          | NOT NULL DEFAULT 100                               | 投影自 `plan_component.priority`，同键可重复                                                                                                         |
| `billing_kind`              | varchar(32)  | NOT NULL, CHECK(bundled_free/charged)              | bundled_free / charged（**修正**：补 CHECK 域约束）                                                                                                  |
| `pool_source`               | varchar(32)  | NOT NULL DEFAULT `'subscription'`                  | subscription / manual_override                                                                                                                       |
| `reset_period`              | varchar(16)  | NOT NULL DEFAULT `'none'`, CHECK(none/day/month)   | 含量刷新节奏，**按订阅锚定推进、非日历**                                                                                                             |
| `period_anchor`             | timestamptz  | NULL                                               | **新增**：周期锚点 = 订阅 `start_at`（manual_override 用 `effective_at`）；周期从此点按 reset_period **整段推进**（15 号锚即每月 15 号刷新，非月初） |
| `current_period_start`      | timestamptz  | NULL                                               | 当前活跃周期起点 = `period_anchor + k×reset_period ≤ now()`（锚定推进，**非 date_trunc 日历对齐**）；周期池强制非空（CHECK）                         |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK(active/retired) | active / retired，软退役绝不硬删（**修正**：补 CHECK 域约束）                                                                                        |
| `retired_at`                | timestamptz  | NULL                                               |                                                                                                                                                      |
| `granted_by`                | uuid         | NULL                                               | 逻辑引用（边界#2）                                                                                                                                   |
| `grant_reason`              | varchar(256) | NULL                                               |                                                                                                                                                      |
| `effective_at`              | timestamptz  | NOT NULL DEFAULT now()                             |                                                                                                                                                      |
| `expires_at`                | timestamptz  | NULL                                               |                                                                                                                                                      |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                             |                                                                                                                                                      |

CHECK：`(pool_source='subscription' AND subscription_id IS NOT NULL) OR pool_source='manual_override'`；`(reset_period='none') OR (current_period_start IS NOT NULL AND period_anchor IS NOT NULL)`。
索引：`idx_quota_pools_route (workspace_id, product_id, metric_key, priority)`。

**不设"活跃池 priority 唯一"约束**——两个独立 plan 默认 priority=100 须共存；瀑布确定性靠全序 `ORDER BY priority, billing_kind(bundled 先), effective_at, id`（同时是加锁顺序，防死锁）。

### 4.1 读路径周期感知（禁裸读，锚定周期）

```sql
-- period_floor：以订阅锚点 period_anchor 为基准，求 ≤ now() 的最近周期起点（锚定推进，非日历 date_trunc）
--   month: period_anchor + floor(月差(period_anchor, now())) 个月   （保留 15 号这类日锚）
--   day  : period_anchor + floor(日差) 天
period_floor(reset_period, period_anchor, now())

effective_used = CASE WHEN current_period_start < period_floor(reset_period, period_anchor, now())
                       THEN 0 ELSE quota_used END
remaining = quota_limit - effective_used
```

裸 `quota_used` O(1) 读作废——惰性归零下会返回过期满载余量。任何配额 gate / `/platform/entitlements` 一律走此表达式。**周期一律锚定 `period_anchor`，禁用 `date_trunc` 日历对齐**（否则"15 号订阅、1 号却重置配额"，见 §0 周期模型）。

## 5. `quota_pool_resets`（归零审计）

| 字段                | 类型        | 约束                   | 说明 |
| ------------------- | ----------- | ---------------------- | ---- |
| `id`                | uuid        | PK                     |      |
| `pool_id`           | uuid        | FK→`quota_pools.id`    |      |
| `period_start`      | timestamptz | NULL                   |      |
| `used_before_reset` | bigint      | NOT NULL               |      |
| `reset_at`          | timestamptz | NOT NULL DEFAULT now() |      |

使 `quota_used = SUM(命中池的 took，落在当前周期)` 可重建，归零可审计——否则真实漂移与合法归零无法区分。

## 6. `usage_events`（用量头，append-only，月分区）

```sql
metering.usage_events (
  id uuid DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES tenancy.workspaces(id),
  product_id   uuid NOT NULL REFERENCES product.products(id),
  metric_key   varchar(64) NOT NULL,
  total_amount     bigint NOT NULL,      -- 实扣 = SUM(明细.took)
  requested_amount bigint,                -- 409 审计用，可空
  idempotency_key varchar(128), request_id varchar(128),  -- 普通索引，全局 UNIQUE 见 usage_idempotencies
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)            -- 分区键必须进 PK
) PARTITION BY RANGE (created_at);         -- 按月，预建分区 + DEFAULT 兜底
```

索引：`idx_route (workspace_id, product_id, metric_key)`。**append-only**：`BEFORE UPDATE OR DELETE RAISE EXCEPTION` 触发器（分区父传播全分区），禁用 `DO INSTEAD NOTHING` RULE（会静默吞写）。

## 7. `usage_event_pools`（用量明细，每命中池一行，月分区）

```sql
metering.usage_event_pools (
  event_id uuid NOT NULL, event_created_at timestamptz NOT NULL,
  quota_pool_id uuid NOT NULL REFERENCES metering.quota_pools(id),  -- 池软退役不硬删，FK 永远可解
  took bigint NOT NULL,
  PRIMARY KEY (event_id, event_created_at, quota_pool_id),
  FOREIGN KEY (event_id, event_created_at) REFERENCES metering.usage_events(id, created_at)
) PARTITION BY RANGE (event_created_at);   -- 与头同步分区
```

**append-only**（**修正**：补与 §6 头表同等强制）：`usage_event_pools` 同挂 `BEFORE UPDATE OR DELETE RAISE EXCEPTION` 触发器（分区父传播全分区，禁用 `DO INSTEAD NOTHING` RULE）——否则明细 `took` 可被篡改/删除，破坏 §5「`quota_used = SUM(命中池 took)` 可重建」不变量。

## 8. `usage_idempotencies`（幂等权威，非分区）

| 字段               | 类型         | 约束                   | 说明                     |
| ------------------ | ------------ | ---------------------- | ------------------------ |
| `idempotency_key`  | varchar(128) | PK                     | 全局唯一，非分区表才成立 |
| `event_id`         | uuid         | NULL                   |                          |
| `event_created_at` | timestamptz  | NULL                   |                          |
| `consumed`         | bigint       | NULL                   |                          |
| `per_pool`         | jsonb        | NULL                   | 重放直接返回             |
| `created_at`       | timestamptz  | NOT NULL DEFAULT now() |                          |

跨月重试不再双扣；重放/并发重复键经 `ON CONFLICT` 分支返回先前结果（非约束错）。

## 9. `usage_summary_hours/_days/_weeks/_months/_years`（多维降采样，纯统计/看板，**永不作计费依据**）

> **定位（2026-07-04 强化）**：汇总表只服务**统计 / 分析 / 看板**——同一份原始用量按不同时间维度展示而已，跨月订阅也能在各维度看使用。**计费/结算一律不读汇总**：超额从 `usage_events` 按订阅锚定周期窗口 `[cycle_start, cycle_end)` 求和（billing §10）。原始记录 = `usage_events`（事件级，≈分钟分辨率）；汇总按 **时 / 天 / 周 / 月 / 年** 五档降采样。

**分维度留存期不同（按需减数据量）**：细粒度高频→只留近期；粗粒度低频→长留。定时 Job 逐层降采样累加（events→hours→days→weeks/months→years），过期按批量/分区 DROP。

| 表                     | 周期字段                            | 典型留存  | 来源                                       |
| ---------------------- | ----------------------------------- | --------- | ------------------------------------------ |
| `usage_summary_hours`  | `period_hour timestamptz`           | ~3 个月   | 从 `usage_events(_pools)` 幂等 upsert 累加 |
| `usage_summary_days`   | `period_day date`                   | ~13 个月  | 从小时层降级                               |
| `usage_summary_weeks`  | `period_week date`（ISO 周一）      | ~2 年     | 从天层降级                                 |
| `usage_summary_months` | `period_month varchar(8)`（YYYYMM） | ~5 年     | 从天层降级                                 |
| `usage_summary_years`  | `period_year varchar(4)`（YYYY）    | 长期/不删 | 从月层降级                                 |

五表统一字段结构：

| 字段                           | 类型        | 约束                       | 说明 |
| ------------------------------ | ----------- | -------------------------- | ---- |
| `id`                           | uuid        | PK                         |      |
| `workspace_id`                 | uuid        | FK→`tenancy.workspaces.id` |      |
| `product_id`                   | uuid        | FK→`product.products.id`   |      |
| `metric_key`                   | varchar(64) | NOT NULL                   |      |
| `period_*`（各表一列，见上表） | 见上表      | NOT NULL                   |      |
| `total_amount`                 | bigint      | NOT NULL DEFAULT 0         |      |
| `created_at` / `updated_at`    | timestamptz | NOT NULL DEFAULT now()     |      |

约束：各表 `UNIQUE(workspace_id, product_id, metric_key, period_*)`。**实时读 `quota_pools`（§4.1）、计费读 `usage_events`（billing §10）——本组五表两者都不承担，纯降采样统计。**

## 10. `entitlement_caches`（短 TTL 缓存，非 SoT）

| 字段           | 类型        | 约束                       | 说明 |
| -------------- | ----------- | -------------------------- | ---- |
| `id`           | uuid        | PK                         |      |
| `workspace_id` | uuid        | FK→`tenancy.workspaces.id` |      |
| `product_id`   | uuid        | FK→`product.products.id`   |      |
| `payload`      | jsonb       | NOT NULL                   |      |
| `resolved_at`  | timestamptz | NOT NULL DEFAULT now()     |      |
| `expires_at`   | timestamptz | NOT NULL                   |      |

约束：`UNIQUE(workspace_id, product_id)`。门控走实时 resolve，不读此表；仅供展示/调试加速。

---

## 11. consume 契约（唯一写入路径，单事务）

产品端/Model Platform 只 `POST /usage/consume {workspace, product, metric, amount, idempotency_key, request_id}`，**不直写用量表**。单事务（READ COMMITTED + 行锁）：

```
1. 幂等先占：INSERT usage_idempotencies(...) ON CONFLICT DO NOTHING RETURNING;
   无返回 → 键已占，读回已提交行，返回其 consumed + per_pool。
2. 锁定候选池：SELECT ... FROM quota_pools WHERE (ws,product,metric) AND active
   FOR UPDATE ORDER BY priority, billing_kind(bundled 先), effective_at, id;
3. 惰性归零：对 `current_period_start < period_floor(reset_period, period_anchor, now())` 的锁定池归零（**锚定推进、非日历**），同事务写 quota_pool_resets。
4. 模式分支(product_metric.consume_mode)：atomic → 不足额 ROLLBACK 返 409；divisible → 瀑布扣减。
5. UPDATE quota_pools.quota_used += took（已锁，安全）。
6. INSERT usage_events(头) + usage_event_pools × N；回填 usage_idempotencies。
```

Model Platform 对本 schema **只读**配额 gate（走 §4.1 表达式），consume 服务独占写。

---

## 12. 跨 schema FK 速查表

| 从                                                                                                    | 到                                                                                | 类型              | 依据                                               |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| `*.workspace_id`                                                                                      | `tenancy.workspaces.id`                                                           | 真 FK             | 普通引用（本次修正：原文档误标裸值）               |
| `subscriptions.tenant_id` 等                                                                          | `tenancy.tenants.id`                                                              | 真 FK             | 普通引用                                           |
| `*.product_id`                                                                                        | `product.products.id`                                                             | 真 FK             | 沿用既有先例                                       |
| `subscriptions.plan_version_id`                                                                       | `product.plan_versions.id`                                                        | 真 FK             | 普通引用                                           |
| `subscriptions.payment_mandate_id`、`subscription_renewals.result_transaction_id`/`result_invoice_id` | `billing.payment_mandates.id` / `billing.transactions.id` / `billing.invoices.id` | 真 FK             | 自动续订跨 schema（铁律一）                        |
| `subscription_entitlement_overrides.operator_id`、`quota_pools.granted_by`                            | `admin.operator_accounts.id`                                                      | **裸值**，不建 FK | 边界#2（运营专属操作，realm 确定=operator）        |
| `*.actor_id` / `created_by_id`（按 actor_type=customer\|operator 解引用）                             | `account.users.id` \| `admin.operator_accounts.id`                                | **裸值**，不建 FK | 边界#2（同列可能指两 realm，按 actor_type 解引用） |

---

## 13. 待办 / 开放项

- 迁移步骤（重灌/加列改造）由 `data_commerce_3**` 实施文档另定。
- `product_id`/`plan_version_id` 指向的 `product` 域表名待 product 域细化设计定案后核对（本文暂按复数化推定 `products`/`plan_versions`）。
- **锚定周期 `period_floor` 落地**：月锚保留日、月末（如 31 号锚遇 2 月）边界处理由实施文档定。
- **org 账单结构（billing 侧待决）**：锚定后不再是天然"自然月 org rollup"——各订阅按周年闭合周期；org 汇总账单的触发节奏（按日历月归集已闭合周期 vs 每订阅周年单独出账）需 billing 侧专门决策。
