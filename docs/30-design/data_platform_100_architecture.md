# Vxture 平台数据架构总纲（字段级权威，v2 草案）

> 版本：v2 草案 · 状态：§0–§15 已成稿（字段级）· §16–§17 精简 · 迁移/待决见 runbook · 待审
> 上级：[`docs/30-design/control-plane.md`](./platform/10-control-plane.md)（双平面**概念概览**）。**本文 = 平台数据架构唯一顶层权威**——原 `database.md` 顶层内容已并入 §2（拓扑/数据流/铁律/治理）+ §3.2（命名规范），database.md 退役（superseded，见 §0.2）。
> 吸收来源：`docs/ADR-11-subscription-entitlement-design.md`（决策记录）。早期草稿 data-architecture-v1.md / v1.1.md 内容已全量并入本文并**删除**（2026-07-01，untracked 草稿）
> 适用范围：仅平台**控制面**数据库（`vxturestudio_platform_main`）+ 平台 Model Platform 库；业务数据面只作边界说明，不在本仓实施。
> 🧭 **三文件路由**：本文 = **架构权威**（§0–§3 全景/命名规范 · §3.4 各域概览+核心字段 · §12/§16 边界 · §17 跨切面约束）｜ 字段级全 DDL/列/索引/触发器/Prisma → [`data_platform_200_schema.md`](./data_platform_200_schema.md)（§4–§15）｜ 落地/迁移/待决/去向矩阵 → [`data_platform_300_migration.md`](./data_platform_300_migration.md)。跨文件 §N 按原号回指对应文件。

---

## 0. 范围、顶层定位、文档取代图、统一前提

### 0.1 本文定位

`data_platform_100_architecture.md`（本文）是 **Vxture 平台数据架构的唯一顶层权威**——原 `database.md`（旧顶层）已并入本文（§2 双平面拓扑/数据流/铁律/治理 + §3.2 命名规范，2026-07-01），`database.md` 退役（见 §0.2）。本文统一收口分散在 v1/v1.1 草稿、ADR-11、identity-data-model、commerce、identity-platform-operator、database.md 等处的设计。更抽象的**概念概览**见 [`control-plane.md`](./platform/10-control-plane.md)。

三层分工（同一事实只在一处）：

- **本文（架构权威）**：设计意图/约定/约束/禁止、双平面拓扑+数据流+铁律+治理（§2）、schema 全景+命名规范（§3）、各域概览+核心字段（§3.4）、边界（§12/§16）、跨切面（§17）。
- **[schema 文档](./data_platform_200_schema.md)**：全字段级 DDL / 列 / 索引 / 触发器 / Prisma（§4–§15）。
- **[migration runbook](./data_platform_300_migration.md)**：现状→最终态的去向矩阵 / 迁移 / 代码锁步 / 待决。

### 0.2 文档取代图（supersession map）

| 文档                                                    | 处置                                     | 理由                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~`docs/30-design/database.md`~~                        | **已并入本文（superseded，2026-07-01）** | 顶层内容并入 §2（拓扑/流/铁律/治理）+ §3.2（命名）；旧 §3 各 schema 详述与 §10 历史路线弃用；计划后续删除。概念概览留 `control-plane.md`。 |
| ~~`docs/data-architecture-v1.1.md`~~                    | **已删除**（2026-07-01）                 | 内容全量并入本文 §4–§13；untracked 草稿，已删。                                                                                            |
| ~~`docs/data-architecture-v1.md`~~                      | **已删除**（2026-07-01）                 | 更早草稿，内容已并入本文；已删。                                                                                                           |
| `docs/ADR-11-subscription-entitlement-design.md`        | **保留为 ADR**（决策记录）               | ADR 是决策快照；本文是其落库实现，互补不冲突。                                                                                             |
| ~~`docs/30-design/platform-db.md`~~                     | **已删除**（2026-07-01，superseded）     | 旧 8-schema/分离 tenant/iam.capability 模型，内容并入本文；已删。                                                                          |
| `docs/40-implementation/ai/05-bff-data-access-guide.md` | **待取代/校订**                          | 数据访问分层仍引旧模型；分层规则迁入本文 §17，需校订。                                                                                     |
| `docs/40-implementation/packages/core/database.md`      | **待取代/校订**                          | 描述 packages/core/database 客户端，落后 deploy 基线。                                                                                     |
| ~~`docs/30-design/db/platform-governance.md`~~          | **已删除**（2026-07-01）                 | 旧治理表模型，并入 §14；已删。                                                                                                             |
| ~~`docs/30-design/db/tickets.md`~~                      | **已删除**（2026-07-01）                 | 旧票据模型，并入 §15；已删。                                                                                                               |

> ⚠️ 「待取代」需逐份核实其被引用处后再正式标注 superseded（避免悬空引用）。本表为意向，非已执行动作。

> 📦 **落地/迁移**：原「0.3 统一前提 / 0.4 本轮已锁定决策」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 1. 业务目标与数据架构驱动

Vxture 是 **PLG 的多产品矩阵 SaaS 控制平面**，不是单产品。下列业务目标共同决定了为什么会有"产品目录 / workspace / 双 realm / 双平面"这些维度——每个 schema 决策都应能追溯到其中至少一条。

1. **产品矩阵目录**：分层产品矩阵（L1 = Atlas/Ontos/Runos 横向能力平台，L2 = Arda/Karda/Terra 域平台，L3 = Raven/Anlan/Forge/Xuanzhen 行业 agent；另 Ruyin=client 端、umbra=外部边界 VPN(域名 ruyin.ai)、Hermes=internal）+ 平台位，每产品独立 5 档套餐（free→starter→pro→business→enterprise）、i18n、发布渠道（stable/beta）。**命名已定型为终版**（2026-07-06 owner 拍板，销 runbook §18.2#5），权威 = [`product_100_matrix.md`](./product_100_matrix.md) v1.0；共享/隔离语义 = [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) v1.0。
2. **中心化 OIDC IdP**：同源子域 + 跨域 RP（ruyin.ai），双 realm 硬隔离（customer/tenant vs workforce/operator），含联邦登录/会话/刷新/SSO-SLO 全表面。
3. **订阅/权益引擎（ADR-11）**：workspace = 成本中心（持订阅/配额/账单），tenant/org = 结算账户，多组件版本化 Plan，能力就高合并 + 消耗瀑布扣减，权益**实时派生、不入 token**。
4. **AI 模型网关与计量权威**：单一 LLM 出口，provider/model/grant/price/policy 治理，token 计价计量（唯一上行写入方），按产品保管下游 provider key（归属待定，见 §12）。
5. **运营/admin 业务面**：operator 身份 + MFA/WebAuthn、settings、灰度、公告、维护、治理记录，与客户面隔离。
6. **完整财务闭环**：订单/多渠道支付/退款/不可变交易流水/预付款/中国发票(fapiao)/开票抬头/支付方式（支付网关尚未接入）。
7. **双平面边界**：平台只持控制面；产品业务/RAG/向量在外部业务面（`vxturebiz_{product}_{env}`），只回引 reference ID，用量只上行。
8. **成长机制（身份内、与计费独立）**：积分流水、等级阈值、等级门控建组织数、可配置 KYC 门控付费订阅。
9. **运营支撑**：工单+SLA、多渠道通知、按月分区长留存审计。
10. **内嵌副驾 Varda**：会话/工具审计数据在同实例独立 datasource，不属 8 个平台 schema。

---

## 2. 双平面拓扑、数据流与治理（顶层，已并入 database.md）

> 本节为平台数据架构的**顶层框架**——原 `database.md` §1/§2/§5/§6/§7/§8/§11 已并入并 reconcile 到 v2 决策（8 schema / admin / customer·workforce / gateway 取消 / consume 唯一写入方）。更抽象的**概念概览**见 [`control-plane.md`](./platform/10-control-plane.md)。

### 2.1 双平面拓扑与物理库

#### 双平面原则（控制面 vs 业务面）

Vxture 数据库体系遵循双平面架构，与代码架构严格对应：控制面是全局唯一权威（订阅/配额/用量/治理/身份），业务面按产品隔离且只持有引用。

```
┌─────────────────────────────────────────────────────────────┐
│               PLATFORM CONTROL PLANE                        │
│               平台控制面（全局唯一，仅 Prod 实例）             │
│                                                             │
│  单一权威数据源  ·  身份 / 订阅 / 配额 / 用量 / 治理           │
│  支付不能双份  ·  订阅不能双份  ·  账本不可变（append-only）   │
└─────────────────────────────────────────────────────────────┘
                           ↕ tenant_id / user_id（引用，不复制）
┌───────────────────────────────────────────────────────────────┐
│               BUSINESS DATA PLANE                             │
│               业务数据面（按产品隔离，Beta + Prod 双轨，外部仓）  │
│                                                               │
│  外部业务 A      外部业务 B          …（未来产品）               │
│  beta │ prod    beta │ prod           beta │ prod              │
└───────────────────────────────────────────────────────────────┘
```

**平面归属边界：**

- **控制面**（本仓 + 平台 Model Platform）：唯一权威数据源，承载身份、访问、产品目录、商业（订阅/配额/用量/账单）、模型注册、安全、平台运营（admin）、支持等全部平台状态。
- **业务面**（外部业务仓库，如 `vxture/agentstudio-ruyin`）：只保存 `tenant_id` / `user_id` 引用与业务执行数据（会话/任务/产物），不复制平台账号、租户、订阅详情，不直连控制面库，不持有 Provider Key。

#### Beta / Prod 区分（环境隔离，非套餐隔离）

**Beta 是环境隔离，不是套餐隔离。** 环境双轨只体现在**业务面**（每产品 beta/prod 两个物理库）；**控制面无 Beta/Prod 之分**（订阅/配额/用量统一从控制面读取，与环境无关）。

| 维度          | Beta 业务数据库                   | Prod 业务数据库              |
| ------------- | --------------------------------- | ---------------------------- |
| 目标用户      | 公测用户、内部测试、功能验证      | 所有正式用户（含 Free 套餐） |
| 数据生命周期  | 可自动清理、限期保留、可重置      | 永久保留，受合规约束         |
| 数据迁移方向  | Beta → Prod（转正时迁移业务数据） | —                            |
| 配额/订阅来源 | 统一来自控制面（与环境无关）      | 统一来自控制面（与环境无关） |
| SLA           | 无承诺                            | 承诺                         |

**Free 套餐用户走 Prod**，因为 Free 是正式订阅计划（`plan_code = 'free'`），只是配额受限，不是试用环境。

#### 三物理库 + varda datasource

平台侧共三个物理数据库；控制面库承载 **8 个平台 schema**（`gateway` schema 已取消：Provider Key 与请求日志下沉到独立 Model Platform DB 的 `key` / `reqlog`）。另有一个 varda 独立 datasource（同实例、独立库，供内嵌助手运行时使用）。

```
┌──────────────────────────────────────────────────────────────┐
│  RDS 平台主库（平台控制面，阿里云 RDS PG18，强备份）            │
│  Database: vxturestudio_platform_main                         │
│  ├── schema: identity   用户 / 认证 / 组织 / 空间 / 成员（含 tenant 域）│
│  ├── schema: iam        治理 RBAC / oidc_client / 签名密钥      │
│  ├── schema: product    产品目录 / 套餐 / 定价（静态配置）      │
│  ├── schema: commerce   订阅 / 配额 / 用量(唯一写入) / 账单 / 支付│
│  ├── schema: model      模型注册 / 授权 / 策略（只读配额 gate 源）│
│  ├── schema: safety     内容安全 / 风控 / 合规事件             │
│  ├── schema: admin      平台运营账号 / 治理 / 全局配置（原 ops） │
│  └── schema: support    工单 / 审计日志 / 通知记录             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  vx-modelruntime-pg（平台 Model Platform 专属库，独立实例）     │
│  Database: vxturestudio_modelruntime_main                     │
│  ├── schema: routing    模型路由规则 / Provider 连接配置       │
│  ├── schema: key        Provider API Key（加密；平台库不接触明文）│
│  └── schema: reqlog     请求日志（高频，独立归档/分区）         │
└──────────────────────────────────────────────────────────────┘

┌────────────────────────────┐  ┌────────────────────────────┐
│  vx-{business}-beta         │  │  vx-{business}-prod         │
│  PostgreSQL（外部业务仓库）  │  │  PostgreSQL（外部业务仓库）  │
│  vxturebiz_{product}_beta   │  │  vxturebiz_{product}_prod   │
└────────────────────────────┘  └────────────────────────────┘

  + varda datasource（同实例、独立库，内嵌助手运行时；@@map 保表名）
```

**关键约束：**

- **用量唯一写入方 = commerce consume 服务**（`POST /usage/consume`，单事务写入用量并核减配额）。Model Platform **不直写**用量，仅作**只读配额 gate**（读 `commerce` 配额判断放行）。
- **Provider Key / reqlog 仅存于独立 Model Platform DB**（`vxturestudio_modelruntime_main` 的 `key` / `reqlog` schema），平台控制面库任何 schema 均不接触 Key 明文。
- 数据全部可重灌（无生产/无用户债务），真正的约束是**已部署 schema 的代码锁步**，而非历史数据迁移。

#### 数据库命名规则

| 类型           | 命名模式                         | 示例 / 说明                          |
| -------------- | -------------------------------- | ------------------------------------ |
| 平台控制面     | `vxturestudio_platform_main`     | 唯一，固定名（承载 8 个平台 schema） |
| Model Platform | `vxturestudio_modelruntime_main` | 平台专属库；非业务 worker 数据库     |
| 业务 Beta      | `vxturebiz_{product}_beta`       | 外部业务仓库定义                     |
| 业务 Prod      | `vxturebiz_{product}_prod`       | 外部业务仓库定义                     |
| varda 运行时   | 同实例独立库（varda datasource） | 内嵌助手运行时，独立 datasource      |

> `tenant.type` 取值 `personal` | `organization`；`realm` 取值 `customer` | `workforce`（原 tenant / operator 语义）。命名规范（`VARCHAR(32)`+CHECK 不用 ENUM、金额 `NUMERIC(12,2)`、token `BIGINT`、uuid 主键、`created_at`/`updated_at`/`deleted_at`、`idx_`/`uidx_`/`chk_`/`fk_` 前缀）见命名规范章节。

### 2.2 跨平面数据流与铁律

三平面数据流：**平台控制面**（`vxturestudio_platform_main`）持有唯一权威的身份/订阅/配额/用量/账本；**Model Platform 库**（`vxturestudio_modelruntime_main`）持有 Provider Key 明文与请求日志；**业务数据面**（`vxturebiz_{product}_{env}`，外部仓）只持引用 ID 并向上行报用量。

#### 2.2.1 跨库数据流图

```
┌──────────────────────────────────────────────────────────────┐
│                   Platform DB（控制面·唯一权威）                │
│                                                                │
│  model.*  ─── 模型/授权/策略定义（只读下发给 Model Platform）    │
│                                                                │
│  metering.usage_events   ◄──────────┐  (append-only 原始流水)   │
│  metering.usage_summary_*             │  (聚合，配额实时检查读)   │
│  metering.quota_pools                 │  (配额池，gate 读)        │
│  metering  consume 服务 ── 唯一用量写入方（POST /usage/consume） │
└───────────────────────────┬──────────┼────────────────────────┘
       读模型定义 / 读配额 gate │          │ consume（单事务，上行）
              ┌───────────────▼──────────┴─────────┐
              │      Model Platform DB              │
              │      routing / key / reqlog         │
              │  · Provider Key 明文仅存于此（AES）  │
              │  · reqlog 为内部审计，≠ usage_event │
              │  · 只读配额 gate，不直写用量         │
              └───────────────┬─────────────────────┘
                              │ 引用 tenant_id / user_id（不复制）
┌─────────────────────────────▼──────────────────────────────────┐
│          Business DB（业务面·beta 或 prod，外部仓）              │
│                                                                │
│  {domain}.*           业务数据（知识库 / 场景 / 任务）          │
│  local_authz.member   成员 + 功能角色（产品自持）              │
│  vx_provision.app_instance 只存 workspace/tenant/user 引用     │
│  local_usage.raw ── 本地缓冲，异步 Job 上报 metering consume    │
└─────────────────────────────────────────────────────────────────┘

（另：同实例独立 datasource `varda`，不与上述库共 schema）
```

#### 2.2.2 数据流向规则

1. **平台数据不下沉**：平台库的账号 / 组织 / 订阅 / 配额详情不复制进业务库。
2. **业务库只持引用 ID**：业务库仅保存 `tenant_id` / `user_id` 作为外部引用，不得直连平台库，不得持有 Provider Key。
3. **用量只上行**：业务侧 `local_usage.raw` 异步上报，配额判断只发生在平台侧，业务侧不做配额裁决。
4. **用量唯一写入方 = metering consume 服务**：所有用量经 `POST /usage/consume` 在单事务内写入 `metering.usage_events`（校验配额→记事件→更新 quota_pools/summary 原子完成）。Model Platform 与业务服务**均不得直写** usage_events，Model Platform 仅只读配额 gate。
5. **Provider Key 隔离**：Provider Key 明文与请求日志只存于 Model Platform DB（`vxturestudio_modelruntime_main`），平台库不接触 Key 明文。

#### 2.2.3 关键铁律汇总

| 铁律                                                                                                                                                                                                                                                                           | 原因                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Platform DB 不存业务执行数据                                                                                                                                                                                                                                                   | 控制面不应因业务洪峰降级                                                                                               |
| 业务 DB 不存配额 / 订阅数据                                                                                                                                                                                                                                                    | 配额必须全局统一，不能分布式裁决                                                                                       |
| **用量唯一写入方 = commerce consume 服务**（单事务，POST /usage/consume）                                                                                                                                                                                                      | 防止绕过配额、保证账务与审计完整；Model Platform 仅只读 gate，不直写                                                   |
| **Provider Key 明文只在 Model Platform DB**                                                                                                                                                                                                                                    | 降低平台库被攻击时的 Key 泄露面，平台库全程不接触明文                                                                  |
| `tenant_transaction` 不可变（DB 触发器 RAISE 阻止 UPDATE/DELETE）                                                                                                                                                                                                              | 账本是法律证据，任何修改一律追加冲正                                                                                   |
| `usage_event` Append-only                                                                                                                                                                                                                                                      | 用量是计费依据，不允许删改                                                                                             |
| Free 套餐走 Prod                                                                                                                                                                                                                                                               | Free 是正式订阅计划（`plan_code='free'`），非试用环境                                                                  |
| Beta / Prod 业务 DB 物理隔离                                                                                                                                                                                                                                                   | 防测试数据污染生产，支持独立清理与生命周期                                                                             |
| **平台库内跨 schema 建真 FK；裸 UUID 仅四类边界**（物理库界 / realm 安全隔离 / 审计可注销 actor / code 目录引用）                                                                                                                                                              | 控制面 ~10k 体量无拆库现实，为不发生的拆库禁 FK = 拿引用完整性做无谓抵押。详见 §2.2.4 铁律一                           |
| **UUID 内部键 / 外部可视码分离**：关联只走不可变 `id UUID`；`user_no`/`tenant_no`/`invoice_no` 等可视码可改、永不做 FK                                                                                                                                                         | 改码/换编号规则不动任何数据关系。详见 §2.2.4 铁律二                                                                    |
| **数据模型完整优先、建库先行**：表/字段按既定能力集全覆盖，业务实现/UI 按阶段推进                                                                                                                                                                                              | 功能未上线 ≠ 表/字段可缺；缺表/缺字段 = 设计缺陷。详见 §2.2.4 铁律四                                                   |
| **计费周期锚定订阅、汇总不作计费依据**：订阅型计费/配额锚定 `subscriptions.start_at`（禁 date*trunc 日历对齐）；`usage_summary*\*`仅统计，计费从`usage_events` 按周期窗口求和                                                                                                  | 日历月汇总对不上锚定周期必错账；三周期（配额重置/计费/结算窗口）须同源。详见 §2.2.4 铁律五                             |
| **付费模式决定结算路径与周期基准**：`credits.billing_mode` postpaid=锚定周期应收账单 / prepaid=实时扣款+自然月对账单 / free·trial 不计费；资金池只经不可变 `transactions` 变动                                                                                                 | 三种模式同构共存，锚定 vs 自然月由模式定。详见 §2.2.4 铁律六                                                           |
| **运营域(workforce)与客户域(customer)在用户身份层面绝对隔离**：两套账号零共享零 FK（双向）、会话/token 不混且结构性互拒、RBAC 各自独立、审计 `actor_type` 逻辑隔离；仅签名密钥/OIDC 基础设施可共用（对账号无 FK）                                                              | 两套身份体系一方被攻破不得横移到另一方。详见 §2.2.4 铁律七                                                             |
| **标识符三层命名纪律 + 锚点列不可变**：`id`(uuid 锚点/FK 目标) / `{table}_no`(可视码/永不 FK) / `{parent}_id`(uuid→`.id`) 三层不混淆；锚点列(`id`/`*_no`/`created_at`/`rank`)不入可写字段集（命名层现行），列级 `REVOKE/GRANT UPDATE` 物理锁为 target-state（TD-018 服务角色） | `*_id` 混用可视码/非 uuid 制造关联混乱。详见 §2.2.4 铁律八                                                             |
| **org(tenant) 为绝对隔离边界、共享不产生数据副本**：跨 org 租户数据流动在架构上无通路；唯一合法跨 tenant 形态 = P 级平台资产（只读、entitlement 消费）；org 内跨 WS/product 共享一律经 SharingGrant 策略表达（default-deny、召回层强制、撤销即时），不靠数据搬运/复制          | SaaS 安全底线 + 撤销无残留。权威 = [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) v1.0 §3/§8 |

> 本平台无生产历史、无用户债务，**数据全部可重灌**；真正的约束不是历史数据，而是**已部署 schema 与代码的锁步**——schema 变更须与其消费代码同批上线。
> **阶段开关（铁律三）**：真正上线、承载业务数据**之前**，各域一律以**重灌重构**为主（可 reseed / 改结构 / 搬 schema）；**「在产迁移纪律 / 不 reseed」待正式上线后恢复生效**。当前（2026-07）开发阶段，identity 等曾部署域无业务数据债务，按重灌处理（详见 §2.2.4 铁律三）。

#### 2.2.4 架构级 SoT 与解耦铁律（2026-07 修订）

> 本节八条为平台数据架构的**结构性解耦铁律**（一~四 = 结构/命名/迁移/完整性；五~六 = 计量计费正确性；七 = 身份安全隔离；八 = 标识符命名与锚点不可变）。目标是让业务扩展**只加表 / 加字段，永不重构 / 迁移 / 恢复数据**。各域字段级章节（§4–§15、`data_*` 细化设计）中与之冲突的旧表述，一律以本节为准。

**铁律一 · 跨 schema FK 政策（取代旧「一律禁跨 schema FK」）**

平台库（`vxturestudio_platform_main`）**内部：跨 schema 引用一律建真 FK**（PostgreSQL 原生支持同库跨 schema 外键），保引用完整性与级联。裸 UUID 逻辑引用**仅**保留于以下四类边界：

1. **真物理库边界**：`platform_main` ↔ `modelruntime_main` ↔ 业务面（本就跨库、无法建 FK）；`request_id` 等跨库单一关联键。
2. **安全 / realm 硬隔离**：`admin.operator_*` ↔ `identity`/`iam` 零 FK；`auth_session.user_id` 按 `realm` 区分的 loose 列。这是**安全设计**，不受本次放宽影响，继续零 FK。
3. **append-only 审计 / 日志对「可注销 actor」的引用**：`support.audit_logs` / `ticket` 的 `actor_id` / `account_id` 等——保日志留存、actor 可删，故意不 FK。
4. **按 code / 值解析的目录引用**：`membership.role` → `iam.role.code`（用 code 非 id）、`feature_flag.tenant_overrides` key 等。

> 依据：控制面为运营管理数据、~10k 体量，平台库无物理拆库现实；为不会发生的拆库禁 FK，是拿引用完整性做无谓抵押。此政策使按域**细拆 schema** 时全程保 FK 完整性（schema 是命名空间、不影响查询性能）。

**铁律二 · UUID 内部键 / 外部可视码分离**

- **`id UUID` 是唯一关联键**：所有 FK / 关联只指向它；不可变、永不外露给用户 / 外部系统。
- **外部可视码**（`user_no` / `tenant_no` / `invoice_no` / `order_no`…）：人友好、可重建、**可改**，用于展示 / URL / 客服 / 外部对接；**永不做 FK、永不做关联键** → 改码、换编号规则、重排均不动任何数据关系。
- **`account`（登录句柄）** 可改、限频，亦非关联键。
- 每个「用户 / 外部可见」实体配一个可视码；纯内部表（membership / credential / session 等）只有 UUID，不设可视码。

**铁律三 · 在产迁移纪律的阶段开关**

真正上线、承载业务数据**之前**，平台各域一律以**重灌重构**为主（可 reseed / 改结构 / 搬 schema）；**「在产迁移纪律 / 不 reseed」待正式上线后恢复生效**。§5 / §6 等处「iam / identity 自 2026-06-18 在产、一律保数据迁移不 reseed」的表述，**开发阶段暂停适用**，上线后恢复。

**铁律四 · 数据模型完整优先、建库先行**

数据表 / 字段按平台**既定能力集**（§1 业务目标）**优先全面覆盖**——先把库建全（表、字段、约束到位）；**业务实现与 UI 按阶段推进**，功能未上线**不等于**表 / 字段可缺。缺表、缺字段、字段缺胳膊少腿 = 设计缺陷。完整性以既定能力集为标尺（如 MFA / 实名 KYC / 成员职务 / 成长积分 / 预付费 / 代金券 现在就建全字段、业务上线才对接），**非**无限堆通用 SaaS 字段——路线图外的能力仍不预造（与「起步最小化」分层：最小化管功能 / 服务范围，不管 schema 覆盖度）。

**铁律五 · 计费周期锚定订阅、汇总永不作计费依据**

- **订阅型计费与配额一律锚定订阅周期**：`quota_pools.period_anchor = subscriptions.start_at`，按 `cycle_unit × cycle_count` 整段推进（15 号订即每月 15 号刷新/结算），**禁用 `date_trunc` 日历对齐**——否则"15 号订阅、1 号却重置/出账"必然错账。
- **三周期同源**：① 配额重置周期、② 订阅计费周期、③ 结算取数窗口，三者共用同一订阅锚点，不得各按各的历法。
- **汇总表 `usage_summary_*` 只做统计 / 分析 / 看板，永不作计费依据**：计费 / 超额一律从 `usage_events`（原始事件，≈分钟）按**精确周期窗口** `[cycle_start, cycle_end)` 求和。汇总可多维（时 / 天 / 周 / 月 / 年）且分维度不同留存以减量，但只服务展示。

**铁律六 · 付费模式决定结算路径与周期基准**

- **`credits.billing_mode` 决定结算路径**：**postpaid**（后付费）按订阅**锚定周期**出**应收账单** `invoices`；**prepaid**（预付费）用量**实时(~5min)扣**资金池（`prepaid_charges` + `transactions`）+ 按**自然月**出**对账单**（`bill_type='prepaid_statement'`，钱已扣、天生 `paid`、仅统计）；**`free` / `trial` 不计费**。
- **锚定周期 vs 自然月由模式决定，不得随意混用**：订阅型（postpaid）走锚定；pay-as-you-go（prepaid）无订阅周期可锚，走自然月对账。二者同构共存。
- **资金池 `credits.balance` 只经不可变 `transactions` 变动**（充值 recharge / 代金券 grant / 扣费 consume / 退款冲正 refund·adjust），配 `version` 乐观锁——与 §2.2.3「`tenant_transaction` 不可变」一脉，杜绝双扣 / 漂移。

**铁律七 · 运营域与客户域在用户身份层面绝对隔离（双 realm 硬隔离）**

平台有**两套完全独立、绝对隔离**的用户身份体系，数据层永不交叉：

- **客户域（customer realm）**：终端用户 / 租户，身份在 `account` / `identity` / `tenancy` / `credential` / `kyc` / `access` / `session` / `loyalty` 等 schema。
- **运营域（workforce realm）**：平台运营人员，身份在 `admin` schema 的 `operator_*`（账号 / 凭据 / MFA / 会话 / RBAC 自成一套）。

**绝对隔离的落库表现（硬约束、不得回退）：**

1. **两套账号零共享、零 FK（双向）**：`admin.operator_*` 与客户 realm 各 schema **互相零外键**；运营人员不是客户 `users` 的子集，反之亦然。（此即铁律一边界#2 的身份层来源。）
2. **会话 / 令牌不混**：operator 的 session / refresh / verification / login_attempt 落 `admin`，**绝不**落客户 realm；`auth_session.user_id` 按 `realm` 区分、绝不交叉解引用。
3. **Token 结构性互拒**：operator token（`sub=opr_*` / `userType=operator` / `aud=admin` / `realm=workforce`）与客户 token（`usr_*` / `customer` / 租户 aud）结构性互斥，一方 token 在另一方端点一律拒绝。
4. **RBAC 各自独立**：运营用 `admin.operator_role/permission`，客户用 `access.roles/permissions`，两套不共享、不引用。
5. **审计逻辑隔离**：共用 `support.audit_logs` 但以 `actor_type`(operator / customer) 逻辑区分。
6. **允许的共享 = 基础设施、非身份**：`appoidc.signing_keys` / `oidc_clients`（RS256 JWKS / IdP 双 realm 共用）对账号**无 FK**——共享的是签名 / 协议基础设施，不是身份数据，不违反本律。

> 依据：两套身份体系隔离是安全设计——一方（如客户面）被攻破，不得能横移到另一方（运营面）。域内引用（如 `admin.risk_records.reviewer_id` → `admin.operator_accounts`，同 schema）是允许的真 FK；被禁的是**跨 realm 的身份 FK**。

**铁律八 · 标识符三层命名纪律 + 锚点列不可变（列级锁）**

标识符分三层，命名互不侵占、职责互不混淆（强化铁律二为可执行命名约束）：

| 层         | 命名          | 类型   | 语义                     | 约束                              |
| ---------- | ------------- | ------ | ------------------------ | --------------------------------- |
| 内部锚点   | `id`          | uuid   | 唯一锚点，所有 FK 指向它 | 不可变、不外泄                    |
| 对外可视码 | `{table}_no`  | bigint | 展示 / URL / 工单 / 发票 | 唯一、可改、**永不做 FK**         |
| 外键列     | `{parent}_id` | uuid   | 指向 `{parent}.id`       | **必须 uuid、必须指向某表 `.id`** |

- **禁止三类混淆**（此即"禁止 `*_id` 命名引起混乱"）：① 可视码命名为 `*_id`；② `*_id` 列承载非 uuid / 非关联值；③ `*_no` 出现在 FK 目标或关联键位置。
- **锚点列不可变**（`id` / `*_no` / `created_at` / 安全语义列如 `admin.operator_role.rank`）：
  - **命名层（现在生效）**：锚点列**不得**出现在任何写接口的可写字段集；检测器扫 DDL/命名（§3.2）。
  - **DB 物理锁（target-state，待前置）**：目标是**列级 `REVOKE UPDATE … GRANT UPDATE(可写列白名单)`** 物理锁死，使服务账号无法 UPDATE 锚点列。**前置未满足**——PostgreSQL 列级权限**对 owner/superuser 无效**，而当前全部服务以 owner `vxture` 连库；须先引入**非-owner 分域服务角色**（`*_svc`）并切连库串，方能生效。见 [`tech-debt.md`](../60-operations/10-tech-debt.md) **TD-018**。
- 依据：借鉴"三层标识符 + 列级 GRANT 锁"思路（外部 `tenancy_core_tables.sql` 稿的可取思路，schema 名按本库校正后采纳；列级锁部分随 TD-018 服务角色模型落地）。命名层检测见 §3.2 + 检测器（`check-data-architecture.mjs` 扩 ironlaw2）。

#### 2.2.5 seed / init 数据约定（幂等 + 哨兵 UUID）

平台初始化数据（预置角色 / 权限 / 系统账号 / 目录）统一进 `deploy/database/seed/seed-catalog.mjs`，遵循以下约定。各域 RBAC seed 明细见 `data_admin_200` §4（运营 realm）/ `data_identity_200` §6.4（客户 realm）。

**幂等双机制**（防重复初始化，二者互补）：

1. **唯一自然键 + `on conflict (key) do nothing` = 普适幂等保证。** 每条 seed 行必须有唯一业务键并带 `on conflict`（`role_code` / `perm_code` / `(scope,code)` / `product_code` / `username`…）。重跑撞唯一键即跳过，永不重复。目录型行（permission / plan / model）用 `gen_random_uuid()` + `on conflict (自然键)`，映射时按自然键回查 id，**无需手钉 UUID**。
2. **哨兵 well-known UUID = 仅用于被其他 seed 行以常量引用的锚点行**（如 `operator_role`、系统 `operator_account`）。使 `account.role_id`、`created_by`、`role_permission` 映射可直接写死引用，免去回查。

**哨兵 UUID 约定**：格式 `00000000-0000-4000-a000-0000000000XX`（合法 UUIDv4，末位段编码可读序号）。这是**保留的 well-known 值**，一眼可辨、可 grep、跨重跑稳定。

**哨兵可预测性不构成安全问题**（论证，防误用为令牌）：

| 安全前提                 | 落地保证                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `id` 是标识符、非密钥    | 认证靠 credential(Argon2id)+MFA；重置令牌 = `randomBytes(32)` CSPRNG；session token 独立，均**不**用账号 UUID |
| 鉴权不"凭 id 猜中即放行" | capabilities 全由 `role_permission` JOIN 出，无"某 UUID=特权"旁路                                             |
| 内部 id 不外泄           | 铁律二：对外一律用 `*_no`，`id` 不出现在 URL / API                                                            |

> 结论：即便猜到某哨兵是 `superadmin`，无口令+MFA 亦不可登录——等同于"知道有个叫 admin 的用户名"。故账号主键用哨兵**安全**。若某值被用作不可猜令牌/密钥，则**必须** CSPRNG 随机、**禁**哨兵（检测器不覆盖此语义，靠本约定 + 评审把关）。

### 2.3 业务数据面结构与 Beta→Prod（边界说明，本仓不实施）

> **范围声明**：`vxture` 仓库只负责平台控制面（`vxturestudio_platform_main`）与 Model Platform（`vxturestudio_modelruntime_main`）两库。业务数据面（`vxturebiz_{product}_{env}`）由外部业务仓库维护（如 `vxture/agentstudio-ruyin` 已迁出，`agentstudio-varda` 复用其模板）。本节只作为**平台与业务的交互契约与边界约定**，不作为本仓实施任务；本仓约束契约，不实施业务面 schema / migration / 部署。

#### 2.3.1 通用业务 DB schema 模板

每个业务产品持有一对对称的数据库（`beta` / `prod`），结构相同、数据完全隔离。**布局权威 = [`product_240_repo-template.md`](./product_240_repo-template.md) §2.4（owner 2026-07-20 拍板，取代旧 `context/app/agent/local_usage` 四钦定 schema）**：按数据性质切分为**契约面 3 schema + N 领域 schema**，前缀 `vx_` = 平台源/契约面、`local_` = 产品自持。`vx_provision` / `local_usage` 两 schema 的契约语义由平台约束；`local_authz` 结构由模板统一、角色/权限目录值由产品 seed；领域 schema 由产品自决。

```
Database: vxturebiz_{product}_{env}        -- env = beta | prod

-- 契约面 3 schema（模板出厂即建；平台约束语义）
schema: vx_provision
  -- 平台开通/绑定 + 入站事件簿（数据来自 provisioning webhook）
  app_instance     -- 应用实例（workspace_id / tenant_id / product_code 引用 + 开通态 status/env）
                   --   workspace_id = 权威隔离键（来自平台 entitlement 体系，不接受产品自声明，见 §16/ADR-11）
  webhook_delivery -- 入站 webhook 幂等（delivery_id = payload.id，PK）
  provision_seq    -- per (workspace_id, product_code) 已处理 seq 水位（弃旧/乱序）

schema: local_authz
  -- 产品级成员与功能授权（产品自持；平台刻意不给结构，模板填空）
  member           -- 成员（workspace_id / sub 引用 + display 缓存可失效 + status）
                   --   登录首见惰性 upsert，是平台 tenancy.workspace_memberships 的"登录过本产品子集"，非全量镜像
  role             -- 产品功能角色目录（产品 seed，如 reviewer/editor；≠ 平台治理角色目录）
  permission       -- 产品功能权限
  member_role      -- 成员↔角色（按 (workspace_id, sub) 解析）
  role_permission  -- 角色↔权限

schema: local_usage
  -- 业务侧用量上报缓冲（待经契约上报到平台 metering consume）
  raw              -- 原始 counter 用量（本地缓冲；异步 Job 调 POST /usage/consume 后置已上报；gauge 型不入本表，直发 PUT /usage/gauge）
  checkpoint       -- 上报水位记录

-- 领域面 N schema（产品自决命名/数量）
schema: {domain} × N
  -- 产品特定业务数据；每业务表冠 workspace_id + 命名规范；不得占 vx_provision/local_authz/local_usage 保留名
  -- AI 交互表（conversation/message/task/artifact）为选装 DDL 组件，产品要用则落自己领域 schema
```

业务表统一沿用命名规范（见 §命名规范）：`uuid` 主键、`created_at/updated_at/deleted_at`、`status VARCHAR(32)+CHECK`（不用 PG ENUM）、金额 `NUMERIC(12,2)`、token 数 `BIGINT`、索引 `idx_/uidx_`、外键 `fk_`、CHECK `chk_`。

#### 2.3.2 外部业务 schema 边界（契约）

业务仓必须遵守下列硬约束，平台以此为交互契约：

1. **只持引用，不复制**：业务库仅保存 `workspace_id` / `tenant_id` / `user_id`(=完整 `sub`) 引用（`vx_provision.app_instance` / `local_authz.member`），**`workspace_id` 为权威业务隔离键**（来自平台 entitlement 体系，不接受产品端自声明，见 §16）；不复制平台账号、组织/空间、订阅或配额详情。身份四层模型（org→workspace→membership→user）与 `tenant.type=personal|organization`、`realm=customer|workforce` 均属平台 `identity` 域，业务侧不得镜像（持隔离键引用 ≠ 镜像模型）。产品建 `local_authz` 的"成员→功能角色→权限"表属**业务授权**（指定落点、非镜像），但**不得复刻平台治理角色目录**（`access.roles` 的 owner/manager/…）。**平台策展的全局只读参考行不得用产品自造的 `workspace_id` 哨兵**（如 `__platform__`，违反"workspace_id 平台签发"铁律）——用**显式轴**表达"全局 vs workspace"：可空 `workspace_id`（NULL=平台全局）或独立 `scope` 列（`workspace`|`platform`）。（arda 现用 `__platform__` 哨兵是偏差，见其仓整改线；owner 2026-07-20 裁定，收口 product_240 §6#22。）
2. **不读平台库**：业务服务禁止直连 `vxturestudio_platform_main`；一切平台状态经 BFF / 契约接口获取，access token 只带治理角色、不含业务 entitlement（业务侧按需实时回查）。
3. **不持 Key**：业务库与业务 worker 不得持有 Provider Key 明文。Provider Key 与请求日志只在独立 Model Platform DB（`vxturestudio_modelruntime_main` 的 `key` / `reqlog`）；`gateway` schema 已取消，平台控制面库不接触 Key。
4. **用量按约上报，不本地判配额**：业务侧只把原始 counter 用量写入 `local_usage.raw`，再由异步 Job 按契约调用平台**用量写入唯一入口**——`metering` consume 服务（`POST /usage/consume`，单事务写入原始事件 + 更新聚合；gauge 型 metric 如 storage.bytes 走 `PUT /usage/gauge` 绝对水位、不入缓冲表）。业务侧**不做配额判断**；配额 gate 由 Model Platform 只读平台配额执行，Model Platform 不直写用量。
5. **L2 域平台条款（2026-07-06 新增，权威 = [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) v1.0）**：L2 域平台产品（Arda/Karda/Terra，及 Runos 技能资产）可在**自己的业务面基础设施**内按 P-T-A 三级模型托管**其他产品**的资产（如 L3 agent 的知识库索引托管于 Karda）——托管资产的归属键恒为 `(org, ws, product)`，可见性由 SharingGrant ∧ entitlement 在 L2 入口求值（召回层强制）。**产品间调用一律走 L0 工具协议直连**（见 [`product_200_integration.md`](./product_200_integration.md) §5），禁止直连对方数据库；本条不改变第 1–4 款对平台库的全部约束（L2 亦不读平台库、不持 Key、用量经 consume 上行）。

#### 2.3.3 用量上报路径（对齐 v2 用量写入模型）

```
业务 DB: local_usage.raw（本地缓冲）
        │  异步 Job（按契约上报）
        ▼
metering consume 服务  POST /usage/consume（单事务，唯一写入方）
        │
        ├─ metering.usage_events         （append-only 原始事件）
        ├─ metering.quota_pools          （配额余量，供 gate 读；usage_summary_* 为时段聚合）
        └─ metering.usage_idempotencies  （幂等键，防重放）
                        ▲
                        │ 只读配额 gate（不写）
                 Model Platform（vxturestudio_modelruntime_main）
```

> 与旧稿差异：① 旧版把 Model Platform 记为「用量唯一写入者」/「直写平台 `usage_events`」——v2 已校正，**唯一写入方是 metering consume 服务**，Model Platform 仅作只读配额 gate；② 平台用量表已随 18-schema cutover 从 `commerce.*` 迁入 `metering.*`（`usage_events` / `quota_pools` / `usage_idempotencies` / `usage_summary_*` / `usage_gauges`，权威 = `deploy/database/ddl/50_metering.sql`）。本文 §2.2/§8 原残留的 `commerce.*` 表引用已按 DDL 逐条迁至对应子域（`metering.*` / `billing.*` / `provisioning.*` / `kyc.verification_policies`）。

#### 2.3.4 Beta→Prod 转换流程

Beta 是**环境隔离**而非套餐隔离；Free 套餐（`plan_code='free'`）属正式订阅，走 Prod，不走 Beta。

```
用户在 Beta 试用满意 → 运营在 admin 后台发起 Beta→Prod 转换
         │
         ├─ 平台 DB 操作（同一 Platform DB，无需迁移）：
         │   • identity 侧成员的环境可访问标记切到 prod
         │   • metering.subscriptions 状态 trial → active
         │     （订阅绑定 workspace_id，不再按 tenant×app 键）
         │
         ▼
业务数据迁移（可选，按用户意愿）：
   方案 A：迁移 Beta 业务数据到 Prod DB（pg_dump → pg_restore 子集）
   方案 B：Prod 全新开始，Beta 数据定期清理
         │
         ▼
Beta 数据生命周期：
   • trial_expires_at 到期 → 标记 cleanup_pending
   • 保留期（可配置，默认 30 天）后物理清理
   • 合规归档：敏感数据保留元数据记录
```

| 维度       | Beta 业务库                     | Prod 业务库                     |
| ---------- | ------------------------------- | ------------------------------- |
| 目标用户   | 公测 / 内部测试 / 功能验证      | 所有正式用户（含 Free 套餐）    |
| 数据生命期 | 可自动清理 / 限期保留 / 可重置  | 永久保留，受合规约束            |
| 迁移方向   | Beta → Prod（转正时迁业务数据） | —                               |
| 配额/订阅  | 来自平台 `commerce`（统一配额） | 来自平台 `commerce`（统一配额） |
| SLA        | 无承诺                          | 承诺                            |

> 数据全部可重灌（无生产/无用户债务）；真正约束来自已部署 schema 与代码的锁步，而非历史数据。业务面 schema 定案后由外部业务仓落地，本仓不实施。

### 2.4 治理原则（备份 / 访问 / 迁移 / 连接池）

> 本节吸收自旧 `database.md §8`，已对齐 v2 三库拓扑（`vxturestudio_platform_main` 平台控制面 / `vxturestudio_modelruntime_main` Model Platform / `vxturebiz_{product}_{env}` 业务面，外部仓）与 8 个平台 schema（identity / iam / product / commerce / model / safety / admin / support）。
> 前提：当前无生产、无用户数据债务，全部数据可重灌；真正的硬约束是**已部署 schema 与代码的锁步一致**，而非历史数据保护。

#### 备份策略

| 数据库                                                | 备份频率            | 保留期           | 策略                                                       |
| ----------------------------------------------------- | ------------------- | ---------------- | ---------------------------------------------------------- |
| Platform DB（`vxturestudio_platform_main`）           | 每日全量 + 实时 WAL | 30 天 + 年度归档 | 异地双份，加密                                             |
| Model Platform DB（`vxturestudio_modelruntime_main`） | 每日全量 + 实时 WAL | 30 天            | 含 `key`（Provider Key 密文）与 `reqlog`；同机房备份，加密 |
| 业务 Prod（`vxturebiz_{product}_prod`）               | 每日全量 + WAL      | 30 天            | 同机房备份（外部业务仓维护）                               |
| 业务 Beta（`vxturebiz_{product}_beta`）               | 每日全量            | 7 天             | 本地备份，可重建（外部业务仓维护）                         |
| varda datasource（同实例独立库）                      | 每日全量            | 14 天            | 随 Platform 实例备份                                       |

> 起步阶段所有平台库均可从 migration + seed 重灌；备份主要面向 Model Platform 的 `reqlog`/`key` 与业务侧不可再生数据。

#### 访问控制

> 详细分层规则、PostgreSQL `GRANT` 脚本、BFF 访问矩阵与演进路线图见
> **[`docs/30-design/data-access.md`](./platform/30-data-access.md)**（执行级别：强制）。本表仅列顶层边界。

| 数据库            | 应用账号权限                                                                                    | 禁止                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Platform DB       | 8 个平台 schema（identity/iam/product/commerce/model/safety/admin/support）各自最小权限 PG 角色 | DDL 由 migration 账号专属执行；BFF 绕过 Domain Service 直连；跨 schema 越权读写；平台库接触 Provider Key 明文 |
| Model Platform DB | `modelruntime_svc` 专属账号（读写 `key`/`reqlog`）                                              | 其他服务直连；业务 worker 部署或直连该库；Key 明文离开该库                                                    |
| 业务 DB           | 各 product service 专属账号（外部仓）                                                           | 跨产品访问、直接读 Platform DB、持有平台 Provider Key                                                         |

- 用量写入路径唯一化：只有 **commerce consume 服务**（`POST /usage/consume`，单事务）可写 `commerce` 用量表；Model Platform 仅**只读**配额 gate，不直写平台库。
- Provider Key 明文仅存在于 Model Platform DB 的 `key` schema（AES-256 密文，内存解密），平台控制面各 schema 一律不接触。

#### Schema 迁移原则

- 所有平台 schema 变更经 `packages/core`（database）统一管理（Prisma / SQL migration），三库各自的 datasource 与 varda 独立 datasource 均纳入同一工具链。
- Platform DB 迁移：灰度、可回滚、**不允许锁表超过 1 秒**（长 DDL 走 `CREATE INDEX CONCURRENTLY`、拆分批量回填）。
- Model Platform DB 迁移：`reqlog` 分区表按月滚动，DDL 避开高峰；`key` schema 变更须与轮换流程隔离。
- 业务 Beta DB 可接受较长迁移时间；业务 Prod DB 在维护窗口执行并提前公告（外部业务仓负责）。
- 起步阶段核心约束是**已部署 schema 与代码锁步**：schema 先行部署、代码随后对齐，数据可重灌不构成迁移阻碍。

#### 连接池

- Platform DB：PgBouncer，**transaction 模式**，8 个平台 schema 对应服务各自独立连接池。
- Model Platform DB：**应用层连接池**（`reqlog` 写入高频，规避 PgBouncer transaction 模式下的事务锁开销）。
- 业务 DB：PgBouncer，**session 模式**（业务事务较长；外部业务仓维护）。

## 3. Schema 全景（8 目标 schema）+ 命名与列规范

### 3.1 目标 schema 集

现状 7 个（database.md §2.1）：`identity / iam / product / commerce / model / ops / support`。
v2 目标 **8 个**（现状 7 + `ops`→`admin` 改名 + 新增 `safety`；`gateway` 取消）：

| schema                     | 现状表数(deploy) | v2 角色                                   | 本文章节 | 主要变更                                                                                              |
| -------------------------- | ---------------- | ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `identity`                 | ~18              | 租户 realm 身份权威                       | §4       | profile 拆分、成长字段、verification（修订/扩）                                                       |
| `iam`                      | 5                | 两级治理 RBAC + OIDC client + signing_key | §5       | oidc_client +product_id/release_channel/品牌/SLO（修订）                                              |
| `(identity 成长子域)`      | —                | 积分/等级/KYC                             | §6       | 新增表（沿用 v1 §5c/5d）                                                                              |
| `product`                  | 8                | 可售目录（静态配置）                      | §7       | agent+application 合并为 product、版本化 plan、退役 plan_feature/price/bundle                         |
| `commerce`（权益）         | 20               | 订阅/配额/用量                            | §8       | workspace 化、quota_pool、usage 三层、entitlement_current                                             |
| `commerce`（账务）         | （同上）         | 账单/支付/流水                            | §9       | org 结算 vs workspace 成本（修订/深化）                                                               |
| `commerce`（provisioning） | （同上）         | 开通生命周期                              | §10      | tenant_app_provisioning + app_webhook_delivery（新建章节）                                            |
| `model`                    | 5                | AI 模型治理                               | §11      | scope-key 调和、Model Platform DB 目标平面（新建章节）                                                |
| ~~`gateway`~~              | —                | **取消**（不在平台库建）                  | §12      | provider key/请求日志归独立 Model Platform DB；`home_url`/`webhook_*`→`product.product_webhook`（§7） |
| `safety`                   | 0（新建）        | 审核占位                                  | §13      | moderation_policy/log（沿用 v1 §4.3）                                                                 |
| `admin`（原 `ops`）        | 16               | 运营身份 + 平台治理                       | §14      | 不只改名：纳入 operator 安全设计 + 治理对象                                                           |
| `support`                  | 4                | 工单/审计/通知                            | §15      | 字段级 + 分区/留存（新建章节）                                                                        |

> 表数为 deploy 基线现状粗计，逐章核定。
> **目标平台 schema = 8 个**（gateway 取消后，修正上方"9 个"）：identity / iam / product / commerce / model / safety / **admin**(原 ops) / support。另有独立 **Model Platform DB**(`routing`/`key`/`reqlog`) + 同实例独立 datasource `varda`。
> ⚠️ **identity / iam 域拆分设计中（2026-07-03起，尚未定稿写入本文）**：`identity`（身份租户合一）与 `iam` 拟按解耦轴细拆为 `account`/`identity`(联邦)/`credential`/`kyc`/`tenancy`/`access`/`appoidc`/`session`/`loyalty` 9 个单数 schema；字段级细化设计见 [`data_identity_200_schema.md`](./data_identity_200_schema.md)（v1 草案，待评审，未落盘前不改变本表的 8-schema 现状）。
> ⚠️ **commerce 域拆分设计中（2026-07-04起，尚未定稿写入本文）**：原 `commerce`（24 表混装权益/账务/开通）拟按写入频率与生命周期拆为 `metering`(订阅/配额/用量) / `billing`(发票/支付/流水/预付费/储值池) / `provisioning`(开通/webhook 投递) / `promotion`(卡券：批次/码/核销五型) 四 schema；`verification_policy` 归属修正移入 `kyc`（见上条 identity 拆分）。字段级细化设计见 [`data_commerce_200_metering.md`](./data_commerce_200_metering.md) / [`data_commerce_210_billing.md`](./data_commerce_210_billing.md) / [`data_commerce_220_provisioning.md`](./data_commerce_220_provisioning.md) / [`data_commerce_230_promotion.md`](./data_commerce_230_promotion.md)（均 v1 草案，待评审）。
> ⚠️ **product 域细化设计（2026-07-04起）**：统一产品目录 + 版本化 plan + **每周期定价 `plan_prices`**（闭合订阅周期）；删除过度工程的 `product_i18n` 表（双名称改为 `products.product_name`+`product_nick` 两列）。字段级见 [`data_product_200_schema.md`](./data_product_200_schema.md)（v1 草案，待评审）。
> ⚠️ **model 域细化设计（2026-07-04起）**：跨两物理库——平台库 `model` schema(5表 providers/models/grants/price*rules/policies) + 独立 Model Platform DB(`key`/`reqlog`/`routing`)；tenant_id 按铁律一改真 FK，跨库仍裸 UUID(边界#1)。字段级见 [`data_model_200_schema.md`](./data_model_200_schema.md)（v1 草案，待评审）。
> ⚠️ **safety / support / admin 域细化设计（2026-07-04起）**：safety(2表占位) [`data_safety_200_schema.md`](./data_safety_200_schema.md)；support(tickets/ticket_comments/audit_logs 中央审计/notification_logs) [`data_support_200_schema.md`](./data_support_200_schema.md)；admin(11 operator*\* 引用专项 + 6 治理表 settings/feature_flags/announcements/maintenance_windows/risk_records/compliance_events) [`data_admin_200_schema.md`](./data_admin_200_schema.md)（均 v1 草案）。**至此 identity/commerce/product/model/safety/support/admin 全域数据底座细化完成。**
> ⚠️ **sharing 域（2026-07-06 ADR-12 拍板 → 2026-07-07 设计定稿并实施 M5）**：SharingGrant 策略 SoT 落平台控制面新 `sharing` schema——**第 19 个平台 schema**，3 表（`grants` SoT + `visible_set_current`/`visible_set_refresh` 物化，撤销/到期 invalidate 推送对齐 entitlement_current 模式）。架构落位见 [`data_sharing_100_architecture.md`](./data_sharing_100_architecture.md)，字段级见 [`data_sharing_200_schema.md`](./data_sharing_200_schema.md)（模型语义权威仍为 [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) §8）；DDL = `deploy/database/ddl/82_sharing.sql`（含 00/90/95/97/98 配套，M5=product_310 P4.2），**生产建库已完成(2026-07-07:platform_main 定向增量 apply,3 表/触发器/FK/角色授权/列锁全验证,端点探针过)**。

### 3.2 命名与列规范

本节为平台三库（`vxturestudio_platform_main` / `vxturestudio_modelruntime_main` / 业务面 `vxturebiz_{product}_{env}`）及独立 varda datasource 统一遵循的命名与列约定。所有表在其所属 schema 内建，schema 名即域名（identity / iam / product / commerce / model / safety / admin / support）。规则为**硬约束**：真正的权威来自已部署 schema 与代码的锁步，数据本身可随时重灌。

#### 3.2.1 单复数与前缀规范（2026-07-03 修订，硬约束）

三层各自的语法数按其**天然基数**统一，取代旧「表名加 schema 前缀」规则：

| 层级       | 单/复数  | 规则                                                                                              | 例                                                         |
| ---------- | -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **schema** | **单数** | 命名"域"，全小写单个词、不用下划线                                                                | `account`、`identity`、`credential`、`commerce`、`kyc`     |
| **table**  | **复数** | 一张表是行的集合；snake_case；**不加 schema 前缀**（schema 本身已限定命名空间，前缀是冗余歧义源） | `users`、`tenants`、`roles`、`identities`、`user_profiles` |
| **column** | **单数** | 一列是一行的一个属性                                                                              | `email`、`status`、`user_id`、`created_at`                 |

```
{entity}s                    -- 普通实体表（复数，如 users、tenants）
{entity}_histories           -- 历史/变更快照表
{entity}_logs                -- 日志表（高频写，按时间分区）
{entity}_overrides           -- 覆盖/定制表（租户级或环境级覆写）
```

**理由**：

- schema 单数——多数域名本是不可数名词（`commerce`/`access`/`identity`/`kyc`），且与现有 `identity`/`commerce`/`product`/`iam` 等保持一致。
- table 复数——① 语义上是行集合；② 关键工程理由：`user`/`order`/`group` 等是 **PostgreSQL 保留字**，单数强行建表需加引号（`"user"`），复数天然绕开，这也是现有 `users` 表名的由来；③ 对齐 Rails/主流 PostgreSQL 惯例。
- column 单数——无争议，一列一属性。

**旧「`{schema}_{entity}` 加前缀」规则作废**（原表述与现实不符：实际落地表名已是 `users` 而非 `identity_users`；真 schema 隔离下前缀纯属冗余）。**存量表单复数混用**（如 `tenant`/`role`/`permission` 为单数，`users` 为复数）**待各域字段级章节（§4–§15）逐域改造时统一为复数**，改造前旧表名仍按原样有效，不视为违规。

说明：

- Provider Key 与请求日志（reqlog）**仅**存在于 `vxturestudio_modelruntime_main`（Model Platform DB），对应 `provider_api_keys` / `request_records` 等表；平台控制面库不落 Key 明文，原 `gateway` schema 已取消。
- 用量事实由 commerce consume 服务单事务写入 `commerce` 域相关表，Model Platform 侧不直写平台库、仅做只读配额 gate。

#### 3.2.2 字段约定

| 约定             | 定义                                                                                                         | 示例                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主键             | uuid，库端默认生成                                                                                           | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`                                                                                                            |
| 外键列           | 引用表实体名 + `_id`，**必须 uuid 且指向 `{parent}.id`**（铁律八）                                           | `user_id UUID`、`tenant_id UUID`、`order_id UUID`                                                                                                          |
| 对外可视码       | `{table}_no`，`BIGINT`，**永不做 FK / 关联键**（铁律二/八）                                                  | `user_no`、`tenant_no`、`invoice_no`、`order_no`                                                                                                           |
| 权限码           | `perm_code` = 三段式 `{domain}:{resource}.{action}`（冒号分顶域、点分资源与动作）；`domain` 对齐 schema 边界 | `operator:account.manage`、`tenant:quota.manage`、`commerce:refund.execute`、`audit:read`                                                                  |
| 创建/更新时间    | 带时区时间戳，非空                                                                                           | `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`，`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`                                                           |
| 软删除           | 带时区、可空；非空即已删                                                                                     | `deleted_at TIMESTAMPTZ NULL`                                                                                                                              |
| 状态/类型枚举    | `VARCHAR(32)` + CHECK 约束，**不用 PG ENUM**（避免迁移锁与不可回退）                                         | `status VARCHAR(32)`，`tenant.type VARCHAR(32) CHECK (type IN ('personal','organization'))`，`realm VARCHAR(32) CHECK (realm IN ('customer','workforce'))` |
| 布尔标志         | `is_` 前缀                                                                                                   | `is_active BOOLEAN NOT NULL DEFAULT true`                                                                                                                  |
| 扩展字段         | 半结构化数据用 jsonb，可空                                                                                   | `metadata JSONB NULL`                                                                                                                                      |
| 货币金额         | 定点数，单位元，**禁用浮点**                                                                                 | `amount NUMERIC(12,2)`                                                                                                                                     |
| Token / 用量计数 | `BIGINT`（可能超 INT 范围）                                                                                  | `tokens_used BIGINT NOT NULL DEFAULT 0`                                                                                                                    |

约定要点：

- 枚举一律 `VARCHAR(32)+CHECK`，取值集合随代码演进由迁移调整 CHECK，不引入 PG ENUM 类型。
- 每张业务实体表默认携带 `id / created_at / updated_at / deleted_at` 四件套；纯日志/历史表可省略 `updated_at` 与软删。
- 金额只用 `NUMERIC(12,2)`，token 只用 `BIGINT`，不得用 float/double。

#### 3.2.3 索引与约束命名

```
idx_{table}_{columns}         -- 普通索引
uidx_{table}_{columns}        -- 唯一索引
pk_{table}                    -- 主键（PG 自动命名，通常不手动指定）
fk_{table}_{ref_table}        -- 外键约束
chk_{table}_{rule}            -- CHECK 约束
```

命名以表名为核心，列名或规则名为后缀，保证同库内约束名唯一且可读；跨 schema 引用时约束名仍以本表为主体命名。

#### 3.2.4 检测器（护栏）覆盖 — 铁律不停留纸面

> 原则：**重要铁律 / 规则 / 逻辑必须落成可执行检测器**（见 [reference: data-architecture linter]，`scripts/guardrails/`）。下表 = 本轮新增/扩展的 5 项规格，实施见 `data_platform_300` / 检测器脚本；`pnpm lint:data-design` 门控。

| #   | 规则（铁律）                              | 检测器                                      | 新增/扩展 | 检查内容                                                                                                                                                                                                                                                                                | 层           |
| --- | ----------------------------------------- | ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | 标识符三层纪律（铁律八）                  | `check-data-architecture.mjs` 扩 `ironlaw2` | 扩展      | `*_no` 不得出现在 FK/关联键；`*_id` 必须 uuid 且指向某表 `.id`；可视码不得命名 `*_id`                                                                                                                                                                                                   | 扫 docs DDL  |
| 2   | perm_code 三段式（§3.2.2）                | `naming/perm-code`（新规则）                | 新增      | perm_code 匹配 `{domain}:{resource}.{action}`（运营 realm）；客户 realm 点分式暂 grandfather（allowlist）                                                                                                                                                                               | 扫 docs      |
| 3   | seed 幂等（§2.2.5）                       | `check-seed-idempotency.mjs`（新脚本）      | 新增      | `seed-catalog.mjs` 每条 `insert into` 必带 `on conflict`                                                                                                                                                                                                                                | 扫 seed 代码 |
| 4   | 锚点列列级锁（铁律八）                    | `check-column-locks.mjs`（新脚本）          | 新增      | `deploy/database/ddl/98_column_locks.sql` 的 REVOKE/GRANT UPDATE 列清单须与实际 DDL 结构（主键/`*_no`/`created_at`/`created_by`/显式安全语义列）逐表一致；`pnpm lint:column-locks` 独立门控（TD-018 §① DDL 已落地；§② 生产切实际 `DATABASE_URL` 为独立待授权部署动作，见 tech-debt.md） | 扫 ddl       |
| 5   | super_admin 全授（`data_admin_200` §4.4） | seed 运行时自检断言                         | 新增      | `count(super_admin 映射) == count(operator_permission 全集)`，漏配即 seed 失败                                                                                                                                                                                                          | 运行时       |

> #5 属数据不变量、静态难查，落为 seed 运行时断言；#1–#4 静态可查，入 `lint:data-design`。新问题→加规则（linter 可扩展性原则）。

> 📦 **落地/迁移**：原「3.3 受影响的现有表去向矩阵」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

#### 3.2.5 i18n 键列规范（2026-07-05，seed 修正线固化）

**外显目录字段**（系统目录/seed 数据中面向用户或运营展示的 `name`/`description` 类字段）一律配伴生 **`{字段}_key` varchar(128)**（i18n 键，前端按 locale 解析；DB 只存键=契约，locale 文件 entry 属前端工作线）。

- **键名 = 从自然键机械派生，禁手写漂移**：`{realm/域}.{实体}.{自然键}`（+`.desc` 为描述键）。已定：`ops.role.{role_code}` / `ops.perm.{perm_code 冒号→点}` / `access.role.{scope}.{role_code}` / `access.perm.{perm_code}` / `product.plan.{plan_code}` / `product.category.{code}` / `product.product.{product_code}.desc` / `product.checklist.{item_code}` / `model.model.{model_code}.desc` / `model.provider.{provider_code}.desc` / `identity.provider.{code}` / `loyalty.level.{level_no}` / `ops.setting.{config_key}.desc` / `ops.flag.{flag_key}.desc`。seed 循环内派生，不手写字面量表。
- **适用面**：系统目录（seed 基线行）。**不适用**：①用户/运营 runtime 内容（工单、租户名、联系人、账单等——用户自己的语言，不译）；②品牌/技术名（oidc_clients 名、product_name、model_name、provider_name——不译，product 另有 name 主 + nick 副双列决策）；③运营撰写的 **tenant 可见动态内容**（公告/维护窗口）——`*_key` 静态 locale 机制不适用，走内容级多语言（见 tech-debt TD-022）。
- **护栏（两层闭合）**：①**列存在** = `check-i18n-keys.mjs`（`pnpm lint:i18n-keys`，静态扫 DDL：目录表外显列必须有伴生 `_key` 列，规则单位=字段；豁免逐列显式+注理由）——2026-07-05 教训：permission 表因"有一个 key 列"被表级归类掩盖 description 无键，手工枚举清单抓不到未枚举项，故固化为规则派生检查器；②**值非空** = `30-verify` C2 轴对 seed 基线行断言（作用域谓词限定 is_system/SYS 哨兵行，运营自建行合法无键）。

#### 3.2.6 展示可见性双列规范（2026-07-06，owner 定案）

**可见性是独立轴，不派生自任何生效开关。** 一行可以 `status='active'`/`is_public=true`/`is_enabled=true`/`is_active=true`（发布了、启用了、激活了、后台有效）却**不可见**——即"后台生效但不给看"。故目录/实体表的展示可见性用**专列**，与 status/发布/启用/激活各司其职、互不派生。

- **两 realm 双列（统一，不分叉）**：`is_customer_visible` boolean（客户端/`customer` realm 展示）+ `is_workforce_visible` boolean（运营端/`workforce` realm 展示）。命名对齐铁律七的 realm 判别器（customer/workforce），非 UI 临时名（client/admin）。
- **统一双列纪律（owner：我可以不用，你不能没有）**：所有需可见性的目录/实体表**两列都建**，即使某 realm 恒 false。**铁律七**使运营域表（`admin.operator_*`）的 `is_customer_visible` **结构性恒 false**（客户永不见运营数据）——接受此死列换取契约统一。默认：客户域表两列 DEFAULT true；运营域表 `is_customer_visible` DEFAULT false / `is_workforce_visible` DEFAULT true。
- **预置元锚点隐藏**：`admin.operator_role.sys_config`、`admin.operator_account.systemadmin` 置 `is_workforce_visible=false`（存在且被 created_by 引用，但不进运营名册/下拉）。`is_system` 是**保护**（禁改删）≠ 可见性——super_admin 也是 is_system 但须可见，故二者独立列。
- **覆盖表（12，2026-07-06 首批）**：`access.roles`/`access.permissions`（原 `is_visible` 拆入本对）、`admin.operator_role`/`operator_permission`（同）/`operator_account`、`loyalty.level_policies`、`product.products`/`product_categories`/`plans`、`model.models`/`model_providers`、`identity.oauth_providers`。
- **运行时消费**：展示查询按 realm 过滤（admin 名册/角色目录 `where is_workforce_visible`；租户角色选择器 `where is_customer_visible`）；按 id/code 的内部解析不过滤。
- **护栏**：`30-verify` C3 轴断言 sys_config/systemadmin 运营端不可见、super_admin 可见、运营域零客户可见（realm 隔离）；`check-column-locks` 保证两列进白名单（可写业务列）。

### 3.4 各域表与核心字段概览（全字段级 DDL 见 [schema 文档](./data_platform_200_schema.md)）

> 逐 schema：表清单 + 核心/锚点字段 + 关键约束/禁止。**完整 DDL / 列 / 索引 / 触发器 / Prisma 见 schema 文档对应 §N**；落地/迁移/待决见 runbook。（原 §3.3「受影响表去向矩阵」已随迁移内容移至 runbook；§4–§15 字段级正文已移至 schema 文档。）

#### 4 identity 域（字段级见 schema 文档 §4）

customer realm 的身份权威：四层稳定模型 `User → Tenant(personal/organization) → Workspace → 两级 Membership` + 全量认证支撑表；只提供归属主键，不持任何 entitlement/配额（身份与业务解耦）。

| 表                      | 用途                  | 核心/锚点字段                                                                                              |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `users`                 | 纯认证身份            | `id` PK / `user_no` / `account` UNIQUE / `email` UNIQUE 可空 / `phone` UNIQUE NOT NULL（强锚点）/ `status` |
| `user_profile`          | 1:1 展示/本地化资料   | `user_id` PK→users / `display_name` / `avatar_url` / `avatar_hash` / `language` / `extra` jsonb            |
| `user_credential`       | 密码凭据（Argon2id）  | `user_id` PK→users / `password_hash`（可空）/ `force_password_change`                                      |
| `user_avatar`           | 真实头像 bytea        | `user_id` PK→users / `data` bytea / `hash`(sha256) / `source`                                              |
| `identities`            | 联邦绑定              | `user_id`→users / `provider` / `provider_subject`                                                          |
| `tenant`                | 租户（个人/组织统一） | `id` PK / `type`(personal\|organization) / `owner_user_id`→users / `status`                                |
| `tenant_profile`        | 1:1 租户资料          | `tenant_id` PK→tenant / `logo_data` bytea / `is_billing_recipient` / 联系/本地化列                         |
| `tenant_membership`     | 租户级成员            | `tenant_id`→tenant / `user_id`→users / `role`(引用 iam scope=org) / `status`                               |
| `workspaces`            | 工作空间              | `id` PK / `tenant_id`→tenant / `is_default` / `status`                                                     |
| `workspace_memberships` | 空间级成员            | `workspace_id`→workspaces / `user_id`→users / `role`(引用 iam scope=workspace)                             |
| `invitation`            | 邀请                  | `scope`(org\|workspace) / `tenant_id?` / `workspace_id?` / `token_hash` UNIQUE / `status`                  |
| `auth_session`          | 中心会话镜像          | `sid` UNIQUE / `user_id`(loose) / `realm`(customer\|workforce) / `status` / `expires_at`                   |
| `refresh_token`         | opaque 轮换令牌       | `token_hash` UNIQUE / `session_id`(loose) / `rotated_from` / `status`                                      |
| `user_verification`     | 验证码                | `target_type` / `code_hash` / `attempt_count` / `expires_at`（append-only）                                |
| `password_reset_token`  | 密码重置              | `token_hash` UNIQUE / `expires_at` / `used_at`（append-only）                                              |
| `login_attempt`         | 风控/限速             | `identifier` / `result` / `ip_address` / `created_at`                                                      |
| `oauth_provider`        | 入站联邦 broker 配置  | `code` UNIQUE / `client_id?`/`client_secret?` / `is_enabled`                                               |
| `oauth_state`           | OAuth 握手状态        | `state` UNIQUE / `code_verifier?`(PKCE) / `nonce?` / `expires_at`（append-only）                           |
| `audit_event`           | 本域审计              | `event_type` / `user_id?`/`tenant_id?`/`workspace_id?` / `result`（append-only）                           |

**关键约束/禁止**：

- **锚点**：`account`/`email`/`phone` 各 UNIQUE；`phone` NOT NULL 且已验证（强锚点），`email` 可空/可未验证；`identities` UNIQUE(provider,provider_subject)+UNIQUE(user_id,provider)，**不按 email 自动并号**（合并以手机为锚点）。
- **部分唯一索引（不变量）**：每 user ≤1 personal tenant（`tenant(owner_user_id) WHERE type=personal AND deleted_at IS NULL`）；每 tenant ≤1 owner 成员行；每 tenant 唯一 default workspace。个人租户注册即建 1 default workspace + 1 条 `role='owner'` membership。
- **owner 一致性**：`tenant.owner_user_id`（反规范化保留）与 `tenant_membership(role='owner')` 须一致——只经 `transfer_tenant_owner()` 原子转移 + DEFERRABLE 约束触发器兜底，禁止业务代码分别 UPDATE。
- **双 realm 硬隔离**：本域仅服务 customer realm，与 admin 域 `operator_*`（workforce）**零 FK**；`auth_session.user_id` 为 loose 列，靠 `realm`(customer\|workforce) 区分、绝不交叉解引用；成长字段（level/points/verification，§6）不得泄漏到 operator。
- **跨 schema 引用**：membership/invitation 的 `role`/`scope` 按 `iam.role.code`/scope 值解析，**不建跨 schema FK**。
- **成长子域**：`users.level_no` / `tenant.verification_*` 物理列挂本域但字段级归 §6，本域不展开。

#### 5 iam 域（字段级见 schema 文档 §5）

治理型两级 RBAC 全局目录 + 平台入口/产品的 OIDC 客户端注册 + RS256 签名密钥公钥/元数据；只管"谁能管组织/空间"与"哪些客户端可接入认证"，不含业务授权、不含 entitlement。

| 表                    | 用途                                             | 核心/锚点字段                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iam.role`            | 全局治理角色目录（org/workspace，非 per-tenant） | `id` PK、`code`、`scope`(org\|workspace)、UNIQUE(scope,code)                                                                                                                                   |
| `iam.permission`      | 权限项目录                                       | `id` PK、`code`(全局 UNIQUE)、`description`                                                                                                                                                    |
| `iam.role_permission` | 角色→权限关联                                    | 复合 PK (`role_id`,`permission_id`)，两侧 FK CASCADE                                                                                                                                           |
| `iam.oidc_client`     | 产品矩阵 + 平台入口接入统一 IdP 的客户端注册     | `id` PK、`client_id`(UNIQUE)、`realm`(customer\|workforce)、`product_id`(FK→product.product，可空)、`release_channel`(stable\|beta)、`slo_participation`、`client_secret_hash`/`pkce_required` |
| `iam.signing_key`     | RS256 签名密钥公钥 + 轮换元数据                  | `kid` PK、`public_jwk`(仅公钥)、`status`(next\|active\|retiring\|retired)、`activated_at`/`retiring_at`/`retired_at`                                                                           |

**关键约束/禁止**：

- **治理 RBAC ≠ 业务授权**：role/permission 只表达"能否管理组织/空间/计费"，业务对象授权在各业务域 OUT、不入平台库；运营 admin RBAC(§14) 与本域互不引用、无 FK。
- **成员表按 code 内联引用、不建跨 schema FK**：`identity.tenant_membership.role` / `workspace_memberships.role` 以字符串 code 引用 `iam.role.code`；owner 唯一性等约束在 identity 域(§4)兜底。
- **双 realm 硬隔离**：`oidc_client.realm` 取值 customer/workforce，与 `auth_session.realm` 对齐，两套账号体系完全独立、互不相通。
- **entitlement/capability 已退役出 iam**：`iam.capability`/`plan_capability`/`subscription_capability` 显式退役（从未物理建表），SoT 归 commerce(§8)/product(§7)，access token 只带治理角色、不含业务权益。
- **CHECK/唯一**：`chk_role_scope`(org\|workspace)、`chk_oidc_client_realm`/`_release_channel`/`_slo`，以及 `slo_participation='back_channel'` 时 `back_channel_logout_uri` 必填；`signing_key` status CHECK + 部分唯一索引保证同一时刻至多一把 active。
- **私钥绝不落库**：signing_key 仅存公钥 JWK + 元数据，私钥进 secret manager / platform-identity.env。
- **在产域迁移纪律**：iam 自 2026-06-18 在产，一律保数据迁移（加列带默认/可空、就地 UPDATE 改取值、补 CHECK/索引），不 reseed；`product_id` 跨 schema FK 待 product 域重建后再加。

#### 6 identity 成长子域：积分/等级/KYC（字段级见 schema 文档 §6）

与计费独立的 per-user / per-tenant「成长面」，物理上分布在 `identity`（等级/积分/进度）+ `commerce`（KYC 可配置策略）+ `identity.tenant`（认证状态列），仅作用于 `realm=customer`。

| 表                                                  | 用途                                                                        | 核心/锚点字段                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `identity.users.level_no`（加列）                   | user 全局有序等级（不由订阅推导）                                           | `level_no`（int，DEFAULT 1）                                                                                |
| `identity.user_level_policy`                        | 等级 → 路径B可建组织 tenant 数上限（可配置）                                | `level_no`(PK), `max_owned_org_tenant`                                                                      |
| `identity.user_level_threshold`                     | 积分 → 等级单调阈值                                                         | `level_no`(PK→policy), `min_points`                                                                         |
| `identity.user_points`                              | 当前积分余额单行汇总                                                        | `user_id`(PK→users), `total_points`                                                                         |
| `identity.user_points_ledger`                       | 积分完整流水                                                                | `id`, `user_id`, `source_type`, `points_delta`, `balance_after`                                             |
| `identity.user_task_progress`                       | 多步累计当前状态（连签/任务进度）                                           | `user_id`, `progress_type`, `current_value`, `target_value`                                                 |
| `identity.tenant.verification_status/_type`（加列） | 个人/组织 KYC 认证态                                                        | `verification_status`(unverified\|pending\|verified\|rejected), `verification_type`(individual\|enterprise) |
| `kyc.verification_policies`                         | 可配置 KYC 门控（跨 identity/kyc/product；2026-07-04 从 commerce 迁入 kyc） | `product_id`(→product.product,可NULL), `tenant_type`, `require_verification`, `required_type`               |

**关键约束/禁止**：

- `realm` 硬隔离：成长面全部专属 `customer`，`workforce`（operator）不参与，两 realm 无 FK、无字段泄漏。
- 与计费不建 FK：等级↔订阅两套机制解耦；KYC 门控规则下沉为 `verification_policy` 表数据，校验动作在应用层（不适合 DB CHECK）。
- `verification_policy` 唯一性（rank 24 修复）：产品级 `(product_id,tenant_type)` 唯一（`WHERE product_id IS NOT NULL`）+ 平台基准 `(tenant_type)` 唯一（`WHERE product_id IS NULL`）两个部分唯一索引；`product_id IS NULL` 是平台基准值（非隐式兜底），产品上架前须显式插入自身非 NULL 记录（§7 launch_checklist 强制）。
- `source_type`/`progress_type` 为开放 varchar 标签，刻意不加 CHECK/ENUM；`user_task_progress` 每 `(user_id,progress_type)` 唯一。
- 余额与流水一致性由应用层同一事务保证，不靠 DB 触发器；ledger 沿用「可写」（非 append-only）；`total_points`/`current_value`/`points_delta≥0` 等 CHECK 兜底，`level_no` 仅 CHECK `>=1`（上界随 policy 扩展）。
- in-production identity 一律「加列带默认/可空」保数据迁移、不 reseed；commerce 为空域可重建+reseed。

#### 7 product 目录域（字段级见 schema 文档 §7）

统一产品目录：合并原 `agent`/`application` 双目录为单一 `product` + 字典/i18n/metric 卫星表 + 版本化 `plan`（`plan_component` 唯一 SoT）+ 平台自签 `product_webhook`。空域，直接按目标态重建 + reseed。

| 表                      | 用途                                               | 核心/锚点字段                                                                                                                                                |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product`               | 统一产品目录（合并 agent+application）             | `id` PK、`product_code` UQ、`product_type`、`category_id`→product_category、`capability_keys[]`、`standalone_subscribable`、`status`                         |
| `product_metric`        | 产品计量维度定义（供 §8 计量分支）                 | `product_id` FK、`metric_key`、`merge_strategy`(max/union/pool)、`consume_mode`(divisible/atomic)、UQ(product_id,metric_key)                                 |
| `product_category`      | 树形分类字典                                       | `id` smallint PK（刻意例外）、`parent_id` 自引用、`code` UQ                                                                                                  |
| `product_i18n`          | 产品多语言文案（双槽位）                           | PK(product_id,locale)、`product_name`、`product_nick`、`description`                                                                                         |
| `plan`                  | 产品壳（对外销售方案）                             | `id` PK、`plan_code` UQ、`current_version_id`→plan_version、`billing_cycle`、`status`                                                                        |
| `plan_version`          | 不可变版本                                         | `id` PK、`plan_id` FK、`version_no`、`price`、`is_locked`、UQ(plan_id,version_no)                                                                            |
| `plan_component`        | 版本组件（唯一 SoT，替代 plan_agent/plan_feature） | `plan_version_id` FK、`product_id` FK、`tier`、`billing_kind`(bundled_free/charged)、`priority`、`features[]`、`quota` jsonb、UQ(version_id,product_id,tier) |
| `product_webhook`       | 平台自签 HMAC 推送配置                             | `product_id` PK/FK、`home_url`、`webhook_url`、`webhook_secret_ref`                                                                                          |
| `launch_checklist_item` | 上架检查项目录（可配置）                           | `item_code` PK、`is_required`                                                                                                                                |
| `product_launch_status` | 各产品各检查项完成态                               | PK(product_id,item_code)、`is_satisfied`、`checked_by`                                                                                                       |

**关键约束/禁止**：

- **`plan_version` 不可变、`plan_component` 唯一 SoT**：无 `components` JSONB 双写；版本一旦被订阅引用即 `is_locked=true`，其 `plan_component` 增/改/删全禁、价格/版本号冻结、禁清 `is_locked`（触发器保护全表）；组合/价格变更只能开新版本（`version_no`+1），老订阅引用的旧版本恒不变。
- **priority 编排期硬约束**：单版本内 `max(bundled_free priority) < min(charged priority)`（触发器强制，财务级）；运行时瀑布扣减不读 `plan_component`，读已投影的 `quota_pool.priority`（§8.2）。
- **`product_metric.consume_mode` CHECK**：仅 `merge_strategy='pool'` 时强制非空且取值合法；`max`/`union` 型不消费。
- **`product_i18n` 无默认语言兜底**：每 product 必须覆盖全部 locale，缺一为数据缺陷，由 `launch_checklist` 的 `i18n_complete` 项收口。
- **上架状态无汇总字段**：`product` 主表不加"是否可上架"列，完全由 `product_launch_status` 推导；`category_id` 须指向叶子小类（应用层引导，无法 CHECK）。
- **`product_webhook.webhook_secret_ref` 是平台自签 HMAC 密钥**（非 Provider Key），不触发"Provider Key 不入库"铁律，正常入平台库；`gateway` schema 已取消，旧"下沉 gateway"表述作废。

#### 8 commerce 权益域：订阅/配额池/用量/计量内核（字段级见 schema 文档 §8）

计量内核是财务正确性核心：consume 是唯一写入路径，quota_pool 为实时余量 SoT，用量事件 append-only。

| 表                              | 用途                                | 核心/锚点字段                                                                                                                                                                           |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tenant_subscription             | workspace 化订阅，指向 plan_version | `workspace_id`、`tenant_id`(rollup 反查)、`plan_version_id`、`pay_amount`(与 plan 价分离)                                                                                               |
| quota_pool                      | 实时余量 SoT，瀑布定序扣减          | `workspace_id`、`product_id`+`metric_key`、`quota_limit`/`quota_used`、`priority`、`billing_kind`、`pool_source`、`reset_period`/`period_anchor`（锚定订阅 start_at，非日历）、`status` |
| tenant_usage_event（头）        | 一次 consume 一行，append-only 分区 | `id`+`created_at`(PK/月分区)、`workspace/product/metric`、`total_amount`(=实扣)、`requested_amount`(409 审计)、`idempotency_key`                                                        |
| tenant_usage_event_pool（明细） | 每命中池一行                        | `(event_id,event_created_at,quota_pool_id)` PK、`took`、FK→quota_pool/头                                                                                                                |
| usage_idempotency               | 幂等权威，非分区                    | `idempotency_key`(全局 PK)、`event_id`、`consumed`、`per_pool`                                                                                                                          |
| quota_pool_reset                | 归零审计，重建 quota_used           | `pool_id`、`period_start`、`used_before_reset`、`reset_at`                                                                                                                              |
| usage_summary                   | 周期对账降采样（时→天→月）          | 不承担实时；实时一律读 quota_pool                                                                                                                                                       |
| entitlement_current             | 短 TTL 缓存，非 SoT                 | **定名 `entitlement_current`**：UPSERT + `UNIQUE(workspace_id, product_id)` 快照（弃 append-only `entitlement_resolve_log` 方案——与"短 TTL 缓存"语义不符）                              |

**关键约束/禁止**：

- consume 是唯一写路径：产品端/Model Platform 只 `POST /usage/consume`，**禁止直写用量表**；单事务 READ COMMITTED + 行锁。
- 瀑布全序 `ORDER BY priority, billing_kind(bundled 先), effective_at, id` 兼作加锁顺序（免死锁/防超扣）；**不设"活跃池 priority 唯一"约束**（两 plan 默认 priority=100 须共存）。
- 用量事件表 **append-only**：BEFORE UPDATE/DELETE RAISE EXCEPTION 触发器（禁用 `DO INSTEAD NOTHING` RULE，会静默吞写）；分区键必须进 PK，头/明细同步月分区。
- quota_pool 只**软退役**(status/retired_at)，绝不硬删（明细 FK 依赖）；周期池 `period_anchor` 强制非空（=订阅 `start_at`），当前周期 `[cycle_start, cycle_end)` 由 `period_anchor + N×(cycle_unit×cycle_count)` 推得——**锚定订阅、不用 `date_trunc` 日历对齐**（铁律五）。仅 prepaid 自然月对账路径（铁律六）例外用自然月，须在该路径处显式标注。
- 读路径周期感知：`effective_used = CASE WHEN now() >= 本周期 cycle_end THEN 0 ELSE quota_used END`（`cycle_start/end` 由 `period_anchor` 推导，**非日历地板**）；**禁裸读 quota_used**（惰性归零下会返回过期满载余量）。
- AI 调用明细（token 拆分/model_code/latency 等）归 Model Platform DB `reqlog`，commerce 只承载计费 metric；跨 schema 无 FK。

#### 9 commerce 账务域（字段级见 schema 文档 §9）

账务闭环：org/tenant 为结算主体（资金），workspace 为成本中心（计量归集）；月末各 workspace charged 订阅费+计量超额上卷成一张 org 账单，经预付款扣减/支付/开票，全部资金变动落不可变流水。

| 表                     | 用途                                        | 核心/锚点字段                                                                                                     |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| tenant_invoice         | 账单头（org/tenant 级 rollup）              | `id`、`tenant_id`、`bill_no`(uidx)、`bill_cycle`、`payable_amount`/`paid_amount`、`bill_status`                   |
| tenant_invoice_item    | 账单明细行（+workspace 成本归集）           | `bill_id`→invoice、`workspace_id`、`subscription_id`、`product_id`/`metric_key`、`item_type`、`usage_summary_ref` |
| tenant_invoice_receipt | 中国增值税发票 fapiao                       | `bill_id`、`invoice_no`(uidx)、`invoice_tax_type`、`company_info`/`bank_info`(jsonb)、`invoice_status`            |
| tenant_payment         | 支付（线上多渠道+线下凭证）                 | `bill_id`、`transaction_id`→流水、`pay_order_no`(uidx)、`pay_source`、`channel_*`(占位)、`pay_status`             |
| tenant_refund          | 退款（审核+执行双状态机）                   | `bill_id`、`pay_record_id`→payment、`refund_no`(uidx)、`audit_status`、`refund_status`                            |
| tenant_transaction     | 资金流水（不可变账本，append-only）         | `tenant_id`、`transaction_no`(uidx)、`trade_type`、`amount`、`balance_before`/`balance_after`                     |
| tenant_credit          | 预付款池（billing_account.prepaid_balance） | `tenant_id`(UNIQUE 一 org 一池)、`balance`、`total_granted`/`total_consumed`、`version`(乐观锁)                   |
| tenant_billing_address | 开票抬头                                    | `tenant_id`、`invoice_tax_type`、`title`、`tax_no`、`is_default`                                                  |
| tenant_payment_method  | 支付方式                                    | `tenant_id`、`method_type`、`external_id`(网关 token 化)、`status`、`is_default`                                  |

**关键约束/禁止**：

- **方案A 结算主体**：credit/billing_address/payment_method + 所有账务头表挂 `tenant_id`（FK→identity.tenant），**不建 org 汇总表**；workspace 维度仅出现在 `tenant_invoice_item` 明细行做成本归集。
- **账本不可变（法律证据）**：`tenant_transaction` 用 RAISE EXCEPTION 触发器阻止 UPDATE/DELETE（**非** `DO INSTEAD NOTHING`，避免静默吞写），无 `updated_at`/`deleted_at`；更正只能追加冲正流水（trade_type=refund/adjust）。
- **支付不能双份**：`tenant_payment.pay_order_no` UNIQUE；回调按 `channel_transaction_no`+`pay_order_no` 幂等去重。
- **预付款唯一变动通道**：`tenant_credit.balance` 任何变化必伴随一条 `tenant_transaction`，配 `version` 乐观锁（`WHERE version=:v` 0 行重试）杜绝双扣/漂移。
- **仅 charged 计入结算**：订阅费仅取 `plan_component.billing_kind='charged'`，`bundled_free` 不进账；发票开具时对抬头/税号做**值快照**（非外键），后续改抬头不影响已开发票。
- ⚠️ `channel_*`/`pay_expire_at`/回调字段为网关目标态占位（支付网关未接入），真实接入前为空；线下转账路径（`offline_*`+凭证）可先行。

#### 10 commerce provisioning（开通状态机 + webhook 投递）（字段级见 schema 文档 §10）

管 workspace 业务空间的开通生命周期与平台→产品的 outbound webhook 投递；与订阅（§8/§9）正交、方向与 consume 相反（outbound 推送 vs inbound 同步 consume）。

| 表                                | 用途                                                          | 核心/锚点字段                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provisioning.provisionings`      | 开通状态机：某 workspace 在某 product 的业务空间是否已建/已拆 | `id` PK；`workspace_id`（真实主体）/`tenant_id`（rollup 反查）；`product_id` FK→`product.product`；`status`（pending/provisioned/deprovisioned）；`version`（单调递增，乐观锁+投递排序键）；`provisioned_at`/`deprovisioned_at`/`metadata`                                                             |
| `provisioning.webhook_deliveries` | 每次 outbound 投递记录：retry/lease/幂等/终态/死信            | `id` PK；`idempotency_key`（全局去重）；`provisioning_id` FK+`provisioning_version`；`workspace_id`/`tenant_id`/`product_id`；`event_type`/`payload`；`status`（pending/delivering/delivered/failed/dead）；`attempts`/`max_attempts`；`signature`（HMAC）；`leased_by`/`leased_until`/`next_retry_at` |

**关键约束/禁止**：

- 状态机仅三态 `pending→provisioned→deprovisioned`（重订阅复用同一行回流，每跳 `version += 1`），起步阶段不加 transient/failed；`chk_tap_status` CHECK 收敛。
- `uq_tap_workspace_product UNIQUE(workspace_id, product_id)`：每 workspace+product 至多一条；主体锁定为 **workspace**（与 §8 一致），`tenant_id` 仅供 org/tenant rollup 反查。
- **删除 deploy 遗留 `plan_id`**（落实开通/订阅正交）：跨 plan 升降级期间 `provisioned` 不变，挂哪个 plan 属审计信息、归投递 payload。
- 投递 `uq_awd_idempotency UNIQUE(idempotency_key)` + `INSERT ... ON CONFLICT DO NOTHING` 保入队幂等；lease 领取用 `FOR UPDATE SKIP LOCKED`+`leased_until` 防并发/僵死重复投递；`attempts>=max_attempts` 转 `dead` 死信。
- `app_webhook_delivery` 是**可变工作队列**，明确**不套** append-only 触发器、**不分区**（区别于 §8.4 高频用量事件）。
- `workspace_id`/`tenant_id` **建跨 schema FK →** `identity.workspaces`/`identity.tenant`（§2.2.4 铁律一：平台库内普通引用建真 FK；workspace/tenant 软删，FK 默认 RESTRICT 安全，杜绝为不存在 workspace 开通的孤儿态）；`product_id` REFERENCES `product.product`。（旧「裸 uuid 不建 FK」表述已按铁律一作废。）
- 与 §7 `product.product_webhook`（每产品一行静态端点+密钥配置）职责正交不可合并；投递时按 `product_id` join 取 `webhook_url`+`webhook_secret_ref` 做 HMAC 签名（平台自签密钥，非 Provider Key）。

#### 11 model 治理域 + Model Platform DB（字段级见 schema 文档 §11）

model 授权/费率/限流的平台配置 + 独立 Model Platform DB（key/reqlog/routing）运行平面；承载 provider 成本侧计量，并调和旧 tenant/application 轴 ↔ 新 workspace/product/metric 计量轴。

| 表                                                          | 用途                                             | 核心/锚点字段                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `model.model_provider`                                      | provider 注册表（doubao/claude/私有）            | `provider_code`(UNIQUE)、`provider_type`、`is_active`、`config`(非敏感)                                       |
| `model.model`                                               | Vxture 模型注册表                                | `model_code`(UNIQUE)、`provider_id`(FK)、`protocol`、`endpoint_url`、`capabilities[]`                         |
| `model.model_grant`                                         | 租户→模型技术授权/灰度白名单（授权上界，非配额） | `model_id`(FK)、`tenant_id`、`application_id`+`application_type`、`agent_id`(退役)、`expires_at`              |
| `model.model_price_rule`                                    | provider 成本费率（付上游的钱，非客户标价）      | `model_id`(FK)、`billing_mode`(token/request)、`input/output/request_unit_price`、`effective_at`/`expires_at` |
| `model.model_policy`                                        | 模型访问技术速率门（rpm/tpm/tpd+并发）           | `model_id`(FK)、`tenant_id`(NULL=平台默认)、`rate_limit_rpm/tpm/tpd`、UNIQUE(model_id,tenant_id)              |
| `key.provider_api_key`                                      | provider 密钥（Model Platform DB）               | `provider_code`(逻辑引用)、`encrypted_key`(bytea/AES-256)、`key_scope`、UNIQUE(provider_code,key_alias)       |
| `key.key_rotation_log`                                      | 密钥轮换审计                                     | `provider_api_key_id`(FK)、`rotated_at`、`rotated_by`                                                         |
| `reqlog.request_record`                                     | 每次 AI 请求明细（高频，按月分区）               | `request_id`(跨库关联键)、`model_code`、`input/output/total_tokens`、`status`、`usage_event_id`(跨库)         |
| `reqlog.error_record`                                       | 错误/异常明细（按月分区）                        | `request_id`、`error_code`、`error_message`                                                                   |
| `routing.provider_config` / `model_route` / `fallback_rule` | 连接/路由/降级                                   | `provider_code`、`model_code`、`weight`、`fallback_model_codes[]`                                             |

**关键约束/禁止**：

- 密钥铁律：`model` 域全表**不得**存 provider API Key，密钥仅归 `key.provider_api_key`（bytea 密文，内存解密，平台库永不接触明文）。
- 授权≠计量≠配额≠限流：`model_grant`(能否调，tenant/application 轴) / §8 计量(扣谁额，workspace/product/metric 轴) / `quota_pool`(商业配额) / `model_policy`(技术速率门) 四者正交，经 §11.3 映射口径在 consume 边界对齐（非列改名）。
- scope-key 调和是 §8 consume 切换的**硬前置**，且依赖 `product.agent_catalog` 落地（跨轮硬前置）；解析方向单一（旧轴→新轴，consume 前完成）。
- 写权归属：AI 用量唯一经 §8.3 consume 单事务上行写 `metering.usage_events`；Model Platform 对 quota_pool **只读**（须走周期感知 `effective_used`，严禁裸读 `quota_used`），禁止直写任何用量/配额表。
- 失败调用不计费：`status='error'` 只进 `reqlog`，不触发 consume；input/output 拆分明细留 reqlog，commerce 只收单一 `amount`。
- Model Platform DB 为独立库，**跨库不建 FK**，一致性靠单一 `request_id`+应用层；`price_rule`/`policy` append 版本化无软删；`endpoint_url` 权威在 `model.model` 与 `routing.provider_config` 二选一（待决）。

#### 13 safety 域（字段级见 schema 文档 §13）

内容审核结构占位：只建策略与日志表，不接真实审核执行。

| 表                | 用途                                 | 核心/锚点字段                                               |
| ----------------- | ------------------------------------ | ----------------------------------------------------------- |
| moderation_policy | 审核策略配置（平台默认或按租户覆盖） | id、tenant_id（NULL=平台默认）、rules(jsonb)、is_active     |
| moderation_log    | 审核记录（输入/输出方向）            | id、request_id、direction(input/output)、result、created_at |

**关键约束/禁止**：

- `moderation_policy.tenant_id` 可为 NULL，表示平台默认策略；租户行覆盖默认。
- `moderation_policy.is_active` 默认 `false`：占位阶段默认不启用审核。
- `moderation_log.result` 默认 `not_checked`，用于区分"没查过" vs "查过通过"两种状态，勿混用。
- `moderation_log.direction` 仅取 `input`/`output`。
- 仅结构占位，不实现审核执行逻辑；跨 schema 引用（如 request_id）不建外键。

#### 14 admin 域：运营身份 + 平台治理（字段级见 schema 文档 §14）

平台运营控制面（`y.vxture.com`）的运营人员身份域 + 平台级治理（配置/灰度/公告/维护/风险/合规）；与客户 realm 五维硬隔离，身份安全权威在专项 `identity-platform-operator.md §6`。共 17 张（11 张 operator\_\*〔不含 P4 预留 `operator_session`〕+ 6 张治理/配置）。

| 表                             | 用途                                | 核心/锚点字段                                                                                       |
| ------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `operator_account`             | 运营账号主体（单角色）              | `role_id`→operator_role、`username`/`email?`/`phone?` U、`status`、`is_system`                      |
| `operator_credential`          | 1:1 密码凭据                        | PK `operator_id`、`password_hash`(Argon2id)、`failed_attempts`、`locked_until`                      |
| `operator_mfa`                 | 1:1 MFA 策略/TOTP                   | PK `operator_id`、`policy`、`totp_secret`(加密)、`webauthn_required`                                |
| `operator_webauthn_credential` | 1:N Passkey                         | `credential_id` U、`public_key`、`sign_count`(防克隆)、`transports[]`                               |
| `operator_recovery_code`       | 1:N 恢复码                          | `code_hash`、`used_at`                                                                              |
| `operator_verification`        | 邮箱/手机 OTP（首因子+step-up）     | `purpose`(login/step_up)、`code_hash`、`expires_at`(≤5min)、`used_at`                               |
| `operator_login_attempt`       | 风控/限流（append-only）            | `identifier`、`auth_method`、`result`、`ip_address`                                                 |
| `operator_refresh_token`       | opaque 刷新（轮换+重放检测）        | `session_id`(vx_sid_op)、`client_id='admin'`、`token_hash` U、`status`                              |
| `operator_role`                | 运营角色目录                        | `role_code` U、`is_system`、`mfa_min_level`(角色级 MFA 下限)                                        |
| `operator_permission`          | 树形权限+菜单路由                   | `parent_id`(自引用)、`perm_code` U、`route_path`/`component`                                        |
| `operator_role_permission`     | 角色↔权限关联                       | 复合 PK `(role_id, permission_id)`、硬删除                                                          |
| `operator_session`             | 会话 DB 镜像（P4 预留，可强制下线） | `session_id` U、`amr`、`status`、`expires_at`                                                       |
| `setting`                      | 全局配置 KV+加密                    | `config_key` U、`value_type`、`is_encrypted`/`is_sensitive`/`is_readonly`（平台默认 MFA 策略落此）  |
| `feature_flag`                 | 灰度百分比+逐租户覆盖               | `flag_key` U、`rollout_percentage`(0–100)、`tenant_overrides` jsonb、`expires_at`                   |
| `announcement`                 | 按 plan/tenant_type 过滤公告        | `severity`/`status`、`target_plans[]`、`target_tenant_types[]`(personal/organization)、`publish_at` |
| `maintenance`                  | 维护窗口声明                        | `status`、`affected_services[]`、`start_at`/`end_at`/`actual_end_at`                                |
| `risk_record`                  | 租户风险评估                        | `tenant_id`(逻辑引用)、`risk_level`、`reviewer_id`、`tags[]`                                        |
| `compliance_event`             | 合规事件                            | `tenant_id?`、`event_type`、`status`、`regulation_code`、`handler_id`                               |

**关键约束/禁止**：

- **隔离不变量（硬约束）**：`admin.operator_*` 对 `identity.*` 与 `iam.role|permission` **零外键**；operator 的 session/refresh/login_attempt/verification **不得**落 `identity.*`（专项 §7.2 已修复，不得回退）。
- **realm 隔离**：`oidc_client(admin).realm='workforce'`；operator token（`sub=opr_*`/`userType=operator`/`aud=admin`）与客户 token 结构性互拒。
- **审计不新建表**：运营全链路审计复用 `support.audit_logs`，以 `actor_type=operator` 逻辑隔离（按月分区、保留 ≥2 年）。
- **CHECK/唯一**：状态列 `VARCHAR+chk_`（account.status/mfa.policy/refresh.status/maint.status/risk_level/compliance.status）；setting/feature_flag/announcement 各有唯一键；`rollout_percentage` BETWEEN 0 AND 100。
- **跨 schema 逻辑引用无 FK（§2.2.4 铁律一的合法例外，逐项归类）**：`risk_record.tenant_id` / `compliance_event.tenant_id` 属**边界#3**（治理/合规记录须在租户注销后留存，建 FK 会级联删证据或 RESTRICT 挡删租户）；`compliance_event.handler_id`(operator) 属**边界#2**（realm 硬隔离）；`feature_flag.tenant_overrides` key 属**边界#4**（按值解析）。均非普通引用，故保持 loose。
- **operator_account 无客户域字段**：去 `account_type`（客户域泄漏）、补 `is_system`（预建超管不可删）；`password_hash` 全量 Argon2id。
- **治理记录已定拆两表**：采纳 `risk_record`+`compliance_event`，deploy 的通用 `governance_record` 单表重建时退役。

#### 15 support 域（工单/审计/通知）（字段级见 schema 文档 §15）

平台支持能力域：工单聚合根 + 工单事件流 + 跨域操作审计 + 多渠道通知投递流水；四表已在 deploy 字段级落地，本域按 §9 收口 CHECK/命名并补分区与不可变约束。

| 表                 | 用途                                                           | 核心/锚点字段                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket`           | 工单聚合根（可变 + 软删），承载状态/优先级/SLA 生命周期        | `id` PK、`tenant_id`（逻辑归属）、`account_id`（报单者，逻辑引用 identity.users）、`assignee_id`（坐席，逻辑引用 admin.operator_account）、`ticket_no` UNIQUE、`status`/`priority`、SLA 五时间戳、`deleted_at` |
| `ticket_comment`   | 工单流水（评论/状态变更/指派/SLA 事件统一一张表，append-only） | `id` PK、`ticket_id` FK→ticket ON DELETE CASCADE、`event_type`、`actor_type`（customer/operator/system）、`actor_name`（冗余留痕）、`payload` jsonb                                                            |
| `audit_log`        | 跨域操作审计（append-only + 按月 RANGE 分区 + 留存 ≥2 年）     | 复合 PK `(id, created_at)`、`actor_type`/`actor_id`、`tenant_id`（可空=平台级）、`action`、`result`、`resource_type`/`resource_id`、`request_id`（跨库关联键）、`before`/`after` jsonb                         |
| `notification_log` | 多渠道通知发送流水（可变，承接投递/打开回执）                  | `id` PK、`channel`、`template_code`、`status`、`recipient`、`provider_message_id`（回执回写键）、`reference_type`/`reference_id`、`retry_count`、`delivered_at`/`opened_at`                                    |

**关键约束/禁止**：

- **三类写入语义须严格区分**：`ticket_comment` 封 UPDATE（append-only 触发器 RAISE，保留 CASCADE DELETE 供父表 purge）；`audit_log` 封 UPDATE+DELETE（分区父声明、传播全分区）；`notification_log` **可变、绝不加 append-only 触发器**（否则回执/重试回写失败）。
- append-only 一律用 `BEFORE ... RAISE` 触发器，**禁用 `DO INSTEAD NOTHING` RULE**（会静默吞写，对齐 §8.4 rank 17）。
- `audit_log` 必须 **PARTITION BY RANGE(created_at)** 且分区键进 PK（`(id, created_at)`，对齐 §8.4 rank 4）；预建月分区 + DEFAULT 兜底分区（rank 16）；留存 24 个月靠 **DROP PARTITION** 过期清理，禁逐行 DELETE。
- **跨 schema 无 FK**：`account_id`/`assignee_id`/`tenant_id` 均逻辑引用（保写入轻量、actor 可注销）；仅 `ticket_comment.ticket_id` 为域内真 FK。
- 状态类列（priority/status/source/actor_type/result/channel/satisfaction_score）用 **VARCHAR + CHECK**（不用 PG ENUM）；`category`/`event_type` 为开放分类法，无 CHECK、应用层校验。
- `request_id` 为 §17 单一跨库关联键（串 reqlog ↔ metering.usage_events ↔ safety.moderation_log），跨库不建 FK。

## 12. gateway 域 —— **已取消**（runbook §0.4：采纳 database.md 双库，方案 A）

> 结论（v1.1 二次分析后拍板）：平台库**不建 `gateway` schema**。原 v1 设想的 `gateway.api_key`/`request_log` 与 database.md §4/§11 铁律"provider key/请求日志只在独立 Model Platform DB、平台库不接触 Key 明文"直接矛盾，故取消。

**相关能力归属**：

- **provider key + 请求日志** → 独立 **Model Platform DB**（`key`(AES-256) / `reqlog`，见 §11、database.md §4）；当前阶段 key 由运行环境注入、不落任何库。
- **`home_url`/`webhook_url`/`webhook_secret_ref`** → 重定位为 `product.product_webhook`（§7）。性质澄清：这是**平台自签 HMAC 验签密钥**（让产品验证"事件确来自平台"），非访问外部 AI 的 provider key，风险模型不同，可正常入平台库。
- **四段复合下游标识** `tenant+workspace+product+user` 哈希：仍成立，作为 Model Platform DB `key`/`reqlog` 设计时的应用层约束，不在本文（平台库）字段级范围。
- **`request_id` 跨库引用**：`metering.usage_events.request_id` ↔ Model Platform DB `reqlog.request_record`，跨库不建 FK，一致性靠应用层（§8/§11/§17）。

> 下方"核心冲突 / 方案 A/B/C"的决策过程记录已移除；如需回溯见 git 历史与 task `w2ak8zq1v`。

---

## 16. Varda 会话 + RAG/向量边界（新建——边界声明）

**目标**：声明边界，不在平台库建会话/向量表。

**关键内容**：Varda 会话/审计在**同实例独立 datasource**（VardaSession/Message/AuditLog，@@map 旧 Vela\*），不属 8 schema；产品侧 RAG/向量数据在**业务面**自存，平台仅经 `product_metric`/`plan_component.quota` 表达 RAG 配额，并提供**权威 `workspace_id` 隔离键**（来自平台 entitlement 体系，不接受产品端自声明，v1 §4.2a）。

---

## 17. 跨切面（新建）

**关键内容**：

- **非 Prisma DDL 清单（重建必须保留）**：`tenant_transaction` 不可变 RAISE 触发器（BEFORE UPDATE OR DELETE，禁 DO INSTEAD NOTHING RULE，§9.8/runbook §9.14）、`support.audit_logs` 按月分区、**`tenant_usage_event(_pool)` 按月分区(+预建/DEFAULT 兜底)+ append-only RAISE 触发器(禁 DO INSTEAD NOTHING RULE)**、`product.product` 的 tags/capability_keys GIN 索引（idx_product_tags_gin/idx_product_cap_gin，§7.2）、`risk_record.tags`/`compliance_event.tags` GIN（§14.4.5）、`user_no_seq` 序列、每 org 唯一 default workspace 的部分唯一索引、§7/§8 的 plan_component 锁定 / quota_pool 周期 CHECK / consume 行锁等触发器。
- **对象存储策略（runbook §18.1 已决=暂留 in-DB）**：`user_avatar`/`organization_profile.logo` 本轮**保留 in-DB bytea**（起步最小、二进制/元数据已分离）；量级上来再迁对象存储(OSS/S3)存 URL 引用——登记为未来优化，非本轮。
- **request_id 关联**：贯穿 Model Platform DB `reqlog` ↔ `metering.usage_events` ↔ `model` ↔ `safety.moderation_log` 的单一关联键（gateway 取消后，跨库不建 FK）。
- **数据访问分层**：Repository→Service→BFF 不变量（Prisma 类型不透出边界、BFF 契约稳定性 deprecation 规则）——从 `ai/05-bff-data-access-guide.md` 校订后收口至此。
  > 📦 **落地/迁移**：core-vs-deploy 决议、分域迁移策略、database.md 回写综合清单 已迁至 [落地 runbook](./data_platform_300_migration.md#6-跨切面迁移项原设计-17)。

---

> 📦 **落地/迁移**：原「18. 待决事项与业务待填」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。
