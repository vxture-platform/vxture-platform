# Vxture 平台数据架构 —— 落地与迁移 runbook

> 配套权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md)（**最终态设计**：schema/表/字段/约束/禁止）。
> 字段级全 DDL/列/索引/触发器/Prisma 见 [`data_platform_200_schema.md`](./data_platform_200_schema.md)（§4–§15）。
> 本文只描述 **“现状 → 最终态”的差量 + 落地步骤 + 代码锁步 + 待决**；**不重述目标 DDL**（以设计文档为准，按原 § 号回指）。
> 状态：v1（自 data_platform_100_architecture.md 抽出，2026-07-01）。数据全部可重灌（无生产/无用户债务）；真正约束是已部署 schema 的代码锁步。

---

## 1. 迁移前提与已锁定决策

#### 0.3 统一前提（沿用 v1 §10）

- **数据全部可重灌（无生产数据 / 无用户债务，owner 确认 2026-07-01）**：各域均为**验证数据** → 结构变更可按目标态直接建表 + 重灌 seed。唯一生成态是 **admin operator 2FA（已扫码 + 恢复码），系 owner 个人测试、可弃**（重建后重扫即可）。**真正约束不是"保数据"而是"已部署 schema 的代码锁步"**：`identity`/`iam`/`admin`(原 ops)/`model` 已上线、服务已绑定，其改名/结构变更须与 admin-bff / model-platform / identity-platform-operator / seed / search_path **同步发版**（工程线，非本 docs 任务；数据本身可弃）。保数据迁移（`INSERT…SELECT` 等）为**可选**（仅为省去重扫 2FA）。仍需业务侧输入的只是"目标数据长什么样"（枚举/档位/阈值），不是"怎么迁移"。
- **跨平面边界（database.md §7/§11，硬约束）**：业务执行数据 / RAG / 向量 / 会话内容**不入平台库**；用量**只上行**；Provider Key **不入平台库**；`tenant_transaction` 不可变；`tenant_usage_event` append-only。
- **现状两份 Prisma**：`deploy/database/prisma/schema.prisma`（76 model，权威全量基线）vs `packages/core/database/prisma/schema.prisma`（69 model，运行时客户端，故意排除 3 计量表 + 3 bundle 表，且 identity 落后于 #540）。本文以 **deploy 基线**为现状准绳；core 客户端的对齐策略见 §17。

#### 0.4 本轮已锁定决策（2026-07-01，v1.1 二次分析后拍板）

> 这些是本文落字段级 DDL 的前提。**代码/seed 改动属工程线、不在本 docs 任务内执行**，此处仅登记决策与波及面。

| 决策             | 选定                              | 波及面（须随动，记入 §17 协调清单）                                                                                                                                                                       |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档主线         | **v1.1 折叠进本文**               | 本文为唯一权威；停止维护 data-architecture-v1.x（吸收为本文 §4–§9）                                                                                                                                       |
| 运营 schema      | ops→**admin**                     | Prisma `@@schema`、seed、search_path、admin-bff、`ops.setting` 键、identity-platform-operator.md、在途 P4 分支                                                                                            |
| `tenant.type`    | **personal / organization**       | 记 team→organization 改名，同步 seed / verification_policy（database.md / identity-data-model 已退役删除）                                                                                                |
| `realm` 取值     | **customer / workforce**          | `auth_session.realm` + seed(14处) + auth-bff/admin-bff/accounts 代码 + sub 前缀/cookie + identity-platform-operator 红线，与代码发版锁步                                                                  |
| `gateway` schema | **取消**（采纳 database.md 双库） | provider key/请求日志归独立 Model Platform DB(`key`/`reqlog`)；`home_url`/`webhook_*` 重定位为 `product.product_webhook`(平台自签 HMAC，§7)                                                               |
| 计量内核         | 见 §8 契约                        | quota_pool 唯一实时源(+window/惰性归零)；usage_event 头+明细两层；`plan_component` 为唯一 SoT(删 plan_version.components JSONB)；summary 最小颗粒=小时；consume 服务单一写入（须回写 database.md §7/§11） |

---

---

## 2. 受影响的现有表去向矩阵（deploy 现状 → v2 目标）

#### 3.3 受影响的现有表去向矩阵

> **本节定位（新建，rank 10 / rank 11——reconciliation 实质缺口）**：v1.1 §6–§9 给出的是"目标态长什么样"，但**没有逐张回答"现有 deploy 基线里的 76 张表，每一张要怎么处置"**。这正是二次分析暴露的两个 reconciliation 缺口：
>
> - **rank 10**：v1.1 §9.1/§9.2 把 `tenant_usage_event` / `tenant_usage_summary` 的改造表述为"命名已对齐 `database.md`、沿用既有命名"——这是**误判**。本文 §8.4/§8.7 实际把它们改成了 `workspace/product/metric` 重键 + 头/明细两层 + 三层降采样，是**破坏性重建**，绝非命名对齐；矩阵必须如实标注，避免后续按"改个名"低估迁移成本。
> - **rank 11**：`application_id`（及 `agent_id`/`feature_id`/`app_code`）退役是一条**横跨 7 张在产表的级联**，v1.1 仅在 §6.1/§7.1 局部提到，从未成表追踪。任何一处漏改都会让 `model_grant ↔ tenant_usage_event ↔ tenant_subscription` 无法按单一维度对齐。
>
> 因此本节用一张全量去向矩阵，逐张给出 **退役 / 改键 / 重映射 / 保留改造 / 沿用** 五种结论之一 + 依据，并显式登记 `application_id`、scope-key、`organizations→tenant`、`ops→admin` 四条改名/退役级联。结论以 deploy 基线（76 model）为准绳，目标态 DDL 见对应章节（§4/§7/§8/§9/§10/§11/§14）。

##### 3.3.0 处置前的迁移分级与一条核心论断

矩阵里"怎么落地"分两档，取决于该表所在域是否**在产**（自 2026-06-18 上线 worker-01）：

| 域                                   | 在产？                                        | 落地手段（§17 迁移策略）                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity` / `iam` / `ops`(→`admin`) | **已部署（数据=验证数据、可弃）**             | 数据无债务 → **可重灌**；真正约束是**代码锁步**（服务已绑定）：schema 改名/结构变更须与 admin-bff/model-platform/identity-platform-operator/seed/search_path 同步发版。保数据迁移（`ALTER…RENAME`/`INSERT…SELECT`）**可选**（省去重扫 admin 2FA）。 |
| `product` / `commerce`               | **空**（仅 seed）                             | 可**重建 + reseed**：按目标态直接建表，重灌 seed，不写 UPDATE 回填脚本。                                                                                                                                                                            |
| `model`                              | 在产（当前由 `vx-model-platform` 复用平台库） | 介于两者之间：scope-key 调和（§3.3.5）是**硬前置**，需与 Model Platform 切流锁步，不可单方 drop。                                                                                                                                                   |

> **核心论断（必须贯穿全章）：「commerce / product 空可重建」对数据成立，对已部署代码不成立。**
> 这两个 schema 现仅有 seed、无真实业务数据，所以**重灌数据**没有迁移负担。但 deploy 基线上**已部署并运行**的代码仍在按旧列名读写这些表——Model Platform writer 仍向 `tenant_usage_event` 写 `tenant_id/agent_id/application_id/feature_id`；订阅服务仍读 `tenant_subscription.application_id/plan_id`；账单仍按 `tenant_invoice_item.agent_id/feature_id` 归集。**"表可以重建"不等于"可以无协调地切换"**：凡涉及 scope-key 重键（§3.3.2/§3.3.5）与用量重建（§3.3.3），必须采用**协调式迁移**（保留旧表 + 旧 writer，直到 Model Platform/产品端切到 `POST /usage/consume` 与 `product_id` 维度，见 §8.9 / §11.3），破坏性重建只针对数据、不针对契约。这是 rank 5/10/11 的共同结论，**reseed 不豁免代码改造**。

##### 3.3.1 product 目录域：agent + application + feature 合并

deploy 现状 8 表（`agent`/`application`/`feature`/`agent_feature`/`plan`/`plan_agent`/`plan_feature`/`plan_price`）按 ADR-11"Product 统一模型"全部重构。`product`/`commerce` 为空，故数据侧重建 + reseed；但目录是**所有计费的静态输入**，对接的产品发布流程/seed 脚本须随动改造。

| deploy 现表                    | 现状关键列                                                                                      | 去向结论     | 目标表 / 章节                                                                                                                                                                                      | 依据（含 v1.1 §）                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `product.agent` (L529)         | `agent_code`/`agent_name`/`agent_type`/`agent_category`(int)/`tags`/`config_json`/`version`     | **重映射**   | → `product.product`（`product_code`/`product_type`/`category_id`FK/`tags`/`config`/`release_version`+`build_number`+`released_at`），名称走 `product_i18n`                                         | v1.1 §6.1/6.1a/6.1b/6.1c；§7                                                  |
| `product.application` (L639)   | `app_code`/`app_name`/`app_type`/`home_url`/`webhook_url`/`webhook_secret_ref`/`metadata`       | **重映射**   | → `product.product`（与 agent 合并为同构单元）；`home_url`/`webhook_*` **下沉** `product.product_webhook`（平台自签 HMAC，非 provider key，§0.4/§7）。同时是 `application_id` 退役的源头（§3.3.2） | v1.1 §6.1（"home_url/webhook 下沉"修正为 product_webhook）；§0.4 gateway 取消 |
| `product.feature` (L584)       | `feature_code`/`feature_name`/`parent_code`/`feature_type`（关系型功能目录）                    | **退役**     | 关系型 feature 目录废弃 → 功能键改由 `product.capability_keys text[]`（产品暴露的可门控键）+ `plan_component.features text[]`（某档开放的键）承载                                                  | v1.1 §6.1（capability_keys）/§6.3（features）                                 |
| `product.agent_feature` (L562) | `(agent_id,feature_id)` 联结 + `is_required`                                                    | **退役**     | "某产品有哪些功能"由 `product.capability_keys text[]` 表达，联结表消失                                                                                                                             | v1.1 §6.1                                                                     |
| `product.plan_feature` (L688)  | `(plan_id,feature_id)` + `quota_value`/`is_unlimited`/`config_json`                             | **退役**     | "某档开放哪些功能 + 配额"由 `plan_component.features text[]` + `plan_component.quota jsonb` 承载（挂在不可变 `plan_version` 下）                                                                   | v1.1 §6.3；§7                                                                 |
| `product.plan_agent` (L669)    | `(agent_id,plan_id)` + `is_allowed`                                                             | **退役**     | product 合并后，"某档包含哪些产品"由 `plan_component.product_id` 表达（一档一行组件）                                                                                                              | v1.1 §6.3；§7                                                                 |
| `product.plan` (L608)          | `application_id`/`plan_code`/`plan_type`/`level`/`is_free`，唯一键 `(application_id,plan_code)` | **保留改造** | 拆为 `product.plan`（壳：plan_code/billing_cycle/current_version_id）+ `product.plan_version`（不可变快照）；**退 `application_id`**（§3.3.2），`plan_code` 由"app 内唯一"升为**全局唯一**         | v1.1 §6.2；§7                                                                 |
| `product.plan_price` (L711)    | `price`/`original_price`/`period_type`/`period_value`                                           | **退役**     | 价格内联进 `plan_version.price`（+ `currency`），周期归 `plan.billing_cycle`；多周期定价不再独立建表                                                                                               | v1.1 §6.2/§7.1                                                                |

**关系型 feature → `text[]` 的取舍（必须明示）**：现状是"目录表 `feature` + 两张联结表（`agent_feature`/`plan_feature`）"的三表关系模型，能用 FK 保证功能键真实存在、能反查"哪些 plan 授予了功能 X"。v2 用 `product.capability_keys text[]` + `plan_component.features text[]` 取代。**放弃的**：(1) 功能键的引用完整性——`text[]` 里的键不再被 FK 校验，拼写错误/孤儿键 DB 层捕获不到；(2) "哪些 plan 含功能 X"的高效反查——退化为数组包含（需 GIN 扫描）。**换取的**：(1) **版本不可变性**——功能键随 `plan_version`/`plan_component` 行一同冻结，组合变更只开新版本，没有联结表需要同步维护（与 §6.2/§7 版本化主线一致）；(2) **组合快照天然成立**——功能键随组件行旅行，免去关系模型的双写一致性；(3) 去掉两张高频联结表。**风险缓冲**：功能键命名空间降级为 seed/约定治理的词表，完整性靠 seed + CI 校验兜底（与 §6.1d `launch_checklist_item` 的 `i18n_complete` 同类思路），不靠 DB FK。这是有意的"完整性换不可变性"取舍，不是遗漏。

##### 3.3.2 `application_id` / scope-key 退役级联清单（rank 11）

`product.application` 退役后，`application_id` 这一列在**7 张在产/在建表**上失去引用对象，必须逐处处置——这是 v1.1 从未成表追踪、最易遗漏的级联。统一原则：能用 `product_id` 表达产品维度的改为 `product_id`；纯派生/可由 `plan_version` 反推的直接 DROP。

| 持有 `application_id` 的表                        | deploy 位置 | 处置                                                                     | 替代                                                                                               |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `product.plan.application_id`                     | L610        | **DROP**（连带改唯一键 `uq_plan_application_code`→`plan_code` 全局唯一） | 产品维度由 `plan_version → plan_component.product_id` 表达                                         |
| `commerce.tenant_subscription.application_id`     | L920        | **DROP**                                                                 | 由 `plan_version_id → plan_component.product_id` 派生（§3.3.3 / §8.1）                             |
| `commerce.tenant_app_provisioning.application_id` | L1007       | **改键** → `product_id`                                                  | 开通主体维度（§10）                                                                                |
| `commerce.app_webhook_delivery.application_id`    | L1025       | **改键** → `product_id`                                                  | 推送目标维度（§10）                                                                                |
| `commerce.tenant_usage_event.application_id`      | L1073       | **重建丢弃**（默认值 `0000…` 哨兵列废弃）                                | 用量改键 `workspace/product/metric`（§3.3.3 / §8.4）                                               |
| `commerce.tenant_usage_summary.application_id`    | L1107       | **重建丢弃**                                                             | 同上（§8.7）                                                                                       |
| `model.model_grant` 授权轴                        | L1332-1337  | **沿用**（授权上界 tenant/application，§11.2.3）                         | 仅 drop 过渡列 `agent_id`；计量 workspace/product 轴经 §11.3 映射在 consume 边界桥接，**非列改名** |

同源还需追踪 `agent_id`（`tenant_invoice_item` L786 / `tenant_usage_event` L1072 / `tenant_usage_summary` L1106 / `tenant_subscription_override` L1159 / `model_grant` L1338）与 `app_code`（`bundle_plan_component` L953 / `bundle_subscription_component` L990）——均随 product 合并塌缩为 `product_id`，分别在 §3.3.3/§3.3.4/§3.3.5 处置。

##### 3.3.3 commerce 权益域：订阅 / 配额 / 用量 重构

本组是计量内核（§8）的落库面。**`product`/`commerce` 空 → 数据可重建 + reseed**；但用量表的 writer 是 Model Platform，配额表/订阅表的 reader 是产品端与 admin-bff，故均受 §3.3.0 论断约束，按协调式迁移落地。

| deploy 现表                                     | 现状关键列                                                                                                                                         | 去向结论                                     | 目标表 / 章节                                                                                                                                                                                                                                                                                                                        | 依据（含 v1.1 § / rank）                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `commerce.tenant_subscription` (L917)           | `tenant_id`/`application_id`/`plan_id`/`cycle_type`/`pay_amount`                                                                                   | **保留改造**                                 | 补 `workspace_id NOT NULL` + `plan_version_id NOT NULL`→`plan_version`；**退 `application_id`**；保 `tenant_id`（账单 rollup 反查 org）；解除 (workspace,plan) 单订阅约束；`pay_amount` 与 `plan_version.price` 分离                                                                                                                 | v1.1 §7.1；§8.1                                   |
| `commerce.tenant_subscription_quota` (L1043)    | `max_users`/`max_api_keys`/`period_tokens`/`allowed_models`…（单层平铺快照）                                                                       | **退役**                                     | 单层模型无法表达"一 workspace 多份配额来源、按 priority 瀑布扣减" → 由 `commerce.quota_pool` 取代（实时余量 SoT）                                                                                                                                                                                                                    | v1.1 §7.2；§8.2                                   |
| `commerce.tenant_subscription_override` (L1156) | `(tenant_id,agent_id,feature_id)` + `custom_quota`/`is_unlimited`                                                                                  | **退役**                                     | 企业定制配额并入 `quota_pool`：插一条 `pool_source='manual_override'` 高优先级池即可，瀑布天然先扣；`granted_by`/`grant_reason` 承接审计                                                                                                                                                                                             | v1.1 §7.2；§8.2/§8.x                              |
| `commerce.tenant_usage_event` (L1069)           | `tenant_id`/`agent_id`/`application_id`/`feature_id`/`used_quota`/`input_quota`/`output_quota`/`model_code`/`latency_ms`/`cycle_month`（单表平铺） | **退役 + 破坏性重建（非命名对齐！rank 10）** | → `commerce.tenant_usage_event`(头：`workspace_id`/`product_id`/`metric_key`/`total_amount`，复合 PK `(id,created_at)`，按月 RANGE 分区，append-only RAISE 触发器) + `tenant_usage_event_pool`(明细，复合 FK)。**AI 维度（input/output token 拆分、model_code、latency、agent/feature）剥离到 Model Platform DB `reqlog`**（rank 5） | v1.1 §9.1（"命名对齐"表述作废）；§8.4/§8.9；§11   |
| `commerce.tenant_usage_summary` (L1102)         | `tenant_id`/`feature_id`/`agent_id`/`application_id`/`cycle_month`/`total_quota`/`stat_type`（单表月度）                                           | **退役 + 破坏性重建**                        | → 三层降采样（小时 `tenant_usage_summary` → 天 `_daily` → 月 `_monthly`，最小颗粒=小时，删 5 分钟层），重键 `workspace/product/metric`；只承担周期对账，实时一律读 `quota_pool`                                                                                                                                                      | v1.1 §9.2（颗粒度修正为小时）；§8.7               |
| `commerce.tenant_subscription_history` (L1131)  | `from_plan_id`/`to_plan_id`/`from_status`/`to_status`                                                                                              | **保留改造**                                 | `from/to_plan_id` 改引用 `plan_version_id`（版本化后变更记录应锁版本）；其余 append-only 沿用                                                                                                                                                                                                                                        | v1.1 §6.2/§7.1；§8.1                              |
| `commerce.bundle_plan_component` (L950)         | `plan_id`/`app_code`/`component_plan_id`（套件→子 plan 组合）                                                                                      | **退役**                                     | "套件"在 v2 即"一个 `plan_version` 下挂多个跨产品 `plan_component` 行"，原生多组件，无需独立组合表                                                                                                                                                                                                                                   | v1.1 §6.2/§6.3（多组件 plan_version 取代 bundle） |
| `commerce.bundle_subscription` (L967)           | `tenant_id`/`plan_id`/`status`（套件订阅头）                                                                                                       | **退役**                                     | 退化为单条 `tenant_subscription` 指向多产品 `plan_version`；无需独立套件订阅头                                                                                                                                                                                                                                                       | v1.1 §7.1；§8.1                                   |
| `commerce.bundle_subscription_component` (L987) | `bundle_subscription_id`/`app_code`/`component_plan_id`/`disposition`/`tenant_subscription_id`（套件展开成各 app 子订阅）                          | **退役**                                     | 展开语义由 `plan_component`（编排期）+ `quota_pool`（按 product/metric 扇出）共同承接，不再需要套件→子订阅的扇出表                                                                                                                                                                                                                   | v1.1 §6.3/§7.2；§8.2                              |

> **用量重建是本节最贵的一项**：它同时翻转了"用量唯一写入方"——deploy 头注释写"用量表为 model-platform 单一权威源"，而 §8 把唯一写入路径改成 **commerce `POST /usage/consume` 服务**（单事务幂等 + 全序锁）。这条须回写 `database.md` §7 规则4 / §11（已登记 §17），并新增 Model Platform **只读配额 gate 面**（直读 `quota_pool` 或专用 balance API），与产品端 `/entitlements` 区分（rank 6/15，§8.9）。

##### 3.3.4 commerce 账务域：`product_id` 引用调和 + provisioning 保留

账务八表的归属主体仍是 `tenant_id`（= org/tenant 结算账户，v1 §5 方案 A 不变），故**绝大多数沿用**；仅明细行的产品维度需随 product 合并调和。

| deploy 现表                                                                                                                                                          | 现状关键列                                  | 去向结论     | 依据                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commerce.tenant_invoice_item` (L782)                                                                                                                                | `agent_id`/`feature_id`/`usage_record_id`   | **改键**     | `agent_id`/`feature_id` → `product_id`（产品合并）；`usage_record_id` → 改名 `usage_summary_ref`，重指向 §8.7 `tenant_usage_summary`（周期对账/出账批次），**不再指逐笔** `tenant_usage_event`（与 §9.4/§9.12 对齐） |
| `commerce.tenant_invoice` (L743)                                                                                                                                     | `tenant_id`/`subscription_id`/`bill_cycle`  | **保留改造** | `subscription_id` 引用仍有效；新增 org-rollup 汇总各 workspace 的 charged 订阅费 + 超额（§9，语义深化非改键）                                                                                                        |
| `commerce.tenant_app_provisioning` (L1004)                                                                                                                           | `application_id`/`plan_id`/状态机           | **保留改造** | `application_id`→`product_id`（§3.3.2）；表本身**保留**，承接"开通生命周期"与"订阅"正交分离（§10）；+`workspace_id`(主体,§10.4)、删 `plan_id`、唯一键→(workspace_id,product_id)(§10.1)                               |
| `commerce.app_webhook_delivery` (L1022)                                                                                                                              | `application_id`/retry/lease                | **保留改造** | `application_id`→`product_id`；表保留，向外部产品仓推送开通（§10）；+`workspace_id`/`idempotency_key(UNIQUE)`/`provisioning_id`、status 终态扩 `dead`(§10.2)                                                         |
| `commerce.tenant_invoice_receipt` / `tenant_payment` / `tenant_refund` / `tenant_transaction` / `tenant_credit` / `tenant_billing_address` / `tenant_payment_method` | `tenant_id` 维度，无 product/agent/app 引用 | **沿用**     | 账务主体不变（`tenant_id` 指 §3.3.6 改名后的 `identity.tenant.id`）；`tenant_transaction` 不可变 RULE、`tenant_credit` 乐观锁等约束原样保留（§9/§17）                                                                |

##### 3.3.5 model 治理域：scope-key 调和（硬前置）

`model` 在产（当前 `vx-model-platform` 复用平台库），scope-key 与 commerce 用量必须**统一映射**，否则 `model_grant ↔ tenant_usage_event ↔ reqlog` 无法按单一 `request_id`/产品维度对齐——这是 §8/§11 的硬前置（§11.3 映射）。

| deploy 现表                                                            | 现状关键列                                                 | 去向结论                            | 依据（rank）                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `model.model_grant` (L1332)                                            | `tenant_id`/`application_id`/`application_type`/`agent_id` | **沿用**（授权轴不改名，§11.2.3）   | 保 tenant/application 授权轴（授权上界）；仅 drop 过渡列 `agent_id`；计量 workspace/product 轴经 §11.3 映射在 consume 边界桥接，**非列改名**；agent_catalog 映射为跨轮硬前置（§11.6/§18） | §11.2.3/§11.6（rank 1/3） |
| `model.model_policy` (L1387)                                           | `tenant_id`(nullable, per-tenant 限流)                     | **保留改造**                        | `tenant_id` 维度可保留作组织级限流；是否下沉 workspace 待 §11 定                                                                                                                          | §11                       |
| `model.provider`→`model.model_provider` / `model` / `model_price_rule` | provider/model 治理 + token 计价                           | **改名**（采纳 database.md，§18.2） | `provider`→`model_provider`（数据可重灌）；`model` bare、其余 `model_` 前缀与 database.md 一致；`model_price_rule` 作计费一等输入沿用                                                     | §11.1；§18.2              |

> 被丢弃的 AI 调用明细维度（input/output token 拆分、`model_code`、`latency_ms`、`agent_id`/`feature_id`）**不是删除**，而是**迁出**到 Model Platform DB `reqlog`（rank 5，§8.9/§11）；commerce 侧用量只保留计费 metric（`amount`）。

##### 3.3.6 identity 域：`organizations → tenant` 改名级联（在产，保数据）

`identity` 自 2026-06-18 在产，含真实用户/组织数据，**禁止 reseed**，一律 `ALTER … RENAME` 保数据 + 就地 `UPDATE` 改取值。`team→organization`、`realm` 取值同属本组级联。

| deploy 现表 / 列                              | 现状                                                                         | 去向结论                    | 手段（保数据）                                                                                                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity.organizations` (L133)               | 表名 `organizations`，`type`∈{personal,team?}，`owner_user_id`               | **保留改造（改名）**        | `ALTER TABLE identity.organizations RENAME TO tenant;`；`UPDATE … SET type='organization' WHERE type='team';`（§0.4 team→organization）；`owner_user_id` **保留**（v1.1 §5a 修正，配唯一约束 + 原子转移），owner 亦可由 `tenant_membership.role='owner'` 派生 |
| `identity.organization_profile` (L159)        | `organization_id` PK                                                         | **改名**                    | `RENAME TO tenant_profile;` + `RENAME COLUMN organization_id TO tenant_id;`；`logo_data` bytea 是否迁对象存储记 §17                                                                                                                                           |
| `identity.org_memberships` (L212)             | `organization_id`/`role`/`status`                                            | **改名**                    | `RENAME TO tenant_membership;` + `RENAME COLUMN organization_id TO tenant_id;`（四层模型 §4）                                                                                                                                                                 |
| `identity.workspaces.organization_id` (L191)  | 工作空间挂 org                                                               | **改键（字段改名）**        | `RENAME COLUMN organization_id TO tenant_id;`（连带索引 `idx_workspaces_organization_id`→`_tenant_id`）                                                                                                                                                       |
| `identity.invitation.organization_id` (L257)  | 邀请作用域                                                                   | **字段改名**                | `RENAME COLUMN organization_id TO tenant_id;`（`scope` 取值同步）                                                                                                                                                                                             |
| `identity.audit_event.organization_id` (L420) | 审计归属                                                                     | **字段改名**                | `RENAME COLUMN organization_id TO tenant_id;`                                                                                                                                                                                                                 |
| `identity.workspace_memberships` (L233)       | 仅 `workspace_id`，无 org 引用                                               | **沿用**                    | 四层模型保留，无改名                                                                                                                                                                                                                                          |
| `identity.auth_session.realm` (L286)          | `realm`∈{tenant,operator}                                                    | **保留改造（就地 UPDATE）** | `UPDATE … SET realm='customer' WHERE realm='tenant'; … 'workforce' WHERE realm='operator';`（§0.4，与 bff/cookie/sub 前缀发版锁步）                                                                                                                           |
| `identity.users` (L45) 等其余 auth 表面       | users/identities/credential/avatar/verification/token/login*attempt/oauth*\* | **保留改造 / 沿用**         | 与本节改名级联无关；其 profile 拆分、成长字段见 §4/§6（独立任务线）                                                                                                                                                                                           |

##### 3.3.7 admin 域：`ops → admin` schema 改名（在产，保数据）

`ops` 自 2026-06-18 在产（含 operator 身份 + 治理表），改名按**保数据**执行；**表名 `operator_*` 前缀保留**（§0.4），仅 schema 命名空间从 `ops` 改为 `admin`。

| 范围                           | deploy 现状                                                                                                                                                                                                                                            | 去向结论                                | 手段                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ops` schema 整体（16 表）     | `@@schema("ops")` ×16（L1454–L1762）：`operator_account/credential/mfa/webauthn_credential/recovery_code/verification/login_attempt/refresh_token/role/permission/role_permission` + `setting/governance_record/feature_flag/announcement/maintenance` | **改名（保留改造）**                    | `ALTER SCHEMA ops RENAME TO admin;`（保数据，一次性）；同步 Prisma `@@schema`、seed、`search_path`、admin-bff、`ops.setting` 键、identity-platform-operator.md、在途 P4 分支（§0.4 波及面） |
| operator 身份 11 表            | 与 `identity.*`/`iam.role                                                                                                                                                                                                                              | permission` **无 FK、无跨读**（硬隔离） | **沿用结构**（仅换 schema 名）                                                                                                                                                              | MFA/WebAuthn/recovery/step-up/短会话设计原样（§14，引用 identity-platform-operator.md 而非复制） |
| `governance_record` 通用治理表 | deploy 单张(kind+id)                                                                                                                                                                                                                                   | **拆分退役（采纳 database.md，§18.2）** | 拆为 `admin.risk_record` + `admin.compliance_event`（§14.4.5）；数据可重灌，无迁移成本                                                                                                      |

##### 3.3.8 去向汇总与未尽事项

按结论归类（不含纯账务/auth 沿用表）：

- **退役（11 张）**：`feature`、`agent_feature`、`plan_feature`、`plan_agent`、`plan_price`、`tenant_subscription_quota`、`tenant_subscription_override`、`bundle_plan_component`、`bundle_subscription`、`bundle_subscription_component`，以及**退役 + 破坏性重建**的 `tenant_usage_event`/`tenant_usage_summary`（计 2，rank 10）。
- **重映射（2 张）**：`agent`、`application` → `product.product`。
- **改键（3 张/列）**：`tenant_invoice_item`、`app_webhook_delivery`、`tenant_app_provisioning`（`application_id`→`product_id`）。`model_grant` **沿用授权轴**（仅 drop 过渡列 `agent_id`，§11.2.3）。
- **保留改造（含改名，~12 张）**：`plan`、`tenant_subscription`、`tenant_subscription_history`、`tenant_invoice`、`organizations→tenant`、`organization_profile→tenant_profile`、`org_memberships→tenant_membership`、`workspaces`/`invitation`/`audit_event`（列改名）、`auth_session`/`oidc_client`（realm 取值）、`ops`→`admin`（schema 改名）。
- **沿用（账务 7 表 + auth 余下表 + model 静态 3 表 + operator 11 表结构）**：主体与约束不变。

> `iam.oidc_client.realm`（L491，默认 `"tenant"`）的取值收窄为 `customer/workforce`、新增 `product_id`/`release_channel`/`logo_url`/`display_name` 属 §5（iam 域）改造，本节仅登记其 `realm` 取值随 §3.3.6 级联同改（就地 `UPDATE` + 改默认值）。
>
> **本矩阵的存在本身是 rank 11 的修复**：后续每一章（§7/§8/§9/§10/§11/§14）落字段级 DDL 时，须回查本表确认"现表→目标表"映射无遗漏；矩阵与各章 DDL 不一致时，以各章 DDL 为准并回写本表。`§3.1 全景表`的现状表数（product=8 非 7、commerce=20、identity=18 非 16）应按本节实际核定回填。

---

##### 受影响表去向矩阵

| v1.1 来源                             | v2 表/列                                                    | 处置                  | 对应 deploy 现状                                  |
| ------------------------------------- | ----------------------------------------------------------- | --------------------- | ------------------------------------------------- |
| §5c `users.level_no`                  | `identity.users.level_no`                                   | 【修订·加列】         | `users` 表存在，**无 level_no 列** → ADD COLUMN   |
| §5c `user_level_policy`               | `identity.user_level_policy`                                | 【新建】              | 无                                                |
| §5d `user_level_threshold`            | `identity.user_level_threshold`                             | 【新建】              | 无                                                |
| §5d `user_points`                     | `identity.user_points`                                      | 【新建】              | 无                                                |
| §5d `user_points_ledger`              | `identity.user_points_ledger`                               | 【新建】              | 无                                                |
| §5d `user_task_progress`              | `identity.user_task_progress`                               | 【新建】              | 无                                                |
| §5c `tenant.verification_status/type` | `identity.tenant.verification_status` / `verification_type` | 【修订·加列】         | `organizations` 表存在，**无这两列** → ADD COLUMN |
| §5c `commerce.verification_policy`    | `commerce.verification_policy`                              | 【新建·rank 24 修订】 | 无                                                |

---

#### 7.1 受影响表去向矩阵（deploy 现状 → v2 目标）

| deploy 现表                              | 现状用途                                      | v2 处置          | 去向                                                                                                                      |
| ---------------------------------------- | --------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `product.agent`                          | 智能体目录                                    | **合并**         | → `product.product`（`product_type='agent'`），§7.2                                                                       |
| `product.application`                    | 应用目录                                      | **合并**         | → `product.product`；`home_url`/`webhook_*` → `product.product_webhook`（§7.7）                                           |
| `product.feature`                        | 功能键字典（规范化表）                        | **退役**         | 功能键改为字符串：`product.capability_keys` / `plan_component.features`（`text[]`，ADR-11 §3.4 功能键由产品端定义），§7.9 |
| `product.agent_feature`                  | 智能体↔功能 关联                              | **退役**         | → `product.capability_keys text[]`（§7.2/§7.9）                                                                           |
| `product.plan`                           | 套餐（挂 `application_id`）                   | **修订（重建）** | → `product.plan`（壳）+ `product.plan_version`（不可变版本），§7.6                                                        |
| `product.plan_agent`                     | 套餐↔智能体 允许关系                          | **退役**         | → `product.plan_component.product_id` 直接表达，§7.6/§7.9                                                                 |
| `product.plan_feature`                   | 套餐↔功能 + 配额                              | **退役**         | → `product.plan_component.features` + `.quota`，§7.6/§7.9                                                                 |
| `product.plan_price`                     | 套餐价格（多周期多条）                        | **退役**         | → `product.plan_version.price` + `product.plan.billing_cycle`，§7.6/§7.9                                                  |
| `commerce.bundle_plan_component`         | 套件→组件套餐声明（migration 0004）           | **退役**         | → 多组件 `product.plan_version`（一个 version 多条 `plan_component`），§7.9                                               |
| `commerce.bundle_subscription`           | 套件订阅记录                                  | **退役**         | → `commerce.tenant_subscription` 指向多组件 plan_version，§7.9/§8.1                                                       |
| `commerce.bundle_subscription_component` | 套件 fanOut 处置（added\|deferred\|bypassed） | **退役**         | → 多组件 plan_version 激活时直接物化多个 `quota_pool`，无 fanOut 中间态，§7.9                                             |

> 矩阵覆盖 deploy 8 张 `product` 表 + 3 张 `commerce.bundle_*` 表（后者物理在 commerce schema，因其语义被本域的多组件 plan_version 取代，处置在此一并声明）。本域重建，故所有"退役"= 新结构里**不再创建该表**，不存在数据迁移脚本。

---

#### 9.2 受影响表去向矩阵（9 表）

| 表                                          | 处置                                 | 对应                                     | 核心变更                                                                                                                                    |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_invoice`（账单头）                  | **修订**                             | deploy `commerce.tenant_invoice`         | org 级 rollup 头；`subscription_id` 改可空（org 账单跨多订阅）；明细化交由 item                                                             |
| `tenant_invoice_item`（账单行）             | **修订**                             | deploy `commerce.tenant_invoice_item`    | **+`workspace_id`（rank 20）**；`agent_id`/`feature_id`→`product_id`/`metric_key`（scope-key 调和 §11）；`usage_record_id` 重指向 §8.7 汇总 |
| `tenant_invoice_receipt`（中国发票 fapiao） | **沿用（+取值收敛）**                | deploy `commerce.tenant_invoice_receipt` | 税号/公司/银行/快递已齐；补 `invoice_type`/`invoice_tax_type` CHECK                                                                         |
| `tenant_payment`（支付）                    | **沿用（+FK/CHECK）**                | deploy `commerce.tenant_payment`         | 线上+线下多渠道+凭证已齐；`transaction_id`→FK `tenant_transaction`；状态 CHECK                                                              |
| `tenant_refund`（退款）                     | **沿用（+FK/CHECK）**                | deploy `commerce.tenant_refund`          | 双状态机（audit + refund）；FK 指向 payment/transaction                                                                                     |
| `tenant_transaction`（资金流水）            | **修订（不可变 + trade_type 收敛）** | deploy `commerce.tenant_transaction`     | **承接 database.md §11 不可变约束**（DB 级阻止 UPDATE/DELETE，§9.8）；`trade_type` CHECK                                                    |
| `tenant_credit`（预付款池）                 | **修订**                             | deploy `commerce.tenant_credit`          | = ADR-11 `billing_account.prepaid_balance`；保留 `version`（乐观锁）；补 `created_at`                                                       |
| `tenant_billing_address`（开票抬头）        | **沿用**                             | deploy `commerce.tenant_billing_address` | 抬头/税号/银行/地址，多条 + `is_default`                                                                                                    |
| `tenant_payment_method`（支付方式）         | **沿用**                             | deploy `commerce.tenant_payment_method`  | 多条 + `is_default`；网关未接入前主要承载线下方式                                                                                           |

> **命名待统一（登记 §18.2）**：deploy 中 `tenant_invoice` 的列用 `bill_*` 前缀（`bill_no`/`bill_status`/`bill_cycle`/`bill_type`），而 `tenant_invoice_receipt` 用 `invoice_*` 前缀。本库术语：**账单 = `tenant_invoice`（bill，应收凭证）**，**发票/fapiao = `tenant_invoice_receipt`（invoice，税务凭证）**。本章保留 deploy 列名以免误导工程改名成本，但建议后续把账单头列前缀统一为 `invoice_*`（重灌前一次性改）。

---

## 3. 分域迁移策略 / schema 改名 / 退役 / 代码锁步

#### 4.19 在产域保数据迁移 + 波及面（rank 14/9）

identity 自 2026-06-18 上生产，**按"保数据迁移"，不 reseed**（§0.4 / §17 迁移策略）。落笔前先核生产实际行数。本域迁移动作分类：

| 手段                                             | 适用       | 本域具体项                                                                                                                                                                                      |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALTER TABLE … RENAME`（表/列，保数据）          | 改名级联   | organizations→tenant、organization_profile→tenant_profile、org_memberships→tenant_membership；workspaces/invitation/audit_event/tenant_profile/tenant_membership 的 `organization_id→tenant_id` |
| 就地 `UPDATE` 改值                               | 枚举收窄   | `tenant.type` team→organization；`auth_session.realm` tenant→customer / operator→workforce                                                                                                      |
| `CREATE TABLE` + `INSERT…SELECT` + `DROP COLUMN` | §4.19 拆分 | 建 `user_profile`，`INSERT…SELECT` 迁 name/avatar_url/avatar_hash/bio/language/timezone（bio 先验长度），再从 `users` 删这 6 列                                                                 |
| 加约束/索引                                      | 不变量     | `chk_users_status`、`chk_tenant_type`、`chk_auth_session_realm`、`uidx_tenant_personal_owner`、`uidx_tenant_membership_owner`、`uidx_workspace_default`、owner 约束触发器 + 转移函数            |

**工程线波及面（不在本 docs 任务内执行，登记 §17 协调清单）**：

- **realm rename（rank 14/9）**：`auth_session.realm` 值 + seed（约 14 处）+ auth-bff/admin-bff/accounts 代码 + `sub` 前缀/cookie 域 + identity-platform-operator 红线，须与代码发版**锁步**；`iam.oidc_client.realm` 同步收窄（属 §5）。
- **organizations→tenant rename**：Prisma model（`Organization`→`Tenant`、`OrganizationOwner` 关系、`@@map`）、FK/索引名（`fk_*_organization*`、`idx_*_organization_id`）、search_path、各 bff Repository/Service 命名，与 seed 同步重生成键名（保数据，不重灌数据）。
- **core vs deploy 两份 Prisma**：core 客户端 identity 落后于 #540（缺 `organization_profile`/User 新列），本批 rename + 拆分须把 core 一并对齐（§17）。
- **回写 `database.md` §3.1**（§17 清单）：`organizations`→`tenant`、`org_memberships`→`tenant_membership`、`type=personal|organization`、新增 `user_profile`/`tenant_profile` 行、`realm` 说明改为 customer/workforce、补三条部分唯一索引与 owner 约束到不变量段。

---

#### 5.6 迁移顺序、波及面与待决（多属工程线）

- **realm 改名 = 工程线全栈 rename（§0.4 已锁，本 docs 任务不执行）**：`iam.oidc_client.realm` + `identity.auth_session.realm`（§4）+ seed（约 14 处）+ auth-bff/admin-bff/accounts 代码 + `sub` 前缀/cookie 命名 + **identity-platform-operator.md 红线**，须与代码发版**锁步**，不能 docs 单独改库。两处 realm 取值必须同时改、保持 customer/workforce 一致。
- **跨 schema FK 迁移顺序（§18.1#3）**：`oidc_client.product_id` FK → `product.product(id)`。product 域为空可**重建+reseed**，iam 为在产域**保数据**。安全顺序 = ① 先在 iam 加 `product_id`（nullable，存量行先留 NULL）→ ② 重建 product 域并 reseed → ③ 回填 oidc_client.product_id（按 client_id 映射到对应 product）→ ④ 最后 `ADD CONSTRAINT fk_oidc_client_product`。重新耦合 iam→product（identity-data-model 曾刻意切断该耦合）本身仍是**待决②**，推荐落 FK；若决定不引入跨 schema 物理 FK，则保留为应用层引用 + `idx_oidc_client_product`。
- **非 Prisma DDL 构造登记（§17）**：本章新增 `chk_oidc_client_realm/_release_channel/_slo/_slo_uri`、`chk_role_scope`、`chk_signing_key_status`、部分唯一索引 `uidx_signing_key_active`、部分索引 `idx_oidc_client_product` —— Prisma 不直接生成，重建时必须保留。
- **回写 database.md §3.3**：三套权限域表的"运营域 RBAC"位置由 `ops.*` 改为 `admin.*`（§14）；realm 取值 customer/workforce 已在 §3.1 回写清单内（§17）。

---

#### 6.4 迁移策略小结（按 §0.4 / §17 分域）

- **`identity` 在产域（保数据迁移、不 reseed）**：
  - `users.level_no`、`tenant.verification_status/verification_type` → **加列带默认或可空**，存量行自动取默认（level=1 / status='unverified' / type=NULL）。
  - `user_points` 新表 → 建表后对存量用户 `INSERT … SELECT … ON CONFLICT DO NOTHING` 回填零余额行。
  - `user_level_policy` / `user_level_threshold` → 新表 + **5 级占位 seed**（属配置数据，非业务数据，可直接 INSERT）。
  - `user_points_ledger` / `user_task_progress` → 新表，无存量数据需迁移。
- **`commerce` 空域（可重建 + reseed）**：`verification_policy` 新建 + 基准 seed。
- 落笔/执行前先核生产实际行数（§17）。**代码/seed 改动属工程线、不在本 docs 任务内执行。**

---

#### 7.9 退役声明与 bundle → subscription 处置

**A. `plan_feature` / `plan_price` 退役（被 plan_version/component 取代）**

- `plan_feature.feature`（功能） + `quota_value`/`is_unlimited`/`config_json` → `plan_component.features text[]` + `plan_component.quota jsonb`。
- `plan_price`（多周期、`original_price`、`is_default`） → `plan_version.price` + `plan.billing_cycle`；版本化天然承载"历史价格不可变"，多周期定价以多 plan/version 表达。

**B. `feature` / `agent_feature` / `plan_agent` 退役（同一关系网的连带处置）**

- 功能键由产品端定义为**字符串**（ADR-11 §3.4）→ `product.capability_keys` / `plan_component.features`（`text[]`）；规范化的 `feature` 字典表不再是 entitlement 解析的取数路径，故退役。
- `agent_feature`（智能体↔功能） → `product.capability_keys`；`plan_agent`（套餐↔智能体允许关系） → `plan_component.product_id` 直接表达。
- 若日后需要 admin 可读的"功能键 → 名称"展示字典，可再引入轻量字典表（不影响解析路径）——列入 §7.10 待决。

**C. `bundle_plan_component` / `bundle_subscription` / `bundle_subscription_component` 退役（commerce schema，migration 0004）**

- **旧模型**：bundle plan（`product.plan` 以 `plan_type='bundle'`）经 `bundle_plan_component` 声明 per-`app_code` 的组件套餐；购买时 `BundlePurchaseService.fanOut()` 产生 per-component 处置（`added` | `deferred` | `bypassed`，Strategy A），`added` 时连一条 `tenant_subscription`，并落 `bundle_subscription` + `bundle_subscription_component` 记录扇出结果。
- **新模型处置（bundle → subscription）**：「跨 app 套件」= **一条多组件 `product.plan_version`**（一个 version 下多条 `plan_component`，每条对应一个 product）。
  1. 一笔 `commerce.tenant_subscription` 指向该多组件 plan_version（§8.1），不再有"套件订阅"这个独立实体 → 取代 `bundle_subscription`。
  2. 订阅激活时，平台按各 `pool` 型 `product_metric` **物化多个 `commerce.quota_pool`**（§8.2/§8.3）——这一步**取代 fanOut**；`added`/`deferred`/`bypassed` 的 per-component 中间态不再需要（组件即 `plan_component`，开通即 `quota_pool` 物化）→ 取代 `bundle_subscription_component`。
  3. `bundle_plan_component`（声明哪些组件套餐组成套件）→ 由 plan_version 下的多条 `plan_component` 自然表达 → 退役。
- **迁移**：本域为空域（§0.3）→ **不重建** `bundle_*` 三表，bundle 直接以多组件 plan_version 重新 seed，无 fanOut 历史数据需迁。

---

#### 8.x 退役 / 校正

- 退役 `iam.capability`/`plan_capability` 作 entitlement SoT；旧 `tenant_subscription_quota`/`override` 由 `quota_pool`(+`pool_source='manual_override'`) 取代。
- 校正：v1.1 §7.2 `WHERE expires_at > now()` 部分索引**本就非法**（now() 非 IMMUTABLE）→ 已改普通复合索引（§8.2）。

**依赖的待决项**：① scope-key 迁移 + §11.3 映射（硬前置，§11）；② 标价 NUMERIC(18,6)/金额 NUMERIC(12,2) 沿用 v1.1；③ per-workspace 粒度已由 ADR-11 确认。

---

#### 10.5 退役 / 迁移 / 依赖与待决

**迁移策略（commerce 为空域 → 重建 + reseed，§0.3/§17）**：本章两表随 commerce 重建，直接按目标态建表，**不写数据迁移**。落地的结构变更：

- 加 `workspace_id NOT NULL`（主体）；`application_id` → `product_id REFERENCES product.product(id)`（rank 6/15）。
- 唯一约束 `(tenant_id, application_id)` → `(workspace_id, product_id)`。
- 删 `tenant_app_provisioning.plan_id`（正交，§10.1）。
- 补 `app_webhook_delivery.idempotency_key`(UNIQUE) / `provisioning_id` / `provisioning_version` / `max_attempts` / `last_error` / `signature` / `leased_by` / `delivered_at` / `updated_at`，并把 `status` 终态集扩为 `pending|delivering|delivered|failed|dead`（rank 21）。

**依赖**：

- scope-key 调和（`application→product`、`tenant→workspace`）与 §11.3 映射、§8 同根；本章 `product_id` 须等 product 合并（§7）落地。**(rank 6/15)**
- §7 `product.product_webhook` 须存在并配好 `webhook_url`+`webhook_secret_ref`，否则该 product 的事件不入队（仅在已配端点的产品上产生投递行）。

**待决（记入 §18）**：

1. 跨 schema FK `product_id → product.product`：沿用 §8.2 先例已用 FK；`workspace_id/tenant_id → identity` 是否建 FK 归 §18.1#3 全局待决。
2. `event_type` 枚举终集（`provisioned`/`deprovisioned` 为基线；`subscription_changed`/`quota_warning` 等是否纳入本通道，属范围决策——业务待填）。
3. `max_attempts` 与退避曲线 `backoff(attempts)` 取值（运维待填）。
4. `app_webhook_delivery` 留存/归档策略（`delivered` 旧行清理周期；本表不分区，与 §8.4/`support.audit_log` 的分区表区别对待）。

---

#### 11.6 协调式破坏性迁移（非 drop/重建，rank 5）

scope-key 切换牵动"谁写 usage_event"，须按依赖顺序、保旧 writer 至切换完成：

1. **落地 `product.agent_catalog`**（§7 同构扩展，**本轮外/跨轮前置**）+ §11.3 三映射口径 → scope-key **可解析**（未完成不进下一步）。
2. **建 commerce consume 服务 + `POST /usage/consume`**（§8.3）+ 只读 gate 面（§11.4）。
3. **保留旧 `tenant_usage_event` + 现 writer（tenant 轴）继续运行**，与新 consume 路径并存。
4. Model Platform 切到 `POST /usage/consume`（workspace 轴，经 §11.3 解析）。
5. 切换稳定后再退役旧 writer，并 drop `model_grant.agent_id` 等过渡列。

- `model` 配置表（provider/model/price/policy）本身可重建 + reseed（§11.0）；**受协调约束的只是 `model_grant` 的 scope 轴 + 旧 usage writer**——不可裸 drop（rank 5）。

#### 14.1 schema `ops` → `admin`：不是改名，是一次锁步收口 (rank 16)

v1.1 §4.1 把本步描述为"`ALTER SCHEMA` 改个名、16 张表原样迁移"。这是低估——**schema 名是被全栈引用的契约**，物理 `RENAME` 只是其中一步，真正的工作量在 ~30 处引用的**锁步切换**。明确标注：除 DDL 外的引用切换属**工程线**，不属本数据架构总纲的设计决策，但必须在总纲点名，避免被当成"一行 SQL"。

**v2 锁定取值 = `admin`。** 注意 v1.1 §4.1 曾把本域 schema 定为 `console`（并联动把客户侧产品名由 console 改为 workspace）——该决策在 v2 被**推翻回 `admin`**（运营 schema = admin / 表名 `operator_*` 前缀保留）。客户侧产品改名与否是产品线议题，与本域 schema 名解耦，不再绑定。

**物理迁移（保数据，生产域）：**

```sql
-- schema 改名：保全部表/数据/索引/FK/约束，仅换命名空间
ALTER SCHEMA ops RENAME TO admin;
```

**锁步引用清单（~30 处，工程线，DDL 之外）：**

| 引用面     | 切换内容                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Prisma     | 全部本域 model 的 `@@schema("ops")` → `@@schema("admin")`                                                         |
| seed       | `deploy/database/prisma/seed.mjs` 中 `ops.*` 写入路径                                                             |
| DB 连接    | 各服务 `search_path` 含 `ops` 的改 `admin`                                                                        |
| admin-bff  | 回查 `ops.operator_role_permission` / 读 `ops.setting`（如 `operator.mfa.policy`）的 schema 限定名                |
| 配置键引用 | `ops.setting` 的 `config_key` 字符串值（如 `operator.mfa.policy`）**不变**，仅 schema 限定名变 `admin.setting`    |
| 专项文档   | `identity-platform-operator.md`（§6.1 明写 schema=`ops`，~多处）+ `database.md §3.7` 标题与表清单需回写为 `admin` |
| 在途分支   | P4 加固分支 `feature/operator-session-hardening`（未 push）落地前需对齐到 `admin`                                 |

> **表名 `operator_*` 前缀保留**：schema `admin` 内运营身份表与平台治理表（setting/feature*flag/announcement/maintenance/risk_record/compliance_event）共存，`operator*` 前缀是二者的可读区隔，不随 schema 改名而改表名（无级联改表）。

---

#### 15.6 迁移姿态（§17 按域策略落地）

`support` 不在"在产域 identity/iam/admin"清单内，生产表已建但工单/审计/通知功能基本未投产、数据基本为空，故按**接近空域**处理：

- 表结构与字段 deploy 已完整 → 本章变更均为**就地 ALTER**，无需重建：
  1. `audit_log`：`ALTER ... DROP CONSTRAINT` 旧单列 PK → 加 `PRIMARY KEY (id, created_at)`；改造为分区表（空表期最简：建新分区父表 + `INSERT…SELECT` 迁移既有少量行，或空表直接重建为分区表后回灌）。
  2. 四表补 `chk_` 约束（落笔前先核生产实际行数，确认现存行满足约束再加，否则先 `UPDATE` 收敛取值）。
  3. 索引按 §3.2 前缀收口（`DROP INDEX` 旧名 + `CREATE INDEX` 新名）。
  4. 加 `ticket_comment` / `audit_log` 不可变触发器、`audit_log` 分区维护函数 + 调度。
- 落笔前务必 `SELECT count(*)` 核每表生产行数：若确为空，`audit_log` 直接 `DROP` 重建为分区表最干净；若已有少量审计行，走 `INSERT…SELECT` 不丢数据（审计不可丢）。

---

---

## 4. database.md 回写清单（已作废：database.md 已并入 v2 顶层）

> ⚠️ `database.md` 已于 2026-07-01 并入 [`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2/§3.2 并退役。以下"回写点"**不再回写 database.md**，仅作"已在 v2 顶层落实"的核对清单。

#### 9.14 非 Prisma DDL → §17 登记 + database.md 回写清单

| 构造                    | 表                       | 说明                                                                                                                         |
| ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **不可变 RAISE 触发器** | `tenant_transaction`     | `BEFORE UPDATE OR DELETE → RAISE EXCEPTION`（§9.8）；**禁** `DO INSTEAD NOTHING` RULE（rank 17 静默吞写）。重建必保留。      |
| 部分唯一索引（可选）    | `tenant_billing_address` | 若用 DB 强制"每 tenant 至多一条 default"：`CREATE UNIQUE INDEX ... ON (tenant_id) WHERE is_default AND deleted_at IS NULL`。 |
| 乐观锁约定              | `tenant_credit`          | `version` 列 + `UPDATE ... WHERE version=:v` 语义（非 DDL，但属并发不变量，文档化）。                                        |

回写 database.md：§11 "tenant_transaction 不可变（DB 规则）" → 校订为 **RAISE 触发器**实现；§3.5 commerce 表清单补 `tenant_invoice_item.workspace_id`（org 结算/workspace 成本分离）。

#### 11.7 待回写 database.md + 待决

**回写 database.md（记入 §17 清单）**：

- §3.6 已与本文一致（`model_provider`，§18.2 采纳 database.md）；明确 `model.model` 退役冗余 `provider` 字符串列（保 `provider_id` FK）。
- §3.2 增列 "provider 成本费率 `numeric(18,8)` 例外"（§11.2.4）。
- §4 Model Platform DB 字段级（key/reqlog/routing）以本章 §11.5 为准；明确"`reqlog` 承接被丢 AI 维度、commerce 只存单一计费 metric amount"（§8.9②）。
- §11 铁律：用量唯一写入方 = **commerce consume 服务**（非 Model Platform 直写），Model Platform 仅得**只读配额 gate 面**（§11.4，与 §8.9①/§8.x 一致）。

**待决**：

1. `model` schema 内命名归一（§11.1：维持现状 A vs 全前缀/全 bare B）。
2. `model_grant` 是否引入 `workspace_id` 做窄于 tenant 的授权收窄（§11.2.3）。
3. `endpoint_url` 权威落点：平台库 `model.model` vs Model Platform DB `routing.provider_config`（§11.5.3）。
4. fail-open 有界额度的运营配置位（建议 `admin.setting`，§11.4）。
5. `application_type` 哨兵 UUID（无 application scope 时记 `internal_service`，model-platform.md §7）在调和口径下如何映射 product_id（§11.3 非 agent 分支）。

---

---

## 5. 待决事项与业务待填

#### 6.5 业务待填值与待决（沿用 v1.1 §5c/§5d + §18.4）

| 项                                       | 待填                                             | 备注                                          |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `user_level_policy.max_owned_org_tenant` | 各级具体上限（现占位全 1）                       | UPDATE 替换，应递增，不改表                   |
| `user_level_threshold.min_points`        | 各级积分阈值（现占位 0/1/2/3/4）                 | UPDATE 替换；须保持单调、满足 UNIQUE          |
| `user_points_ledger.source_type`         | 来源枚举（check_in/invite/task/…）               | 纯标签，varchar 已兼容，无需字典表            |
| `user_task_progress.progress_type`       | 进度类型枚举                                     | 同上                                          |
| `verification_policy`（product 级）      | 各产品线/场景的认证策略配置                      | 上架前置项，§7 检查清单强制                   |
| level↔积分换算复杂度                     | 是否超出"单调阈值"（来源权重/时间衰减）          | 若超出需另设计阈值表外的模型                  |
| `user_points_ledger` 是否 append-only    | 是否比照 §9 `tenant_transaction` 加 RAISE 触发器 | 可选增强，不阻塞；列入 §17 非 Prisma DDL 候选 |
| level ↔ 订阅是否联动                     | 目前按独立机制                                   | 不建 FK，关联逻辑留应用层                     |

---

#### 7.10 依赖的待决项

1. ✅ **产品矩阵命名已定型为终版**（2026-07-06 owner 拍板，§18.2#5 同步销号）：L1=Atlas/Ontos/Runos、L2=Arda/Karda/Terra、L3=Raven/Anlan/Forge/Xuanzhen；权威 = [`product_100_matrix.md`](./product_100_matrix.md) v1.0。seed 取值迁移登记（`data`→`arda` 改名、`nocus` 处置、现 `ruyin` code→`umbra` 迁移考量、`karda`/`terra` 新增）见 product_100_matrix §6（实施规划 = product_300_naming-migration），为独立实施项；中文品牌名/i18n 文案仍由运营后补。
2. `product_category` 字典枚举（大类/小类命名与层级关系，业务侧给出，§18.4）。
3. 是否为 admin 展示重建一张轻量"功能键名称"字典（默认 `feature` 退役为 `text[]`，§7.9-B）。
4. 各 `pool` 型 `product_metric` 的 `consume_mode` 取值（`divisible` vs `atomic`，随 metric 定义给出）。
5. `tier` 取值集是否最终定为 `standard/starter/pro/business/enterprise` 五档（与 ADR-11 / §8 对齐）。

---

#### 9.15 依赖待决项

1. **支付网关接入**（现状 ⏳ 未接入）：`pay_channel`/`channel_*`/回调幂等在微信/支付宝/银行接入后启用；线下路径可先上线。
2. **org-rollup 汇总语义细化**：计量超额计价口径（按 `model_price_rule` 还是 plan 级阶梯）、跨币种 workspace 如何并入单币种 org 账单——待 §11 计价规则与业务确认。
3. **外键归属 = 方案A（`tenant_id`）确认**：账务三表（credit/billing_address/payment_method）+ 账单头均挂 org/tenant；workspace 仅在明细行（v1.1 §5 已拍板，此处复述确认）。
4. **scope-key 硬前置**：`tenant_invoice_item.product_id`/`metric_key` 依赖 §11.3 映射（agent/feature→product），映射就绪前出账逻辑不启用。
5. **多币种 billing account**：当前 `tenant_credit` 单币种/org；多币种需改唯一键为 `(tenant_id, currency)`。
6. **列前缀统一**：`tenant_invoice` 的 `bill_*` 前缀 vs `tenant_invoice_receipt` 的 `invoice_*`，建议重灌前一次性收敛（§18.2）。

---

### 18. 待决事项与业务待填

#### 18.1 范围/架构决策

1. ✅ **gateway 归属** = 取消，归独立 Model Platform DB（§12/§0.4）。
2. ✅ **provider key 归宿** = Model Platform DB `key`（当前运行环境注入）。
3. ✅ **跨 schema 完整性** = **保持无 FK**（应用层保完整性；schema 内 FK 照用；利于未来按域拆服务）。
4. ✅ **core vs deploy** = **deploy 为权威基线**，`packages/core` 从统一 schema 重生成，#540 落后列本轮一并对齐（数据可重灌，无迁移风险）。
5. ✅ **对象存储** = **暂留 in-DB bytea**（起步最小；量级上来再迁 OSS，登记未来优化，§17）。
6. **「待取代」文档** supersede 执行（§0.2）—— **待 owner 点头**：确认后给 platform-db / bff-data-access-guide / core-database / db-platform-governance / db-tickets 5 份加 superseded 头指向本文。

#### 18.2 命名/取值

1. ✅ `tenant.type` = **personal / organization**（记 team→organization，同步上游）。
2. ✅ `realm` = **customer / workforce**（全栈 rename 工程）。
3. ✅ 运营 schema = **admin**（原 ops）。
4. ✅ **命名归一 = 全按 database.md**（owner 决）：`model_provider`（弃 provider）、`ticket_comment`（弃 ticket_event）、`risk_record` + `compliance_event`（拆分，弃 governance_record 通用表）。已在 §11.1/§14.4.5/§15.2 落实。
5. ✅ **产品矩阵/品牌命名 = 已定型终版**（2026-07-06 owner 拍板，取代原"暂缓定名"决议）：`product_code` 终版见 [`product_100_matrix.md`](./product_100_matrix.md) v1.0 §2（L1 Atlas/Ontos/Runos · L2 Arda/Karda/Terra · L3 Raven/Anlan/Forge/Xuanzhen · client Ruyin · 外部 umbra(域名 ruyin.ai) · internal Hermes）；旧候选 Vault/Cortex/Nocus 废弃。seed 迁移登记见 product_100_matrix §6（实施规划 = product_300_naming-migration，独立实施项；ruyin→umbra 仅规划本次不实施）；中文品牌名/i18n 由运营后补。

#### 18.3 计量/计费

1. ✅ 计量内核契约见 **§8**（经对抗校验，5 blocker + 16 delta 已应用）。
2. ✅ **已确认（按推荐，§8.9）**：① Model Platform consume = 同步 + 有界 fail-open + 异步对账；② 被丢 AI 维度(token/model_code/latency)归 Model Platform DB `reqlog`。
3. **待决**：scope-key 迁移 + §11.3 映射（§11，硬前置）。
4. ✅ per-workspace 为既定计费/用量粒度（ADR-11）；标价 NUMERIC(18,6)/金额 NUMERIC(12,2) 沿用 v1.1。

#### 18.4 业务侧待填（沿用 v1 §10）

1. `level_no` 范围 + 每级 `max_owned_org_tenant`。
2. `verification_policy` 各产品线/场景配置。
3. `user_level_threshold.min_points` 各级阈值。
4. `user_points_ledger.source_type` 枚举。
5. `product_category` 字典枚举。

---

> **进度**：地基决策已锁定（§0.4）；计量内核契约经对抗校验后已成稿（**§8**，5 blocker + 16 delta 已应用），含 2 项 ★待确认（§8.9）。**下一步**：确认 §8.9 两项后，按 §4(identity)→§5(iam)→§7(product)→§9(账务)→§10(provisioning)→§11(model)→§14(operator)→§15(support) 逐章把 v1.1 字段级 DDL 折叠进来（应用 §0.4 决策、修内部矛盾、补"受影响表去向矩阵"）。

---

## 6. 跨切面迁移项（原设计 §17）

- **core vs deploy Prisma 权威（§18.1 已决）**：**deploy 基线为权威**，`packages/core` 客户端从统一 schema 重生成；#540 落后列（organization_profile + User/Workspace 新列）本轮一并对齐（数据可重灌，无迁移风险）。
- **迁移策略（数据全部可弃 / 无用户债务，owner 确认 2026-07-01）**：各域数据均为验证数据 → 可重灌 seed；`admin` operator 2FA 为可弃测试数据。**约束是已部署 schema 的代码锁步**（identity/iam/admin/model 服务已绑定）：改名/结构变更须与 admin-bff/model-platform/identity-platform-operator/seed/search_path 同步发版（工程线）。保数据迁移（`ALTER…RENAME`/`INSERT…SELECT`）为可选、非硬要求。
- **待回写 database.md 清单**：§3.4 product 模型（版本化 plan、product 合并）、§3.5 commerce workspace 化、**§7 规则4/§11 用量唯一写入方=consume 服务（非 Model Platform）+ 新增只读配额 gate 面**、§3.6 model 命名、§3.7 ops→**admin**、§3.1/§5c `tenant.type=organization` + `realm=customer/workforce`、§11.4 "pool removed"→"pool 软退役"、§2.1 全景（**admin、+safety、gateway 取消**）。
