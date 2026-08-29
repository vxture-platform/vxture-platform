# Product 域细化设计：统一产品目录 + 版本化 plan + 每周期定价

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_product_200`（细化设计层）· 待评审 · 未实施
> ⚠️ **D6/D7 修订待落（2026-07-08，[`product_220`](./product_220_catalog-resource-model.md) §8 为落位摘要权威）**：`plan_components.billing_kind`→`component_role{primary,bundled}`、tier 改 NULLABLE+纯五档+成对 CHECK、`source_profile_code` 溯源列、新表 `product.platform_metrics`（L0 资源目录）、`quota_pools` 同步改名与共享匹配——本文相应小节随实施车按 as-built 更新，落库前以 product_220 §8 为准。
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 取代范围：**取代** [`data_platform_200_schema.md`](./data_platform_200_schema.md) §7（product 目录域）字段级内容。
> 命名规范：schema 单数、table 复数、column 单数（§3.2.1）；本文表名已复数化，是目标态。
> 被引用：`commerce`（metering.subscriptions.plan_version_id、plan_component 投影 quota_pool）、`provisioning`（product_webhooks）、`promotion`（redemption 激活档 plan_version）。

---

## 0. 定位与两处关键修正

统一产品目录：合并旧 `agent`/`application` 双目录为单一 `products` + 卫星表（metric/category）+ 版本化 `plans`（`plan_components` 为唯一 SoT）+ **每周期定价 `plan_prices`** + 平台自签 `product_webhooks` + 上架检查清单。空域，直接按目标态重建 + reseed。

**本轮两处关键修正：**

1. **删除 `product_i18n` 表** —— 双名称（主名/译名）就是 `products` 上**两列** `product_name` + `product_nick`，不再拆成按 locale 的独立表（原设计过度工程）。description 亦留在 products。
2. **新增 `plan_prices`（每周期定价）** —— 闭合订阅周期模型：一个 `plan_version` 挂 N 个周期价（月/季/年…各自价格），`metering.subscriptions.cycle_unit/count` 从中选一。删去旧 `plan.billing_cycle`（单值）与 `plan_version.price`（单价）。

---

## 1. `products`（统一产品目录，合并 agent + application）

| 字段                                           | 类型         | 约束                                                                 | 说明                                                                                      |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                                           | uuid         | PK                                                                   |                                                                                           |
| `product_code`                                 | varchar(64)  | UNIQUE NOT NULL                                                      | 可视码：data/kb/agent_writing…（合并 agent_code/app_code）                                |
| `product_type`                                 | varchar(32)  | NOT NULL                                                             | agent/data_platform/kb_platform…（扩展型 kind，不加 CHECK）                               |
| `category_id`                                  | smallint     | NULL, FK→`product_categories.id`                                     | 叶子小类（§3）                                                                            |
| `product_name`                                 | varchar(128) | NOT NULL                                                             | **主名/品牌名**（如"如影"）——双名称之一，直接列，非独立表                                 |
| `product_nick`                                 | varchar(128) | NULL                                                                 | **译名/副名**（如"Ruyin"）——双名称之二                                                    |
| `description`                                  | text         | NULL                                                                 | 描述                                                                                      |
| `description_key`                              | varchar(128) | NULL                                                                 | i18n 键 `product.product.{product_code}.desc`                                             |
| `capability_keys`                              | text[]       | NOT NULL DEFAULT `'{}'`                                              | 可门控功能键（字符串，非 FK）                                                             |
| `tags`                                         | text[]       | NOT NULL DEFAULT `'{}'`                                              | 自由标签（GIN，与 category 正交）                                                         |
| `standalone_subscribable`                      | boolean      | NOT NULL DEFAULT true                                                | 是否允许单独订阅                                                                          |
| `icon_url`                                     | varchar(512) | NULL                                                                 |                                                                                           |
| `sort`                                         | int          | NOT NULL DEFAULT 0                                                   |                                                                                           |
| `config`                                       | jsonb        | NULL                                                                 | 合并 agent.config_json + application.metadata                                             |
| `release_version` / `build_number`             | varchar      | NULL                                                                 | 对外发布号 / 内部构建号                                                                   |
| `released_at`                                  | timestamptz  | NULL                                                                 |                                                                                           |
| `status`                                       | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK(active/inactive/draft/deprecated) | 上下架状态（≠展示可见）                                                                   |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true                                                | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活）                          |
| `created_by` / `updated_by`                    | uuid         | NULL                                                                 | 产品目录**运营专属**维护，realm 确定=operator（边界#2，逻辑引用 admin.operator_accounts） |
| `created_at` / `updated_at`                    | timestamptz  | NOT NULL DEFAULT now()                                               |                                                                                           |
| `deleted_at`                                   | timestamptz  | NULL                                                                 |                                                                                           |

索引：`category_id`、`status`、`deleted_at`；GIN：`tags`、`capability_keys`（raw DDL，§9 登记）。

> **双名称说明**：`product_name`（主）+ `product_nick`（副）覆盖"品牌名 + 译名"的双语实务需求，两列即可，不设按 locale 的矩阵表。若未来确需产品文案全 locale 化，再评估（当前明确不建 i18n 表）。

## 2. `product_metrics`（计量维度）

| 字段             | 类型        | 约束                                           | 说明                                                                                                                                                                                                                             |
| ---------------- | ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid        | PK                                             |                                                                                                                                                                                                                                  |
| `product_id`     | uuid        | NOT NULL, FK→`products.id`                     |                                                                                                                                                                                                                                  |
| `metric_key`     | varchar(64) | NOT NULL                                       | doc.words/ai.calls/storage.max/member.max                                                                                                                                                                                        |
| `merge_strategy` | varchar(16) | NOT NULL, CHECK(max/union/pool/tiered)         | max/union=能力型(数值就高/并集) / **tiered**（2026-07-07 增）=非数值能力型（bool/枚举，取最高档组件的值——避免 readonly 类反向布尔被 OR 合并的坑）/ pool=消耗型(配额池瀑布扣)。max 型约定 **-1=无限哨兵**（合并中胜过任何有限值） |
| `consume_mode`   | varchar(16) | NULL, CHECK(仅 pool 时非空且 divisible/atomic) | divisible=可分割瀑布扣 / atomic=不足额整笔 409                                                                                                                                                                                   |
| `metric_unit`    | varchar(32) | NULL                                           | words/calls/GB/seats                                                                                                                                                                                                             |
| `created_at`     | timestamptz | NOT NULL DEFAULT now()                         |                                                                                                                                                                                                                                  |

约束：`UNIQUE(product_id, metric_key)`；`CHECK(merge_strategy<>'pool' OR consume_mode IN ('divisible','atomic'))`。**2026-07-07 增列 `reset_period varchar(16) NOT NULL DEFAULT 'none'`（CHECK none/day/month；仅 pool 型有意义，CHECK 强制能力型恒 none）**——订阅创建物化 quota_pools 时投影为池的重置周期，周期池锚定订阅 `start_at`（period_anchor/current_period_start 同置）。供 `metering` consume 分支（§8.3）。

## 3. `product_categories`（树形字典）

| 字段                                           | 类型         | 约束                             | 说明                                                                 |
| ---------------------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------- |
| `id`                                           | smallint     | PK                               | **刻意例外 uuid 规范**：小型策展字典、人读 id、天然可排序（§9 登记） |
| `parent_id`                                    | smallint     | NULL, FK→`product_categories.id` | 自引用，NULL=顶级；任意深度                                          |
| `code`                                         | varchar(32)  | UNIQUE NOT NULL                  | 可视码                                                               |
| `name`                                         | varchar(64)  | NOT NULL                         |                                                                      |
| `name_key`                                     | varchar(128) | NULL                             | i18n 键 `product.category.{code}`                                    |
| `sort`                                         | int          | NOT NULL DEFAULT 0               |                                                                      |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true            | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活）     |
| `created_at`                                   | timestamptz  | NOT NULL DEFAULT now()           |                                                                      |

`products.category_id` 应指向**叶子小类**（无法 CHECK，应用层引导）。smallint id 是内部代理键（非可视码，可视码是 `code`），铁律二不冲突。

## 4. `plans`（产品壳/对外销售方案）

| 字段                                           | 类型         | 约束                                                                 | 说明                                                             |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `id`                                           | uuid         | PK                                                                   |                                                                  |
| `plan_code`                                    | varchar(64)  | UNIQUE NOT NULL                                                      | 可视码                                                           |
| `plan_name`                                    | varchar(128) | NOT NULL                                                             | 客户可见                                                         |
| `plan_name_key`                                | varchar(128) | NULL                                                                 | i18n 键 `product.plan.{plan_code}`                               |
| `description`                                  | text         | NULL                                                                 |                                                                  |
| `description_key`                              | varchar(128) | NULL                                                                 | i18n 键 `product.plan.{plan_code}.desc`                          |
| `current_version_id`                           | uuid         | NULL, FK→`plan_versions.id`                                          | 当前对外销售版本（FK 在 plan_versions 建后补）                   |
| `is_public`                                    | boolean      | NOT NULL DEFAULT true                                                | 对外售卖开放（≠展示可见；保留，各司其职）                        |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true                                                | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活） |
| `status`                                       | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK(active/inactive/draft/deprecated) |                                                                  |
| `created_by` / `updated_by`                    | uuid         | NULL                                                                 | 运营专属（边界#2）                                               |
| `created_at` / `updated_at`                    | timestamptz  | NOT NULL DEFAULT now()                                               |                                                                  |
| `deleted_at`                                   | timestamptz  | NULL                                                                 |                                                                  |

> **删除旧 `billing_cycle` 字段**：可售周期集不再是 plan 上的单值，改由 §6 `plan_prices` 表达（一个版本可同时提供月/季/年）。

## 5. `plan_versions`（不可变版本；组合的版本快照）

| 字段                | 类型        | 约束                        | 说明                                                               |
| ------------------- | ----------- | --------------------------- | ------------------------------------------------------------------ |
| `id`                | uuid        | PK                          |                                                                    |
| `plan_id`           | uuid        | NOT NULL, FK→`plans.id`     |                                                                    |
| `version_no`        | int         | NOT NULL                    | 同 plan 下从 1 递增                                                |
| `is_locked`         | boolean     | NOT NULL DEFAULT false      | 被任意订阅引用即 true → 版本 + 其 components + prices 全冻结       |
| `trial_cycle_unit`  | varchar(16) | NULL, CHECK(day/week/month) | **新增·试用配置**：该版本是否提供试用及时长单位（NULL=不提供试用） |
| `trial_cycle_count` | int         | NULL                        | 试用时长倍数（如 14 天 = day×14）                                  |
| `created_by`        | uuid        | NULL                        | 运营专属（边界#2）                                                 |
| `created_at`        | timestamptz | NOT NULL DEFAULT now()      |                                                                    |

约束：`UNIQUE(plan_id, version_no)`。

> **删除旧 `price`/`currency` 单价字段** → 移入 §6 `plan_prices`（每周期一价）。版本不可变靠 §7 触发器（锁定后 components/prices/trial 全冻结）。

## 6. `plan_prices`（每周期定价，新增——闭合订阅周期模型）

一个 `plan_version` 挂 **N 个周期价**（月/季/年/永久…各自价格），`metering.subscriptions.cycle_unit/cycle_count` 订阅时从中选定一条。

| 字段              | 类型          | 约束                                           | 说明                            |
| ----------------- | ------------- | ---------------------------------------------- | ------------------------------- |
| `id`              | uuid          | PK                                             |                                 |
| `plan_version_id` | uuid          | NOT NULL, FK→`plan_versions.id`                |                                 |
| `cycle_unit`      | varchar(16)   | NOT NULL, CHECK(day/week/month/year/perpetual) | 对齐 `subscriptions.cycle_unit` |
| `cycle_count`     | int           | NOT NULL DEFAULT 1                             | 季度=month×3、年=year×1…        |
| `price`           | numeric(18,6) | NOT NULL                                       | 标价（高精度，§3.2）；free 档=0 |
| `currency`        | varchar(16)   | NOT NULL DEFAULT `'CNY'`                       |                                 |
| `created_at`      | timestamptz   | NOT NULL DEFAULT now()                         |                                 |

约束：`UNIQUE(plan_version_id, cycle_unit, cycle_count, currency)`。索引：`(plan_version_id)`。

- **随版本锁定冻结**：version `is_locked=true` 后，其 plan_prices 禁增删改（§7 触发器覆盖本表），价格变更只能开新版本——老订阅引用的旧版本价格恒不变。
- **周期与版本正交**：版本管"组合"（plan_components），价格按"周期"（本表）；trial 时长在 §5 plan_versions；free = price 0 行或 free-tier 组件。

## 7. `plan_components`（唯一 SoT，挂 plan_version）+ 不可变/优先级触发器

| 字段              | 类型        | 约束                                                          | 说明                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | uuid        | PK                                                            |                                                                                                                                                                                                                                                                                                                                                                                          |
| `plan_version_id` | uuid        | NOT NULL, FK→`plan_versions.id`                               |                                                                                                                                                                                                                                                                                                                                                                                          |
| `product_id`      | uuid        | NOT NULL, FK→`products.id`                                    |                                                                                                                                                                                                                                                                                                                                                                                          |
| `tier`            | varchar(32) | NOT NULL, CHECK(free/bundled/starter/pro/business/enterprise) | **2026-07-07 修订（owner 拍板）**：商业阶梯=free<starter<pro<business<enterprise（五档，C2 就高合并的排序权威）；`bundled`（原 `standard` 改名）=**供给档**，不入阶梯（合并中 unranked，仅当无在梯直购订阅时浮出）——语义=产品作为另一产品套餐的后台支撑件（如 agent 套餐捆绑 arda 数据支撑），**订阅面不展示、权益面（C2）如实返回**；`bundled` 只出现在捆绑组件上，不做直购 plan 的档位 |
| `billing_kind`    | varchar(32) | NOT NULL, CHECK(bundled_free/charged)                         |                                                                                                                                                                                                                                                                                                                                                                                          |
| `priority`        | int         | NOT NULL DEFAULT 100                                          | 编排期序，投影到 `metering.quota_pools.priority`                                                                                                                                                                                                                                                                                                                                         |
| `features`        | text[]      | DEFAULT `'{}'`                                                | 该档开放功能键                                                                                                                                                                                                                                                                                                                                                                           |
| `quota`           | jsonb       | NULL                                                          | 业务语言配额 `{"doc.words":1000000}`（计数非金额）                                                                                                                                                                                                                                                                                                                                       |
| `sort_order`      | int         | NOT NULL DEFAULT 0                                            |                                                                                                                                                                                                                                                                                                                                                                                          |
| `created_at`      | timestamptz | NOT NULL DEFAULT now()                                        |                                                                                                                                                                                                                                                                                                                                                                                          |

约束：`UNIQUE(plan_version_id, product_id, tier)`。索引：`(plan_version_id)`。

**非 Prisma DDL（触发器，§9 登记，重建必保）：**

```sql
-- 触发器1a：plan_version 已锁 → 禁增/改/删其 plan_component（保护对象全表，非旧 JSONB）
CREATE TRIGGER trg_plan_component_guard_lock BEFORE INSERT OR UPDATE OR DELETE
  ON product.plan_components FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_component();
-- 同一守卫扩展到 plan_prices（锁定版本价格冻结）：
CREATE TRIGGER trg_plan_price_guard_lock BEFORE INSERT OR UPDATE OR DELETE
  ON product.plan_prices FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_component();  -- 复用同函数，按 plan_version_id 查 is_locked

-- 触发器1b：已锁版本禁清 is_locked + version_no 冻结（price 已移出 plan_versions）
CREATE TRIGGER trg_plan_version_guard_lock BEFORE UPDATE
  ON product.plan_versions FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_version();

-- 触发器2：单版本内 max(bundled_free priority) < min(charged priority)（编排期财务级硬约束）
CREATE TRIGGER trg_plan_component_priority BEFORE INSERT OR UPDATE
  ON product.plan_components FOR EACH ROW EXECUTE FUNCTION product.check_plan_component_priority();
```

- **唯一 SoT，无 JSONB 双写**：版本不可变，组合就是快照。组合/价格变更 = 开新版本（`version_no+1`，改 `plans.current_version_id`）。
- **写入时机**：新建 plan_version 同事务写全部 plan_components + plan_prices；订阅创建（commerce §8.1）置该版本 `is_locked=true` 冻结。
- **运行时不读 plan_components**：瀑布扣减读已投影的 `quota_pools.priority`（commerce §8.2）。

## 8. `product_webhooks`（平台自签 HMAC，平台→产品推送）

| 字段                        | 类型         | 约束                   | 说明                                                                          |
| --------------------------- | ------------ | ---------------------- | ----------------------------------------------------------------------------- |
| `product_id`                | uuid         | PK, FK→`products.id`   | 每产品一行                                                                    |
| `home_url`                  | varchar(512) | NULL                   | 产品主页（展示）                                                              |
| `webhook_url`               | varchar(512) | NULL                   | 平台→产品 推送目标（订阅变更/额度预警）                                       |
| `webhook_secret_ref`        | varchar(128) | NULL                   | **平台自签 HMAC 验签密钥引用**（非 Provider Key，风险模型不同，正常入平台库） |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now() |                                                                               |

被 `provisioning.webhook_deliveries` 投递时 join 取端点+密钥签名（provisioning §3）。

## 9. `launch_checklist_items` + `product_launch_statuses`（上架检查）

**`launch_checklist_items`（检查项目录，可配置）**

| 字段              | 类型         | 约束                   | 说明                                         |
| ----------------- | ------------ | ---------------------- | -------------------------------------------- |
| `item_code`       | varchar(64)  | PK                     | verification_policy/pricing_set…             |
| `item_name`       | varchar(128) | NOT NULL               |                                              |
| `item_name_key`   | varchar(128) | NULL                   | i18n 键 `product.checklist.{item_code}`      |
| `description`     | varchar(256) | NULL                   |                                              |
| `description_key` | varchar(128) | NULL                   | i18n 键 `product.checklist.{item_code}.desc` |
| `is_required`     | boolean      | NOT NULL DEFAULT true  |                                              |
| `sort`            | int          | NOT NULL DEFAULT 0     |                                              |
| `created_at`      | timestamptz  | NOT NULL DEFAULT now() |                                              |

**`product_launch_statuses`（每 product × 每检查项完成态）**

| 字段           | 类型         | 约束                                            | 说明                                            |
| -------------- | ------------ | ----------------------------------------------- | ----------------------------------------------- |
| `product_id`   | uuid         | NOT NULL, FK→`products.id`                      |                                                 |
| `item_code`    | varchar(64)  | NOT NULL, FK→`launch_checklist_items.item_code` |                                                 |
| `is_satisfied` | boolean      | NOT NULL DEFAULT false                          |                                                 |
| `checked_at`   | timestamptz  | NULL                                            |                                                 |
| `checked_by`   | uuid         | NULL                                            | 人工确认操作人（运营，边界#2）；自动校验为 NULL |
| `remark`       | varchar(256) | NULL                                            |                                                 |

复合 PK `(product_id, item_code)`。product 主表**不加**"是否可上架"汇总字段——由本表推导（所有 required 项 satisfied 即可上架）。

初始检查项（seed）：

- `verification_policy`：上架前须显式插入自己的 **`kyc.verification_policies`** 记录（该表 2026-07-04 从 commerce 迁入 kyc，见 `data_identity_200_schema.md §4.3`；`product_id IS NULL` 是平台基准值非兜底）。
- `pricing_set`：至少配置一条 `plan_prices`（替代原 `i18n_complete`——i18n 表已删，双名称是 products 必填列，无需清单项）。

新增检查项 = INSERT 一行，不改表结构。

---

## 10. 可视码

| 码                                                                      | 说明                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `products.product_code` / `plans.plan_code` / `product_categories.code` | 可视/业务码，人读、可改；关联仍走各自 uuid（category 走 smallint 代理键），非 FK 目标（铁律二） |

## 11. 跨 schema FK 速查表（本域内 + 被引用）

| 从                                                                                                                               | 到                                                   | 类型              | 依据                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `product_metrics/plan_components.product_id`、`product_webhooks.product_id`、`product_launch_statuses.product_id`                | `products.id`                                        | 真 FK             | 同 schema                                             |
| `products.category_id` / `product_categories.parent_id`                                                                          | `product_categories.id`                              | 真 FK             | 同 schema（smallint 代理键）                          |
| `plan_versions.plan_id` / `plans.current_version_id`                                                                             | `plans.id` / `plan_versions.id`                      | 真 FK             | 同 schema（互相引用）                                 |
| `plan_prices.plan_version_id` / `plan_components.plan_version_id`                                                                | `plan_versions.id`                                   | 真 FK             | 同 schema                                             |
| `product_launch_statuses.item_code`                                                                                              | `launch_checklist_items.item_code`                   | 真 FK             | 同 schema（code 作 PK，此处 code 即主键非可视码语义） |
| `solution_products.solution_id` / `solution_plans.solution_id`；`solution_products.product_id`；`solution_plans.plan_id`（§13）  | `solutions.id`（CASCADE）；`products.id`；`plans.id` | 真 FK             | 同 schema（2026-08-31）                               |
| `*.created_by`/`updated_by`/`checked_by`                                                                                         | `admin.operator_accounts.id`                         | **裸值**，不建 FK | 边界#2（产品目录运营专属，realm 确定）                |
| **被引用**：`metering.subscriptions.plan_version_id`、`promotion.*.grant_plan_version_id`、`billing.invoice_items.product_id` 等 | 本域 `plan_versions.id`/`products.id`                | 真 FK             | 跨 schema（铁律一）                                   |

## 12. 待办 / 开放项

- **规划态表**（`agent_catalog`/`skill` 等，旧 database.md §3.4 曾列）本轮不建；未来落地走本域同构扩展。`agent_catalog` 是 model 域 scope-key 调和的跨轮前置，落地时同构补。`solution` 已于 2026-08-31 落地（§13）。
- `product_launch_statuses.checked_by`：若未来产品可由租户自助上架（marketplace），checked_by 需升级为 actor_type（当前平台运营专属，determinate operator）。
- 迁移：本域空域，直接目标态重建 + reseed（无保数据负担）。

## 13. `solutions` / `solution_products` / `solution_plans`（解决方案，2026-08-31 新增）

admin「产品与套餐 · 业务产品方案 / 服务套餐」去 mock（TD-029 收口）落地的三表；设计权威 [`docs/20-specs/000-platform/admin/70-product-solutions.md`](../20-specs/000-platform/admin/70-product-solutions.md)。方案是运营写出来的内容，**无 seed**，空表即正确态。服务套餐 = 既有 `plans` 绑到方案的一个档位，价格 / 版本 / 组件都是 plan 自己的，**不另建定价模型**。

### 13.1 `solutions`（方案本体）

| 字段                                           | 类型         | 约束                                                                | 说明                                                       |
| ---------------------------------------------- | ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `id`                                           | uuid         | PK                                                                  |                                                            |
| `solution_code`                                | varchar(64)  | UNIQUE NOT NULL                                                     | 可视码（kebab，如 `flood-regulation`；铁律二不作 FK 目标） |
| `solution_name`                                | varchar(128) | NOT NULL                                                            |                                                            |
| `description`                                  | text         | NULL                                                                |                                                            |
| `industry` / `scenario`                        | varchar(128) | NULL                                                                | 行业领域 / 业务场景（自由文本，不建字典）                  |
| `customer_segment`                             | varchar(255) | NULL                                                                | 目标客户群                                                 |
| `owner_team`                                   | varchar(128) | NULL                                                                | 负责团队（展示）                                           |
| `tags`                                         | text[]       | NOT NULL DEFAULT `'{}'`                                             | 自由标签（GIN）                                            |
| `delivery_mode`                                | text         | NULL                                                                | 交付模式一句话                                             |
| `delivery_boundaries`                          | text[]       | NOT NULL DEFAULT `'{}'`                                             | 交付边界条目，一条一项                                     |
| `status`                                       | varchar(32)  | NOT NULL DEFAULT `'draft'`, CHECK(draft/active/inactive/deprecated) | 状态机与 `products` 同形，守卫在 admin-bff                 |
| `is_public`                                    | boolean      | NOT NULL DEFAULT true                                               | 对外售卖开放（admin 投影为 visibility）                    |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true                                               | 展示可见性双列（§3.2.6，独立轴）                           |
| `sort`                                         | int          | NOT NULL DEFAULT 0                                                  |                                                            |
| `created_by` / `updated_by`                    | uuid         | NULL                                                                | 运营专属裸值（边界#2）                                     |
| `created_at` / `updated_at`                    | timestamptz  | NOT NULL DEFAULT now()                                              |                                                            |
| `deleted_at`                                   | timestamptz  | NULL                                                                | 软删（读侧过滤）                                           |

索引：`(status)`、`(deleted_at)`、`tags` GIN。

### 13.2 `solution_products`（方案 × 产品能力，M:N）

| 字段          | 类型         | 约束                                          | 说明                                       |
| ------------- | ------------ | --------------------------------------------- | ------------------------------------------ |
| `solution_id` | uuid         | NOT NULL, FK→`solutions.id` ON DELETE CASCADE |                                            |
| `product_id`  | uuid         | NOT NULL, FK→`products.id`                    | product 走软删，读侧过滤，故不 CASCADE     |
| `role`        | varchar(128) | NULL                                          | 该产品在方案中的角色（展示文案，不进值域） |
| `sort`        | int          | NOT NULL DEFAULT 0                            |                                            |
| `created_at`  | timestamptz  | NOT NULL DEFAULT now()                        |                                            |

约束：`PRIMARY KEY (solution_id, product_id)`。索引：`(product_id)`。

### 13.3 `solution_plans`（方案 × 档位 → 套餐绑定）

| 字段          | 类型        | 约束                                                  | 说明                                                                                                                   |
| ------------- | ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `solution_id` | uuid        | NOT NULL, FK→`solutions.id` ON DELETE CASCADE         |                                                                                                                        |
| `tier`        | varchar(32) | NOT NULL, CHECK(free/starter/pro/business/enterprise) | 五档商业阶梯（product_220 §1），与 `chk_plan_components_tier` 同源，`lint:catalog-domains` 强制与 @shared `TIERS` 一致 |
| `plan_id`     | uuid        | NOT NULL, FK→`plans.id`, **UNIQUE**                   | 一个 plan 至多绑一个方案档位——订阅 / 收入按 plan 归到唯一方案，计数不重叠                                              |
| `created_at`  | timestamptz | NOT NULL DEFAULT now()                                |                                                                                                                        |

约束：`PRIMARY KEY (solution_id, tier)`、`UNIQUE (plan_id)`。

列锁（98）：三表锚点 = PK / `created_by` / `created_at`；`solution_products` 可改 `role, sort`；`solution_plans` 只可改 `plan_id`（换绑）。跨 schema FK：无。
