# Admin 域细化设计：运营身份 + 平台治理

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_admin_200`（细化设计层）· 待评审 · 部分在产（见 §0）
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 运营身份**权威专项**：[`identity-platform-operator.md`](./identity/090-operator.md) §6（本文不复制，只做落库归口 + 治理表字段级）。
> 取代范围：**取代** [`data_platform_200_schema.md`](./data_platform_200_schema.md) §14（operator/admin 域）字段级内容。

---

## 0. 定位、红线与在产提示

`admin` schema（原 `ops`）= 平台运营控制面（`y.vxture.com`）的**运营人员身份域**（11 张 `operator_*`）+ **平台治理**（6 张：配置/灰度/公告/维护/风险/合规）。

**⚠️ 在产 + 专项归口**：运营身份自 2026-06-18 上生产，字段级权威在**专项 §6**，本文**不复制**、只做落库归口。11 张 `operator_*` 的**复数化命名（operator_account→operator_accounts…）随专项下次协调迁移一并做**（在产表，避免单方改名与专项漂移）——本文列**现名 + 目标 plural 名**并标待办。

**红线（硬隔离不变量，边界#2 realm 隔离，不得回退）：**

- `admin.operator_*` 对**客户 realm 各 schema**（`account`/`identity`/`tenancy`/`credential`/`kyc`/`access`/`session`/`loyalty`）**零外键**（两套账号体系完全隔离；`access.roles`/`permissions` 是客户治理 RBAC，operator 有自己的 `operator_role`/`permission`）。
- 运营人员的 session/refresh/verification/login_attempt **不得**落客户 realm（`account`/`session` 等）（专项 §7.2 已修复现网泄漏，不得回退）。
- realm：`appoidc.oidc_clients(client_id=admin).realm='workforce'`；operator token(`sub=opr_*`/`userType=operator`/`aud=admin`) 与客户 token 结构性互拒。
- **审计不新建表**：运营全链路审计复用 `support.audit_logs`（`actor_type=operator`），本域不建审计表。
- **共享基础设施（允许）**：`appoidc.oidc_clients(admin)` + `appoidc.signing_keys`（RS256 JWKS 双 realm 共用），对运营账号无 FK。

---

## 1. 运营身份域（11 表，引用专项 §6，不复制字段级）

字段级权威 = **专项 §6.3**。此处只给落库目录 + 目标 plural 名 + 安全语义要点。

| 现名（在产，单数）             | 目标 plural 名                  | 职责                         | 关键语义                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operator_account`             | `operator_accounts`             | 运营账号主体（单角色）       | `role_id`→role、username/email?/phone? U、`is_system`(预建超管不可删)、去客户域 `account_type` 泄漏                                                                                                          |
| `operator_credential`          | `operator_credentials`          | 1:1 密码                     | `password_hash` **Argon2id**（OTP-only 可空）、failed_attempts、locked_until                                                                                                                                 |
| `operator_mfa`                 | `operator_mfas`                 | 1:1 MFA/TOTP                 | `totp_secret` 加密落库、`webauthn_required`、policy                                                                                                                                                          |
| `operator_webauthn_credential` | `operator_webauthn_credentials` | 1:N Passkey                  | credential_id U、public_key、sign_count(防克隆)、transports[]                                                                                                                                                |
| `operator_recovery_code`       | `operator_recovery_codes`       | 1:N 恢复码                   | code_hash、used_at                                                                                                                                                                                           |
| `operator_verification`        | `operator_verifications`        | 邮箱/手机 OTP                | purpose(login/step_up)、code_hash、expires_at(≤5min)                                                                                                                                                         |
| `operator_login_attempt`       | `operator_login_attempts`       | 风控/限流（append-only）     | identifier、result、ip_address                                                                                                                                                                               |
| `operator_refresh_token`       | `operator_refresh_tokens`       | opaque 刷新（轮换+重放检测） | session_id(vx_sid_op)、token_hash U、status                                                                                                                                                                  |
| `operator_role`                | `operator_roles`                | 运营角色目录                 | 三元 `role_code` U/`role_name`/`role_name_key`(i18n)、is_system、`mfa_min_level`、**`rank`**(层级比较；锚点列，列级锁 target-state·TD-018；值见 §4.1)。与 `access.roles` 最大化一致(见 data_identity_200 §6) |
| `operator_permission`          | `operator_permissions`          | 树形权限+菜单路由            | parent_id、三元 `perm_code` U/`perm_name`/`perm_name_key`/`description_key`(i18n `ops.perm.{code 冒号→点}.desc`)、`perm_type`/route_path/component/icon、`is_system`、category。与 `access.permissions` 同构 |
| `operator_role_permission`     | `operator_role_permissions`     | 角色↔权限                    | 复合 PK (role_id, permission_id)                                                                                                                                                                             |
| （P4 预留）`operator_session`  | `operator_sessions`             | 会话 DB 镜像（可强制下线）   | session_id U、amr、status；**不复用 identity.auth_sessions**（红线）                                                                                                                                         |

**安全语义要点（详见专项）**：MFA 策略取最严 `max(平台默认 admin.settings:operator.mfa.policy, 角色 mfa_min_level, 个人 policy)`；高权限强制 WebAuthn；短会话(idle≤30min/abs≤8h)+step-up；状态列补 `chk_`（account.status active/disabled/locked 等）。

## 2. 平台治理域（6 表，字段级，plural）

### 2.1 `settings`（全局配置 KV + 加密）

| 字段                                            | 类型         | 约束                        | 说明                                                                         |
| ----------------------------------------------- | ------------ | --------------------------- | ---------------------------------------------------------------------------- |
| `id`                                            | uuid         | PK                          |                                                                              |
| `config_group`                                  | varchar(64)  | NOT NULL                    |                                                                              |
| `config_key`                                    | varchar(128) | UNIQUE NOT NULL             |                                                                              |
| `value_type`                                    | varchar(20)  | NOT NULL DEFAULT `'string'` | string/int/bool/json                                                         |
| `config_value`                                  | text         | NOT NULL                    | `is_encrypted=true` 时存密文（信封加密，密钥进 secret manager，DB 不持明文） |
| `is_sensitive` / `is_encrypted` / `is_readonly` | boolean      | NOT NULL DEFAULT false      |                                                                              |
| `validation_rule`                               | varchar(512) | NULL                        |                                                                              |
| `description`                                   | text         | NULL                        |                                                                              |
| `description_key`                               | varchar(128) | NULL                        | i18n 键 `ops.setting.{config_key}.desc`                                      |
| `created_by` / `updated_by`                     | uuid         | NULL                        | 运营专属（边界#2）                                                           |
| `created_at` / `updated_at`                     | timestamptz  | NOT NULL DEFAULT now()      |                                                                              |

索引：`(config_group)`。平台默认 MFA 策略落此：`config_key='operator.mfa.policy'`。

### 2.2 `feature_flags`（灰度百分比 + 逐租户覆盖）

| 字段                                  | 类型         | 约束                              | 说明                                                                                                                 |
| ------------------------------------- | ------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                                  | uuid         | PK                                |                                                                                                                      |
| `flag_key`                            | varchar(128) | UNIQUE NOT NULL                   |                                                                                                                      |
| `category`                            | varchar(64)  | NOT NULL DEFAULT `'release'`      |                                                                                                                      |
| `environment`                         | varchar(32)  | NOT NULL DEFAULT `'all'`          |                                                                                                                      |
| `description`                         | varchar(512) | NULL                              |                                                                                                                      |
| `description_key`                     | varchar(128) | NULL                              | i18n 键 `ops.flag.{flag_key}.desc`                                                                                   |
| `is_globally_enabled` / `is_archived` | boolean      | NOT NULL DEFAULT false            |                                                                                                                      |
| `rollout_percentage`                  | int          | NOT NULL DEFAULT 0, CHECK(0..100) | 灰度比例                                                                                                             |
| `tenant_overrides`                    | jsonb        | NOT NULL DEFAULT `'{}'`           | `{tenant_id: true\|false}` 逐租户强开/关；key=`tenancy.tenants.id`，**边界#4 按值解析、不建 FK**；命中优先于 rollout |
| `expires_at`                          | timestamptz  | NULL                              | 临时开关自动失效                                                                                                     |
| `created_by` / `updated_by`           | uuid         | NULL                              | 运营专属                                                                                                             |
| `created_at` / `updated_at`           | timestamptz  | NOT NULL DEFAULT now()            |                                                                                                                      |

索引：`(category)`、`(environment)`。

### 2.3 `announcements`（按 plan / tenant_type 过滤）

| 字段                        | 类型                | 约束                                                        | 说明                                                          |
| --------------------------- | ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `id`                        | uuid                | PK                                                          |                                                               |
| `announcement_type`         | varchar(32)         | NOT NULL                                                    |                                                               |
| `severity`                  | varchar(16)         | NOT NULL DEFAULT `'info'`, CHECK(info/warning/critical)     |                                                               |
| `status`                    | varchar(32)         | NOT NULL DEFAULT `'draft'`, CHECK(draft/published/archived) |                                                               |
| `lang`                      | varchar(16)         | NOT NULL DEFAULT `'zh-CN'`                                  |                                                               |
| `title` / `content`         | varchar(256) / text | NOT NULL                                                    |                                                               |
| `cta_label` / `cta_url`     | varchar             | NULL                                                        |                                                               |
| `target_plans`              | varchar(64)[]       | NOT NULL DEFAULT `'{}'`                                     | 按 `product.plans.plan_code` 过滤（按值，空=全部）            |
| `target_tenant_types`       | varchar(32)[]       | NOT NULL DEFAULT `'{}'`                                     | personal/organization（对齐 `tenancy.tenants.type`，空=全部） |
| `is_dismissible`            | boolean             | NOT NULL DEFAULT true                                       |                                                               |
| `publish_at`                | timestamptz         | NOT NULL                                                    |                                                               |
| `expires_at`                | timestamptz         | NULL                                                        |                                                               |
| `meta`                      | jsonb               | NULL                                                        |                                                               |
| `created_by`                | uuid                | NOT NULL                                                    | 运营专属                                                      |
| `created_at` / `updated_at` | timestamptz         | NOT NULL DEFAULT now()                                      |                                                               |
| `deleted_at`                | timestamptz         | NULL                                                        |                                                               |

索引：`(publish_at)`、`(status)`。

### 2.4 `maintenance_windows`（维护窗口声明）

> 命名：原 `maintenance` 单数不合复数规范且是集合语义，改 `maintenance_windows`（清晰复数）。

| 字段                                 | 类型          | 约束                                                                             | 说明                   |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------- | ---------------------- |
| `id`                                 | uuid          | PK                                                                               |                        |
| `severity`                           | varchar(16)   | NOT NULL DEFAULT `'minor'`, CHECK(minor/major/critical)                          |                        |
| `status`                             | varchar(32)   | NOT NULL DEFAULT `'scheduled'`, CHECK(scheduled/in_progress/completed/cancelled) |                        |
| `title`                              | varchar(256)  | NOT NULL                                                                         |                        |
| `description` / `impact_description` | text          | NULL                                                                             |                        |
| `affected_services`                  | varchar(64)[] | NOT NULL DEFAULT `'{}'`                                                          |                        |
| `start_at` / `end_at`                | timestamptz   | NOT NULL                                                                         |                        |
| `actual_end_at`                      | timestamptz   | NULL                                                                             | 实际结束（与计划对账） |
| `created_by`                         | uuid          | NOT NULL                                                                         | 运营专属               |
| `updated_by`                         | uuid          | NULL                                                                             |                        |
| `created_at` / `updated_at`          | timestamptz   | NOT NULL DEFAULT now()                                                           |                        |

索引：`(start_at)`、`(status)`。

### 2.5 `risk_records`（租户风险评估）

| 字段                         | 类型         | 约束                                                      | 说明                                                                                    |
| ---------------------------- | ------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                         | uuid         | PK                                                        |                                                                                         |
| `tenant_id`                  | uuid         | NOT NULL                                                  | 评估对象；**逻辑引用** `tenancy.tenants`（**边界#3**：治理记录须活过租户注销，不建 FK） |
| `risk_level`                 | varchar(32)  | NOT NULL DEFAULT `'normal'`, CHECK(normal/follow_up/high) |                                                                                         |
| `risk_score`                 | int          | NULL                                                      |                                                                                         |
| `scope`                      | varchar(160) | NULL                                                      |                                                                                         |
| `reason`                     | text         | NOT NULL DEFAULT `''`                                     |                                                                                         |
| `reviewer_id`                | uuid         | NULL, FK→`operator_accounts.id`                           | 运营复核人（admin 域内真 FK，同 schema）                                                |
| `tags`                       | text[]       | NOT NULL DEFAULT `'{}'`                                   | GIN                                                                                     |
| `source_table` / `source_id` | varchar(128) | NULL                                                      | 触发来源回溯                                                                            |
| `created_at` / `updated_at`  | timestamptz  | NOT NULL DEFAULT now()                                    |                                                                                         |
| `deleted_at`                 | timestamptz  | NULL                                                      |                                                                                         |

索引：`(tenant_id, risk_level)`、GIN `tags`。

### 2.6 `compliance_events`（合规事件）

| 字段                        | 类型        | 约束                                                                | 说明                                                                  |
| --------------------------- | ----------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`                        | uuid        | PK                                                                  |                                                                       |
| `tenant_id`                 | uuid        | NULL                                                                | 关联租户（可空=平台级）；**逻辑引用**（**边界#3** 合规留存），不建 FK |
| `event_type`                | varchar(64) | NOT NULL                                                            | kyc/审查/处置…（枚举待业务）                                          |
| `status`                    | varchar(32) | NOT NULL DEFAULT `'open'`, CHECK(open/in_review/resolved/dismissed) |                                                                       |
| `regulation_code`           | varchar(64) | NULL                                                                | 对应法规/条款                                                         |
| `evidence_url`              | text        | NULL                                                                | 证据材料（对象存储 URL）                                              |
| `handler_id`                | uuid        | NULL, FK→`operator_accounts.id`                                     | 处置运营（admin 域内真 FK，同 schema）                                |
| `detail`                    | jsonb       | NULL                                                                |                                                                       |
| `tags`                      | text[]      | NOT NULL DEFAULT `'{}'`                                             | GIN                                                                   |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()                                              |                                                                       |
| `deleted_at`                | timestamptz | NULL                                                                |                                                                       |

索引：`(tenant_id, status)`、GIN `tags`。

> **治理记录拆两表**（risk_records + compliance_events），弃 deploy 通用 `governance_record` 单表。

## 3. FK / 边界速查表

| 从                                                                                              | 到                                                                                  | 类型              | 依据                                                                                   |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `operator_role_permissions.(role_id/permission_id)`、`operator_credentials/mfas/...operator_id` | `operator_*`（域内）                                                                | 真 FK             | admin 域内运营身份                                                                     |
| **`admin.operator_*`**                                                                          | 客户 realm 各 schema（`account`/`identity`/`tenancy`/`access.roles\|permissions`…） | **零 FK**         | **边界#2 红线**（realm 硬隔离，不得回退）                                              |
| `risk_records.tenant_id`、`compliance_events.tenant_id`                                         | `tenancy.tenants`                                                                   | **裸值**，不建 FK | **边界#3**（治理/合规记录须活过租户注销）                                              |
| `feature_flags.tenant_overrides` key、`announcements.target_*`                                  | `tenancy.tenants`/`product.plans`                                                   | **裸值**，不建 FK | **边界#4**（jsonb/数组按值解析）                                                       |
| `risk_records.reviewer_id`、`compliance_events.handler_id`、治理表 `created_by/updated_by`      | `operator_accounts.id`                                                              | 真 FK             | **admin 域内**（同 schema）普通引用，operator 主体；≠ 跨 schema/跨 realm（那才 loose） |

## 4. 初始化数据（RBAC seed · 运营 realm）

> 权威：本节 = 运营 realm（`admin.operator_*`）预置角色 / 权限 / 映射 / 系统账号的**初始化数据设计**。落库脚本 = `deploy/database/seed/seed-catalog.mjs`（幂等）。客户 realm（`access.*`）的角色/权限见 [`data_identity_200_schema.md`](./data_identity_200_schema.md) §6；两 realm 命名空间**互不统一**（边界#2 硬隔离）。

### 4.0 载体与幂等（双机制）

- **载体**：`seed-catalog.mjs`（ESM），非 DDL——预置角色/权限属"上线前可自由重建"（[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) 铁律·在产迁移相位）、`is_system` 守护不可删。
- **幂等双机制**（见 `data_platform_100` §「seed/init 约定」）：
  - **① 唯一自然键 + `on conflict (key) do nothing`** = 普适幂等保证。`operator_permission(perm_code)`、`operator_role(role_code)` 均走此路；permission 用 `gen_random_uuid()` + `on conflict (perm_code)`，**不手钉 UUID**（照 `access.permissions` 现有模式，映射时 `select id, perm_code` 回查）。
  - **② 哨兵 well-known UUID** = 仅用于被其他 seed 行**以常量引用**的锚点行（`operator_role`、两个 `operator_account`），使 `operator_account.role_id`、`superadmin.created_by`、`operator_role_permission` 映射可直接写死引用。哨兵约定与安全论证见 `data_platform_100` §「seed/init 约定」。

### 4.1 七预置角色 + rank

`operator_role` 增 `rank int NOT NULL DEFAULT 0` 列（DDL 见 `ddl/80_admin.sql`；锚点列——命名层不入可写字段集，列级物理锁为 target-state·TD-018，见铁律八）。**rank 仅作跨 operator 操作的层级比较依据**，管理能力由 `operator:account.manage` 权限决定（只 `super_admin` 持有）；二者独立。

| role_code     | rank | is_system | mfa_min_level | 定位                                                                                     |
| ------------- | ---- | --------- | ------------- | ---------------------------------------------------------------------------------------- |
| `sys_config`  | 999  | ✔         | optional      | 平台自治配置元角色（seed actor 归属，`systemadmin` 专属、disabled 永不登录）；**零权限** |
| `super_admin` | 100  | ✔         | required      | 唯一持 `operator:*` + `security:*` 危权；唯一能管 operator 账号/角色                     |
| `admin`       | 80   | ✔         | required      | 全业务域管理，**不含** operator 管理与安全密钥                                           |
| `operation`   | 60   | ✔         | required      | 租户/套餐/内容/增长侧                                                                    |
| `finance`     | 60   | ✔         | required      | 订阅/订单/退款/发票/收入报表                                                             |
| `tech_ops`    | 50   | ✔         | required      | 模型供给/发布/维护窗口/系统设置（显示名 SRE）                                            |
| `support`     | 30   | ✔         | optional      | 工单/租户查询(脱敏)/通知                                                                 |
| `auditor`     | 10   | ✔         | required      | 全域只读 + 审计日志，零写                                                                |

> rank 留间距（10/30/50/60/80/100）便于将来插角色。
>
> **`sys_config` rank 2026-07-05 由 0 改 999（owner 质询触发，代码级双向推导后定案）**：
>
> - **原判不成立**：原注"rank 不参与业务门控，仅作 seed actor 归属"与代码事实矛盾——systemadmin 账号存在于名册，门控必然消费其角色 rank（`platform-admins.router.ts` 双侧严格大于门 :148-197、编辑他人 :374、canManage :569），且**账号层无任何 is_system 守卫**（角色本体的 is_system 守卫只放行 sort，护角色行不护账号），rank 是该账号唯一门控层。
> - **rank=0 的真实暴露（内部人链，可走通）**：super_admin(100)>0 → 可改 systemadmin 角色/编辑启用账号/设凭据——三步把"永不登录的审计元锚点"复活为可登录高权账号，`created_by=systemadmin` 的全部 seed 溯源被污染；新角色侧 100>0 → 可把 sys_config 分配给任意账号，制造冒充 seed actor 的身份。
> - **rank=999 逐门控**：改角色/编辑账号 100≤999 全员拒 ✔；分配 sys_config 100≤999 拒（溯源唯一性锁死）✔；canManage 全员 false（从可管名单消失）✔；复活链逐环断死（给角色加权限→is_system 守卫仅 sort ✔；启用账号→rank 门拒 ✔——解锁互为前置，循环依赖不可解）。
> - **副作用核查**：持有者权力——若 systemadmin 能行动则 999 可管全员，但 disabled+无凭据+零权限三锁，且解任一锁先过被 999 挡死的账号编辑门 ✔；UI/排序无数值假设 ✔；未来插角色仍在 999 之下 ✔。
> - **机制**：seed 对 rank 做 `on conflict do update`（锚点列 owner-only，seed 即其 SoT，防漂移自愈）。`super_admin(100)` 之间互操作、`admin(80)` 同级操作的门控（严格大于）属**应用层 rank 门控**（bucket 3 / TD-017 整改），非本 seed 范围。

### 4.2 perm_code 目录（三段式 `{domain}:{resource}.{action}`）

粒度约定：每资源暴露 `.read` 与 `.manage`，**`.manage` 语义上⊇ `.read`**；高危动作（危）单列独立 perm_code，强制 step-up（应用层 `@RequireStepUp`）。`domain` 段对齐 schema 边界（`commerce` 域映射 `metering`/`billing`；`release` 域映射 `admin` 治理表；`security` 域映射 `appoidc`）。

| perm_code                                                                        | 危  | 说明                                                                                         |
| -------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------- |
| `tenant:profile.read` / `.manage`                                                |     | 租户档案（tenancy）                                                                          |
| `tenant:verification.review`                                                     |     | 租户认证审核（回写 kyc 快照）                                                                |
| `tenant:quota.manage`                                                            |     | 配额调整（metering）                                                                         |
| `tenant:lifecycle.suspend`                                                       | 危  | 封停/关闭租户                                                                                |
| `tenant:risk.read` / `.manage`                                                   |     | 租户风险评估（admin.risk_records，TD-021）                                                   |
| `user:profile.read`                                                              |     | 用户查询（脱敏）                                                                             |
| `user:pii.read`                                                                  | 危  | 明文 PII                                                                                     |
| `user:account.manage`                                                            |     | C 端账号处置（停用/恢复/强制下线；全禁用 status='disabled'，可逆故无 step-up）               |
| `commerce:subscription.read` / `.manage`                                         |     | 订阅只读 / 订阅动作（续订/暂停/恢复/取消，routine）                                          |
| `commerce:order.read`                                                            |     | 订单只读合成视图（无独立 order 表，写归 payment.settle）                                     |
| `commerce:billing.read` / `.manage`                                              |     | 账单只读 / 账单动作（作废[限未收未开票]/逾期/调整/补开，routine）                            |
| `commerce:billing.discount`                                                      | 危  | 账单减免应收（TD-027，单独端点 + step-up）                                                   |
| `commerce:invoice.read` / `.manage`                                              |     | 发票只读 / 发票动作（线下登记/寄送/完成，routine）                                           |
| `commerce:invoice.void`                                                          | 危  | 发票红冲（作废已出账发票，法定不可逆，TD-027，单独端点 + step-up）                           |
| `commerce:payment.read` / `.manage`                                              |     | 支付只读 / 支付驳回（routine，不动钱）                                                       |
| `commerce:payment.settle`                                                        | 危  | 支付核销 / 线下收款确认（确认收款写流水，TD-027，单独端点 + step-up）                        |
| `commerce:refund.execute`                                                        | 危  | 退款                                                                                         |
| `product:plan.read` / `.manage` · `product:price.read` / `.manage`               |     | 套餐与定价                                                                                   |
| `model:provider.read` / `.manage` · `model:model.read` / `.manage`               |     | 模型供给                                                                                     |
| `release:feature_flag.read` / `.manage` · `release:maintenance.read` / `.manage` |     | 灰度/维护窗口                                                                                |
| `platform:setting.read` / `.manage`                                              |     | 平台运行时配置（admin.settings；sensitive/encrypted 值脱敏读，敏感/加密/只读行不经本码编辑） |
| `content:announcement.read` / `.manage`                                          |     | 公告                                                                                         |
| `notification:log.read`                                                          |     | 通知投递台账（support.notification_logs，只读）                                              |
| `support:ticket.read` / `.manage`                                                |     | 工单                                                                                         |
| `support:impersonate`                                                            | 危  | 代客操作                                                                                     |
| `compliance:event.read` / `.manage`                                              |     | 合规事件（admin.compliance_events，TD-021；tenant_id 可空=平台级故自成 domain）              |
| `security:signing_key.manage` · `security:oidc_client.manage`                    | 危  | 签名密钥 / OIDC client                                                                       |
| `operator:account.manage` · `operator:role.manage`                               | 危  | 运营账号 / 角色管理                                                                          |
| `audit:read`                                                                     |     | 中央审计日志（support.audit_logs）                                                           |

### 4.3 role → permission 映射（✔=授 `.manage`，R=授 `.read`，危独列）

| perm_code                                    | super_admin | admin | operation | finance | tech_ops | support | auditor |
| -------------------------------------------- | ----------- | ----- | --------- | ------- | -------- | ------- | ------- |
| `tenant:profile`                             | ✔           | ✔     | ✔         | R       | R        | R       | R       |
| `tenant:verification.review`                 | ✔           | ✔     | ✔         | —       | —        | —       | R       |
| `tenant:lifecycle.suspend` 危                | ✔           | ✔     | —         | —       | —        | —       | —       |
| `tenant:quota.manage`                        | ✔           | ✔     | ✔         | R       | R        | —       | R       |
| `tenant:risk`                                | ✔           | ✔     | ✔         | —       | —        | —       | R       |
| `compliance:event`                           | ✔           | ✔     | —         | —       | —        | —       | R       |
| `user:profile.read`                          | ✔           | ✔     | ✔         | R       | —        | ✔       | R       |
| `user:pii.read` 危                           | ✔           | ✔     | —         | —       | —        | —       | —       |
| `user:account.manage`                        | ✔           | ✔     | —         | —       | —        | —       | —       |
| `commerce:subscription`                      | ✔           | ✔     | R         | ✔       | —        | R       | R       |
| `commerce:order.read`                        | ✔           | ✔     | R         | ✔       | —        | R       | R       |
| `commerce:billing`                           | ✔           | ✔     | —         | ✔       | —        | —       | R       |
| `commerce:billing.discount` 危               | ✔           | ✔     | —         | ✔       | —        | —       | —       |
| `commerce:invoice`                           | ✔           | ✔     | —         | ✔       | —        | —       | R       |
| `commerce:invoice.void` 危                   | ✔           | ✔     | —         | ✔       | —        | —       | —       |
| `commerce:payment`                           | ✔           | ✔     | —         | ✔       | —        | —       | R       |
| `commerce:payment.settle` 危                 | ✔           | ✔     | —         | ✔       | —        | —       | —       |
| `commerce:refund.execute` 危                 | ✔           | ✔     | —         | ✔       | —        | —       | —       |
| `product:plan/price`                         | ✔           | ✔     | ✔         | R       | —        | —       | R       |
| `model:provider/model`                       | ✔           | ✔     | R         | —       | ✔        | —       | R       |
| `release:feature_flag/maintenance`           | ✔           | ✔     | R         | —       | ✔        | —       | R       |
| `platform:setting`                           | ✔           | R     | —         | —       | ✔        | —       | R       |
| `content:announcement`                       | ✔           | ✔     | ✔         | —       | R        | —       | R       |
| `notification:log.read`                      | ✔           | R     | —         | —       | R        | R       | R       |
| `support:ticket`                             | ✔           | ✔     | R         | —       | —        | ✔       | R       |
| `support:impersonate` 危                     | ✔           | ✔     | —         | —       | —        | —       | —       |
| `security:signing_key/oidc_client.manage` 危 | ✔           | —     | —         | —       | —        | —       | —       |
| `operator:account/role.manage` 危            | ✔           | —     | —         | —       | —        | —       | —       |
| `audit:read`                                 | ✔           | ✔     | —         | —       | —        | —       | ✔       |

> 两个关键不变量（比 prompt 稿更严，以本矩阵为准）：
>
> 1. **`operator:*` 与 `security:*` 危权只给 `super_admin`**——这是应用层 rank 门控"第一层权限门控"的数据基础（`admin` 都拿不到 operator 管理权）。
> 2. **`admin` 不能管 operator**——`assertCanManagePlatformAdmins` 的能力串（现 `platform.admin.manage`）迁移为 `operator:account.manage` 后，只 `super_admin` 命中（bucket 3 应用端迁移）。

### 4.4 super_admin 显式全授（解 bootstrap 自锁）

现网鉴权 = 纯 DB JOIN（`operator_account→role→role_permission→permission`），**无 super_admin 硬编码旁路**。故 seed 必须**把全部 `operator_permission` 显式映射给 `super_admin`**，否则干净重建后 `superadmin` 登录 capabilities=`[]` → 自锁 403。

- 落法：`super_admin` 映射 = 全 perm 集合（含 4.3 所有 ✔/R/危 行的 `.manage`+`.read`+危 perm）。
- 兜底：**seed 运行时自检断言** `count(super_admin 映射) == count(operator_permission 全集)`，新增 perm 漏配即 seed 失败（检测器规格见 §5·检测器，与 `data_platform_100` 检测器补齐一致）。

### 4.5 两个系统账号（哨兵锚点）

| username      | UUID(哨兵)       | role          | status     | 用途                                         | 凭据                                                                                                                                                                                                                          |
| ------------- | ---------------- | ------------- | ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemadmin` | `…-000000000010` | `sys_config`  | `disabled` | 初始化数据 `created_by` 元锚点，**永不登录** | 无                                                                                                                                                                                                                            |
| `superadmin`  | `…-000000000011` | `super_admin` | `active`   | 真正第一个超管，由 `systemadmin` 创建        | Argon2id(默认口令，`force_password_change=true`)，可经 `OPERATOR_SUPERADMIN_PASSWORD_HASH` 覆盖；**生产 seed 必须覆盖**——默认口令已随公开仓公开，23/29 seed 脚本在 `NODE_ENV=production` 且未覆盖时 fail-closed（2026-07-21） |

- `sys_config` = 平台自治配置元角色（rank=999，见 §4.1；仅作 seed actor 归属）；分配它 + `disabled` 使该身份**可审计追溯又杜绝登录利用**。
- **展示可见性（2026-07-06，§3.2.6 双列）**：`admin.operator_role`/`operator_permission`/`operator_account` 三表统一加 `is_customer_visible`（铁律七恒 false）+ `is_workforce_visible`；**`sys_config` 角色与 `systemadmin` 账号置 `is_workforce_visible=false`**——存在且被 `created_by` 引用，但不进运营名册/角色下拉（运行时 `where is_workforce_visible`）。`superadmin`/`super_admin` 等真实运营身份保持可见。`is_system`（禁改删保护）与可见性是独立轴。
- 凭据 `on conflict (operator_id) do nothing`——重跑不重置已改口令。
- 平台默认 MFA 策略 → `admin.settings(config_key='operator.mfa.policy')`。
- 哨兵 UUID 可预测**不构成安全问题**（id 是标识符非密钥、认证靠 credential+MFA、内部 id 不外泄）——完整论证见 `data_platform_100` §「seed/init 约定」。

### 4.6 与 rank 门控 / TD-017 的衔接

本 seed 是 **rank 分级模型 + TD-017（平台管理员权限"平顶"P0）整改的数据前置**。数据层交付到位后，应用层还需（**bucket 3，非本轮数据层**）：跨 operator 操作三层门控（权限→rank 严格大于→末位 super_admin 存活保护）、重置链接**带外投递**（不回传发起方）、能力串 `platform.admin.manage`→`operator:account.manage` 迁移、前端 `canManage`/角色下拉过滤。见 [`tech-debt.md`](../60-operations/10-tech-debt.md) TD-017。

## 5. 待办 / 开放项

- **operator\_\* 复数化**：随专项下次协调迁移一并做（在产表，不单方改名）。
- **在产迁移纪律**：identity/iam/admin 在产，改动走保数据迁移（加列带默认/就地 UPDATE/补 CHECK），不 reseed；治理记录拆表为空域可重建。**注**：本轮 rank 列 + RBAC seed 属开发阶段全重建（无数据债），不走在产就地迁移。
- `compliance_events.event_type` 等子域枚举待业务补。
