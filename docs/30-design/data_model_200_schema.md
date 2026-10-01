# Model 域细化设计：模型治理（平台库）+ Model Platform DB（独立库）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_model_200`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 取代范围：**取代** [`data_platform_200_schema.md`](./data_platform_200_schema.md) §11（model 治理域 + Model Platform DB）字段级内容。
> 命名规范：schema 单数、table 复数（§3.2.1）；本文表名已复数化。

---

## 0. 定位：跨两个物理库

model 域**横跨两个物理数据库**（这是真物理拆库，非命名空间拆分——`reqlog` 每次 AI 调用一条、写入量极高，与平台库共实例会伤 OLTP；provider Key 明文必须隔离）：

| 平面             | 库                                      | schema/内容                                                                                  |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| **模型治理配置** | 平台库 `vxturestudio_platform_main`     | `model` schema（§1，5 表）——provider/model/grant/price/policy，Model Platform 的**配置来源** |
| **模型运行时**   | 独立库 `vxturestudio_modelruntime_main` | `key`（密钥）/ `reqlog`（请求日志）/ `routing`（连接路由）三 schema（§4）                    |

**FK 政策（铁律一）**：

- 平台库 `model` schema **内部** + 对 `tenancy`（tenant_id）等 → **建真 FK**（普通引用）。
- **跨库**（平台库 ↔ Model Platform DB）→ **裸 UUID，不建 FK**（边界#1）；一致性靠单一 `request_id` + 应用层。
- **唯一上行写**回平台库的是 `commerce.metering.usage_events`（经 §3 consume，不绕过）。

---

## 1. `model` schema（平台库，模型治理配置，5 表）

### 1.1 `model_providers`（provider 注册表）

| 字段                                                  | 类型         | 约束                        | 说明                                                             |
| ----------------------------------------------------- | ------------ | --------------------------- | ---------------------------------------------------------------- |
| `id`                                                  | uuid         | PK                          |                                                                  |
| `provider_code`                                       | varchar(64)  | UNIQUE NOT NULL             | 可视码：doubao/claude/private…                                   |
| `provider_type`                                       | varchar(32)  | NOT NULL DEFAULT `'online'` | online/self_hosted/private                                       |
| `provider_name`                                       | varchar(128) | NOT NULL                    |                                                                  |
| `description`                                         | varchar(512) | NULL                        |                                                                  |
| `description_key`                                     | varchar(128) | NULL                        | i18n 键 `model.provider.{provider_code}.desc`                    |
| `logo_url`/`homepage_url`/`console_url`/`billing_url` | text         | NULL                        | 展示/运维，非敏感                                                |
| `is_active`                                           | boolean      | NOT NULL DEFAULT true       | 技术可用（≠展示可见）                                            |
| `is_customer_visible` / `is_workforce_visible`        | boolean      | NOT NULL DEFAULT true       | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活） |
| `config`                                              | jsonb        | NULL                        | 非敏感连接元数据（超时/区域）；**密钥不入此处**                  |
| `created_by`/`updated_by`                             | uuid         | NULL                        | 运营专属（边界#2）                                               |
| `created_at`/`updated_at`                             | timestamptz  | NOT NULL DEFAULT now()      |                                                                  |
| `deleted_at`                                          | timestamptz  | NULL                        |                                                                  |

**铁律**：本表及 `config` **不得**存 provider API Key（明文或可逆引用）——密钥归 §4.1 `key.provider_api_keys`（Model Platform DB，铁律：平台库永不接触明文）。

### 1.2 `models`（Vxture 模型注册表）

| 字段                                           | 类型         | 约束                          | 说明                                                             |
| ---------------------------------------------- | ------------ | ----------------------------- | ---------------------------------------------------------------- |
| `id`                                           | uuid         | PK                            |                                                                  |
| `provider_id`                                  | uuid         | NULL, FK→`model_providers.id` | 权威 provider 引用                                               |
| `model_code`                                   | varchar(128) | UNIQUE NOT NULL               | 调用方唯一引用键（可视码，不接触 key）                           |
| `model_type`                                   | varchar(32)  | NOT NULL DEFAULT `'chat'`     | chat/embedding/rerank…                                           |
| `protocol`                                     | varchar(64)  | NOT NULL                      | openai/anthropic…（adapter 选择）                                |
| `model_name`                                   | varchar(128) | NOT NULL                      |                                                                  |
| `description`                                  | varchar(512) | NULL                          |                                                                  |
| `description_key`                              | varchar(128) | NULL                          | i18n 键 `model.model.{model_code}.desc`                          |
| `endpoint_url`                                 | text         | NOT NULL                      | **权威二选一待决**：本列 vs `routing.provider_configs`（§6）     |
| `context_window` / `max_output_tokens`         | int          | NULL                          |                                                                  |
| `capabilities`                                 | text[]       | NOT NULL DEFAULT `'{}'`       | vision/tools/json_mode…                                          |
| `supports_streaming`                           | boolean      | NOT NULL DEFAULT true         |                                                                  |
| `is_active`                                    | boolean      | NOT NULL DEFAULT true         | 技术可用（≠展示可见）                                            |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true         | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活） |
| `sort`                                         | int          | NOT NULL DEFAULT 999          |                                                                  |
| `config`                                       | jsonb        | NULL                          | 非敏感运行时配置                                                 |
| `created_by`/`updated_by`                      | uuid         | NULL                          | 运营专属（边界#2）                                               |
| `created_at`/`updated_at`                      | timestamptz  | NOT NULL DEFAULT now()        |                                                                  |
| `deleted_at`                                   | timestamptz  | NULL                          |                                                                  |

**修订（沿用§11.2.2 裁定）**：deploy 曾同时有 `provider_id`(FK) + `provider`(varchar 冗余)——**退役 `provider` 字符串列，`provider_id` 为唯一权威 FK**（去双写防漂移）；运行时若需免 join 取 provider_code，用视图/投影列而非可写裸列。

### 1.3 `model_grants`（租户→模型技术授权/灰度白名单）

授权上界（**不是**配额、**不是**计费）——"这个租户能不能调这个模型"。

| 字段                      | 类型         | 约束                                                    | 说明                                                                                          |
| ------------------------- | ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`                      | uuid         | PK                                                      |                                                                                               |
| `model_id`                | uuid         | NOT NULL, FK→`models.id`                                |                                                                                               |
| `tenant_id`               | uuid         | NOT NULL, FK→`tenancy.tenants.id`                       | **本次修正**：授权主体，按铁律一建真 FK（原裸 uuid）                                          |
| `application_id`          | uuid         | NULL                                                    | 应用维度（agent/workflow/api_client/internal_service）；agent_catalog 落地前暂裸值（§2 调和） |
| `application_type`        | varchar(32)  | NULL, CHECK(agent/workflow/api_client/internal_service) | **补 CHECK**（deploy 为裸 varchar）                                                           |
| `agent_id`                | uuid         | NULL                                                    | **【退役过渡】** = application_id WHERE type='agent'；调用方切走后 drop                       |
| `priority`                | int          | NOT NULL DEFAULT 100                                    |                                                                                               |
| `is_active`               | boolean      | NOT NULL DEFAULT true                                   |                                                                                               |
| `reason`                  | varchar(512) | NULL                                                    |                                                                                               |
| `expires_at`              | timestamptz  | NULL                                                    |                                                                                               |
| `created_by`/`updated_by` | uuid         | NULL                                                    | 运营专属（边界#2）                                                                            |
| `created_at`/`updated_at` | timestamptz  | NOT NULL DEFAULT now()                                  |                                                                                               |
| `deleted_at`              | timestamptz  | NULL                                                    |                                                                                               |

**轴语义（关键）**：grant 维持 `tenant(+application)` 轴作**授权上界**，**不**改名为 workspace/product——授权（能不能调）与计量（扣谁额）是两套语义，经 §2 映射口径桥接（非列改名）。未来若需 workspace 级收窄授权，再加 `workspace_id NULL`。

### 1.4 `model_price_rules`（provider 成本费率）

Vxture 付给上游的钱（毛利分析/供应商结算），**不是**客户标价（客户费在 `product.plan_prices`）。版本化靠 effective_at/expires_at 叠加，无软删（append 新规则）。

| 字段                                                        | 类型          | 约束                       | 说明                                                                         |
| ----------------------------------------------------------- | ------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `id`                                                        | uuid          | PK                         |                                                                              |
| `model_id`                                                  | uuid          | NOT NULL, FK→`models.id`   |                                                                              |
| `billing_mode`                                              | varchar(32)   | NOT NULL DEFAULT `'token'` | token/request（决定计量 metric，§2）                                         |
| `currency`                                                  | varchar(16)   | NOT NULL DEFAULT `'CNY'`   |                                                                              |
| `unit_tokens`                                               | int           | NOT NULL DEFAULT 1000000   | 单价对应 token 基数（每百万）                                                |
| `input_unit_price`/`output_unit_price`/`request_unit_price` | numeric(18,8) | NOT NULL DEFAULT 0         | **成本费率例外**：per-token 极小，保 18,8（非 §3.2 的 18,6；登记为显式例外） |
| `is_active`                                                 | boolean       | NOT NULL DEFAULT true      |                                                                              |
| `effective_at`                                              | timestamptz   | NOT NULL DEFAULT now()     |                                                                              |
| `expires_at`                                                | timestamptz   | NULL                       | 新费率起给旧行置 expires_at                                                  |
| `created_by`/`updated_by`                                   | uuid          | NULL                       | 运营专属（边界#2）                                                           |
| `created_at`/`updated_at`                                   | timestamptz   | NOT NULL DEFAULT now()     |                                                                              |

**成本侧 vs 计费侧解耦**（§8.9②）：客户被扣的是 metric（如 ai.tokens）；Vxture 内部按本表换算成本，二者独立。

### 1.5 `model_policies`（访问速率门：限流+并发+上下文）

| 字段                              | 类型         | 约束                          | 说明                                               |
| --------------------------------- | ------------ | ----------------------------- | -------------------------------------------------- |
| `id`                              | uuid         | PK                            |                                                    |
| `model_id`                        | uuid         | NOT NULL, FK→`models.id`      |                                                    |
| `tenant_id`                       | uuid         | NULL, FK→`tenancy.tenants.id` | **NULL=平台默认策略**；本次修正建真 FK（nullable） |
| `name`                            | varchar(128) | NULL                          |                                                    |
| `priority`                        | int          | NOT NULL DEFAULT 100          |                                                    |
| `max_concurrent`                  | int          | NULL                          |                                                    |
| `rate_limit_rpm`                  | int          | NULL                          | requests/min                                       |
| `rate_limit_tpm`/`rate_limit_tpd` | bigint       | NULL                          | tokens/min、tokens/day（BIGINT，§3.2）             |
| `max_context_tokens`              | int          | NULL                          |                                                    |
| `is_active`                       | boolean      | NOT NULL DEFAULT true         |                                                    |
| `effective_at`/`expires_at`       | timestamptz  |                               | 版本化                                             |
| `created_by`/`updated_by`         | uuid         | NULL                          | 运营专属（边界#2）                                 |
| `created_at`/`updated_at`         | timestamptz  | NOT NULL DEFAULT now()        |                                                    |

约束：`UNIQUE(model_id, tenant_id)`。**限流 ≠ 配额**：policy 是技术速率门（防滥用/护上游 QPS），与 `commerce.quota_pools`（商业配额）正交，两者生成前都 gate 但读不同源。

---

## 2. scope-key 调和（旧轴 → 新轴，consume 硬前置）

`model_grants`/旧 usage 用 `tenant/application/agent` 轴；`commerce.metering` 用 `workspace/product/metric` 轴。两轴不打通则 consume 无从知扣哪个 quota_pool。**映射在 Model Platform 调 `POST /usage/consume` 之前一次性解析**，consume 只收 `{workspace_id, product_id, metric_key, amount, idempotency_key, request_id, intent?}`，不感知旧轴。

| 新轴           | 来源口径                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id` | 由 `tenant_id`+`product_id` → 该 tenant 下持有该 product 订阅的 workspace（`commerce.metering.subscriptions` active）                        |
| `product_id`   | `application_id`/`agent_id` 经 **`product.agent_catalog`** 解析所属 product（非 agent 应用按调用方声明的 product 上下文）                    |
| `metric_key`   | `model_price_rules.billing_mode`：token→token metric(divisible) / request→调用计数 metric(atomic)，consume_mode 见 `product.product_metrics` |

- **`amount` 口径**：token 模式 amount=计费 token 数（单一 BIGINT）；input/output 拆分**不进 commerce**，归 §4.2 `reqlog`。
- **grant 不参与计量轴改名**：仍按 tenant/application 轴做授权 gate；同一 `request_id` 串起 grant 决策 / quota 扣减 / reqlog 明细。
- **`product.agent_catalog` 跨轮硬前置**：application/agent→product 映射表（product 域规划态，本轮未落）；未落地则 scope-key 不可调和、consume 不可切。待 agent_catalog 立项按 product 域同构补。

---

## 3. Model Platform 接入面（只读配额 gate + consume 独占写）

consume 是 AI 热路径同步调用，拆读/写两面：

- **只读 gate**：授权 Model Platform 直读 `commerce.metering.quota_pools`（**须走周期感知 `effective_used`，严禁裸读 `quota_used`**）或专用 balance API；只读不扣。
- **consume 独占写**：实际扣减唯一经 `commerce` consume 单事务；Model Platform/产品端禁止直写任何用量/配额表。
- **同步 + 有界本地 fail-open + 异步对账**：commerce 不可用时按有界额度本地放行（保 AI 可用），事后异步对账补记 usage_events；fail-open 上限是运营配置（`admin.settings`）。

---

## 4. Model Platform DB（独立库 `vxturestudio_modelruntime_main`）

> 独立实例 `vx-modelruntime-pg`（当前 `vx-model-platform` 先复用平台库过渡）。**跨库不建 FK**（边界#1），一致性靠单一 `request_id` + 应用层。

### 4.1 `key` schema（provider 密钥，平台库永不接触明文）

**`provider_api_keys`**

| 字段                      | 类型         | 约束                        | 说明                                                                    |
| ------------------------- | ------------ | --------------------------- | ----------------------------------------------------------------------- |
| `id`                      | uuid         | PK                          |                                                                         |
| `provider_code`           | varchar(64)  | NOT NULL                    | **跨库逻辑引用** `model.model_providers.provider_code`（无 FK，边界#1） |
| `key_alias`               | varchar(128) | NOT NULL                    | 多 key 轮换/区分                                                        |
| `encrypted_key`           | bytea        | NOT NULL                    | AES-256 密文，内存解密，**绝不出库明文**                                |
| `key_scope`               | varchar(32)  | NOT NULL DEFAULT `'shared'` | shared/dedicated                                                        |
| `is_active`               | boolean      | NOT NULL DEFAULT true       |                                                                         |
| `last_rotated_at`         | timestamptz  | NULL                        |                                                                         |
| `created_at`/`updated_at` | timestamptz  | NOT NULL DEFAULT now()      |                                                                         |

约束：`UNIQUE(provider_code, key_alias)`。

**`key_rotation_logs`**：id / `provider_api_key_id` FK→`provider_api_keys.id`（同库真 FK）/ rotated_at / rotated_by / reason。

### 4.2 `reqlog` schema（高频请求日志 + 被丢 AI 维度，按月分区）

承接从 commerce 剥离的 AI 调用明细（input/output token 拆分、model_code、latency 等）。

```sql
reqlog.request_records (                              -- 每次 AI 请求一行（高频）
  id uuid DEFAULT gen_random_uuid(),
  request_id varchar(128) NOT NULL,                   -- 跨库关联键 → commerce.metering.usage_events.request_id
  tenant_id uuid, workspace_id uuid, product_id uuid, user_id uuid,  -- 归属维度（跨库裸值，审计保留）
  application_id uuid, application_type varchar(32), agent_id uuid, feature_id uuid,
  downstream_identity_hash varchar(128),              -- tenant+workspace+product+user 哈希（应用层统一函数现算）
  model_code varchar(128), provider_code varchar(64),
  input_tokens bigint, output_tokens bigint, total_tokens bigint,
  latency_ms int, usage_type varchar(16),             -- normal|retry|test
  status varchar(32),                                 -- success|error|timeout
  business_id varchar(128),
  billed_metric_key varchar(64), billed_amount bigint,
  usage_event_id uuid,                                -- 跨库引用 usage_events.id（无 FK）
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);                    -- 按月，预建+DEFAULT 兜底
CREATE INDEX idx_reqlog_request_id ON reqlog.request_records (request_id);

reqlog.error_records (                                -- 错误明细，按月分区
  id uuid DEFAULT gen_random_uuid(),
  request_id varchar(128), provider_code varchar(64), model_code varchar(128),
  error_code varchar(64), error_message text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

- **失败调用不计费**：`status='error'` 只进 reqlog，**不**触发 consume、**不**写 usage_events。
- **四段复合下游标识**：`tenant+workspace+product+user` 哈希作传给上游的隔离标识 + 落 `downstream_identity_hash`；属 Model Platform DB 设计约束，平台库不建对应表。

### 4.3 `routing` schema（连接/路由/降级）

| 表                 | 字段（要点）                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `provider_configs` | id / provider_code / endpoint_url / timeout_ms / retry_policy jsonb / is_active |
| `model_routes`     | id / model_code / provider_code / weight / is_active                            |
| `fallback_rules`   | id / model_code / fallback_model_codes text[] / condition / is_active           |

**`endpoint_url` 权威待决**：现挂平台库 `model.models.endpoint_url`；目标态可下沉 `routing.provider_configs`。**二选一避免双写**（§6 待办）。

---

## 5. FK / 边界速查表

| 从                                                                                                          | 到                                            | 类型              | 依据                                       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------- | ------------------------------------------ |
| `models.provider_id`、`model_grants/price_rules/policies.model_id`                                          | `model.*`（同 schema）                        | 真 FK             | 域内                                       |
| `model_grants.tenant_id`、`model_policies.tenant_id`(nullable)                                              | `tenancy.tenants.id`                          | 真 FK             | **本次修正**（原裸值），普通引用（铁律一） |
| `key.key_rotation_logs.provider_api_key_id`                                                                 | `key.provider_api_keys.id`                    | 真 FK             | Model Platform DB 域内                     |
| `*.created_by/updated_by/rotated_by`                                                                        | `admin.operator_accounts.id`                  | **裸值**，不建 FK | 边界#2（模型治理运营专属）                 |
| `key/reqlog.provider_code`、`reqlog.request_records.{tenant_id,workspace_id,product_id,usage_event_id,...}` | 平台库 `model.*` / `commerce.*` / `tenancy.*` | **裸值**，不建 FK | **边界#1**（跨物理库，`request_id` 关联）  |
| `model_grants.application_id/agent_id`                                                                      | （agent_catalog 未落）                        | 裸值              | 退役过渡 + agent_catalog 跨轮前置          |

---

## 6. 待办 / 开放项

- **`endpoint_url` 权威**：`model.models` vs `routing.provider_configs` 二选一，避免双写。
- **`agent_catalog` 跨轮硬前置**：product 域规划态表，落地前 scope-key 不可调和、consume 不可切（协调式迁移）。
- **`model_grants.agent_id` / `provider` 冗余列退役**：调用方切走后 drop。
- 迁移：model 域为 seed 配置，归"可重建+reseed"；唯一例外是有真实 grant + 旧 writer 时的协调式切换。
