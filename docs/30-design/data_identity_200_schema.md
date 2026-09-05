# Identity 域细化设计：9-Schema 字段级 DDL（v1 草案）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_identity_200`（细化设计层，见 [`data_platform_100_architecture.md` §2.2.4](./data_platform_100_architecture.md#224-架构级-sot-与解耦铁律2026-07-修订)）· 待评审 · 未实施（开发阶段，铁律三适用：可重灌不受在产迁移纪律约束）
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md)（§2.2.4 八条铁律：①跨 schema FK 政策 ②UUID/可视码分离 ③阶段开关 ④完整优先建库先行 ⑤计费周期锚定订阅 ⑥付费模式 ⑦运营/客户 realm 绝对隔离 ⑧标识符三层命名纪律+锚点列不可变）
> 取代范围：本文**取代** [`data_platform_200_schema.md`](./data_platform_200_schema.md) §4（identity 域）+ §5（iam 域）+ §6.3.2（`verification_policy`，2026-07-04 归属修正移入本文 §4.3）字段级内容；旧文对应章节待下一次该文档改版时标记 superseded，当前以本文为准。
> 命名规范：schema 单数、table 复数、column 单数（见 §2.2.3 命名规范）；本文表名已按此复数化，与旧库现状（部分单数表名）不同，是**目标态**，落地由 3\*\* 实施文档另定迁移步骤。

---

## 0. 设计原则回顾（本文的落地依据）

1. **主体 vs 属性**：`account.users` / `tenancy.tenants` 是瘦主体，只放骨架；会增长的信息挂独立属性表。加能力 = 加属性表，主体表不动。
2. **全局 vs 租户相关**：`account.users` 全局唯一；随租户变化的信息（职务、默认空间）挂 `tenancy.tenant_memberships`，永不上 users。
3. **活属性 / 可复用簿 / 不可变快照**：同类信息（如地址）按用途三层存，互不覆盖（§7）。
4. **跨 schema FK 一律真建**（铁律一）：平台库内部默认建 FK；裸 UUID 仅限四类边界——物理库界 / realm 安全隔离 / 审计可注销 actor / code 目录引用。本文逐表标注属于哪一类。
5. **UUID 内部键 / 外部可视码分离**（铁律二）：`id uuid` 是唯一关联键，不可变、不外露；可视码（`user_no`/`tenant_no`）人友好、可改、永不做 FK。
6. **数据模型完整优先**（铁律四）：MFA / KYC / 成员职务等表**现在建全字段**，业务不接线、UI 不实现。

---

## 1. schema `account`（本地账号：你是谁）

### 1.1 `users`

| 字段                        | 类型         | 约束                                          | 说明                                                                                     |
| --------------------------- | ------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                        | uuid         | PK, default `gen_random_uuid()`               | 唯一关联键                                                                               |
| `user_no`                   | bigint       | UNIQUE, default 主体号seq×1000+3位随机(12 位) | 可视码，见 §11                                                                           |
| `account`                   | varchar(64)  | UNIQUE NOT NULL                               | 登录句柄，可改限频，非关联键                                                             |
| `email`                     | varchar(128) | UNIQUE NULL                                   | 可空                                                                                     |
| `email_verified_at`         | timestamptz  | NULL                                          |                                                                                          |
| `phone`                     | varchar(32)  | UNIQUE NOT NULL                               | 强锚点                                                                                   |
| `phone_verified_at`         | timestamptz  | NOT NULL                                      |                                                                                          |
| `account_changed_at`        | timestamptz  | NULL                                          | 限频判据                                                                                 |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK            | active/disabled/pending/deleting(自助删除保留期,050-account §7)                          |
| `level_no`                  | int          | NOT NULL DEFAULT 1, CHECK `>=1`               | 反规范化只读列，SoT 在 `loyalty.level_policies`（§9.1）                                  |
| `source`                    | varchar(32)  | NULL                                          | 注册来源：web/invite/oidc，不可变事实                                                    |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                        |                                                                                          |
| `deleted_at`                | timestamptz  | NULL                                          | 软删                                                                                     |
| `deletion_requested_at`     | timestamptz  | NULL                                          | 自助删除申请时刻;status=`deleting` 起 30 天保留期,到期清扫(2026-09-04 加,050-account §7) |

索引：`idx_users_user_no`、`idx_users_email`、`idx_users_phone`、`idx_users_status`、`idx_users_deleted_at`、`idx_users_deletion_requested_at`（部分索引，仅非空行）。

### 1.2 `user_profiles`

| 字段                        | 类型         | 约束                                         | 说明                                               |
| --------------------------- | ------------ | -------------------------------------------- | -------------------------------------------------- |
| `user_id`                   | uuid         | PK, FK→`users.id` ON DELETE CASCADE          |                                                    |
| `display_name`              | varchar(96)  | NULL                                         |                                                    |
| `avatar_url`                | varchar(512) | NULL                                         |                                                    |
| `avatar_hash`               | varchar(64)  | NULL                                         | 与 `user_avatars.hash` 冗余同步，供 claim 轻读     |
| `gender`                    | varchar(16)  | NULL                                         |                                                    |
| `birthday`                  | date         | NULL                                         |                                                    |
| `bio`                       | varchar(512) | NULL                                         |                                                    |
| `language`                  | varchar(16)  | NULL                                         |                                                    |
| `timezone`                  | varchar(64)  | NULL                                         |                                                    |
| `theme`                     | varchar(16)  | DEFAULT `'system'`, CHECK(light/dark/system) |                                                    |
| `preferences`               | jsonb        | NULL                                         | 通知开关等细粒度偏好                               |
| `extra`                     | jsonb        | NULL                                         | 压力阀：备用联系人/个人地址/社交账号展示等低频字段 |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                       |                                                    |

### 1.3 `user_avatars`

| 字段           | 类型        | 约束                                | 说明                                           |
| -------------- | ----------- | ----------------------------------- | ---------------------------------------------- |
| `user_id`      | uuid        | PK, FK→`users.id` ON DELETE CASCADE |                                                |
| `data`         | bytea       | NOT NULL                            | 起步阶段 in-DB（§17 既有决议），量级上来迁 OSS |
| `content_type` | varchar(32) | NOT NULL                            |                                                |
| `hash`         | varchar(64) | NOT NULL                            | sha256                                         |
| `source`       | varchar(16) | NOT NULL                            | upload/import                                  |
| `updated_at`   | timestamptz | NOT NULL DEFAULT now()              |                                                |

---

## 2. schema `identity`（联邦身份：外部如何识别你）

> ⚠️ 命名纪律：本 schema = **联邦身份**层（绑定 + 上游配置 + 握手），**不是**本地账号主记录。人的主记录在 `account.users`（对齐 Keycloak `IDENTITY_PROVIDER`/`FEDERATED_IDENTITY` vs `USER_ENTITY` 的划分）。

### 2.1 `identities`（联邦绑定）

| 字段                        | 类型         | 约束                                    | 说明                          |
| --------------------------- | ------------ | --------------------------------------- | ----------------------------- |
| `id`                        | uuid         | PK                                      |                               |
| `user_id`                   | uuid         | FK→`account.users.id` ON DELETE CASCADE |                               |
| `provider`                  | varchar(32)  | NOT NULL                                | feishu/dingtalk/google/wechat |
| `provider_subject`          | varchar(255) | NOT NULL                                |                               |
| `metadata`                  | jsonb        | NULL                                    |                               |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                  |                               |

约束：`UNIQUE(provider, provider_subject)`、`UNIQUE(user_id, provider)`。不按 email 自动并号（合并以手机为锚点，见 [[project_social_identity_consolidation]]）。

### 2.2 `oauth_providers`（入站 broker 配置）

| 字段                                                           | 类型         | 约束                   | 说明                                                                                                             |
| -------------------------------------------------------------- | ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --- |
| `id`                                                           | uuid         | PK                     |                                                                                                                  |
| `code`                                                         | varchar(64)  | UNIQUE NOT NULL        |                                                                                                                  |
| `name`                                                         | varchar(64)  | NOT NULL               |                                                                                                                  |
| `name_key`                                                     | varchar(128) | NULL                   | i18n 键 `identity.provider.{code}`（§3.2.5 键规范，data_platform_100）                                           |     |
| `client_id` / `client_secret`                                  | varchar(255) | NULL                   |                                                                                                                  |
| `scope`                                                        | varchar(512) | NULL                   |                                                                                                                  |
| `auth_url` / `token_url` / `account_info_url` / `redirect_uri` | varchar(512) | NULL                   |                                                                                                                  |
| `field_mapping`                                                | jsonb        | NULL                   | **新增**（行业缺口补齐，对齐 Keycloak Identity Provider Mapper）：上游 claim → 本地 `user_profiles` 字段映射配置 |
| `is_enabled`                                                   | boolean      | NOT NULL DEFAULT true  |                                                                                                                  |
| `is_customer_visible` / `is_workforce_visible`                 | boolean      | NOT NULL DEFAULT true  | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活）                                                 |
| `sort`                                                         | int          | NOT NULL DEFAULT 999   |                                                                                                                  |
| `created_at` / `updated_at`                                    | timestamptz  | NOT NULL DEFAULT now() |                                                                                                                  |

### 2.3 `oauth_states`（握手态，append-only）

| 字段            | 类型         | 约束                   | 说明 |
| --------------- | ------------ | ---------------------- | ---- |
| `id`            | uuid         | PK                     |      |
| `provider_code` | varchar(64)  | NOT NULL               |      |
| `state`         | varchar(128) | UNIQUE NOT NULL        |      |
| `redirect_uri`  | varchar(512) | NOT NULL               |      |
| `code_verifier` | varchar(128) | NULL                   | PKCE |
| `nonce`         | varchar(128) | NULL                   |      |
| `ip_address`    | varchar(64)  | NULL                   |      |
| `expires_at`    | timestamptz  | NOT NULL               |      |
| `created_at`    | timestamptz  | NOT NULL DEFAULT now() |      |

---

## 3. schema `credential`（本地凭据：密码 / 多因素）

### 3.1 `user_credentials`

| 字段                        | 类型         | 约束                                        | 说明                               |
| --------------------------- | ------------ | ------------------------------------------- | ---------------------------------- |
| `user_id`                   | uuid         | PK, FK→`account.users.id` ON DELETE CASCADE |                                    |
| `password_hash`             | varchar(255) | NULL                                        | Argon2id；phone-code-only 用户可空 |
| `password_changed_at`       | timestamptz  | NULL                                        |                                    |
| `force_password_change`     | boolean      | NOT NULL DEFAULT false                      |                                    |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                      |                                    |

### 3.2 `user_mfas`（预留，铁律四：建全不接线）

| 字段                        | 类型         | 约束                                                   | 说明     |
| --------------------------- | ------------ | ------------------------------------------------------ | -------- |
| `user_id`                   | uuid         | PK, FK→`account.users.id` ON DELETE CASCADE            |          |
| `policy`                    | varchar(32)  | NOT NULL DEFAULT `'off'`, CHECK(off/optional/required) |          |
| `totp_secret`               | varchar(255) | NULL                                                   | 加密存储 |
| `totp_enabled`              | boolean      | NOT NULL DEFAULT false                                 |          |
| `webauthn_required`         | boolean      | NOT NULL DEFAULT false                                 |          |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                 |          |

### 3.3 `user_webauthn_credentials`（预留）

| 字段            | 类型         | 约束                                    | 说明   |
| --------------- | ------------ | --------------------------------------- | ------ |
| `id`            | uuid         | PK                                      |        |
| `user_id`       | uuid         | FK→`account.users.id` ON DELETE CASCADE |        |
| `credential_id` | varchar(255) | UNIQUE NOT NULL                         |        |
| `public_key`    | text         | NOT NULL                                |        |
| `sign_count`    | bigint       | NOT NULL DEFAULT 0                      | 防克隆 |
| `transports`    | text[]       | NULL                                    |        |
| `device_name`   | varchar(96)  | NULL                                    |        |
| `created_at`    | timestamptz  | NOT NULL DEFAULT now()                  |        |
| `last_used_at`  | timestamptz  | NULL                                    |        |

### 3.4 `user_recovery_codes`（预留）

| 字段         | 类型        | 约束                                    | 说明 |
| ------------ | ----------- | --------------------------------------- | ---- |
| `id`         | uuid        | PK                                      |      |
| `user_id`    | uuid        | FK→`account.users.id` ON DELETE CASCADE |      |
| `code_hash`  | varchar(64) | NOT NULL                                |      |
| `used_at`    | timestamptz | NULL                                    |      |
| `created_at` | timestamptz | NOT NULL DEFAULT now()                  |      |

---

## 4. schema `kyc`（实名，敏感隔离）

### 4.1 `user_kycs`（预留，铁律四）

| 字段                        | 类型         | 约束                                                                         | 说明                                                             |
| --------------------------- | ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `user_id`                   | uuid         | PK, FK→`account.users.id` ON DELETE CASCADE                                  |                                                                  |
| `real_name`                 | varchar(64)  | NULL                                                                         |                                                                  |
| `id_type`                   | varchar(32)  | NULL, CHECK(id_card/passport/...)                                            |                                                                  |
| `id_no_encrypted`           | bytea        | NULL                                                                         | 加密存储，非明文                                                 |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'unverified'`, CHECK(unverified/pending/verified/rejected) |                                                                  |
| `verified_at`               | timestamptz  | NULL                                                                         |                                                                  |
| `reviewer_id`               | uuid         | NULL                                                                         | 逻辑引用 `admin.operator_accounts`（边界#2 realm 隔离，不建 FK） |
| `reject_reason`             | varchar(255) | NULL                                                                         |                                                                  |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                                       |                                                                  |

### 4.2 `tenant_verifications`（组织实名明细，预留）

| 字段                         | 类型         | 约束                                                  | 说明                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                         | uuid         | PK                                                    |                                                                                                                                                                                                                                                              |
| `tenant_id`                  | uuid         | FK→`tenancy.tenants.id` ON DELETE CASCADE             |                                                                                                                                                                                                                                                              |
| `verification_type`          | varchar(32)  | NOT NULL, CHECK(individual/enterprise)                | **主体轴**：证的是谁                                                                                                                                                                                                                                         |
| `verification_method`        | varchar(32)  | NOT NULL DEFAULT `'lite'`, CHECK(lite/face/documents) | **方式轴**（2026-09-06，与主体轴正交）：怎么证的。`lite` 简易企业实名（企业名称 + 统一社会信用代码 + 法定代表人姓名，可订阅**不可开票**）/ `face` 法人扫脸 / `documents` 提交资料（后两者可开票，开发中）。能力判定收在 console-bff `lib/verification-level` |
| `company_name`               | varchar(128) | NULL                                                  | 申报的企业名称；通过后即租户认证名（改名作废原认证）。迁移前的历史行按 `pending`/`verified` 从 `tenancy.tenants.name` 回填，其余留空                                                                                                                         |
| `business_license_no`        | varchar(64)  | NULL                                                  |                                                                                                                                                                                                                                                              |
| `business_license_image_ref` | varchar(255) | NULL                                                  | 对象存储引用                                                                                                                                                                                                                                                 |
| `legal_person_name`          | varchar(64)  | NULL                                                  |                                                                                                                                                                                                                                                              |
| `status`                     | varchar(32)  | NOT NULL DEFAULT `'unverified'`, CHECK                |                                                                                                                                                                                                                                                              |
| `reviewer_id`                | uuid         | NULL                                                  | 逻辑引用（同上，边界#2）                                                                                                                                                                                                                                     |
| `reviewed_at`                | timestamptz  | NULL                                                  |                                                                                                                                                                                                                                                              |
| `reject_reason`              | varchar(255) | NULL                                                  |                                                                                                                                                                                                                                                              |
| `created_at` / `updated_at`  | timestamptz  | NOT NULL DEFAULT now()                                |                                                                                                                                                                                                                                                              |

> `tenancy.tenants.verification_status`/`verification_type` 保留为反规范化只读列（快查），审核流水明细权威在本表。

### 4.3 `verification_policies`（KYC 门控策略，2026-07-04 从 commerce 域移入）

> **归属修正**：原 `commerce.verification_policy`。它是"何时要求实名"的**策略配置**，不是资金/计量数据，和本 schema 的 `user_kycs`/`tenant_verifications`（实名**记录**）是同一件事的两面（策略 + 执行记录），放在 commerce 纯属历史沿革，现按内聚原则移入 `kyc`。跨 `identity`(account)/`kyc`/`product` 三域引用不变。

| 字段                        | 类型        | 约束                                   | 说明                                              |
| --------------------------- | ----------- | -------------------------------------- | ------------------------------------------------- |
| `id`                        | uuid        | PK                                     |                                                   |
| `product_id`                | uuid        | NULL, FK→`product.products.id`         | NULL=平台基准值（非隐式兜底）；非 NULL=该产品策略 |
| `tenant_type`               | varchar(32) | NOT NULL, CHECK(personal/organization) |                                                   |
| `require_verification`      | boolean     | NOT NULL                               |                                                   |
| `required_type`             | varchar(32) | NULL, CHECK(individual/enterprise)     |                                                   |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()                 |                                                   |

约束：`UNIQUE(product_id, tenant_type) WHERE product_id IS NOT NULL`（产品级策略）+ `UNIQUE(tenant_type) WHERE product_id IS NULL`（平台基准值，每 tenant_type 仅一行）。任何产品上架前**必须显式插入**自己 `product_id` 非 NULL 的记录，由 `product` 域上架检查清单强制。

**校验逻辑（应用层，不适合 DB CHECK）**：创建付费订阅（`metering.subscriptions` 关联非 free plan_version）时，按 `(product_id, tenant_type)` 查本表；若 `require_verification=true`，校验该 tenant 的 `tenant_verifications`/`user_kycs` 状态为 `verified` 且类型匹配 `required_type`。这条规则跨 `identity`/`kyc`/`commerce`/`product` 四域，触发条件下沉为数据、校验动作留应用层。

---

## 5. schema `tenancy`（组织 / 空间 / 成员）

### 5.1 `tenants`

| 字段                        | 类型         | 约束                                                                         | 说明                                                                                                   |
| --------------------------- | ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                        | uuid         | PK                                                                           |                                                                                                        |
| `tenant_no`                 | bigint       | UNIQUE；95 触发器分配（个人 = owner user_no，组织 = 自取主体号）             | 可视码，见 §11                                                                                         |
| `name`                      | varchar(128) | NOT NULL                                                                     |                                                                                                        |
| `display_name`              | varchar(96)  | NULL(迁移 2026-09-16 回填 = name)                                            | 简称:日常展示名(侧栏 / 面板 / 身份卡),自由改;`name` 是认证名(改名作废企业认证)。新建与转组织时两者相同 |
| `type`                      | varchar(16)  | NOT NULL, CHECK(personal/organization)                                       |                                                                                                        |
| `owner_user_id`             | uuid         | FK→`account.users.id`                                                        |                                                                                                        |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'active'`, CHECK(active/suspended/deleted)                 | **修正**：补 CHECK（同 users.status 一致标准）                                                         |
| `verification_status`       | varchar(32)  | NOT NULL DEFAULT `'unverified'`, CHECK(unverified/pending/verified/rejected) | 反规范化只读，详见 `kyc.tenant_verifications`；**修正**：补 CHECK                                      |
| `verification_type`         | varchar(32)  | NULL                                                                         |                                                                                                        |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                                       |                                                                                                        |
| `deleted_at`                | timestamptz  | NULL                                                                         |                                                                                                        |

不变量：每 user ≤1 personal tenant（部分唯一索引 `WHERE type='personal' AND deleted_at IS NULL`）；`owner_user_id` 与 `tenant_memberships(role='owner')` 一致性只经 `transfer_tenant_owner()` 原子转移。

> **个人租户自动开通与命名（2026-07-06 owner 定案）**：仅 personal 类型自动创建（注册 / 首次登录 PLG 懒兜底自愈，收口在 `bff/auth-bff/src/authn/user-onboarding.service.ts`——用户创建后续动作唯一归集清单文件）。`tenants.name` 命名链 = **`display_name > account(username) > user_no`**（显式传名优先；未传时 provision 事务内从 DB 解析，`'Personal'` 仅作最终防御回退）。**对外默认显示** = `{tenant.display_name ?? tenant.name} + 空格 + {tenant.type}`(2026-09-05 起简称优先)（如 `yanhaoguo personal` / `yanhaoguo organization`——同名跨类型可区分；组织租户同规则），前端统一走 `formatTenantDisplay`。可视码对外一律带类别前缀展示（§11 v4）：`U-{user_no}` / `T-{tenant_no}` / `W-{workspace_no}`；旧标签写法 `USR_ID:` / `ORG_ID:` 已退役。

### 5.2 `tenant_profiles`

| 字段                                 | 类型         | 约束                                  | 说明                                                                                                                                                                                 |
| ------------------------------------ | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenant_id`                          | uuid         | PK, FK→`tenants.id` ON DELETE CASCADE |                                                                                                                                                                                      |
| `logo_hash`                          | varchar(64)  | NULL                                  | 与 `tenant_logos.hash` 冗余同步，供展示轻读（大对象已拆至 §5.3）                                                                                                                     |
| `description`                        | text         | NULL                                  |                                                                                                                                                                                      |
| `industry` / `scale` / `website`     | varchar      | NULL                                  | `industry` 自 2026-09-06 起 console 写入只认 core-utils `industry-taxonomy` 的清单码(自定义清单,不套国标);历史自由文本原样保留,admin 侧仍可自由填写;展示按码翻标签、未登记值原样显示 |
| `country_code`                       | varchar(8)   | NULL                                  |                                                                                                                                                                                      |
| `address`                            | varchar(255) | NULL                                  | **组织注册地址**（地址三层 SoT 第一层，见 §7）                                                                                                                                       |
| `postal_code`                        | varchar(16)  | NULL                                  |                                                                                                                                                                                      |
| `is_billing_recipient`               | boolean      | NOT NULL DEFAULT false                |                                                                                                                                                                                      |
| `timezone` / `language` / `currency` | varchar      | NULL                                  |                                                                                                                                                                                      |
| `created_at` / `updated_at`          | timestamptz  | NOT NULL DEFAULT now()                |                                                                                                                                                                                      |

> **联系人迁出（2026-07-05 二次吸纳修正）**：round-1 吸纳曾把原稿（`inputs/tenancy_core_tables.sql` §4）的 1:N 多类型联系人**有损折叠**为本表 4 个 `contact_*` 列且无落盘记录；现按原设计恢复为独立 `tenant_contacts` 表（§5.8），本表不再承载联系人。运行时主联系人读写 = `tenant_contacts` 的 `contact_type='primary'` 首行（API 面 `contactName/Role/Email/Phone` 保持不变，`contact_role`→`title` 映射）。

### 5.3 `tenant_logos`（品牌资产字节，多变体，对齐 §1.3 `account.user_avatars`）

> **2026-07-05 升多变体（owner 拍板）**：PK 由 `tenant_id` 改 `(tenant_id, kind)`，五个品牌变体（§5.9 枚举）的字节都存本表。与 `tenant_branding` 分工：**本表 = 字节 SoT**，branding = 品牌语义 + 外链覆盖位；生效 URL = `coalesce(branding.*_url, 派生 API 路由 /api/tenant/:id/brand/:kind?v=hash)`——单一派生规则，无双 SoT。console 现有上传流管理 `kind='logo'`，其余变体功能届时接线（铁律四结构先行）。

| 字段           | 类型        | 约束                                        | 说明                                                     |
| -------------- | ----------- | ------------------------------------------- | -------------------------------------------------------- |
| `tenant_id`    | uuid        | PK(复合), FK→`tenants.id` ON DELETE CASCADE |                                                          |
| `kind`         | varchar(16) | PK(复合), NOT NULL DEFAULT 'logo', CHECK    | `logo` / `logo_dark` / `icon` / `favicon` / `email_logo` |
| `data`         | bytea       | NOT NULL                                    | 起步阶段 in-DB，量级上来迁 OSS（同 §17 既有决议）        |
| `content_type` | varchar(32) | NOT NULL                                    |                                                          |
| `hash`         | varchar(64) | NOT NULL                                    | sha256                                                   |
| `updated_at`   | timestamptz | NOT NULL DEFAULT now()                      |                                                          |

### 5.4 `workspaces`

| 字段                        | 类型         | 约束                                                        | 说明                                                               |
| --------------------------- | ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `id`                        | uuid         | PK                                                          |                                                                    |
| `workspace_no`              | bigint       | NOT NULL, UNIQUE；95 触发器分配                             | 可视码 10 位：类别位 3 + 随机 8 + Luhn，与租户号无推导关系，见 §11 |
| `tenant_id`                 | uuid         | FK→`tenants.id` ON DELETE CASCADE                           |                                                                    |
| `name`                      | varchar(128) | NOT NULL                                                    |                                                                    |
| `is_default`                | boolean      | NOT NULL DEFAULT false                                      | 每 tenant 仅一 default（部分唯一索引）                             |
| `description`               | text         | NULL                                                        |                                                                    |
| `icon`                      | varchar(64)  | NULL                                                        |                                                                    |
| `status`                    | varchar(16)  | NOT NULL DEFAULT `'active'`, CHECK(active/archived/deleted) |                                                                    |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                      |                                                                    |
| `deleted_at`                | timestamptz  | NULL                                                        |                                                                    |

约束：`UNIQUE(id, tenant_id)`（**新增**，`uq_workspaces_id_tenant`——为 §5.6 `workspace_memberships` 的复合 FK 提供目标，锁定"ws 成员的 tenant_id 必须是该 ws 真实所属 tenant"）。

> **默认工作空间（2026-08-19 owner 改定，取代 2026-07-06 `'workspace'`）**：随租户自动创建一个，`name='default workspace'`、`is_default=true`（创建时默认填写，用户可后改名）。

### 5.5 `tenant_memberships`

| 字段                        | 类型        | 约束                                                                          | 说明                                                                                                                                       |
| --------------------------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | uuid        | PK                                                                            |                                                                                                                                            |
| `tenant_id`                 | uuid        | FK→`tenants.id` ON DELETE CASCADE                                             |                                                                                                                                            |
| `user_id`                   | uuid        | FK→`account.users.id`                                                         |                                                                                                                                            |
| `role_id`                   | uuid        | NOT NULL, 复合 FK 见下                                                        | 基础角色，**唯一承载授权判断的列**（见下方纪律说明）                                                                                       |
| `role_scope`                | varchar(16) | NOT NULL DEFAULT `'tenant'`, CHECK(`role_scope='tenant'`)                     | 判别列，配合复合 FK 锁定 scope（见下）                                                                                                     |
| `status`                    | varchar(32) | NOT NULL DEFAULT `'active'`, CHECK(active/suspended/removed)                  |                                                                                                                                            |
| `title`                     | varchar(64) | NULL                                                                          | 职务（原参考清单"组织/职业"归位于此，非 users）**——纯展示/HR 属性，非授权属性**                                                            |
| `department`                | varchar(64) | NULL                                                                          | 同上，非授权属性                                                                                                                           |
| `employee_no`               | varchar(32) | NULL                                                                          | 同上，非授权属性                                                                                                                           |
| `job_level`                 | varchar(32) | NULL                                                                          | 同上，**非授权属性——严禁任何鉴权代码读取此列做权限判断**（见下方纪律说明）                                                                 |
| `default_workspace_id`      | uuid        | NULL, 复合 FK `(default_workspace_id, tenant_id)`→`workspaces(id, tenant_id)` | 该用户在此租户下的默认空间；**修正**：用复合 FK 锁"默认 ws 必属本 tenant"(同 §5.6 严谨标准)，NULL 行自动放行                               |
| `is_default`                | boolean     | NOT NULL DEFAULT false；部分唯一 `(user_id) WHERE is_default`                 | 该用户**登录后默认进入的租户**（账号信息页「设为默认」，2026-09-05）；挂成员关系不挂 users：成员关系没了默认自然消失，登录解析回落个人租户 |
| `member_extra`              | jsonb       | NULL                                                                          |                                                                                                                                            |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()                                                        |                                                                                                                                            |

约束：`UNIQUE(tenant_id, user_id)`。

**角色关联（2026-07-04 修正）**：原设计用 `role varchar(32)` 按 code 引用 `access.roles.code`，误列为铁律一边界#4（code 目录引用）——**这是错误分类**：`access.roles` 唯一性是 `(scope, code)` 复合唯一，code 单列并不唯一，一旦启用自定义角色（未来待办，见 §13）连 `(scope, code)` 也会退化为 `(tenant_id, scope, code)`，裸 code 字符串关联当场失效。已改为真 FK：

```sql
-- access.roles 需补一个复合唯一（id 本身已唯一，这只是给复合 FK 提供目标）：
ALTER TABLE access.roles ADD CONSTRAINT uq_roles_id_scope UNIQUE (id, scope);

-- tenant_memberships：role_scope 是常量判别列，把"tenant 成员只能持 tenant 角色"
-- 从应用层约定升级为 DB 不变量（标准 Postgres 复合 FK 技巧）：
ALTER TABLE tenancy.tenant_memberships
  ADD CONSTRAINT fk_tenant_memberships_role
  FOREIGN KEY (role_id, role_scope) REFERENCES access.roles (id, scope);
```

`workspace_memberships` 同构处理，`role_scope` 常量换成 `'workspace'`（见 §5.6）。**单纯 `role_id uuid FK→roles.id` 只保证角色存在，不保证 scope 正确**（tenant 成员可能挂到 workspace 角色）——复合 FK 是把这个不变量从"但愿应用层没写错"变成"数据库物理上不可能写错"，为此多一列判别列，成本可接受。

**角色基数（已决 2026-07-04，修正表述）**：`role_id` 保持**单值**（一人在一 tenant/workspace 内仅一个基础角色），承担粗粒度门禁与 UI 展示。真要跨维度叠加授权（如"member 基础角色 + billing_admin 增量"），扩展路径是**新增 `role_assignments` 表做增量叠加、与基础角色取并集**，而不是把 `role_id` 升级成多对多——membership 表的这一列永远不需要再动，是纯增量迁移。当前业务侧未确认此需求，不预建 `role_assignments`（起步阶段最小化）。

> **授权列纯度纪律**：本表只有 `role_id`（+`role_scope` 判别列）承载授权判断。`title`/`department`/`employee_no`/`job_level`/`member_extra` 是成员档案的展示/HR 属性，**禁止**出现"按 `job_level` 判断能否执行某操作"这类代码路径——那会形成第二套隐性权限体系，与 `access` schema 并存冲突。同 §1.1 `users.level_no`（成长等级）与订阅套餐层级刻意术语区分是同一类纪律：概念边界不能靠字段命名习惯来维系，要靠明文禁止。

### 5.6 `workspace_memberships`

| 字段                        | 类型        | 约束                                                            | 说明                                                                                |
| --------------------------- | ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                        | uuid        | PK                                                              |                                                                                     |
| `workspace_id`              | uuid        | NOT NULL, 复合 FK 见下                                          |                                                                                     |
| `tenant_id`                 | uuid        | NOT NULL, 复合 FK 见下                                          | **新增·反规范化判别列**——= 该 ws 所属 tenant，用于锁定"ws 成员 ⊆ tenant 成员"不变量 |
| `user_id`                   | uuid        | NOT NULL, FK→`account.users.id`                                 |                                                                                     |
| `role_id`                   | uuid        | NOT NULL, 复合 FK→`access.roles(id, scope)`                     | 同 §5.5，唯一承载授权判断的列                                                       |
| `role_scope`                | varchar(16) | NOT NULL DEFAULT `'workspace'`, CHECK(`role_scope='workspace'`) | 判别列                                                                              |
| `status`                    | varchar(32) | NOT NULL DEFAULT `'active'`, CHECK(active/suspended/removed)    |                                                                                     |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()                                          |                                                                                     |

约束：`UNIQUE(workspace_id, user_id)`。

**成员归属不变量（2026-07-04 新增）——ws 成员必须是其所属 tenant 的成员**（`ws membership ⊆ tenant membership`）。用两个复合 FK 在 DB 层锁死，无需触发器：

```sql
-- ① tenant_id 必须是该 workspace 真实所属的 tenant（防伪造 tenant_id 绕过②）
ALTER TABLE tenancy.workspace_memberships
  ADD CONSTRAINT fk_ws_memberships_workspace
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES tenancy.workspaces (id, tenant_id)
  ON DELETE CASCADE;                                     -- ws 删 → 成员随删

-- ② (tenant_id, user_id) 必须已存在于 tenant_memberships（该用户确是此 tenant 成员）
ALTER TABLE tenancy.workspace_memberships
  ADD CONSTRAINT fk_ws_memberships_tenant_member
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenancy.tenant_memberships (tenant_id, user_id)
  ON DELETE CASCADE;                                     -- 退出 tenant → 自动退出其名下所有 ws

-- 角色 scope 锁定（同 §5.5）
ALTER TABLE tenancy.workspace_memberships
  ADD CONSTRAINT fk_ws_memberships_role
  FOREIGN KEY (role_id, role_scope) REFERENCES access.roles (id, scope);
```

- **① + ② 合起来**保证：`workspace_memberships` 的 user_id 一定是 workspace 所属 tenant 的成员——`tenant_id` 是反规范化列（可从 workspace_id 推导），FK① 锁定它必须真等于 ws 的实际 tenant，FK② 再拿它去 `tenant_memberships(tenant_id, user_id)` 校验成员资格。缺 FK① 的话，可以填一个错误的 tenant_id 去骗过 FK②，所以两条缺一不可。
- **级联语义**：FK② 的 `ON DELETE CASCADE` 实现"用户退出 tenant → 自动清除其在该 tenant 下所有 workspace 的成员身份"，这是期望行为（不会残留孤儿 ws 成员）。tenant 删除时，两条路径（tenant→tenant_memberships→ws_memberships，以及 tenant→workspaces→ws_memberships）都会级联到本表，PG 幂等处理无冲突。
- 这一列冗余换来的是把"ws 成员必须在 tenant 内"从应用层约定变成**数据库物理不变量**——与 §5.5 role_scope 锁定同一类 DB 层防御取向。

### 5.7 `invitations`

| 字段                        | 类型         | 约束                                                                  | 说明                                                                                                      |
| --------------------------- | ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid         | PK                                                                    |                                                                                                           |
| `scope`                     | varchar(16)  | NOT NULL, CHECK(`tenant`/`workspace`)                                 | 兼作角色复合 FK 判别列（见下），值域同步 §5.5 由 `org` 改 `tenant`                                        |
| `tenant_id`                 | uuid         | NULL, FK→`tenants.id`                                                 |                                                                                                           |
| `workspace_id`              | uuid         | NULL, FK→`workspaces.id`                                              |                                                                                                           |
| `target_type`               | varchar(16)  | NOT NULL                                                              | email/phone                                                                                               |
| `target`                    | varchar(128) | NOT NULL                                                              |                                                                                                           |
| `role_id`                   | uuid         | NOT NULL, 复合 FK→`access.roles(id, scope)`                           | 邀请接受后授予的基础角色；同 §5.5 理由改用 role_id，直接复用本表已有的 `scope` 列做判别列，无需再加常量列 |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'pending'`, CHECK(pending/accepted/expired/revoked) |                                                                                                           |
| `token_hash`                | varchar(64)  | UNIQUE NOT NULL                                                       |                                                                                                           |
| `expires_at`                | timestamptz  | NOT NULL                                                              |                                                                                                           |
| `accepted_at`               | timestamptz  | NULL                                                                  |                                                                                                           |
| `created_by`                | uuid         | FK→`account.users.id`                                                 |                                                                                                           |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                                |                                                                                                           |

约束：`FOREIGN KEY (role_id, scope) REFERENCES access.roles (id, scope)`。

---

### 5.8 `tenant_contacts`（日常联系人，1:N 多类型）

> 来源 = `inputs/tenancy_core_tables.sql` §4 原稿忠实落地（2026-07-05 二次吸纳；round-1 曾有损折叠进 §5.2，本节即修正）。一个租户可登记多类型、多名联系人；控制台"主联系人"= `contact_type='primary'` 首行。

| 字段                        | 类型         | 约束                                           | 说明                                                       |
| --------------------------- | ------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| `id`                        | uuid         | PK                                             |                                                            |
| `tenant_id`                 | uuid         | NOT NULL, FK→`tenants.id` ON DELETE CASCADE    |                                                            |
| `contact_type`              | varchar(16)  | NOT NULL                                       | `primary` / `billing` / `technical` / `security` / `legal` |
| `name`                      | varchar(128) | NOT NULL                                       |                                                            |
| `title`                     | varchar(128) | NULL                                           | 职务（原 §5.2 `contact_role` 语义迁移至此）                |
| `email`                     | varchar(128) | NOT NULL                                       |                                                            |
| `phone`                     | varchar(32)  | NULL                                           |                                                            |
| `user_id`                   | uuid         | NULL, FK→`account.users.id` ON DELETE SET NULL | 联系人是平台用户时关联（跨 schema 真 FK，落 90 文件）      |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                         |                                                            |

约束：`UNIQUE(tenant_id, contact_type, email)`；索引 `(tenant_id, contact_type)`。

### 5.9 `tenant_branding`（品牌资产当前生效指针，1:1）

> 来源 = `inputs/tenancy_core_tables.sql` §5。**round-1 吸纳把本表整个丢弃且无落盘记录**（cutover 复盘同类流程缺口的"吸纳"变体），2026-07-05 二次吸纳恢复。与 §5.3 `tenant_logos` 分工（owner 拍板）：logos 存**字节 SoT**（多变体，PK `tenant_id+kind`），本表存**品牌语义**（品牌色）+ **`*_url` 外链覆盖位**——现阶段 NULL，迁 OSS/CDN 托管后启用；生效 URL = `coalesce(本表外链, logos 派生 API 路由)`，单一派生规则。如需文件元数据/历史版本，后续增设 `tenant_brand_assets` 明细表（铁律四预留，不预建）。

| 字段                               | 类型         | 约束                                  | 说明                                     |
| ---------------------------------- | ------------ | ------------------------------------- | ---------------------------------------- |
| `tenant_id`                        | uuid         | PK, FK→`tenants.id` ON DELETE CASCADE |                                          |
| `logo_url`                         | varchar(512) | NULL                                  | 横版全标，浅色背景                       |
| `logo_dark_url`                    | varchar(512) | NULL                                  | 深色模式变体                             |
| `icon_url`                         | varchar(512) | NULL                                  | 方形，侧边栏/头像位                      |
| `favicon_url`                      | varchar(512) | NULL                                  |                                          |
| `email_logo_url`                   | varchar(512) | NULL                                  | 邮件模板专用（邮件客户端不支持深色切换） |
| `brand_color` / `brand_color_dark` | char(7)      | NULL, CHECK `^#[0-9A-Fa-f]{6}$`       | 主品牌色 `#RRGGBB`（浅/深两态）          |
| `updated_by`                       | uuid         | NULL                                  |                                          |
| `created_at` / `updated_at`        | timestamptz  | NOT NULL DEFAULT now()                |                                          |

## 6. schema `access`（customer realm 治理 RBAC）

> operator 那套 RBAC 独立存在于 `admin.operator_roles`/`operator_permissions`（realm 隔离，边界#2，与本 schema 零 FK）。
> **两 realm RBAC 最大化一致 + 保留分化**（2026-07-04）：`access.*` 与 `admin.operator_*` 同为**控制台模式** RBAC（租户 console 与运营 admin 皆按权限树渲染菜单），仅用户域不同——故字段级**最大化对齐**：三元 `{entity}_code`/`{entity}_name`/`{entity}_name_key`（i18n）+ `is_system` + `created_by`（system vs 管理员自建溯源）+ 控制台渲染字段（`perm_type`/`route_path`/`component`/`icon`/`is_active`/`is_visible`/`sort`）+ 审计列。**保留的合理分化**：`access.roles.scope`（tenant/workspace 两级，客户专属） vs `admin.operator_role.rank`+`mfa_min_level`（运营安全分级）。**表名裸名不加前缀**（`access` 单一用途 schema，schema 名即 realm 判别器；`operator_` 前缀仅因 `admin` 是混合 schema 需区分治理表，见铁律 §3.2.1）。
> **业务域拆分边界（明确不做，非遗漏）**：`data_platform_100_architecture.md §5` 铁律"治理 RBAC ≠ 业务授权"——`roles`/`permissions` 只表达"能否管理组织/空间/计费"等治理动作，产品功能级授权在各业务域 OUT、不入平台库。因此本 schema **不**按产品/业务域拆分角色；跨维度组合权限（如"能管账单但不能管成员"）靠定义更细的角色码覆盖（见 §5.5 角色基数说明），不引入业务域角色。

### 6.1 `roles`

| 字段                                           | 类型         | 约束                                  | 说明                                                                                   |
| ---------------------------------------------- | ------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                           | uuid         | PK                                    | **membership/invitation 关联的唯一目标**（2026-07-04 起，取代旧的 code 关联，见 §5.5） |
| `role_code`                                    | varchar(64)  | NOT NULL                              | 语义码（原 `code`），非关联键（统一三元 `*_code`）                                     |
| `scope`                                        | varchar(16)  | NOT NULL, CHECK(`tenant`/`workspace`) | 判别列（**access 专属分化**）；值域由 `org` 改 `tenant`                                |
| `role_name`                                    | varchar(128) | NULL                                  | 默认/回退显示名（统一三元 `*_name`）                                                   |
| `role_name_key`                                | varchar(128) | NULL                                  | i18n 键（统一三元 `*_name_key`；前端按 locale 解析）                                   |
| `description` / `description_key`              | varchar      | NULL                                  | 描述 + i18n 键                                                                         |
| `is_system`                                    | boolean      | NOT NULL DEFAULT false                | true 预置不可删 / false 管理员自建可删                                                 |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true                 | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活）                       |
| `status`                                       | varchar(32)  | NOT NULL DEFAULT `'active'`           | active/disabled（对齐 operator）                                                       |
| `sort`                                         | int          | NOT NULL DEFAULT 999                  | 控制台排序                                                                             |
| `created_by` / `updated_by`                    | uuid         | NULL                                  | 谁建的（SYS vs 管理员 id，溯源）                                                       |
| `created_at` / `updated_at`                    | timestamptz  | NOT NULL DEFAULT now()                |                                                                                        |

约束：`UNIQUE(scope, role_code)`（`uq_roles_scope_role_code`，业务唯一性，非关联用途）+ `UNIQUE(id, scope)`（`uq_roles_id_scope`——为 §5.5/§5.6/§5.7 的复合 FK 提供目标，锁定"tenant 成员不能挂 workspace 角色"这类不变量）。角色间**不设继承/组合关系**（无 role 层级）——2 个 scope、少量角色码的扁平模型足够，对齐行业惯例（AWS IAM/Keycloak 基础模型均不强制角色继承，需要时才用 composite role 这类附加特性，起步阶段不预建）。

> **自定义角色（未来待办，当前不建）**：现在 `roles` 是全局目录（非 per-tenant）。若未来开放"租户自定义角色"，需加 `tenant_id uuid NULL`（NULL=系统角色、任意租户可用；非 NULL=该租户专属），并把 `UNIQUE(scope, code)` 升级为 `UNIQUE(tenant_id, scope, code)`。**该分支（系统角色 tenant_id IS NULL vs 自定义角色 tenant_id 须等于 membership.tenant_id）无法用复合 FK 表达**（FK 不支持"NULL 或等于"的条件语义），须靠应用层校验 + 低频一致性巡检查询兜底，触发器在此场景收益不大（角色分配非高频路径）。当前不建 `tenant_id` 列，属起步阶段最小化（自定义角色非既定能力）。

### 6.2 `permissions`

> 与 `admin.operator_permission` **完全同构**（控制台菜单树模式）。

| 字段                                           | 类型         | 约束                      | 说明                                                             |
| ---------------------------------------------- | ------------ | ------------------------- | ---------------------------------------------------------------- |
| `id`                                           | uuid         | PK                        |                                                                  |
| `parent_id`                                    | uuid         | NULL, FK→`permissions.id` | 树形自引用，对齐 `admin.operator_permission.parent_id`           |
| `perm_code`                                    | varchar(64)  | UNIQUE NOT NULL           | 语义码（原 `code`；统一三元 `*_code`）                           |
| `perm_name`                                    | varchar(64)  | NULL                      | 显示名（统一三元 `*_name`）                                      |
| `perm_name_key`                                | varchar(128) | NULL                      | i18n 键（统一三元 `*_name_key`）                                 |
| `description_key`                              | varchar(128) | NULL                      | i18n 键 `access.perm.{perm_code}.desc`（§3.2.5）                 |
| `perm_type`                                    | varchar(20)  | NULL                      | menu/button/api（**控制台模式**，开放集）                        |
| `route_path` / `component` / `icon`            | varchar      | NULL                      | 前端菜单渲染（控制台模式）                                       |
| `category`                                     | varchar(32)  | NULL                      | 分组标签（billing/member/security/settings）                     |
| `description`                                  | varchar(255) | NULL                      |                                                                  |
| `is_active`                                    | boolean      | NOT NULL DEFAULT true     | 权限节点是否启用（≠可见）                                        |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true     | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活） |
| `is_system`                                    | boolean      | NOT NULL DEFAULT true     | 权限目录默认系统预置（区分管理员自建）                           |
| `sort`                                         | int          | NOT NULL DEFAULT 999      |                                                                  |
| `created_by` / `updated_by`                    | uuid         | NULL                      | 溯源                                                             |
| `created_at` / `updated_at`                    | timestamptz  | NOT NULL DEFAULT now()    |                                                                  |

索引：`idx_permissions_parent_id`、`idx_permissions_sort`。

### 6.3 `role_permissions`

| 字段            | 类型        | 约束                                  | 说明                                    |
| --------------- | ----------- | ------------------------------------- | --------------------------------------- |
| `role_id`       | uuid        | FK→`roles.id` ON DELETE CASCADE       |                                         |
| `permission_id` | uuid        | FK→`permissions.id` ON DELETE CASCADE |                                         |
| `is_system`     | boolean     | NOT NULL DEFAULT true                 | 预置映射 vs 管理员分配（对齐 operator） |
| `created_by`    | uuid        | NULL                                  | 溯源                                    |
| `created_at`    | timestamptz | NOT NULL DEFAULT now()                |                                         |

复合 PK `(role_id, permission_id)`。

### 6.4 初始化数据（RBAC seed · customer realm）

> 落库脚本 = `deploy/database/seed/seed-catalog.mjs`（幂等，`on conflict (scope, code)` / `(code)` / `(role_id, permission_id)`）。运营 realm 的角色/权限见 [`data_admin_200_schema.md`](./data_admin_200_schema.md) §4；两 realm 命名空间**互不统一**（边界#2）。

**预置角色：每 scope 一整套 5 个内置角色（共 10 行，`is_system=true`）。** 数据架构按完整度建（用不用是业务侧决策，设计不得不足）。`other` 已定名 `guest`。

| code       | 名称    | 定位                                             | 治理权限姿态                          | SaaS 对标                                                |
| ---------- | ------- | ------------------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| `owner`    | Owner   | 最高权，含账单/所有权转移/删除                   | 全授                                  | GitHub Org Owner · Slack Owner · Notion Workspace Owner  |
| `manager`  | Manager | 管成员/角色/设置，**不含**账单与所有权           | member/role/workspace/settings.manage | Slack Admin · Atlassian Admin                            |
| `member`   | Member  | 常规协作者，读写业务资源，不碰治理               | 空                                    | 通用 Member                                              |
| `readonly` | Viewer  | **内部**全域只读，零写                           | 空                                    | Google/Atlassian Viewer · GitHub read                    |
| `guest`    | Guest   | **受限/外部**，仅见被显式授予的资源，弱于 member | 空                                    | GitHub Outside Collaborator · Slack Guest · Notion Guest |

> **两 scope 同构**：`tenant` 与 `workspace` 各持这 5 个 code（`(scope, code)` 唯一）。`readonly` vs `guest` 的分野（SaaS 标准）：**readonly=内部人、能看全但不能写；guest=外部人、只能看被分享的那一小块**——二者不冗余。
>
> **治理映射的"写侧"只区分 owner/manager**（忠于 §6 铁律"治理 RBAC ≠ 业务授权"）：治理 RBAC 只闸"能否管理组织/空间/计费/成员/角色"这类治理动作，不闸产品功能。
>
> **2026-09-04 修订（console 权限配置体系，identity/070）**：目录补入**读侧码**（`*.read`）与商业面细分码（`payment.manage` / `invoice.manage`），`member` / `readonly` / `guest` 的治理码**不再皆空**——三者在 console 里"能看哪一类租户数据"由读侧码表达（readonly = 全部 `.read`；member = 成员目录 + 配额用量；guest = 空）。这仍在治理边界内：读侧码回答的是"能否看租户的成员/账单/审计"，不是产品功能。`access.permissions` 的 menu 层（`tenant.menu.*`，parent_id / route_path / perm_type）随之灌满，与 console 侧栏同构；菜单行只承载层级，不进 `role_permissions`。

**治理权限目录（category ∈ billing/member/security/settings/quota/audit/model）与映射（tenant scope）：**

| perm code                                      | category | owner | manager | member | readonly | guest |
| ---------------------------------------------- | -------- | :---: | :-----: | :----: | :------: | :---: |
| `tenant.member.read`                           | member   |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| `{scope}.member.manage`                        | member   |   ✔   |    ✔    |   —    |    —     |   —   |
| `{scope}.role.assign`                          | security |   ✔   |    ✔    |   —    |    —     |   —   |
| `tenant.workspace.manage`（仅 tenant scope）   | settings |   ✔   |    ✔    |   —    |    —     |   —   |
| `{scope}.settings.manage`                      | settings |   ✔   |    ✔    |   —    |    —     |   —   |
| `tenant.delete`                                | security |   ✔   |    —    |   —    |    —     |   —   |
| `tenant.billing.read`                          | billing  |   ✔   |    ✔    |   —    |    ✔     |   —   |
| `tenant.billing.manage`（仅 tenant scope，危） | billing  |   ✔   |    —    |   —    |    —     |   —   |
| `tenant.payment.manage`（危）                  | billing  |   ✔   |    —    |   —    |    —     |   —   |
| `tenant.invoice.manage`                        | billing  |   ✔   |    —    |   —    |    —     |   —   |
| `tenant.quota.read`                            | quota    |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| `tenant.audit.read`                            | audit    |   ✔   |    ✔    |   —    |    ✔     |   —   |
| `tenant.model.read`                            | model    |   ✔   |    —    |   —    |    —     |   —   |

> `.manage` 蕴含同资源的 `.read`（`@vxture/core-utils` `capabilitySatisfies`，BFF 守卫与前端门共用）。`tenant.model.read` 自批 7（2026-09-05）起只授予 owner（`/atlas` 页整改完成）。
> `tenant:owner` 额外并入其下所有 `workspace.*` 治理权（承租户对旗下空间的全权，照现 seed `TENANT_ALL ∪ WS_ALL`）。perm code 现用 `{scope}.{resource}.{action}` 点分隔；与运营 realm 的 `{domain}:{resource}.{action}` 冒号约定的**统一（点→冒号）列为后续待办**，本轮不改（避免牵动 console 治理授权代码，守边界）。存量库由 `deploy/database/migrations/2026-09-10-access-console-permission-catalog.sql` 补齐；seed / core-utils / console 导航 / 迁移四处由 `check-tenant-permission-catalog` 守卫逐码比对。

---

## 7. schema `appoidc`（Vxture 作 IdP，对业务/应用/域名发身份 outbound）

### 7.1 `oidc_clients`

| 字段                        | 类型         | 约束                                                  | 说明                                                                                                                                                                                                                                                       |
| --------------------------- | ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid         | PK                                                    |                                                                                                                                                                                                                                                            |
| `client_id`                 | varchar(64)  | UNIQUE NOT NULL                                       |                                                                                                                                                                                                                                                            |
| `client_secret_hash`        | varchar(255) | NULL                                                  |                                                                                                                                                                                                                                                            |
| `realm`                     | varchar(16)  | NOT NULL, CHECK(customer/workforce)                   |                                                                                                                                                                                                                                                            |
| `product_id`                | uuid         | NULL, FK→`product.products.id`                        | **修正**：product 与本库同物理库(platform_main)——按铁律一是**真跨 schema FK**(普通引用)，非物理库界；原"跨物理拆分/边界#4"表述错误已删                                                                                                                     |
| `client_kind`               | varchar(16)  | NOT NULL DEFAULT `'product'`, CHECK(platform/product) | 2026-08-30 新增（`opera/40-product-registry.md` §3）：`platform`=平台自有门户（product_id 必 NULL，只由 seed 建）；`product`=已登记产品的接入凭据（product_id 必非 NULL）。`chk_oidc_clients_kind_product` 把两列绑死，"NULL=平台级"不再是靠缺席推断的事实 |
| `release_channel`           | varchar(16)  | NOT NULL DEFAULT `'stable'`, CHECK                    |                                                                                                                                                                                                                                                            |
| `name`                      | varchar(96)  | NULL                                                  |                                                                                                                                                                                                                                                            |
| `redirect_uris`             | text[]       | NOT NULL                                              |                                                                                                                                                                                                                                                            |
| `pkce_required`             | boolean      | NOT NULL DEFAULT true                                 |                                                                                                                                                                                                                                                            |
| `slo_participation`         | varchar(32)  | NOT NULL DEFAULT `'none'`                             |                                                                                                                                                                                                                                                            |
| `back_channel_logout_uri`   | varchar(512) | NULL                                                  | `slo_participation='back_channel'` 时必填（CHECK）                                                                                                                                                                                                         |
| `status`                    | varchar(32)  | NOT NULL DEFAULT `'active'`                           |                                                                                                                                                                                                                                                            |
| `created_at` / `updated_at` | timestamptz  | NOT NULL DEFAULT now()                                |                                                                                                                                                                                                                                                            |

### 7.2 `signing_keys`

| 字段                                          | 类型        | 约束                                          | 说明                                  |
| --------------------------------------------- | ----------- | --------------------------------------------- | ------------------------------------- |
| `kid`                                         | varchar(64) | PK                                            |                                       |
| `public_jwk`                                  | jsonb       | NOT NULL                                      | 仅公钥，私钥进 secret manager         |
| `status`                                      | varchar(16) | NOT NULL, CHECK(next/active/retiring/retired) | 部分唯一索引保同一时刻至多一把 active |
| `activated_at` / `retiring_at` / `retired_at` | timestamptz | NULL                                          |                                       |
| `created_at`                                  | timestamptz | NOT NULL DEFAULT now()                        |                                       |

### 7.3 `oidc_consents`（新增，行业缺口补齐：对齐 Hydra consent / Auth0 grant）

| 字段                        | 类型        | 约束                                          | 说明                    |
| --------------------------- | ----------- | --------------------------------------------- | ----------------------- |
| `id`                        | uuid        | PK                                            |                         |
| `user_id`                   | uuid        | FK→`account.users.id` ON DELETE CASCADE       |                         |
| `client_id`                 | varchar(64) | FK→`oidc_clients.client_id` ON DELETE CASCADE |                         |
| `scopes`                    | text[]      | NOT NULL                                      | 用户已授权的 scope 集合 |
| `granted_at`                | timestamptz | NOT NULL DEFAULT now()                        |                         |
| `revoked_at`                | timestamptz | NULL                                          |                         |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()                        |                         |

约束：`UNIQUE(user_id, client_id) WHERE revoked_at IS NULL`。授权码/access_token 明细走 Redis 短存，不入库（对齐行业惯例，非本表职责）。

---

## 8. schema `session`（会话 / 令牌，短命高频，loose user_id）

> 本 schema 全部表对 `account.users` **不建 FK**——属铁律一边界#2（realm 安全隔离：`user_id` 需按 `realm`(customer\|workforce) 区分，且与 `admin.operator_*` 会话结构对称隔离，绝不交叉解引用）。

### 8.1 `auth_sessions`

| 字段             | 类型         | 约束                                | 说明 |
| ---------------- | ------------ | ----------------------------------- | ---- |
| `id`             | uuid         | PK                                  |      |
| `sid`            | varchar(64)  | UNIQUE NOT NULL                     |      |
| `user_id`        | uuid         | NOT NULL（loose）                   |      |
| `realm`          | varchar(16)  | NOT NULL, CHECK(customer/workforce) |      |
| `auth_method`    | varchar(32)  | NOT NULL                            |      |
| `ip_address`     | varchar(64)  | NULL                                |      |
| `user_agent`     | varchar(512) | NULL                                |      |
| `status`         | varchar(16)  | NOT NULL DEFAULT `'active'`         |      |
| `last_active_at` | timestamptz  | NOT NULL DEFAULT now()              |      |
| `expires_at`     | timestamptz  | NOT NULL                            |      |
| `revoked_at`     | timestamptz  | NULL                                |      |
| `created_at`     | timestamptz  | NOT NULL DEFAULT now()              |      |

### 8.2 `refresh_tokens`

| 字段           | 类型        | 约束                                       | 说明                                                                                                                                                                                                    |
| -------------- | ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | uuid        | PK                                         |                                                                                                                                                                                                         |
| `user_id`      | uuid        | NOT NULL（loose）                          | 边界#2 realm 隔离，不建 FK                                                                                                                                                                              |
| `session_id`   | uuid        | NOT NULL（松引用 Redis 会话 sid，不建 FK） | **2026-07-04 撤回**（**边界#1 跨物理存储**：session_id 指向 Redis 会话 sid，非本库 auth_sessions 行）：会话 Redis-primary、OIDC 登录不写 auth_sessions，FK 致登录热路径违约（集成验证发现）；改回松引用 |
| `client_id`    | varchar(64) | NOT NULL                                   |                                                                                                                                                                                                         |
| `token_hash`   | varchar(64) | UNIQUE NOT NULL                            |                                                                                                                                                                                                         |
| `rotated_from` | uuid        | NULL                                       | 轮换链                                                                                                                                                                                                  |
| `status`       | varchar(16) | NOT NULL DEFAULT `'active'`                |                                                                                                                                                                                                         |
| `expires_at`   | timestamptz | NOT NULL                                   |                                                                                                                                                                                                         |
| `created_at`   | timestamptz | NOT NULL DEFAULT now()                     |                                                                                                                                                                                                         |

### 8.3 `user_verifications`（验证码，append-only）

| 字段            | 类型         | 约束                   | 说明        |
| --------------- | ------------ | ---------------------- | ----------- |
| `id`            | uuid         | PK                     |             |
| `user_id`       | uuid         | NULL（loose）          |             |
| `target_type`   | varchar(16)  | NOT NULL               | email/phone |
| `target`        | varchar(128) | NOT NULL               |             |
| `purpose`       | varchar(32)  | NOT NULL               |             |
| `code_hash`     | varchar(64)  | NOT NULL               |             |
| `attempt_count` | int          | NOT NULL DEFAULT 0     |             |
| `expires_at`    | timestamptz  | NOT NULL               |             |
| `used_at`       | timestamptz  | NULL                   |             |
| `created_at`    | timestamptz  | NOT NULL DEFAULT now() |             |

### 8.4 `password_reset_tokens`（append-only）

| 字段         | 类型        | 约束                   | 说明 |
| ------------ | ----------- | ---------------------- | ---- |
| `id`         | uuid        | PK                     |      |
| `user_id`    | uuid        | NOT NULL（loose）      |      |
| `token_hash` | varchar(64) | UNIQUE NOT NULL        |      |
| `expires_at` | timestamptz | NOT NULL               |      |
| `used_at`    | timestamptz | NULL                   |      |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |      |

### 8.5 `login_attempts`（append-only，风控）

| 字段           | 类型         | 约束                          | 说明 |
| -------------- | ------------ | ----------------------------- | ---- |
| `id`           | uuid         | PK                            |      |
| `user_id`      | uuid         | NULL（loose）                 |      |
| `identifier`   | varchar(128) | NOT NULL                      |      |
| `auth_method`  | varchar(32)  | NOT NULL DEFAULT `'password'` |      |
| `result`       | varchar(32)  | NOT NULL                      |      |
| `ip_address`   | varchar(64)  | NOT NULL                      |      |
| `country_code` | char(2)      | NULL                          |      |
| `user_agent`   | varchar(512) | NULL                          |      |
| `created_at`   | timestamptz  | NOT NULL DEFAULT now()        |      |

---

## 9. schema `loyalty`（成长：积分 / 等级 / 任务 / 标签）

> `realm` 硬隔离：全部专属 customer，与 admin/operator 无 FK、无字段泄漏。与计费不建 FK（等级↔订阅两套机制解耦）。

### 9.1 `level_policies`

| 字段                                           | 类型         | 约束                  | 说明                                                                                                                                                     |
| ---------------------------------------------- | ------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level_no`                                     | int          | PK                    |                                                                                                                                                          |
| `max_owned_org_tenant`                         | int          | NOT NULL              | 等级→可建组织数上限                                                                                                                                      |
| `base_discount_percent`                        | numeric(5,2) | NULL                  | **预留·卡券联动**：等级自带折扣（如 L4=95 表 95 折）；与 `commerce promotion` 折扣券按叠加规则取优，校验在应用层。见 `data_commerce_230_promotion.md §6` |
| `level_name`                                   | varchar(64)  | NOT NULL DEFAULT ''   | 平台定义等级名（外显；2026-07-05 owner 拍板 DB 化，占位集待成长线定稿）                                                                                  |
| `is_customer_visible` / `is_workforce_visible` | boolean      | NOT NULL DEFAULT true | 展示可见性双列（§3.2.6，独立轴；不派生自 status/发布/启用/激活）                                                                                         |
| `level_name_key`                               | varchar(128) | NULL                  | i18n 键 `loyalty.level.{level_no}`                                                                                                                       |
| `description`                                  | varchar(128) | NULL                  |                                                                                                                                                          |
| `description_key`                              | varchar(128) | NULL                  | i18n 键 `loyalty.level.{level_no}.desc`                                                                                                                  |

### 9.2 `level_thresholds`

| 字段         | 类型   | 约束                             | 说明       |
| ------------ | ------ | -------------------------------- | ---------- |
| `level_no`   | int    | PK, FK→`level_policies.level_no` |            |
| `min_points` | bigint | UNIQUE NOT NULL                  | 保单调可比 |

### 9.3 `user_points`

| 字段           | 类型        | 约束                                        | 说明                           |
| -------------- | ----------- | ------------------------------------------- | ------------------------------ |
| `user_id`      | uuid        | PK, FK→`account.users.id` ON DELETE CASCADE |                                |
| `total_points` | bigint      | NOT NULL DEFAULT 0                          | 当前余额单行汇总，避免每次 SUM |
| `updated_at`   | timestamptz | NOT NULL DEFAULT now()                      |                                |

### 9.4 `point_ledgers`

| 字段            | 类型         | 约束                   | 说明                 |
| --------------- | ------------ | ---------------------- | -------------------- |
| `id`            | uuid         | PK                     |                      |
| `user_id`       | uuid         | FK→`account.users.id`  |                      |
| `source_type`   | varchar(64)  | NOT NULL               | 开放标签，不加 CHECK |
| `source_ref_id` | varchar(128) | NULL                   |                      |
| `points_delta`  | bigint       | NOT NULL               | 允许负数（消耗）     |
| `balance_after` | bigint       | NOT NULL               |                      |
| `remark`        | varchar(512) | NULL                   |                      |
| `created_at`    | timestamptz  | NOT NULL DEFAULT now() |                      |

余额一致性由应用层同事务维护（非 append-only，可写）。

### 9.5 `task_progresses`

| 字段              | 类型        | 约束                   | 说明     |
| ----------------- | ----------- | ---------------------- | -------- |
| `id`              | uuid        | PK                     |          |
| `user_id`         | uuid        | FK→`account.users.id`  |          |
| `progress_type`   | varchar(64) | NOT NULL               | 开放标签 |
| `current_value`   | bigint      | NOT NULL DEFAULT 0     |          |
| `target_value`    | bigint      | NULL                   |          |
| `last_updated_at` | timestamptz | NOT NULL DEFAULT now() |          |
| `reset_at`        | timestamptz | NULL                   |          |
| `created_at`      | timestamptz | NOT NULL DEFAULT now() |          |

约束：`UNIQUE(user_id, progress_type)`。

### 9.6 `user_tags`（新增，用户分群，铁律四完整覆盖）

| 字段         | 类型        | 约束                                    | 说明        |
| ------------ | ----------- | --------------------------------------- | ----------- |
| `id`         | uuid        | PK                                      |             |
| `user_id`    | uuid        | FK→`account.users.id` ON DELETE CASCADE |             |
| `tag`        | varchar(64) | NOT NULL                                |             |
| `source`     | varchar(32) | NOT NULL DEFAULT `'manual'`             | manual/auto |
| `created_at` | timestamptz | NOT NULL DEFAULT now()                  |             |

约束：`UNIQUE(user_id, tag)`。

---

## 10. audit_event 退役

`identity.audit_event` 不再单独建表，统一并入 `support.audit_logs`（`actor_type='customer'` 逻辑隔离，对齐 operator 审计已有先例：`data_platform_200_schema.md` §14.688）。

---

## 11. 可视码方案

**定版 v4「三号解耦」（2026-09-05 owner 定案，取代 v3「人租同号」）**：三个主体号**各自独立取号、互不推导**，归属关系只走 uuid 外键。

> **为什么推翻 v3**：v3 把归属写进号里（个人租户号 = owner 的 `user_no`；`workspace_no = tenant_no×1000 + 序号`），这等于隐式外键，与 [`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 铁律二「可视码永不做 FK / 关联键，改码换规则不动任何数据关系」直接冲突。代价是三处债：个人转组织必须换发租户号、空间号必须整批跟随（需要一个 `SECURITY DEFINER` 触发器绕开列锁去写锚点列）、每租户空间数被三位序号钉死 999。v4 取消全部推导，上述三处随之消失——转换退化成改 `type` + `name` 两个字段。

**号形**：10 位 = 类别位（1）+ 随机段（8）+ Luhn 校验位（1）。

| 码             | 位置                 | 类别位 | 值域                      | 生成                                       |
| -------------- | -------------------- | :----: | ------------------------- | ------------------------------------------ |
| `user_no`      | `account.users`      |   1    | `1000000000`–`1999999999` | 95 触发器 → `account.alloc_user_no()`      |
| `tenant_no`    | `tenancy.tenants`    |   2    | `2000000000`–`2999999999` | 95 触发器 → `tenancy.alloc_tenant_no()`    |
| `workspace_no` | `tenancy.workspaces` |   3    | `3000000000`–`3999999999` | 95 触发器 → `tenancy.alloc_workspace_no()` |

- **类别位编的是「我是哪一类主体」，不是「我属于谁」**。个人租户与组织租户同为租户、同用类别位 2，所以**个人转组织不换号**。
- **随机段直取随机，不走序列**：号不承载先后，拿到两个号推不出增长量。每类容量 1 亿；分配器取号后查重重试（20 次上限），`UNIQUE` 约束兜底，剩余竞态约 1/10⁸。
- **Luhn 校验位**：客服手输 / 电话报号错一位、相邻换位当场可查。生成与校验是 `public.luhn_check_digit(text)` 与 `public.principal_no_valid(bigint, int)`（`IMMUTABLE`，三张表的 `CHECK` 直接复用）。
- 10 位恒定长度，JSON 安全（< 2⁵³）。展示前缀 `U-` / `T-` / `W-`，裸号也自明（首位即类别）。
- 显式携号插入放行（迁移 / 修复通道）；号一旦分配**永不回收**，删除只做脱敏软删。
- 内部表（membership / credential / session / loyalty 明细等）不设可视码，只用 `id uuid`。

示例：用户 `1799729056` 的个人租户是 `2765455965`，其默认空间是 `3549118424`——三个号毫无关系，归属查 `tenants.owner_user_id` 与 `workspaces.tenant_id`。界面需要「一眼看归属」时由页面并列展示（账号信息页身份卡、运营台租户详情），不靠号推导。

**落地**：DDL `00_schemas.sql`（三个 `public` 函数）+ `95_triggers.sql` B9（三个分配器 + 三个 `BEFORE INSERT` 触发器）；迁移 `2026-09-12-principal-no-decoupling.sql`（存量重编号、旧号备份进 `public.vx_principal_no_backup_v3`、退役 `workspace_counter` 与 `account.principal_no_seq`）。v3 的换发（B9b）与跟随（B9c）触发器已删除。

内部表（membership / credential / session / loyalty 明细等）不设可视码，只用 `id uuid`。

---

## 12. 跨 schema FK 速查表（本域内）

| 从                                                             | 到                                                | 类型                                             | 依据                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `identity.identities.user_id`                                  | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `credential.*.user_id`                                         | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `kyc.user_kycs.user_id`                                        | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `kyc.tenant_verifications.tenant_id`                           | `tenancy.tenants.id`                              | 真 FK                                            | 普通引用                                                                                              |
| `kyc.verification_policies.product_id`                         | `product.products.id`                             | 真 FK（NULL 允许）                               | 普通引用；NULL=平台基准值                                                                             |
| `tenancy.tenants.owner_user_id`                                | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `tenancy.tenant_logos.tenant_id`                               | `tenancy.tenants.id`                              | 真 FK                                            | 普通引用（同 schema 内，域内主键级联）                                                                |
| `tenancy.tenant_contacts.tenant_id`                            | `tenancy.tenants.id`                              | 真 FK（CASCADE）                                 | 普通引用（同 schema 内）                                                                              |
| `tenancy.tenant_contacts.user_id`                              | `account.users.id`                                | 真 FK（SET NULL）                                | 联系人是平台用户时关联，见 §5.8                                                                       |
| `tenancy.tenant_branding.tenant_id`                            | `tenancy.tenants.id`                              | 真 FK（CASCADE）                                 | 普通引用（同 schema 内），见 §5.9                                                                     |
| `tenancy.tenant_memberships.user_id`                           | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `tenancy.tenant_memberships.(role_id, role_scope)`             | `access.roles.(id, scope)`                        | 真 FK（复合）                                    | **2026-07-04 修正**：原误列边界#4，现改真 FK 并锁 scope，见 §5.5                                      |
| `tenancy.workspace_memberships.(role_id, role_scope)`          | `access.roles.(id, scope)`                        | 真 FK（复合）                                    | 同上，见 §5.6                                                                                         |
| `tenancy.workspace_memberships.(workspace_id, tenant_id)`      | `tenancy.workspaces.(id, tenant_id)`              | 真 FK（复合，CASCADE）                           | **2026-07-04 新增**：锁 ws 真实所属 tenant，见 §5.6                                                   |
| `tenancy.workspace_memberships.(tenant_id, user_id)`           | `tenancy.tenant_memberships.(tenant_id, user_id)` | 真 FK（复合，CASCADE）                           | **2026-07-04 新增**：ws 成员 ⊆ tenant 成员不变量，见 §5.6                                             |
| `tenancy.invitations.(role_id, scope)`                         | `access.roles.(id, scope)`                        | 真 FK（复合，复用既有 scope 列）                 | 同上，见 §5.7                                                                                         |
| `access.permissions.parent_id`                                 | `access.permissions.id`                           | 真 FK（自引用）                                  | 普通引用（树形，同表）                                                                                |
| `appoidc.oidc_consents.user_id`                                | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `appoidc.oidc_clients.product_id`                              | `product.products.id`                             | 真 FK（NULL 允许）                               | **2026-07-04 修正**：同物理库普通引用，非物理库界（原误标边界#4）                                     |
| `tenancy.tenant_memberships.(default_workspace_id, tenant_id)` | `tenancy.workspaces.(id, tenant_id)`              | 真 FK（复合）                                    | **2026-07-04 新增**：默认 ws 必属本 tenant                                                            |
| `session.refresh_tokens.session_id`                            | Redis 会话 sid（非 auth_sessions.id）             | **裸值**，不建 FK（**边界#1** 跨物理存储 Redis） | **2026-07-04 撤回**：会话 Redis-primary、OIDC 登录不写 auth_sessions，FK 致登录热路径违约；改回松引用 |
| `session.*.user_id`                                            | `account.users.id`                                | **裸值**，不建 FK                                | 边界#2（realm 安全隔离）                                                                              |
| `loyalty.*.user_id`                                            | `account.users.id`                                | 真 FK                                            | 普通引用                                                                                              |
| `kyc.*_kycs.reviewer_id` / `tenant_verifications.reviewer_id`  | `admin.operator_accounts.id`                      | **裸值**，不建 FK                                | 边界#2（realm 隔离，operator 主体）                                                                   |

---

## 13. 待办 / 开放项

- 本文表名为**目标态**，落地迁移步骤（重灌 or 加列改造）由 `data_identity_3**` 实施文档另定。
- `oidc_clients.product_id` 待 `product` 域重建后评估是否升级为真 FK。
- 是否需要拆分本文（如按 §1–§4 为一份、§5–§9 为一份）视篇幅增长再定，当前单文件（`data_identity_200`）内留 `210`/`220` 空位。
- 代码注释中对旧文件名 / 旧表名（单数）的引用尚未同步，属代码工作线范畴（见 [[feedback_scope]]）。
- **自定义角色（未来）**：`access.roles` 加 `tenant_id` 列后，"系统角色 NULL vs 自定义角色须归属正确租户"这条不变量无法用 FK 表达，需应用层校验 + 低频一致性巡检查询（见 §6.1 说明），当前不建。
- **role_assignments（未来增量表）**：若业务侧确认需要"基础角色 + 叠加授权"，新增该表与 `role_id` 取并集，membership 表结构不再需要变动（见 §5.5）。
