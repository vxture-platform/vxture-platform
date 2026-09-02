# Vxture 平台数据架构 —— schema / 表 / 字段级设计（DDL 规格）

> 配套：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md)（**架构权威**：设计意图/约定/约束/禁止 + 各域概览+核心字段）；[`data_platform_300_migration.md`](./data_platform_300_migration.md)（落地/迁移 runbook）。
> 本文 = **字段级最终态规格**：各 schema 全表 DDL / 列 / 索引 / 触发器 / Prisma 关系。**章节号沿用架构文档原编号（§4–§15）**便于交叉引用。命名/列规范见架构文档 §3.2；跨平面铁律见架构 §2；跨切面约束（非-Prisma DDL 清单/对象存储/request_id/数据访问分层）见架构 §17。
> 状态：v1（自 data_platform_100_architecture.md 抽出，2026-07-01）。落地/迁移/待决一律见 runbook。
> 📌 说明：本文多处以 `database.md §X` 标注**历史设计来源**；`database.md`（旧顶层）已于 2026-07-01 并入 [`data_platform_100_architecture.md`](./data_platform_100_architecture.md)（§2/§3.2）并删除，此类引用仅表设计沿革、不再指向现存文件。

---

## 4. identity 域（修订 · 字段级）

> 现状基线：`deploy/database/prisma/schema.prisma` 的 18 张 identity 表（自 2026-06-18 上生产）。
> **identity/iam 字段级权威 = 本文（data_platform_200_schema.md）**。原 `identity-data-model.md`（已退役删除）的 §4/§5 已并入本章；任何冲突一律以本章为准。
> 折叠来源：v1.1 §5a（organizations→tenant）、§5e（user_profile 拆分）；并补齐 v1.1 未触及的全 auth 表面。
> **本章纠正骨架稿一处**：§4 骨架曾写"owner 由 `tenant_membership.role='owner'` 派生（废 `owner_user_id`）"——该结论已被 runbook §0.4 + v1.1 §5a 修订与本任务 (rank 18) **推翻**：`owner_user_id` **保留**，并以部分唯一索引直接表达约束（见 §4.2.1/§4.17）。

### 4.0 目标模型与本域不变量

四层稳定模型 `User → Tenant(personal/organization 统一) → Workspace → 两级 Membership`：

```
identity.users ──┬── tenant_membership ──► identity.tenant   (type=personal|organization, owner_user_id)
                 │                              │ 1:N
                 └── workspace_memberships ──► identity.workspaces (tenant_id, is_default)
```

- **订阅/配额/用量挂 `workspace_id`**（commerce 侧，§8）；**计费管理权在 tenant/org 级**（`org.billing.manage` ⇒ owner，iam §5）。本域只提供四层主键与归属，不持任何 entitlement/配额（身份与业务严格解耦，access token 不带 entitlement）。
- **个人租户 = `type='personal'`**：注册即建 1 个 default workspace + 一条 `role='owner'` 的 `tenant_membership`（统一模型，不拆表）。
- **双 realm 硬隔离**：本域全部表只服务 customer realm（终端客户）；workforce/operator 身份在 `admin` 域（§14，`operator_*`），与本域**无任何 FK**。成长字段（profile/points/level/verification）只作用于 customer realm，不得泄漏到 operator（§4.18）。

**受影响表去向矩阵（19 表）**

| 目标表                  | 处置 | 来源 / 现表                         | 主要变更（rank）                                                                                           |
| ----------------------- | ---- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `users`                 | 修订 | deploy `users` / v1.1 §5e           | 收紧为纯认证；MOVE 展示列至 `user_profile`；补 status CHECK（rank 12）                                     |
| `user_profile`          | 新建 | v1.1 §5e                            | display_name/avatar/bio/language/timezone/extra（rank 12）                                                 |
| `user_credential`       | 沿用 | deploy / idm §4.3                   | Argon2id 全量，无变更                                                                                      |
| `user_avatar`           | 沿用 | deploy                              | bytea 头像，无变更（对象存储迁移待 §17）                                                                   |
| `identities`            | 沿用 | deploy / idm §4.2                   | 联邦绑定，**不按 email 自动并号**                                                                          |
| `tenant`                | 修订 | deploy `organizations` / v1.1 §5a   | 改名 organizations→tenant；`type` team→organization；`owner_user_id` **保留** + 部分唯一索引（rank 13/18） |
| `tenant_profile`        | 修订 | deploy `organization_profile`(#540) | 改名 + `organization_id`→`tenant_id`（rank 13）                                                            |
| `tenant_membership`     | 修订 | deploy `org_memberships` / v1.1 §5a | 改名 + `organization_id`→`tenant_id`；owner 唯一索引                                                       |
| `workspaces`            | 修订 | deploy                              | `organization_id`→`tenant_id`；default 部分唯一索引                                                        |
| `workspace_memberships` | 沿用 | deploy                              | 已是 `workspace_id`，无 FK 改名                                                                            |
| `invitation`            | 修订 | deploy / idm §4.8                   | `organization_id`→`tenant_id`；`scope` 值**保留** `org`（对齐 iam.role.scope，见 §4.3.4）（rank 13）       |
| `auth_session`          | 修订 | deploy / idm §4.9                   | `realm` tenant→customer / operator→workforce + CHECK（rank 14）                                            |
| `refresh_token`         | 沿用 | deploy / idm §4.9                   | opaque 轮换 + 重放检测                                                                                     |
| `user_verification`     | 沿用 | deploy                              | append-only 验证码                                                                                         |
| `password_reset_token`  | 沿用 | deploy                              | append-only                                                                                                |
| `login_attempt`         | 沿用 | deploy                              | 风控/限速                                                                                                  |
| `oauth_provider`        | 沿用 | deploy                              | 入站联邦 broker 配置（表驱动启用）                                                                         |
| `oauth_state`           | 沿用 | deploy                              | OAuth 握手状态                                                                                             |
| `audit_event`           | 修订 | deploy / idm §4.10                  | `organization_id`→`tenant_id`（rank 13）                                                                   |

> 成长子域（`level_no` / `user_points*` / `user_level_*` / `tenant.verification_*`）虽**物理列挂在本域的 `users`/`tenant` 上**，字段级设计归 **§6**，本章不展开，仅在对应表标注"§6 追加"。

---

### 4.1 用户与凭据

#### 4.1.1 `users`【修订 · deploy `identity.users` / v1.1 §5e / rank 12】

收紧为**纯认证身份表**。`name` / `avatar_url` / `avatar_hash` / `bio` / `timezone` / `language` 这 6 列在 deploy 现表上**已存在**，按 (rank 12) 是 **MOVE 到 `user_profile` 而非新增**；`account_changed_at`（改名限频，属认证语义）**保留在本表**（rank 12 补入保留清单）。

```sql
-- 目标结构（保数据迁移，见 runbook §4.19）
CREATE TABLE identity.users (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_no            bigint       NOT NULL UNIQUE DEFAULT nextval('identity.user_no_seq'),  -- 对外稳定数字号（序列见 §17）
  account            varchar(64)  NOT NULL UNIQUE,           -- 登录句柄；未提供时系统生成
  account_changed_at timestamptz,                            -- 上次改名时间（限频），rank 12 保留
  email              varchar(128) UNIQUE,                    -- 可空，可未验证
  email_verified_at  timestamptz,
  phone              varchar(32)  NOT NULL UNIQUE,           -- 强制已验证的全局强锚点
  phone_verified_at  timestamptz  NOT NULL,
  status             varchar(32)  NOT NULL DEFAULT 'active', -- active | disabled | locked
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT chk_users_status CHECK (status IN ('active','disabled','locked'))
);
CREATE INDEX idx_users_email   ON identity.users (email);
CREATE INDEX idx_users_phone   ON identity.users (phone);
CREATE INDEX idx_users_status  ON identity.users (status);
CREATE INDEX idx_users_deleted ON identity.users (deleted_at);
```

> **锚点规则**：`account`/`email`/`phone` 各自 UNIQUE；`phone` NOT NULL 且已验证（强锚点，注册必收并验手机）；`email` 可空、可未验证。
> **成长子域（§6）追加**：`level_no integer NOT NULL DEFAULT 1`（不在本域字段级展开）。

#### 4.1.2 `user_profile`【新建 · v1.1 §5e / rank 12】

1:1 挂 `users`，承载展示/本地化资料，把核心鉴权表从低频展示字段中解耦（资料编辑接口无能力触及 `phone_verified_at` 等安全列）。

```sql
CREATE TABLE identity.user_profile (
  user_id      uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  display_name varchar(96),    -- ← MOVE 自 users.name
  avatar_url   varchar(512),   -- ← MOVE 自 users.avatar_url（指向 user_avatar 的版本化 URL）
  avatar_hash  varchar(64),    -- ← MOVE 自 users.avatar_hash（内容 sha256，作 URL 版本段/ETag/claim 轻读）
  bio          varchar(512),   -- ← MOVE 自 users.bio（deploy 为 text，迁移收敛，见下）
  language     varchar(16),    -- ← MOVE 自 users.language（取舍见下；存 BCP-47 值如 zh-CN）
  timezone     varchar(64),    -- ← MOVE 自 users.timezone
  extra        jsonb,          -- 低频小众属性兜底，避免反复加列改表
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

- **`locale` vs `language` 取舍（rank 12）**：选 **`language`**——① deploy 现列即 `users.language`，MOVE 为 1:1 列迁移、无语义改名；② 与 `tenant_profile.language`（#540 已建）保持两张 profile 表命名一致。v1.1 §5e 草拟的 `locale` 名在此**作废**；该列仍存 BCP-47 富值（如 `zh-CN`），是命名取舍而非语义收窄。
- **`bio` 类型（保数据迁移注意）**：deploy `users.bio` 为 `text`，v1.1 §5e 定 `varchar(512)`。MOVE 前须先 `SELECT max(length(bio))`，≤512 才收窄为 `varchar(512)`，否则保留 `text` 以免截断（在产域不接受丢数据）。
- **统一拆分约定（rank 13）**：`user_profile` 与 `tenant_profile` 遵同一约定——**核心表（`users` / `tenant`）= 身份/认证 + 生命周期；`*_profile` 1:1 表 = 展示/联系/本地化 + 内联二进制（avatar/logo bytea）+ `extra` jsonb 扩展**。两表 PK 均为父实体 id、`ON DELETE CASCADE`。

#### 4.1.3 `user_credential`【沿用 · deploy / idm §4.3】

`user_id`(PK, FK→users ON DELETE CASCADE) / `password_hash varchar(255)`（**Argon2id**，phone-code-only 用户可空）/ `password_changed_at` / `force_password_change boolean DEFAULT false` / `created_at` / `updated_at`。无 bcrypt 列、无 mfa 列（MFA 阶段二的可空 seam）。字段级权威即本章。

#### 4.1.4 `user_avatar`【沿用 · deploy】

`user_id`(PK, FK→users ON DELETE CASCADE) / `data bytea` / `content_type varchar(32)` / `hash varchar(64)`（内容 sha256）/ `source varchar(16)`（upload|federated_import）/ `updated_at`。仅承载真实头像；默认头像为前端内联 SVG（不入库）。`user_profile.avatar_url/avatar_hash` 是对它的版本化引用。bytea 是否迁出对象存储 → §17 待决。

#### 4.1.5 `identities`【沿用 · deploy / idm §4.2】

联邦绑定（google/feishu/dingtalk…）：`id` / `user_id`(FK→users CASCADE) / `provider varchar(32)` / `provider_subject varchar(255)` / `metadata jsonb` / `created_at` / `updated_at`。`UNIQUE(provider, provider_subject)` + `UNIQUE(user_id, provider)`。**不按 email 自动并号**（见 identity-platform-architecture.md §4）——账号合并以手机为锚点，见 `project_social_identity_consolidation`，属工程线。

---

### 4.2 Tenant / Workspace / Membership

#### 4.2.1 `tenant`【修订 · deploy `identity.organizations` / v1.1 §5a / rank 13/18】

```sql
ALTER TABLE identity.organizations RENAME TO tenant;                       -- 保数据
UPDATE identity.tenant SET type = 'organization' WHERE type = 'team';      -- team→organization 就地改值（runbook §0.4）
ALTER TABLE identity.tenant
  ADD CONSTRAINT chk_tenant_type CHECK (type IN ('personal','organization'));
```

目标结构：

```
id uuid PK
name           varchar(128) NOT NULL
type           varchar(16)  NOT NULL          -- personal | organization（原 personal | team）
owner_user_id  uuid NOT NULL REFERENCES identity.users(id)   -- 保留（rank 18）
status         varchar(32)  NOT NULL DEFAULT 'active'
created_at / updated_at / deleted_at
```

- **`owner_user_id` 保留（rank 18，纠正 §4 骨架"派生/废弃"）**：高频鉴权路径的反规范化（判"当前 user 是否该 tenant owner"免 join membership），与"access token 只带治理角色、业务侧实时回查"同一哲学。一致性兜底用真实约束/转移函数（§4.17），不靠注释。
- **每 user 至多 1 个 personal tenant（rank 18）**：v1.1 §5c 认为"跨表约束不适合 DB 表达"的前提**被纠正**——`owner_user_id` 既在 `tenant` 表上，约束可直接表达，不必下放应用层：

```sql
CREATE UNIQUE INDEX uidx_tenant_personal_owner
  ON identity.tenant (owner_user_id)
  WHERE type = 'personal' AND deleted_at IS NULL;   -- 含 deleted_at 排除：注销后可再开个人租户
```

> **成长子域（§6）追加**：`verification_status` / `verification_type`（KYC 门控，跨 identity/commerce/product，§6 + commerce.verification_policy）。

#### 4.2.2 `tenant_profile`【修订 · deploy `identity.organization_profile`(#540) / rank 13】

```sql
ALTER TABLE identity.organization_profile RENAME TO tenant_profile;
ALTER TABLE identity.tenant_profile RENAME COLUMN organization_id TO tenant_id;
```

字段沿用 #540（`tenant_id` PK, FK→tenant CASCADE）：`logo_data bytea` / `logo_content_type` / `logo_hash` / `description text` / `industry` / `scale` / `website` / `contact_name`/`contact_role`/`contact_email`/`contact_phone` / `country_code` / `address` / `postal_code` / `is_billing_recipient boolean` / `timezone` / `language` / `currency` / `created_at` / `updated_at`。与 §4.1.2 同一拆分约定（核心瘦、profile 承展示/联系/本地化 + logo bytea）。

#### 4.2.3 `tenant_membership`【修订 · deploy `identity.org_memberships` / v1.1 §5a】

```sql
ALTER TABLE identity.org_memberships RENAME TO tenant_membership;
ALTER TABLE identity.tenant_membership RENAME COLUMN organization_id TO tenant_id;
-- 旧唯一键 org_memberships_org_user_key 随列改名为 (tenant_id, user_id)
```

列：`id` / `tenant_id`(FK→tenant CASCADE) / `user_id`(FK→users) / `role varchar(32) DEFAULT 'member'`（取值引用 `iam.role.code` scope=`org`，**不建跨 schema FK**，按 code 解析）/ `status varchar(32) DEFAULT 'active'` / `created_at` / `updated_at`。`UNIQUE(tenant_id, user_id)`。**个人租户也必须有一条 `role='owner'` 行**。每 tenant 至多一个 owner：

```sql
CREATE UNIQUE INDEX uidx_tenant_membership_owner
  ON identity.tenant_membership (tenant_id) WHERE role = 'owner';
```

#### 4.2.4 `workspaces`【修订 · deploy / v1.1 §5a】

```sql
ALTER TABLE identity.workspaces RENAME COLUMN organization_id TO tenant_id;  -- 跟随上层改名
```

列：`id` / `tenant_id`(FK→tenant CASCADE) / `name` / `is_default boolean DEFAULT false` / `description text` / `icon varchar(64)` / `status varchar(16) DEFAULT 'active'` / `created_at` / `updated_at` / `deleted_at`。注册创建恰好一个 default。**每 tenant 唯一 default**（现状 baseline 未建此索引，本次补为目标态不变量）：

```sql
CREATE UNIQUE INDEX uidx_workspace_default
  ON identity.workspaces (tenant_id) WHERE is_default AND deleted_at IS NULL;
```

> §6/§8.1 多处逻辑依赖"每 tenant 有且仅有一行 `is_default=true`"——此索引把该前提从口头约定变为 DB 强制。

#### 4.2.5 `workspace_memberships`【沿用 · deploy】

`id` / `workspace_id`(FK→workspaces CASCADE) / `user_id`(FK→users) / `role varchar(32)`（引用 `iam.role.code` scope=`workspace`）/ `status` / `created_at` / `updated_at`。`UNIQUE(workspace_id, user_id)`。引用列为 `workspace_id`，不涉 organizations→tenant 改名，**无 FK 列改名**，整表沿用。

---

### 4.3 Auth 支撑表面

#### 4.3.1 `auth_session`【修订 · deploy / idm §4.9 / rank 14】

中心会话镜像（Redis 为主）。`realm` 取值收窄（runbook §0.4）：

```sql
UPDATE identity.auth_session SET realm = CASE realm
  WHEN 'tenant'   THEN 'customer'
  WHEN 'operator' THEN 'workforce'
  ELSE realm END;                                  -- 就地改值，保数据
ALTER TABLE identity.auth_session
  ADD CONSTRAINT chk_auth_session_realm CHECK (realm IN ('customer','workforce'));
```

列：`id` / `sid varchar(64) UNIQUE` / `user_id`(loose，**无跨实体 FK**，customer/operator 共表靠 realm 区分) / `realm varchar(16)`（customer|workforce）/ `auth_method` / `ip_address` / `user_agent` / `status varchar(16) DEFAULT 'active'` / `last_active_at` / `expires_at` / `revoked_at` / `created_at`。

> realm 取值与代码/seed/cookie/sub 前缀强耦合，rename 须与发版锁步 → 工程线，见 runbook §4.19 波及面。

#### 4.3.2 `refresh_token`【沿用 · deploy / idm §4.9】

opaque、轮换、重放检测：`id` / `user_id`(loose) / `session_id`(loose→auth_session.id) / `client_id varchar(64)` / `token_hash varchar(64) UNIQUE` / `rotated_from uuid`（轮换链）/ `status varchar(16) DEFAULT 'active'`（active|rotated|revoked）/ `expires_at` / `created_at`。重放 = 出示 status≠active 的 token_hash → 吊销整条会话链。

#### 4.3.3 验证 / 重置 / 风控 / 联邦握手【沿用 · deploy】

- **`user_verification`**：`id` / `user_id?` / `target_type`(email|phone) / `target` / `purpose` / `code_hash varchar(64)` / `attempt_count int DEFAULT 0` / `expires_at` / `used_at` / `created_at`。append-only。
- **`password_reset_token`**：`id` / `user_id`(loose) / `token_hash varchar(64) UNIQUE` / `expires_at` / `used_at` / `created_at`。append-only。
- **`login_attempt`**：`id` / `user_id?` / `identifier varchar(128)` / `auth_method` / `result varchar(32)` / `ip_address` / `country_code char(2)` / `user_agent` / `created_at`。`idx(identifier, created_at DESC)` + `idx(ip_address, created_at DESC)` 供限速/风控。
- **`oauth_provider`**：入站联邦 broker 配置（表驱动启用，免改 env/重部署）：`id` / `code varchar(64) UNIQUE` / `name` / `client_id?` / `client_secret?` / `scope?` / `auth_url?` / `token_url?` / `account_info_url?` / `redirect_uri?` / `is_enabled boolean DEFAULT true` / `sort` / `created_at` / `updated_at`。
- **`oauth_state`**：OAuth 握手状态，append-only：`id` / `provider_code` / `state varchar(128) UNIQUE` / `redirect_uri` / `code_verifier?`(PKCE) / `nonce?` / `ip_address?` / `expires_at` / `created_at`。

#### 4.3.4 `invitation`【修订 · deploy / idm §4.8 / rank 13】

```sql
ALTER TABLE identity.invitation RENAME COLUMN organization_id TO tenant_id;
```

列：`id` / `scope varchar(16)`（**保留取值 `org` / `workspace`**，见下）/ `tenant_id uuid?`(FK→tenant) / `workspace_id uuid?`(FK→workspaces) / `target_type`(email|phone) / `target` / `role varchar(32)` / `status varchar(32) DEFAULT 'pending'`（pending|accepted|expired|revoked）/ `token_hash varchar(64) UNIQUE` / `expires_at` / `accepted_at?` / `created_by` / `created_at` / `updated_at`。

> **`scope` 值不改名（一致性裁决，rank 13）**：实体由 organization 改名为 **tenant**，但**治理层级**名仍叫 `org`（与 `iam.role.scope IN ('org','workspace')` 一致，§5）。故仅改 FK 列 `organization_id→tenant_id`，**`scope` 取值仍 `org|workspace`**，避免与 iam 角色目录的 scope 维度分叉。

#### 4.3.5 `audit_event`【修订 · deploy / idm §4.10 / rank 13】

```sql
ALTER TABLE identity.audit_event RENAME COLUMN organization_id TO tenant_id;
-- 索引 idx_audit_event_organization_id 随列改名为 idx_audit_event_tenant_id
```

列：`id` / `event_type varchar(32)`（UserLogin/UserLogout/IdentityBind/RoleChange/TokenIssue + `*Failed`）/ `user_id?` / `tenant_id?` / `workspace_id?` / `result varchar(16)`(success|failure) / `ip_address?` / `metadata jsonb?` / `created_at`。append-only（本域自含审计，独立于 `support.audit_log`）。

---

> 编号说明：§4.4–§4.16 为预留空档；§4.17/§4.18 为稳定主题 ID（owner 一致性 / 双 realm 隔离）；§4.19（在产域迁移）已迁至 runbook。编号有意跳号、非缺失。

### 4.17 owner 跨表一致性：真实约束 + 转移函数（rank 18）

`tenant.owner_user_id`（反规范化）与 `tenant_membership(role='owner')`（权威成员行）两处必须一致。(rank 18) 要求"用真实约束/转移函数，非仅注释"：

```sql
-- (a) 唯一合法的 owner 转移路径：同事务原子改两处，业务代码不得绕过分别 UPDATE
CREATE FUNCTION identity.transfer_tenant_owner(p_tenant uuid, p_new_owner uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE identity.tenant_membership
     SET role = 'member', updated_at = now()
   WHERE tenant_id = p_tenant AND role = 'owner';
  INSERT INTO identity.tenant_membership (tenant_id, user_id, role, status)
       VALUES (p_tenant, p_new_owner, 'owner', 'active')
  ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET role = 'owner', status = 'active', updated_at = now();
  UPDATE identity.tenant
     SET owner_user_id = p_new_owner, updated_at = now()
   WHERE id = p_tenant;
END $$;

-- (b) 提交期一致性兜底：DEFERRABLE 约束触发器，防绕过 (a) 直接 UPDATE 造成漂移。
--     断言：tenant.owner_user_id == 该 tenant 中 role='owner' 成员的 user_id。
CREATE CONSTRAINT TRIGGER trg_tenant_owner_consistency
  AFTER INSERT OR UPDATE OF owner_user_id ON identity.tenant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION identity.assert_tenant_owner_consistency();
CREATE CONSTRAINT TRIGGER trg_membership_owner_consistency
  AFTER INSERT OR UPDATE OF role, user_id OR DELETE ON identity.tenant_membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION identity.assert_tenant_owner_consistency();
```

三道防线协同：`uidx_tenant_membership_owner`（≤1 owner 行）+ `uidx_tenant_personal_owner`（≤1 personal/user）+ 约束触发器（两处取值一致）。三者均为非 Prisma DDL，登记 §17 重建清单。

### 4.18 双 realm 隔离边界

- 本域所有表只服务 **customer realm**；workforce/operator 身份在 `admin.operator_*`（§14），与本域**零 FK**、独立会话 cookie（`vx_sid_op`，host-only，非 `.vxture.com`）、独立 `sub`/`aud` 命名空间。
- `auth_session` 是唯一以 `realm` 列同表承载两域会话的表，但 `user_id` 为 loose 列（无 FK），customer 行指向 `identity.users`、workforce 行指向 `admin.operator_account`，靠 `realm` 区分，**绝不交叉解引用**。
- 成长字段（`users.level_no`、`user_points*`、`tenant.verification_*`，§6）仅对 customer realm 有意义，不得出现在 operator 模型或其 token claims。

> 📦 **落地/迁移**：原「4.19 在产域保数据迁移 + 波及面」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 5. iam 域：两级 RBAC + OIDC 客户端 + 签名密钥

> 现状权威：deploy `schema.prisma` iam（5 model）+ `identity-platform-access-topology.md`（D-AU/D-AW）。吸收 v1.1 §5b。
> **iam 自 2026-06-18 上生产，属在产域** → 全部按"保数据迁移"（加列带默认或可空、就地 `UPDATE` 改取值、补 CHECK/索引），**不 reseed**；落笔前先核生产 `oidc_client`/`signing_key` 实际行数。

**目标**：iam 只承载三件事——① **治理型**两级 RBAC 全局目录（org/workspace：谁能管这个组织/空间），② 平台自有产品矩阵 + 平台入口接入统一 IdP 的 **OIDC 客户端注册**，③ RS256 **签名密钥**公钥/元数据。`iam` 维持独立 schema，**不并入 identity**（`identity` 管"用户是谁"，`iam.oidc_client` 管"哪些产品/客户端可接入认证"，非同一层级，v1.1 §5b 已澄清）。

**职责边界三连**（写死本章红线）：

1. **iam 是治理 RBAC，不是业务授权**——`role`/`permission` 只表达"能否管理组织/空间/计费"，不表达"能否操作某业务对象 Y"（后者在各业务域 OUT，不入平台库）。
2. **entitlement/capability 已移出 iam**——能力门控、配额、权益**实时派生、不入 token、归 commerce**（§8 `entitlement_cache` 一脉），本章 §5.5 显式声明 `iam.capability`/`plan_capability`/`subscription_capability` **退役**。
3. **双 realm 硬隔离**——`oidc_client.realm` 与 `auth_session.realm`（identity，§4）取值对齐为 **customer/workforce**，两套账号体系完全独立、互不相通；operator（workforce）因 realm 隔离不受客户面 SLO 影响。

### 5.1 三套权限域隔离（沿用 database.md §3.3，随 ops→admin 更新）

iam 只占其中一套；本表用于划清不要把另外两套塞进 iam。

| 域                    | 位置                                                  | 用途                                                                                     |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **治理 RBAC**（本章） | `iam.role` / `iam.permission` / `iam.role_permission` | 组织/空间治理：成员、角色、设置、**计费管理**（计费管理权在 org 级，订阅虽落 workspace） |
| 业务授权              | 各业务域（OUT，不入平台库）                           | 能否操作业务对象 Y                                                                       |
| 运营域 RBAC           | `admin`（原 `ops`）域运营 RBAC 表，§14                | 运营人员在 admin 后台的权限（与客户面 iam 各自独立，**互不引用、无 FK**）                |

### 5.2 治理 RBAC：role / permission / role_permission 【沿用】

deploy iam 现表（`role`/`permission`/`role_permission`），二次分析确认 3 表已存在、结构正确，**无字段级改动**，仅补两条 CHECK 收紧取值。对应 v1.1：v1 仅把角色当成员表内联字符串处理，本章补齐"全局目录"定位。

```sql
-- 【沿用】deploy iam.role / database.md §3.3
-- 全局治理角色目录（非 per-tenant）：scope 内 code 唯一
CREATE TABLE iam.role (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code       varchar(64)  NOT NULL,            -- owner | manager | member
    scope      varchar(16)  NOT NULL,            -- org | workspace
    name       varchar(128) NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (scope, code)                         -- deploy: role_scope_code_key
);
CREATE INDEX idx_role_scope ON iam.role (scope);
-- 补 CHECK（现表无，收紧 scope 取值）：
ALTER TABLE iam.role ADD CONSTRAINT chk_role_scope CHECK (scope IN ('org','workspace'));

-- 【沿用】deploy iam.permission / database.md §3.3
-- 权限项目录，code 全局唯一
CREATE TABLE iam.permission (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        varchar(128) NOT NULL UNIQUE,    -- org.member.manage | workspace.settings.manage | org.billing.manage ...
    description varchar(512),
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- 【沿用】deploy iam.role_permission / database.md §3.3
-- 角色 → 权限关联，复合主键
CREATE TABLE iam.role_permission (
    role_id       uuid NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES iam.permission(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permission_permission_id ON iam.role_permission (permission_id);
```

要点：

- **RBAC 角色集（MVP）**：org `owner / manager / member`、workspace `owner / manager / member`（database.md §3.3）。**计费管理权限挂在 org 级**（订阅落 workspace，但谁能改订阅/付款由 org 角色决定）。
- **成员表按 code 内联引用**：`identity.tenant_membership.role`（scope='org'）与 `identity.workspace_memberships.role`（scope='workspace'）以**字符串 code** 引用 `iam.role.code`，**不建跨 schema 外键**（按值引用，database.md §3.3"成员表内联 role code"）；owner 唯一性等约束在 identity 域（§4）兜底，非本章。
- 目录全局、非 per-tenant、变更极少。

### 5.3 oidc_client：realm 收窄 + product_id + release_channel + 品牌 + SLO 参与【修订】

对应 deploy iam.oidc_client + v1.1 §5b + topology D-AU/D-AW。下为**目标态全字段**，随后给在产域 ALTER 增量。

```sql
-- 【修订】deploy iam.oidc_client（在产，保数据迁移）
-- 平台自有产品矩阵 + 平台入口接入统一 IdP 的注册记录（≠ product.application ≠ agent）
CREATE TABLE iam.oidc_client (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                 varchar(64)  NOT NULL UNIQUE,          -- 沿用
    name                      varchar(128) NOT NULL,                 -- 沿用（内部识别名）
    -- ── D-AU 统一登录/登出界面品牌（沿用：deploy 已有，非新增；修正 §5 骨架"topology 要求新增"措辞）──
    display_name              varchar(128),                          -- 沿用，登录面/post-logout 页展示"已从 [RP] 安全退出"
    logo_url                  varchar(512),                          -- 沿用，同上携带 RP logo
    -- ── realm（修订：取值收窄，不改字段名）──
    realm                     varchar(16)  NOT NULL DEFAULT 'customer', -- customer | workforce（原 tenant | operator）
    client_secret_hash        varchar(255),                          -- 沿用（机密客户端，仅存 hash；公开客户端为 NULL + pkce_required）
    redirect_uris             text[]       NOT NULL DEFAULT '{}',    -- 沿用
    post_logout_redirect_uris text[]       NOT NULL DEFAULT '{}',    -- 沿用
    back_channel_logout_uri   varchar(512),                          -- 沿用（SLO back-channel 接收端点）
    allowed_scopes            text[]       NOT NULL DEFAULT '{}',    -- 沿用（openid/profile/email/phone/offline_access...）
    access_token_ttl          integer      NOT NULL DEFAULT 900,     -- 沿用（秒）
    refresh_token_ttl         integer      NOT NULL DEFAULT 2592000, -- 沿用（秒）
    pkce_required             boolean      NOT NULL DEFAULT true,     -- 沿用
    is_enabled                boolean      NOT NULL DEFAULT true,     -- 沿用
    -- ── 新增（v1.1 §5b）：接产品矩阵 + 发布渠道 ──
    product_id                uuid,                                  -- 新增，FK→product.product(id)，nullable，1:N（见迁移顺序 runbook §5.6）
    release_channel           varchar(32)  NOT NULL DEFAULT 'stable',-- 新增，stable | beta（发布渠道，非部署环境）
    -- ── 新增（topology D-AW）：每客户端 SLO 参与方式 ──
    slo_participation         varchar(32)  NOT NULL DEFAULT 'back_channel', -- back_channel | local_only | none
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_oidc_client_realm      ON iam.oidc_client (realm);       -- 沿用
CREATE INDEX idx_oidc_client_is_enabled ON iam.oidc_client (is_enabled);  -- 沿用
CREATE INDEX idx_oidc_client_product    ON iam.oidc_client (product_id) WHERE product_id IS NOT NULL; -- 新增
```

**字段语义与约束**：

- **realm（修订，取值收窄不改名）**：`'tenant' → 'customer'`（Okta/Microsoft "customer identity" 标准术语，面向终端客户）、`'operator' → 'workforce'`（Okta "Workforce Identity"，面向内部运营人员）。字段命名（realm = Keycloak"完全隔离、互不可见的认证域"）本身准确，只改取值以避免与 `identity.tenant` 概念撞车。
- **product_id（新增，v1.1 §5b）**：FK → `product.product(id)`，**nullable、一对多、允许零，不加 UNIQUE**——① 多 client 可指向同一 product（见 release_channel）；② `website`/`console`/`admin` 等平台级入口 `product_id = NULL`（平台入口不对应可订阅 product）；③ 允许 product 无对应 client（纯 API 能力被嵌入使用）。跨 schema FK 处置见 runbook §5.6 / runbook §18.1#3。
- **release_channel（新增，v1.1 §5b）**：`stable | beta`，是**面向用户、用户可自选体验的发布渠道**（参考 Chrome Stable/Beta），**不是** deployment environment。`arda`→(product_id=Arda, stable)、`arda-beta`→(同 product_id, beta)。beta 是否计费由 `product.plan`/`plan_component` 是否引用决定，本字段**仅做认证层渠道标识，不参与计费判断**。
- **display_name / logo_url（沿用，D-AU）**：deploy 已有，**无需 DDL 变更**；登录面与统一中性 post-logout 页据此携带发起 RP 品牌（logo/title），渲染"已从 [RP] 安全退出"。剩余是 accounts UI 接线（**工程线**），非数据库改动。
- **slo_participation（新增，D-AW，"跨域登出方式可选择/可配置"）**：
  - `back_channel` —— 参与全域 SLO，IdP 经 `back_channel_logout_uri` 强制推送 `logout_token`（默认，子域 RP 取此值）；
  - `local_only` —— 不接收 back-channel，仅本 RP 主动登出时本地清，不被其他 RP 登出连带（适合跨域 ruyin 选择性弱耦合）；
  - `none` —— 完全不参与全域 SLO。
- **back_channel_logout_uri / post_logout_redirect_uris / redirect_uris / allowed_scopes / pkce_required**：沿用现状；`back_channel_logout_uri` 在 `slo_participation='back_channel'` 时必填（下方 CHECK 行内兜底）。

**在产域迁移增量（保数据，不 reseed）**：

```sql
-- (1) realm 就地改名（与 identity.auth_session.realm + seed 同步，属工程线，见 runbook §5.6/§17）
UPDATE iam.oidc_client SET realm = 'customer'  WHERE realm = 'tenant';
UPDATE iam.oidc_client SET realm = 'workforce' WHERE realm = 'operator';
ALTER TABLE iam.oidc_client ALTER COLUMN realm SET DEFAULT 'customer';
ALTER TABLE iam.oidc_client ADD CONSTRAINT chk_oidc_client_realm
    CHECK (realm IN ('customer','workforce'));

-- (2) 新增列（带默认/可空，安全在产加列）
ALTER TABLE iam.oidc_client
    ADD COLUMN product_id        uuid,
    ADD COLUMN release_channel   varchar(32) NOT NULL DEFAULT 'stable',
    ADD COLUMN slo_participation varchar(32) NOT NULL DEFAULT 'back_channel';

-- (3) 取值 CHECK + back-channel 行内一致性兜底
ALTER TABLE iam.oidc_client
    ADD CONSTRAINT chk_oidc_client_release_channel CHECK (release_channel IN ('stable','beta')),
    ADD CONSTRAINT chk_oidc_client_slo             CHECK (slo_participation IN ('back_channel','local_only','none')),
    ADD CONSTRAINT chk_oidc_client_slo_uri
        CHECK (slo_participation <> 'back_channel' OR back_channel_logout_uri IS NOT NULL);

CREATE INDEX idx_oidc_client_product ON iam.oidc_client (product_id) WHERE product_id IS NOT NULL;

-- (4) 跨 schema FK：待 product 域重建+reseed 后再加（顺序见 runbook §5.6）
-- ALTER TABLE iam.oidc_client ADD CONSTRAINT fk_oidc_client_product
--     FOREIGN KEY (product_id) REFERENCES product.product(id);
```

### 5.4 signing_key：RS256 公钥/元数据【沿用/微修订】

对应 deploy iam.signing_key。私钥**绝不落库**（进 secret manager / platform-identity.env），库内只存公钥 JWK + 轮换元数据。微修订两点：① 补 `retired_at`（现表只有 `activated_at`/`retiring_at`，缺退役时点，轮换审计需要）；② 补 status CHECK + "至多一把 active"部分唯一索引（现表无，轮换安全）。

```sql
-- 【沿用/微修订】deploy iam.signing_key
CREATE TABLE iam.signing_key (
    kid          varchar(64) PRIMARY KEY,                 -- JWKS kid（业务生成，非 gen_random_uuid）
    algorithm    varchar(16)  NOT NULL DEFAULT 'RS256',
    public_jwk   jsonb        NOT NULL,                   -- 仅公钥；私钥进 secret manager，不落库
    status       varchar(32)  NOT NULL DEFAULT 'next',    -- next | active | retiring | retired
    activated_at timestamptz,                             -- 转 active 时点
    retiring_at  timestamptz,                             -- 转 retiring 时点（仍验签、不再签发）
    retired_at   timestamptz,                             -- 微修订：补退役时点（彻底停用）
    created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_signing_key_status ON iam.signing_key (status);
-- 微修订（现表无，建议补）：
ALTER TABLE iam.signing_key ADD CONSTRAINT chk_signing_key_status
    CHECK (status IN ('next','active','retiring','retired'));
-- 同一时刻至多一把 active（创建前先确认现有 active ≤ 1）
CREATE UNIQUE INDEX uidx_signing_key_active ON iam.signing_key (status) WHERE status = 'active';

-- 在产微修订增量：
-- ALTER TABLE iam.signing_key ADD COLUMN retired_at timestamptz;
-- （status 现为 varchar(16)，仅容 ≤8 字符取值，已足；如对齐 §3.2 规范可 ALTER TYPE 至 varchar(32)，元数据级、可选）
```

轮换生命周期：`next`（预备，已广告 JWKS、未签发）→ `active`（当前签发）→ `retiring`（停止签发、仍验存量 token）→ `retired`（彻底停用）。这是首发部署坑点之一（社交登录闭合记忆 #12：签名密钥需跑 25+ 填 platform-identity.env+recreate auth-bff），DDL 层只承接元数据，密钥物料/轮换编排在工程线。

### 5.5 退役声明：entitlement/capability 移出 iam（SoT 归 commerce）

显式退役下列 entitlement-as-SoT 模型，**iam 不再承载能力门控**：

| 退役对象                      | 处置                                                        | 接替                                                                              |
| ----------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `iam.capability`              | **退役**（deploy 从未建表，无数据迁移）                     | entitlement 实时回查（不入 token）                                                |
| `iam.plan_capability`         | **退役**（同上，从未建表）                                  | `product.plan_component`（唯一 SoT，§7）+ `commerce.quota_pool`（实时余量，§8.2） |
| `iam.subscription_capability` | **退役**（旧 platform-db.md 模型，database.md §3.3 已废止） | `commerce.entitlement_cache`（短 TTL、非 SoT、供审计/调试，§8.8）                 |

依据：access token 只带**治理角色**、不含业务 entitlement；权益用今天的规则实时派生，避免 token 内嵌过期权益。与 database.md §3.3"~~能力门控 iam.capability/subscription_capability~~ 已废止"、本文 runbook §8.x"退役 iam.capability/plan_capability 作 entitlement SoT"一致。**deploy 现状 iam 仅 5 表，这些 capability 表从未物理存在，退役是纯声明、无迁移动作。**

> 📦 **落地/迁移**：原「5.6 迁移顺序、波及面与待决」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 6. identity 成长子域：积分/等级/KYC

> 吸收来源：`data-architecture-v1.1.md` §5c（等级/认证）+ §5d（积分/流水/进度/阈值）。本子域不是独立 schema，物理上分布在 `identity`（等级/积分/进度）与 `commerce`（KYC 可配置策略）+ `identity.tenant`（认证状态列），逻辑上构成"与计费独立的 per-user/per-tenant 成长面"。**基本沿用 v1.1，无结构争议**；本章只做三件事：① 落字段级 DDL + CHECK + 索引命名（database.md §9）；② 应用 runbook §0.4 锁定决策（`tenant.type=organization`、`realm=customer/workforce`）；③ 修复二次分析问题 **(rank 24)** `verification_policy` 在 `product_id IS NULL` 时唯一约束失效。

### 6.0 定位、realm 边界与跨章关系

- **成长面 = 客户面专属**：积分/等级/进度/KYC 全部只作用于 **`realm=customer`**（终端客户）身份；`workforce`（operator/运营人员，§14）不参与成长机制，两 realm 硬隔离（无 FK、无字段泄漏）。这与 §4「成长字段仅作用于 customer realm」一致。
- **三个挂载点**：
  - **user 本人维度**（全局、跨其名下所有 tenant 累计）：`users.level_no` + `user_points` + `user_points_ledger` + `user_task_progress`，配置表 `user_level_policy` / `user_level_threshold`。
  - **tenant 维度**（个人/组织各一套认证态）：`identity.tenant.verification_status/verification_type`。
  - **可配置策略**（跨 identity/commerce/product）：`commerce.verification_policy`。
- **与计费独立**：等级↔订阅是两套机制，不建外键直接挂钩（v1.1 §5c）；KYC 是付费订阅的**前置门控**，但门控规则下沉为 `verification_policy` 配置数据，校验动作在应用层（见 §6.3）。
- **与本文其他章的关系**：等级门控"路径 B 建组织数"约束 §4 的 User-Tenant 拓扑；`verification_policy.product_id` 引用 §7 `product.product`，并被 §7 的产品上架检查清单（`launch_checklist_item` 的 `'verification_policy'` 项）强制为上架前置；积分余额维护沿用 §8/§9「实时状态查状态表、不靠扫描明细现算」的同一条原则。

> 📦 **落地/迁移**：原「受影响表去向矩阵」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

### 6.1 等级维度（level）

用户等级是 **user 本人的全局属性**（v1.1 §5c：与具体哪个 tenant 无关、不由订阅推导），数字型、有序可比较。

#### 6.1.1 `identity.users.level_no`（修订·加列）

- 现状（deploy `users` 表，§4）：无 `level_no` 列。
- 目标：新增有序整数等级列。identity 为**在产域**（自 2026-06-18 上生产），按"保数据迁移"——**加列带默认值**，存量行自动得初始等级 1，**不 reseed**。

```sql
-- 【修订·加列】对应 v1.1 §5c；in-production identity，加列带默认即安全
ALTER TABLE identity.users
  ADD COLUMN level_no integer NOT NULL DEFAULT 1;     -- 1=初始等级；最高级数值见 6.1.2
-- CHECK：等级须落在已配置档位区间（占位 1..5，见 6.1.2）。用 FK 表达更稳，但 level_no
-- 是高频读列、不宜引外键回查；改用轻量 CHECK 兜底下界，上界随 policy 扩展。
ALTER TABLE identity.users
  ADD CONSTRAINT chk_users_level_no CHECK (level_no >= 1);
CREATE INDEX idx_users_level_no ON identity.users (level_no);
```

> 说明：等级**取值上界**由 `user_level_policy` 实际行数决定（应用层换算时只会落到已存在的 `level_no`），故 CHECK 只兜下界 `>=1`，避免每次配置加级都要改 CHECK。

#### 6.1.2 `identity.user_level_policy`（新建）：等级 → 建组织数上限

把"等级→可通过路径 B 新建组织 tenant 的数量上限"做成可配置表（运营改一行数据、不发版，v1.1 §5c）。

```sql
-- 【新建】对应 v1.1 §5c
CREATE TABLE identity.user_level_policy (
  level_no              integer       PRIMARY KEY,                 -- 与 users.level_no 对应
  max_owned_org_tenant  integer       NOT NULL,                    -- 该等级经"路径B"可建 organization tenant 数上限
  description           varchar(256),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_level_policy_max_owned CHECK (max_owned_org_tenant >= 0)
);

-- 5 级占位（业务待填，见 6.5）。占位值全设 1=最小合理值，保证"路径B建组织"在任何
-- 等级下都可用、不因占位数值导致功能不可用；业务侧用 UPDATE 替换为递增值即可，无需改表。
INSERT INTO identity.user_level_policy (level_no, max_owned_org_tenant, description) VALUES
(1, 1, '待业务侧配置'),
(2, 1, '待业务侧配置'),
(3, 1, '待业务侧配置'),
(4, 1, '待业务侧配置'),
(5, 1, '待业务侧配置');
```

> 顺序关系（等级递增、上限随等级单调不降）由 `level_no`/`max_owned_org_tenant` 数值大小隐含，**不需额外字段**（v1.1 §5c）。该约束属业务语义、不强制 DB CHECK。

#### 6.1.3 `identity.user_level_threshold`（新建）：积分 → 等级单调阈值

积分→等级判为简单**单调阈值**模型（非多因子加权，v1.1 §5d）：积分越多解锁等级越高。

```sql
-- 【新建】对应 v1.1 §5d
CREATE TABLE identity.user_level_threshold (
  level_no    integer  PRIMARY KEY REFERENCES identity.user_level_policy(level_no),
  min_points  bigint   NOT NULL,                 -- 达到此累计积分解锁该等级
  CONSTRAINT chk_user_level_threshold_min_points CHECK (min_points >= 0),
  UNIQUE (min_points)                            -- uidx_user_level_threshold_min_points，阈值不重复→保单调可比
);

-- 占位（与 policy 5 级对应；递增占位仅满足 UNIQUE+保证可 INSERT，非真实策略，见 6.5）
INSERT INTO identity.user_level_threshold (level_no, min_points) VALUES
(1, 0),   -- level 1 默认等级，无需积分即拥有
(2, 1),
(3, 2),
(4, 3),
(5, 4);
```

应用层换算：积分变动后，按 `min_points` **从高到低**比对，取第一个满足 `total_points >= min_points` 的 `level_no` 回写 `identity.users.level_no`。若实际逻辑超出"单调阈值"（来源权重/时间衰减），此表不够用，需另设计（v1.1 §5d，列入待决 6.5）。

---

### 6.2 积分维度（points）

参照 `commerce.tenant_credit`（余额）+ `commerce.tenant_transaction`（流水）既有模式拆"余额表 + 流水表"（v1.1 §5d）。积分绑 user 本人、跨其名下所有 tenant 累计。

#### 6.2.1 `identity.user_points`（新建）：当前余额单行汇总

```sql
-- 【新建】对应 v1.1 §5d
CREATE TABLE identity.user_points (
  user_id       uuid        PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  total_points  bigint      NOT NULL DEFAULT 0,    -- 累计余额，避免每次 SUM 流水
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_points_total CHECK (total_points >= 0)   -- 余额不为负；消耗场景由应用层保证不超扣
);
```

> in-production identity 新建空表后，对存量用户**惰性建行**或一次性回填：`INSERT INTO identity.user_points (user_id) SELECT id FROM identity.users WHERE deleted_at IS NULL ON CONFLICT DO NOTHING;`（属"保数据迁移"，不 reseed 业务数据）。

#### 6.2.2 `identity.user_points_ledger`（新建）：完整流水

```sql
-- 【新建】对应 v1.1 §5d
CREATE TABLE identity.user_points_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES identity.users(id),
  source_type   varchar(64) NOT NULL,         -- check_in | invite | task | ... 来源动态扩展，刻意不加 CHECK/ENUM
  source_ref_id varchar(128),                 -- 关联业务记录ID（邀请/任务），便于追溯，非强制外键
  points_delta  bigint      NOT NULL,         -- 正=获得，负=消耗（结构天然兼容消耗场景）
  balance_after bigint      NOT NULL,         -- 变动后余额快照，对账用
  remark        varchar(512),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_points_ledger_user ON identity.user_points_ledger (user_id, created_at);
```

设计要点（v1.1 §5d）：

- `source_type` 用 `varchar` 而非 PG ENUM——来源种类动态增加，延续全项目"状态/标签用 varchar 不用枚举"原则（database.md §9），**此处刻意不加 CHECK**（开放标签，取值枚举待业务给出，纯标签性质无需字典表）。
- 余额与流水一致性由**应用层同一事务**保证（写流水后同步更新 `user_points.total_points`），**不靠 DB 触发器隐式维护**，避免与未来批量积分发放任务冲突。
- `points_delta` 允许负数，为"积分消耗"预留结构，即使当前只有获得也无需日后改表。
- **append-only 取舍**：v1.1 未对 ledger 施加不可变约束（区别于 §9 `tenant_transaction` 的 DB RULE）。本文沿用"可写"现状；若后续要求流水绝对不可篡改，可比照 §9/§17 追加 `BEFORE UPDATE OR DELETE … RAISE` 触发器，列为可选增强、不阻塞（待决 6.5）。

#### 6.2.3 `identity.user_task_progress`（新建）：多步累计当前状态

弥补流水表的结构缺口——连续签到、任务完成百分比等需跟踪"多步累计的当前状态"，不该靠扫描流水反复计算（v1.1 §5d，延续 §8 quota_pool「实时状态查状态表」同一原则）。

```sql
-- 【新建】对应 v1.1 §5d
CREATE TABLE identity.user_task_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES identity.users(id),
  progress_type   varchar(64) NOT NULL,        -- check_in_streak | task_completion | ... 与积分来源对应但不强制一致；开放标签不加 CHECK
  current_value   bigint      NOT NULL DEFAULT 0,  -- 当前进度（连续天数/完成次数/百分比，语义由 progress_type 决定）
  target_value    bigint,                          -- 目标值（如需完成10次=10；无上限场景留空）
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  reset_at        timestamptz,                      -- 上次重置时间（如签到断签后重置），便于排查
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_task_progress_current CHECK (current_value >= 0),
  UNIQUE (user_id, progress_type)              -- uidx_user_task_progress_user_type；每用户每类型仅一行，查询 O(1)
);
```

设计要点（v1.1 §5d）：`(user_id, progress_type)` 唯一→单行读取；`current_value`/`target_value` 用通用 `bigint`，新增进度类型只是 `progress_type` 多一个值、不改表；`progress_type` 与 `user_points_ledger.source_type` 是两套独立 varchar 枚举、不强制一一对应、不建 FK，由应用层在同一事务联动更新（如签到时插流水 + 更新进度）。

---

### 6.3 KYC / 认证维度（verification）

个人租户开通付费订阅前需个人认证、组织租户需企业认证；**"是否要认证、要哪种"本身是可配置策略**，不写死在 DB 约束或代码（v1.1 §5c）。

#### 6.3.1 `identity.tenant.verification_status / verification_type`（修订·加列）

- 现状（deploy `organizations` 表，§4）：有 `type varchar(16)`，**无 verification 列**。
- 表名说明：v2 目标态 `organizations`→`identity.tenant`（§4/§5a，`ALTER SCHEMA`/`RENAME` 保数据），下列列在该迁移中按"加列带默认/可空"补齐，**不 reseed**。

```sql
-- 【修订·加列】对应 v1.1 §5c；in-production identity，status 带默认、type 可空，均安全
ALTER TABLE identity.tenant
  ADD COLUMN verification_status varchar(32) NOT NULL DEFAULT 'unverified',  -- unverified|pending|verified|rejected
  ADD COLUMN verification_type   varchar(32);                                -- individual|enterprise（对应 personal/organization 认证材料）
ALTER TABLE identity.tenant
  ADD CONSTRAINT chk_tenant_verification_status
    CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  ADD CONSTRAINT chk_tenant_verification_type
    CHECK (verification_type IN ('individual','enterprise'));   -- 可空列：NULL 自动通过 CHECK，无须 OR IS NULL
```

#### 6.3.2 `commerce.verification_policy`（新建·rank 24 修订）

可配置 KYC 门控，跨 `identity`/`commerce`/`product` 三 schema。`product_id IS NULL` 行是**平台基准值（非隐式兜底）**——任何产品上架商城前**必须显式插入自己 product_id 非 NULL 的记录**（覆盖 personal/organization 两种 tenant_type），由 §7 上架检查清单 `launch_checklist_item('verification_policy')` 强制（v1.1 §5c/§6.1d）。commerce 为**空域**，可重建 + reseed。

```sql
-- 【新建·rank 24 修订】对应 v1.1 §5c
CREATE TABLE commerce.verification_policy (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid        REFERENCES product.product(id),  -- NULL=平台基准值（非兜底）；非NULL=该产品策略（上架必填）
  tenant_type          varchar(32) NOT NULL,                        -- personal | organization（runbook §0.4：team→organization）
  require_verification boolean     NOT NULL DEFAULT true,           -- 该场景是否要求认证，可关闭
  required_type        varchar(32),                                 -- individual | enterprise
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_verification_policy_tenant_type   CHECK (tenant_type   IN ('personal','organization')),
  CONSTRAINT chk_verification_policy_required_type CHECK (required_type IN ('individual','enterprise'))
);

-- ★ rank 24 修复：v1.1 的 UNIQUE(product_id, tenant_type) 在 product_id IS NULL 时
--   因 SQL "NULL <> NULL" 语义而 *不防重复*——两条 (NULL,'personal') 基准行可同时存在，
--   破坏"平台基准值每 tenant_type 唯一"。改用以下二者其一：
-- 方案A（PG15+，最简）：
--   ALTER TABLE commerce.verification_policy
--     ADD CONSTRAINT uidx_verification_policy_product_type
--     UNIQUE NULLS NOT DISTINCT (product_id, tenant_type);
-- 方案B（版本无关·本文采用，与项目既有部分唯一索引风格一致，database.md §9）：
CREATE UNIQUE INDEX uidx_verification_policy_product_type
  ON commerce.verification_policy (product_id, tenant_type)
  WHERE product_id IS NOT NULL;          -- 产品级策略：每(product,tenant_type)唯一
CREATE UNIQUE INDEX uidx_verification_policy_baseline_type
  ON commerce.verification_policy (tenant_type)
  WHERE product_id IS NULL;             -- 平台基准值：每 tenant_type 仅一行

-- 平台基准 seed（product_id=NULL）。应用 runbook §0.4：tenant_type 用 personal/organization
INSERT INTO commerce.verification_policy (product_id, tenant_type, require_verification, required_type) VALUES
(NULL, 'personal',     true, 'individual'),
(NULL, 'organization', true, 'enterprise');
```

**校验逻辑（应用层，v1.1 §5c）**：创建付费订阅（关联 `plan_version` 非 free，§8）时，按 `(product_id, tenant_type)` 查该产品自配置的 `verification_policy`；若 `require_verification=true`，再校验该 tenant `verification_status='verified'` 且 `verification_type = required_type`。这条规则跨三 schema、且依赖运营可调策略数据，**不适合 DB CHECK 表达**，触发条件已下沉为表数据、校验动作留应用层。

---

> 📦 **落地/迁移**：原「6.4 迁移策略小结 / 6.5 业务待填值与待决」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 7. product 目录域：统一 product + 版本化 plan + product_webhook

> 吸收 v1.1 §6（全）+ §4.2a。现状基线 = deploy `schema.prisma` 的 `product` schema **8 表**：`agent` / `agent_feature` / `feature` / `plan` / `application` / `plan_agent` / `plan_feature` / `plan_price`。
> 本域为**空域**（仅 seed、无生产数据）→ 按 runbook §0.3/§17 迁移策略**直接按目标态重建 + reseed**，无保数据迁移负担。
> 目标：把分裂的 `agent` / `application` 双目录 + 一堆关系表 + JSONB 双写，收口为「统一 `product` + 字典/i18n/metric 卫星表 + 版本化 `plan`（`plan_component` 为唯一 SoT）+ 平台自签 `product_webhook`」。

**两条预先澄清**：

- **规划态澄清（沿用 §3.1/§7 骨架）**：旧 `database.md`（已退役）§3.4 曾列 `agent_catalog` / `skill_catalog` / `skill` / `solution` / `preset` / `plan_skill` / `plan_solution` 等，但 deploy 实际 schema **无这些表**——§3.4 该部分为**规划态**，本章一律以 deploy 实际 8 表为现状准绳，规划态表不纳入本轮字段级设计（如未来落地，走本章同构扩展）。**其中 `agent_catalog` 是 §11.3 scope-key 调和的跨轮硬前置**（runbook §11.6/runbook §18），落地时在此同构补。
- **删除"home_url/webhook 下沉到 gateway"旧表述**：v1.1 §6.1 去留表曾写 `home_url`/`webhook_url`/`webhook_secret_ref`「下沉到 `gateway` schema」。`gateway` 已取消（runbook §0.4/§12），该表述作废——三字段重定位到本章 `product.product_webhook`（§7.7），性质是**平台自签 HMAC 验签密钥**，非 Provider Key，正常入平台库。

---

> 📦 **落地/迁移**：原「7.1 受影响表去向矩阵」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

### 7.2 `product.product`（合并 `agent` + `application`）【新建/合并；对应 deploy product.agent+application、v1.1 §6.1】

```sql
CREATE TABLE product.product (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code            varchar(64)  NOT NULL UNIQUE,   -- data | kb | agent_writing | agent_analysis（合并 agent_code/app_code）
    product_type            varchar(32)  NOT NULL,          -- agent | data_platform | kb_platform ...（合并 agent_type/app_type；扩展型 kind，不加 CHECK）
    category_id             smallint REFERENCES product.product_category(id),  -- 叶子小类，§7.4（替代裸 agent_category）
    description             text,                            -- 默认/兜底描述；走 i18n 的以 product_i18n.description 为准
    capability_keys         text[]       NOT NULL DEFAULT '{}',  -- 可门控功能键（承接 agent_feature；字符串，非外键）
    tags                    text[]       NOT NULL DEFAULT '{}',  -- 自由标签（与 category 正交；GIN，§17）
    standalone_subscribable boolean      NOT NULL DEFAULT true,  -- 是否允许单独订阅（data/kb=true）
    icon_url                varchar(512),
    sort                    integer      NOT NULL DEFAULT 0,
    config                  jsonb,                           -- 合并 agent.config_json + application.metadata
    release_version         varchar(32),                     -- 对外发布号（短），§6.1a
    build_number            varchar(64),                     -- 内部构建号（长）
    released_at             timestamptz,
    status                  varchar(32)  NOT NULL DEFAULT 'active',
    created_by              uuid,
    updated_by              uuid,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now(),
    deleted_at              timestamptz,
    CONSTRAINT chk_product_status CHECK (status IN ('active','inactive','draft','deprecated'))
);

CREATE INDEX        idx_product_category   ON product.product (category_id);
CREATE INDEX        idx_product_status     ON product.product (status);
CREATE INDEX        idx_product_deleted_at ON product.product (deleted_at);
-- 数组检索（raw DDL，重建必须保留，登记 §17）：
CREATE INDEX        idx_product_tags_gin   ON product.product USING GIN (tags);
CREATE INDEX        idx_product_cap_gin    ON product.product USING GIN (capability_keys);
```

**逐字段去留（沿用 v1.1 §6.1，仅修正 home_url/webhook 去向）**：

| 原字段                                            | 来源表      | 去向                                                                                    |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `agent_code` / `app_code`                         | 两表        | 合并 `product_code`                                                                     |
| `agent_name` / `app_name` / `app_name_zh`         | 两表        | **废弃** → `product.product_i18n`（§7.5）                                               |
| `description`                                     | 两表        | 保留作默认描述；多语言以 `product_i18n.description` 为准                                |
| `agent_type` / `app_type`                         | 两表        | 合并 `product_type`                                                                     |
| `agent_category`                                  | agent       | 字典外键 `category_id`（§7.4）                                                          |
| `tags`                                            | agent       | 保留（与 category 正交）                                                                |
| `config_json` / `metadata`                        | 两表        | 合并 `config`                                                                           |
| `version`                                         | agent       | 非运行时版本 → 拆 `release_version`/`build_number`/`released_at`                        |
| `home_url` / `webhook_url` / `webhook_secret_ref` | application | **→ `product.product_webhook`**（§7.7）；**作废**"下沉 gateway"旧表述（gateway 已取消） |
| `status`/`visibility`/`sort`/`icon_url`/审计列    | 两表        | 保留（`visibility` 并入 `status`/`is_public` 语义，按需保留）                           |

---

### 7.3 `product.product_metric`（merge_strategy + consume_mode）【新建；v1.1 §6.1 + 计量校验 rank 9】

```sql
CREATE TABLE product.product_metric (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     uuid NOT NULL REFERENCES product.product(id),
    metric_key     varchar(64)  NOT NULL,    -- doc.words | ai.calls | storage.max | member.max
    merge_strategy varchar(16)  NOT NULL,    -- max | union | pool
    consume_mode   varchar(16),              -- divisible | atomic（仅 pool 型必填，供 §8.3 计量分支，rank 9）
    metric_unit    varchar(32),              -- words | calls | GB | seats
    created_at     timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (product_id, metric_key),
    CONSTRAINT chk_product_metric_merge CHECK (merge_strategy IN ('max','union','pool')),
    CONSTRAINT chk_product_metric_consume_mode
        CHECK (merge_strategy <> 'pool' OR consume_mode IN ('divisible','atomic'))
);
```

要点：

- `merge_strategy`：`max`/`union` = **能力型**（就高 / 并集，§8 路 A，不消费）；`pool` = **消耗型**（独立成配额池、瀑布扣减，§8 路 B）。
- `consume_mode`（**rank 9**）：仅对 `pool` 型有意义，§8.3 consume 第 4 步据此分支——`divisible`（字数等可分割 → 瀑布扣减、部分成功）/ `atomic`（一次生成/调用等原子动作 → 锁定池 `SUM(available) < amount` 则整笔 `ROLLBACK`、返 409 `consumed=0`、不写任何 head/detail）。`max`/`union` 型不消费，`consume_mode` 留空（CHECK 仅在 `pool` 时强制非空 + 取值合法）。

---

### 7.4 `product.product_category`（树形字典）【新建；v1.1 §6.1b】

```sql
CREATE TABLE product.product_category (
    id         smallint PRIMARY KEY,         -- 小型策展字典，人工指派、可排序（刻意例外于 uuid 主键规范，沿用 v1.1）
    parent_id  smallint REFERENCES product.product_category(id),  -- NULL=顶级；自引用支持任意深度树
    code       varchar(32) NOT NULL UNIQUE,
    name       varchar(64) NOT NULL,
    sort       integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_category_parent ON product.product_category (parent_id);
```

要点：树形（`parent_id` 自引用），当前先用两级（大类/小类）即可，结构不限层级深度（深度变化只需应用层递归查询适配）。`product.category_id` 应指向**叶子小类**——这条无法用 CHECK 表达（无法判定"是否叶子"），靠应用层/录入界面引导。`id` 用 `smallint` 是对 uuid 主键规范的**刻意例外**（小型策展字典、人读 id、天然可排序），登记 §17。

---

### 7.5 `product.product_i18n`（双槽位，无默认兜底）【新建；v1.1 §6.1c】

```sql
CREATE TABLE product.product_i18n (
    product_id   uuid NOT NULL REFERENCES product.product(id),
    locale       varchar(16)  NOT NULL,     -- zh-CN | en-US | ja-JP ...
    product_name varchar(128) NOT NULL,     -- 品牌名/专有名（如 "如影" / "Ruyin"）
    product_nick varchar(128) NOT NULL,     -- 释义名/译名（双槽位，各 locale 独立维护）
    description  text,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, locale)
);
```

要点：`product_name` + `product_nick` 双槽位，各 locale 独立维护（zh/en 偶尔取值相同纯属内容巧合，非结构）。**无默认语言兜底**——每个 product 必须覆盖平台支持的全部 locale，缺一视为**数据缺陷**而非运行时容错；完整性由 §7.8 `launch_checklist` 的 `'i18n_complete'` 检查项统一收口。

---

### 7.6 版本化 plan：`plan`（壳）+ `plan_version`（不可变）+ `plan_component`（唯一 SoT）【修订/新建；v1.1 §6.2/§6.3】

**`product.plan`（产品壳）**【修订（重建）；对应 deploy product.plan】

```sql
CREATE TABLE product.plan (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code          varchar(64)  NOT NULL UNIQUE,
    plan_name          varchar(128) NOT NULL,         -- 客户可见：方案编写智能体 / 数据分析智能体
    description        text,
    billing_cycle      varchar(32)  NOT NULL DEFAULT 'monthly',  -- monthly | yearly ...（承接 plan_price 周期语义）
    current_version_id uuid,                            -- 当前对外销售版本（FK 在 plan_version 建后补，见下）
    is_public          boolean NOT NULL DEFAULT true,
    status             varchar(32)  NOT NULL DEFAULT 'active',
    created_by uuid, updated_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT chk_plan_status CHECK (status IN ('active','inactive','draft','deprecated'))
);
```

**`product.plan_version`（不可变版本，必修 a：无 `components` JSONB）**【新建；v1.1 §6.2】

```sql
CREATE TABLE product.plan_version (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     uuid NOT NULL REFERENCES product.plan(id),
    version_no  integer NOT NULL,             -- 同 plan 下从 1 递增
    price       numeric(12,2) NOT NULL,       -- 标价，到分（§3.2 修订 2026-09-03：资金类一律两位小数）
    currency    varchar(16) NOT NULL DEFAULT 'CNY',
    is_locked   boolean NOT NULL DEFAULT false, -- 一旦被任意订阅引用即置 true → 版本及其 plan_component 全冻结
    created_by  uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, version_no)
    -- 必修(a)：删除 v1.1 §6.2 原有的 components jsonb —— plan_component 为唯一 SoT，不再 JSONB 双写
);

ALTER TABLE product.plan
    ADD CONSTRAINT fk_plan_current_version
        FOREIGN KEY (current_version_id) REFERENCES product.plan_version(id);
```

**`product.plan_component`（唯一 SoT，挂 plan_version）**【新建；v1.1 §6.3，替代 plan_agent/plan_feature】

```sql
CREATE TABLE product.plan_component (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id uuid NOT NULL REFERENCES product.plan_version(id),
    product_id      uuid NOT NULL REFERENCES product.product(id),
    tier            varchar(32) NOT NULL,        -- standard | starter | pro | business | enterprise
    billing_kind    varchar(32) NOT NULL,        -- bundled_free | charged
    priority        integer NOT NULL DEFAULT 100, -- 编排期顺序，投影到 quota_pool.priority（瀑布运行时读 quota_pool，§8.2）
    features        text[] DEFAULT '{}',         -- 该档开放功能键（替代 plan_feature 的 feature 关联）
    quota           jsonb,                       -- 业务语言配额 {"doc.words":1000000,"storage.max":"100GB"}（替代 plan_feature.quota_value）
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_version_id, product_id, tier),
    CONSTRAINT chk_plan_component_tier
        CHECK (tier IN ('standard','starter','pro','business','enterprise')),
    CONSTRAINT chk_plan_component_billing
        CHECK (billing_kind IN ('bundled_free','charged'))
);

CREATE INDEX idx_plan_component_version ON product.plan_component (plan_version_id);
```

**触发器 1：锁定不可变 —— 保护对象从 JSONB 移到 `plan_component` 全表（必修 b，rank 10）**

```sql
-- 1a. plan_version 已锁定 → 禁止增/改/删其 plan_component
CREATE OR REPLACE FUNCTION product.guard_locked_plan_component()
RETURNS trigger AS $$
DECLARE v_locked boolean;
BEGIN
    SELECT is_locked INTO v_locked FROM product.plan_version
        WHERE id = COALESCE(NEW.plan_version_id, OLD.plan_version_id);
    IF v_locked THEN
        RAISE EXCEPTION 'plan_version % 已锁定，禁止增/改/删其 plan_component；组合变更请开新版本',
            COALESCE(NEW.plan_version_id, OLD.plan_version_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_component_guard_lock           -- 名取 'g'，先于 priority('p') 触发
    BEFORE INSERT OR UPDATE OR DELETE ON product.plan_component
    FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_component();

-- 1b. 已锁定版本：禁止清除 is_locked + 价格/版本号冻结
CREATE OR REPLACE FUNCTION product.guard_locked_plan_version()
RETURNS trigger AS $$
BEGIN
    IF OLD.is_locked THEN
        IF NEW.is_locked = false THEN
            RAISE EXCEPTION 'plan_version % 已锁定，不可清除 is_locked', OLD.id;
        END IF;
        IF NEW.price IS DISTINCT FROM OLD.price
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
           OR NEW.version_no IS DISTINCT FROM OLD.version_no THEN
            RAISE EXCEPTION 'plan_version % 已锁定，价格/版本号不可改，请开新版本', OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_version_guard_lock
    BEFORE UPDATE ON product.plan_version
    FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_version();
```

**触发器 2：`bundled_free` priority < `charged` priority（编排期硬约束，必修 c；v1.1 §6.3）**

```sql
CREATE OR REPLACE FUNCTION product.check_plan_component_priority()
RETURNS trigger AS $$
DECLARE min_charged int; max_bundled int;
BEGIN
    SELECT MIN(priority) INTO min_charged FROM product.plan_component
        WHERE plan_version_id = NEW.plan_version_id AND billing_kind = 'charged';
    SELECT MAX(priority) INTO max_bundled FROM product.plan_component
        WHERE plan_version_id = NEW.plan_version_id AND billing_kind = 'bundled_free';
    IF min_charged IS NOT NULL AND max_bundled IS NOT NULL AND max_bundled >= min_charged THEN
        RAISE EXCEPTION 'bundled_free 的 priority(%) 必须 < charged 的 priority(%)，plan_version=%',
            max_bundled, min_charged, NEW.plan_version_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_component_priority
    BEFORE INSERT OR UPDATE ON product.plan_component
    FOR EACH ROW EXECUTE FUNCTION product.check_plan_component_priority();
```

要点（贯穿三条必修）：

- **必修 (a) —— 删 `plan_version.components` JSONB**：`plan_component` 为唯一 SoT。版本本身不可变，故"既是数据源也是快照"的诉求由 `plan_component` 行（连同锁定）满足，不再 JSONB 双写、不再有双写一致性维护成本。
- **必修 (b) —— 锁定保护从 JSONB 移到 `plan_component` 全表 + 禁解锁（rank 10）**：v1.1 §6.2 的触发器只盯 `plan_version.components` JSONB 的变更，而独立的 `plan_component` 行**不受保护**。删掉 JSONB 后若不补，会留下漏洞——锁定版本的 `plan_component` 仍可被 INSERT/UPDATE/DELETE，等于绕过锁直接改已售出订阅的财务条款。新模型把保护对象**移到 `plan_component` 全表**（增/改/删皆禁，触发器 1a）+ **禁止清除 `is_locked`** + 锁定版本价格/版本号冻结（触发器 1b）。组合/价格变更**只能开新版本**（`version_no`+1，改 `plan.current_version_id` 指向），老订阅引用的旧版本恒不变（Stripe/Orb 版本化标准）。
- **必修 (c) —— `bundled<charged` 为编排期规则、priority 投影到 quota_pool**：触发器 2 在 plan_version **编排期**保证单版本内 `max(bundled priority) < min(charged priority)`（财务级后果——违反将先扣用户付费额度，故用触发器覆盖所有写入路径，应用层校验并存作为第一道防线）。运行时**瀑布扣减不读 `plan_component`**，读已投影的 `quota_pool.priority`（§8.2）；跨 plan 的 priority 相等（两个独立 plan 默认都 = 100）由 §8.3 **全序** `ORDER BY priority, billing_kind(bundled 先), effective_at, id` 的 tiebreaker 处理——因此 `quota_pool` 侧**不设"活跃池 priority 唯一"约束**（§8.2 rank 3）。
- **写入时机**：新建 `plan_version` 的**同一事务内**连带写入该版本下全部 `plan_component`；订阅创建（§8.1）时把目标版本 `is_locked` 置 `true`，此后该版本及其组件冻结。

---

### 7.7 `product.product_webhook`（平台自签 HMAC）【新建/重定位；v1.1 §4.2a，承接 deploy application.home*url/webhook*\*】

```sql
CREATE TABLE product.product_webhook (
    product_id         uuid PRIMARY KEY REFERENCES product.product(id),
    home_url           varchar(512),   -- 纯展示：产品主页地址
    webhook_url        varchar(512),   -- 平台 → 产品 推送事件目标（订阅状态变更、额度预警）
    webhook_secret_ref varchar(128),   -- 平台自签 HMAC 验签密钥的引用（非 Provider Key，可正常入平台库）
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
```

要点（推翻旧归类）：三字段承接自 deploy `product.application.home_url`/`webhook_url`/`webhook_secret_ref`，归入 `product`（产品目录的一部分）。

- **方向**：是**平台主动推送事件给产品**（非"产品上报用量给平台"——用量走 §8 `POST /usage/consume` 上行），`webhook_secret_ref` 是**平台自己签发、供产品验证"该 webhook 确来自平台、未被篡改"的 HMAC 密钥**（Stripe/GitHub webhook 标准模式）。
- **与 Provider Key 的风险模型不同**：Provider Key 泄露 → 外部服务商账单被盗刷；HMAC 验签密钥泄露 → 仅"被伪造一条假事件"。后者不触发 data_platform_100_architecture.md §2.2"Provider Key 不入平台库"铁律（那条针对外部账单盗刷），可正常保留在平台库。
- **`gateway` 已取消**：v1.1 §6.1 去留表"下沉到 gateway"的写法作废（runbook §0.4/§12）。

---

### 7.8 上架检查清单：`launch_checklist_item` + `product_launch_status`【新建；v1.1 §6.1d】

```sql
-- 检查项目录（可配置，不写死代码）
CREATE TABLE product.launch_checklist_item (
    item_code   varchar(64) PRIMARY KEY,   -- verification_policy | i18n_complete | pricing_set ...
    item_name   varchar(128) NOT NULL,
    description varchar(256),
    is_required boolean NOT NULL DEFAULT true,  -- 个别项未来可为"建议"而非强制
    sort        integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 每个 product 对每个检查项的完成状态
CREATE TABLE product.product_launch_status (
    product_id   uuid NOT NULL REFERENCES product.product(id),
    item_code    varchar(64) NOT NULL REFERENCES product.launch_checklist_item(item_code),
    is_satisfied boolean NOT NULL DEFAULT false,
    checked_at   timestamptz,
    checked_by   uuid,                       -- 人工确认记录操作人；自动校验为 NULL
    remark       varchar(256),
    PRIMARY KEY (product_id, item_code)
);

INSERT INTO product.launch_checklist_item (item_code, item_name, is_required, sort) VALUES
('verification_policy', '认证策略已配置', true, 10),
('i18n_complete',       '多语言文案已覆盖所有 locale', true, 20);
```

要点：通用上架前置机制——`product.product` 主表**不加**"是否可上架"汇总字段，该状态完全由 `product_launch_status` 推导（该 product 下所有 `is_required=true` 的项均 `is_satisfied=true` 即可上架），避免主表字段膨胀与不一致。初始两项：

- `'verification_policy'`：产品上架商城前**必须显式插入**自己的 `commerce.verification_policy` 记录（`product_id IS NULL` 是平台基准值、**非隐式兜底**；策略表见 §6.3.2）。
- `'i18n_complete'`：§7.5 全 locale 覆盖（缺一算数据缺陷）的完整性收口。

新增检查项 = INSERT 一行 `launch_checklist_item`，不改表结构（定价/合规等未来项同此扩展，runbook §18.4）。

---

> 📦 **落地/迁移**：原「7.9 退役声明与 bundle → subscription 处置 / 7.10 依赖的待决项」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 8. commerce 权益域：订阅 / 配额池 / 用量 / 计量内核契约（修订定稿）

> 吸收 v1.1 §7–§9，并已应用计量内核**对抗校验**（2026-07-01）修正的 **5 个 blocker + 16 项 delta**。计量内核是财务正确性核心，DDL 与并发/事务语义一并固化。⚠️ 两项**架构决策待确认**（已按推荐落，可改）见 §8.9。

### 8.1 tenant_subscription（workspace 化、引用 plan_version、多订阅）

补 `workspace_id NOT NULL` + `plan_version_id NOT NULL REFERENCES product.plan_version`；保留 `tenant_id`（账单 rollup 反查 org）；解除 (workspace,plan) 单订阅约束（同 product 可"附带 + 单独订"多笔）；`pay_amount` 与 `plan_version.price` 分离。续费/升级 = 新增订阅指向新版本，不改老订阅。

### 8.2 quota_pool（实时余量 SoT）

```sql
commerce.quota_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  subscription_id uuid REFERENCES commerce.tenant_subscription(id),   -- 可空(manual_override)
  product_id uuid NOT NULL REFERENCES product.product(id),
  metric_key varchar(64) NOT NULL,
  quota_limit bigint NOT NULL,
  quota_used  bigint NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 100,        -- 投影自 plan_component.priority；同(ws,product,metric)可重复
  billing_kind varchar(32) NOT NULL,            -- bundled_free | charged
  pool_source  varchar(32) NOT NULL DEFAULT 'subscription',  -- subscription | manual_override
  reset_period varchar(16) NOT NULL DEFAULT 'none',          -- none | day | month
  current_period_start timestamptz,             -- 周期池非空(见 CHECK)；insert/rollover 时 date_trunc 对齐
  status varchar(32) NOT NULL DEFAULT 'active', -- active | retired（软退役，绝不硬删，保 detail FK）
  retired_at timestamptz, granted_by uuid, grant_reason varchar(256),
  effective_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((pool_source='subscription' AND subscription_id IS NOT NULL) OR pool_source='manual_override'),
  CHECK ((reset_period='none') OR (current_period_start IS NOT NULL))
);
-- 瀑布查询索引：普通复合，无 now() 谓词（expires_at/周期在查询 WHERE 过滤）
CREATE INDEX idx_quota_pool_route ON commerce.quota_pool (workspace_id, product_id, metric_key, priority);
```

要点（校验修正）：

- **不设"活跃池 priority 唯一"约束**——不可强制 + 会挡掉 §8.1 两池共存（定序见 §8.3）（两个独立 plan 默认 priority 都=100 必须并存，rank 3）。瀑布确定性靠**全序** `ORDER BY priority, billing_kind(bundled 先), effective_at, id`——同时是加锁顺序（免死锁），且 priority 相等时仍保 bundled<charged。
- bundled<charged 仍是 plan_version 编排期规则（§7 plan_component 触发器），投影到 quota_pool。
- 池**软退役**(status/retired_at)，绝不硬删（detail FK 依赖，rank 14）；过期/退役池排除出活跃查询。
- `current_period_start` 周期池强制非空 + insert/rollover 时 `date_trunc(reset_period, now())` 对齐（多周期间隔一步塌缩到当前，rank 13/18）。

### 8.3 consume 契约（唯一写入路径，单事务）

产品端/Model Platform 只 `POST /usage/consume {workspace, product, metric, amount, idempotency_key, request_id}`，**不直写用量表**。commerce consume 服务单事务（READ COMMITTED + 行锁）：

```
 1. 幂等先占：INSERT commerce.usage_idempotency(idempotency_key,...) ON CONFLICT DO NOTHING RETURNING;
       无返回 → 键已占（读回已提交行，阻塞等在途事务），返回其 consumed + per_pool（remaining_total 现算）。  [rank 1/12]
 2. 锁定候选池：SELECT ... FROM quota_pool WHERE (ws,product,metric) AND active
       FOR UPDATE ORDER BY priority, billing_kind(bundled 先), effective_at, id;                      [rank 2/3 防超扣/定序/免死锁]
 3. 惰性归零：对 current_period_start < period_floor(reset_period,now()) 的锁定池：quota_used:=0,
       current_period_start:=date_trunc(...); 同事务写 commerce.quota_pool_reset 一行。                [rank 7/8/18]
 4. 模式分支(product_metric.consume_mode)：atomic → 先算锁定池 SUM(available)，< amount 则 ROLLBACK、
       返 409 consumed=0、不写任何 head/detail；divisible → 瀑布扣减得 took[]。                        [rank 9]
 5. UPDATE quota_pool.quota_used += took（已锁，安全）。
 6. INSERT tenant_usage_event(头, total_amount=consumed=SUM(took)); INSERT tenant_usage_event_pool × N;
       回填 usage_idempotency(event_id, consumed, per_pool)。                                          [rank 11]
```

### 8.4 tenant_usage_event(头) + \_pool(明细)：append-only / 分区 / 键修正

```sql
commerce.tenant_usage_event (                                  -- 头，一次 consume 一行
  id uuid DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, product_id uuid NOT NULL, metric_key varchar(64) NOT NULL,
  total_amount bigint NOT NULL,            -- = 实扣 consumed = SUM(明细.took)
  requested_amount bigint,                 -- 409 审计用(请求量)，可空
  idempotency_key varchar(128), request_id varchar(128),   -- 仅普通索引；全局 UNIQUE 不在此(见 8.5)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)             -- 分区键必须进 PK [rank 4]
) PARTITION BY RANGE (created_at);          -- 按月；预建分区 + DEFAULT 兜底 [rank 16]
commerce.tenant_usage_event_pool (                             -- 明细，每命中池一行
  event_id uuid NOT NULL, event_created_at timestamptz NOT NULL,
  quota_pool_id uuid NOT NULL REFERENCES commerce.quota_pool(id),   -- 池软退役不硬删，FK 永远可解
  took bigint NOT NULL,
  PRIMARY KEY (event_id, event_created_at, quota_pool_id),
  FOREIGN KEY (event_id, event_created_at) REFERENCES commerce.tenant_usage_event(id, created_at)
) PARTITION BY RANGE (event_created_at);    -- 与头同步分区，retention 对齐 [rank 4]
```

- **append-only**：`BEFORE UPDATE OR DELETE FOR EACH ROW RAISE EXCEPTION` 触发器（分区父传播全分区），**禁用 `DO INSTEAD NOTHING` RULE**（会静默吞写，rank 17）。

### 8.5 usage_idempotency（非分区，幂等权威）

```sql
commerce.usage_idempotency (
  idempotency_key varchar(128) PRIMARY KEY,         -- 全局唯一，非分区表才成立 [rank 1]
  event_id uuid, event_created_at timestamptz,
  consumed bigint, per_pool jsonb,                  -- 重放直接返回
  created_at timestamptz NOT NULL DEFAULT now()
);
```

跨月重试不再双扣；重放/并发重复键经 `ON CONFLICT` 分支返回先前结果（非约束错，rank 12）。

### 8.6 quota_pool_reset（归零审计）

```sql
commerce.quota_pool_reset (id uuid PK, pool_id uuid, period_start timestamptz,
  used_before_reset bigint, reset_at timestamptz NOT NULL DEFAULT now());
```

使 `quota_used = SUM(took 落在当前周期)` 可重建、归零可审计——否则真实漂移与合法归零无法区分（rank 8）。

### 8.7 usage_summary（仅周期对账，三层降采样）

实时一律读 quota_pool（§8.9），summary **不承担实时**。最小颗粒 = **小时**（删 5 分钟层）→ 天 → 月；定时 Job：`tenant_usage_event(_pool) → 小时`（幂等 upsert 累加，补此前缺失的首层聚合任务）→ 天 → 月按窗口降级。

### 8.8 entitlement_cache（短 TTL，非 SoT）

保留 v1.1 §8。★命名/语义二选一（不可两义）：**真缓存** `UNIQUE(ws,product)`+upsert、读 `expires_at>now()`、更名 `entitlement_current`；或 **审计轨迹** append-only、更名 `entitlement_resolve_log`、查 `resolved_at DESC LIMIT 1`。门控走实时 resolve，不读此表。

### 8.9 读路径 + 两项 ★待确认的架构决策

- **读路径周期感知**：`/platform/entitlements` 与任何配额 gate 读用 `effective_used = CASE WHEN current_period_start < period_floor(reset_period,now()) THEN 0 ELSE quota_used END`，`remaining = quota_limit - effective_used`（共享视图/表达式）。"裸 quota_used O(1) 读"作废——惰性归零下会返回过期满载余量（rank 7）。
- ✅ **已确认①｜Model Platform 接入（§11，rank 6/15）**：consume 是 AI 热路径同步调用。① 提供 Model Platform **只读配额 gate/CHECK 面**（授权直读 quota_pool 或专用 balance API，区别于产品 /entitlements），consume 服务独占写；② consume **同步 + 有界本地 fail-open**（commerce 不可用时放行有限额度）+ 异步对账（兼顾 AI 可用性与计量）。
- ✅ **已确认②｜被丢 AI 维度去向（rank 5）**：input/output token 拆分、model_code、latency、agent/feature 等 AI 调用明细归 **Model Platform DB `reqlog`**（database.md §4），commerce `tenant_usage_event` 只承载计费 metric(amount)；agent/feature→product 经 §11.3 映射。
- **协调迁移（非 drop/重建，rank 5）**：保留旧 `tenant_usage_event` + 现 writer，直到 Model Platform 切到 `POST /usage/consume`（§11.3 `tenant/agent/feature/model → workspace/product/metric` 映射是硬前置，§11）。

> 📦 **落地/迁移**：原「8.x 退役 / 校正」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 9. commerce 账务域：账单/发票/支付/退款/不可变流水/预付款

> 吸收：v1.1 §5（仅"方案A=三表分离指向 tenant"，**未落字段级**）＋ deploy 现状 9 张账务表 ＋ ADR-11 §11.1/§11.8④/MVP-3（**org=结算账户 / workspace=成本中心**）＋ database.md §3.5/§11（不可变账本铁律 + "支付不能双份·账本不可变"）＋ `commerce.md` §7/§9（状态机与不变量）。
> 本章首次把账务域落到**字段级**，并把 v1.1 仅"保留三表"深化为完整账务闭环，按 **org 结算 vs workspace 成本** 重构（rank 20）。
> ⚠️ **支付网关尚未接入**（`commerce.md` §10：🚧 微信支付/支付宝/银行回调流程规划中）。本章 `channel_*` / `pay_expire_at` / 回调类字段为目标态占位，真实接入前为空；线下转账路径（`offline_*` + 凭证）可先行，不依赖网关。
> **建表策略**：commerce 为空域 → 按 runbook §0.3「空域重建 + reseed」，本章直接给目标态 `CREATE TABLE`（非 ALTER），逐表标注相对 deploy 的字段去留。金额与单价（标价类）一律 `NUMERIC(12,2)`（§3.2 修订 2026-09-03：资金类有且只有两位小数，原标价类 `NUMERIC(18,6)` 已收口）、Token/配额 `BIGINT`（§3.2）。

### 9.1 账务域定位：「资金 vs 成本」分离拓扑（rank 20）

ADR-11 §11.1/§11.8④ 确立两条主体：

```
Organization / Tenant  =  billing account（资金/结算主体）
        · 预付款池、币种、开票抬头 → 本域 tenant_credit + tenant_billing_address
        · 月末汇总出账、扣预付款、开 fapiao → tenant_invoice + tenant_transaction + tenant_invoice_receipt
Workspace              =  cost center（成本/计量主体）
        · 订阅(charged)、配额池、消耗 → §8 tenant_subscription / quota_pool / tenant_usage_event
        · 各 workspace 成本独立归集，月末上卷到所属 org
```

**rank 20 修复点**：deploy 的 `tenant_invoice` / `tenant_invoice_item` **只挂 `tenant_id`、无 `workspace_id`**，无法表达"一个 org 下多个 workspace 各自订阅 / 各自计量超额，月末在 org 汇总成一张账单"（ADR-11 MVP-3 验收场景）。本章为账单**明细行补 `workspace_id`**（成本归集键）+ `subscription_id` + `product_id` + `metric_key`，使账单头停在 org/tenant 级、明细行下钻到 workspace/订阅/计量维度（§9.3/§9.4/§9.12）。

> 外键归属沿用 **v1.1 §5 方案A**：`tenant_credit` / `tenant_billing_address` / `tenant_payment_method` 三表保持 `tenant_id` 不挂 `workspace_id`，外键指向 `identity.tenant.id`（原 `organizations.id`）；**不**新建 `org_billing_account` 汇总表（方案B 已否决）。账务头表（invoice/payment/refund/transaction）同样以 `tenant_id` 为结算主体键；workspace 维度只出现在**明细行**用于成本归集。

> 📦 **落地/迁移**：原「9.2 受影响表去向矩阵」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

### 9.3 `tenant_invoice`（账单头，org/tenant 级 rollup）【修订】

```sql
CREATE TABLE commerce.tenant_invoice (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,                  -- 结算主体 = org/tenant（方案A，FK→identity.tenant）
  bill_no         varchar(64)  NOT NULL UNIQUE,   -- 业务单号；uidx
  subscription_id uuid,                            -- 改【可空·修订】：org rollup 账单跨多订阅，单订阅一次性账单时填
  bill_cycle      varchar(8)   NOT NULL,           -- 计费周期标签，如 '202607'
  cycle_start_date date NOT NULL,
  cycle_end_date   date NOT NULL,
  total_amount    numeric(12,2) NOT NULL DEFAULT 0,  -- = SUM(item.total_amount)
  discount_amount numeric(12,2) DEFAULT 0,
  payable_amount  numeric(12,2) NOT NULL DEFAULT 0,  -- = total - discount
  paid_amount     numeric(12,2) DEFAULT 0,           -- 预付款扣减 + 线上/线下实付合计
  currency        varchar(16)  DEFAULT 'CNY',
  bill_status     varchar(32)  NOT NULL DEFAULT 'unpaid',  -- 见 §9.13 状态机
  bill_type       varchar(32)  DEFAULT 'normal',           -- normal(周期) | one_off(一次性购买/升级) | adjustment(冲调)
  paid_at         timestamptz,
  payment_method  varchar(64),                     -- 冗余便于展示；权威以 tenant_payment 为准
  transaction_no  varchar(128),                    -- 关联 tenant_transaction.transaction_no（出账扣款）
  operator_id     uuid, operate_remark text,       -- 运营手工出账/调整留痕（admin realm operator）
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_ti_status CHECK (bill_status IN ('unpaid','paying','paid','partial','cancelled','overdue'))
);
CREATE INDEX idx_ti_tenant_cycle ON commerce.tenant_invoice (tenant_id, bill_cycle);
CREATE INDEX idx_ti_status       ON commerce.tenant_invoice (bill_status);
CREATE INDEX idx_ti_deleted_at   ON commerce.tenant_invoice (deleted_at);
```

- 头表停在 **org/tenant 级**，是月末 rollup 的落点（§9.12）；workspace/订阅/计量维度全部下钻到明细行（§9.4）。
- `subscription_id` 由 deploy 的"隐含单订阅"改为**可空**——org 周期账单聚合多 workspace、多订阅，不属于任何单一订阅；仅一次性升级购买（`bill_type='one_off'`）时回填。
- `paid_amount` 涵盖两条受款路径：**预付款扣减**（`tenant_transaction` trade_type=`consume`）+ **线上/线下支付**（`tenant_payment`）；`partial` 状态即两路合计仍 < `payable_amount`。

### 9.4 `tenant_invoice_item`（账单明细行，+workspace_id 成本归集）【修订，rank 20】

```sql
CREATE TABLE commerce.tenant_invoice_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         uuid NOT NULL REFERENCES commerce.tenant_invoice(id),  -- fk_tii_invoice
  tenant_id       uuid NOT NULL,                  -- 冗余结算主体，便于不连头表查询
  workspace_id    uuid NOT NULL,                  -- 【新增·rank 20】成本中心归集键（ADR-11 §11.1）
  subscription_id uuid,                            -- 该行对应哪笔订阅（charged 订阅费行必填）
  product_id      uuid REFERENCES product.product(id),  -- 替代 deploy agent_id（scope-key 调和 §11/§8.9#5）
  metric_key      varchar(64),                     -- 替代 deploy feature_id；计量超额行填 doc.words/ai.calls
  item_name       varchar(128) NOT NULL,
  item_type       varchar(32)  NOT NULL,           -- subscription_fee | metered_overage | credit_adjustment | discount | tax
  item_unit       varchar(64),                     -- 月 | 万字 | 千次 ...
  quantity        numeric(12,4) DEFAULT 1,         -- 沿用 deploy 精度
  unit_price      numeric(12,2) DEFAULT 0,         -- 【修订 2026-09-03】资金类一律两位小数（§3.2），承接 plan_prices.price
  total_amount    numeric(12,2) NOT NULL DEFAULT 0,-- 行小计（应用层 round 到分），并入头表 total
  usage_summary_ref uuid,                           -- 【修订】原 usage_record_id；重指向 §8.7 周期对账/出账批次，不再指退役 usage_meter
  remark          varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_tii_type CHECK (item_type IN ('subscription_fee','metered_overage','credit_adjustment','discount','tax'))
);
CREATE INDEX idx_tii_invoice   ON commerce.tenant_invoice_item (bill_id);
CREATE INDEX idx_tii_workspace ON commerce.tenant_invoice_item (workspace_id);     -- rank 20：按 workspace 成本拆分
CREATE INDEX idx_tii_type      ON commerce.tenant_invoice_item (item_type);
CREATE INDEX idx_tii_deleted_at ON commerce.tenant_invoice_item (deleted_at);
```

- **rank 20 核心**：`workspace_id NOT NULL` 让一张 org 账单能按 workspace 拆出"哪个工作区花了多少"，对应 ADR-11 MVP-3 验收"一个 Org 下两个 Workspace 各自订阅 → 月末 Org 汇总一张账单（仅计 charged）"。
- **两类计费行**（ADR-11 §11.8④ "订阅费(仅 charged) + 计量超额"）：
  - `subscription_fee`：取自 charged 的 `tenant_subscription` × `plan_version.price`（`billing_kind='charged'` 的组件才计；`bundled_free` 不进结算）。
  - `metered_overage`：取自 §8.7 `usage_summary` 在本周期内 charged 计量（按 `model_price_rule` §11 计价），`product_id`+`metric_key`+`usage_summary_ref` 锁定来源，**逐池/逐 metric 可对账回溯**。
- `agent_id`/`feature_id` → `product_id`/`metric_key`：与 §8/§11 的 scope-key 统一（agent/feature→product，§11.3 映射为硬前置）；在映射就绪前出账逻辑暂不启用，结构先就位。

### 9.5 `tenant_invoice_receipt`（中国增值税发票 fapiao）【沿用 + 取值收敛】

deploy 已具备 fapiao 全要素（税号 / 公司 / 银行 / 快递），本章仅补 CHECK 与语义注释，不动结构：

```sql
CREATE TABLE commerce.tenant_invoice_receipt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,                     -- 开票主体 = 结算 org/tenant
  bill_id       uuid NOT NULL REFERENCES commerce.tenant_invoice(id),
  invoice_no    varchar(64) NOT NULL UNIQUE,       -- 平台内部发票申请号；uidx
  invoice_type      varchar(32) NOT NULL,          -- electronic_general(电子普票) | electronic_special(电子专票) | paper_special(纸质专票)
  invoice_tax_type  varchar(32) NOT NULL,          -- general(普票) | special(增值税专用发票)
  invoice_title varchar(256) NOT NULL,             -- 抬头（公司名/个人）
  tax_no        varchar(128),                       -- 纳税人识别号（专票必填）
  company_info  jsonb NOT NULL,                     -- 单位名称/地址/电话（结构化抬头）
  bank_info     jsonb,                              -- 开户行 + 银行账号（专票必填）
  address_info  jsonb,                              -- 收件人/电话/邮寄地址（纸质发票快递用）
  invoice_amount numeric(12,2) NOT NULL,            -- 价税合计
  tax_amount     numeric(12,2) DEFAULT 0,           -- 税额
  currency       varchar(16) DEFAULT 'CNY',
  invoice_status varchar(32) NOT NULL DEFAULT 'applying',  -- applying|approved|issued|sent|rejected|voided
  status_remark  text,
  invoice_code        varchar(64),                  -- 税务局发票代码（开具后回填）
  invoice_electronic_no varchar(64),                -- 电子发票号码
  invoice_file_url    text,                          -- PDF/OFD 文件地址
  issued_at      timestamptz,                        -- 实际开具时间
  express_company varchar(64),                       -- 快递公司（纸质专票邮寄）
  express_no      varchar(64),                       -- 快递单号
  send_at         timestamptz,
  created_by uuid NOT NULL, auditor_id uuid, audit_at timestamptz,  -- 申请人 + 运营审核
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_tir_status CHECK (invoice_status IN ('applying','approved','issued','sent','rejected','voided')),
  CONSTRAINT chk_tir_tax_type CHECK (invoice_tax_type IN ('general','special'))
);
CREATE INDEX idx_tir_invoice_no ON commerce.tenant_invoice_receipt (invoice_no);
CREATE INDEX idx_tir_status     ON commerce.tenant_invoice_receipt (invoice_status);
CREATE INDEX idx_tir_bill       ON commerce.tenant_invoice_receipt (bill_id);
```

- 与开票抬头表 `tenant_billing_address`（§9.10）的关系：申请发票时把某条 `billing_address` 快照成 `company_info`/`bank_info`/`tax_no`（**值快照**，非外键引用），抬头后续修改不影响已开发票——同 §8 "版本不可变" 一脉的快照思路。
- 一张账单可能拆开多张发票（金额分次），故 `(bill_id)` 非唯一；`invoice_no` 唯一。

### 9.6 `tenant_payment`（支付：线上+线下多渠道+凭证）【沿用 + FK/CHECK】

```sql
CREATE TABLE commerce.tenant_payment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  bill_id       uuid NOT NULL REFERENCES commerce.tenant_invoice(id) ON DELETE RESTRICT,  -- fk_tp_invoice
  transaction_id uuid REFERENCES commerce.tenant_transaction(id),   -- 【修订】支付成功后写流水，建 FK
  pay_order_no  varchar(64) NOT NULL UNIQUE,        -- 支付单号；UNIQUE = "支付不能双份"（database.md §11）
  pay_source    varchar(32) NOT NULL DEFAULT 'online',  -- online | offline
  pay_channel   varchar(32),                          -- wechat | alipay | unionpay | bank（网关接入后填）
  pay_method    varchar(32),                          -- qrcode | h5 | app ...
  offline_pay_type   varchar(32),                     -- 线下：bank_transfer | cash | check
  offline_payer_name varchar(128),
  offline_pay_time   timestamptz,
  offline_evidence_url text,                          -- 线下转账凭证（回单截图/扫描件）
  total_amount  numeric(12,2) NOT NULL,
  paid_amount   numeric(12,2) DEFAULT 0,
  currency      varchar(16) DEFAULT 'CNY',
  pay_status    varchar(32) NOT NULL DEFAULT 'pending',  -- 见 §9.13 状态机
  status_msg    text,
  channel_order_no       varchar(128),                -- 网关侧订单号（占位，未接入为空）
  channel_transaction_no varchar(128),                -- 网关侧交易流水号
  channel_raw_data       jsonb,                        -- 回调原文留存
  pay_expire_at timestamptz, paid_at timestamptz, closed_at timestamptz,
  operator_id   uuid, operate_remark text,            -- 线下支付/手工对账由 operator 录入
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tp_source CHECK (pay_source IN ('online','offline')),
  CONSTRAINT chk_tp_status CHECK (pay_status IN ('pending','pending_verify','paid','failed','closed','refunding'))
);
CREATE INDEX idx_tp_invoice    ON commerce.tenant_payment (bill_id);
CREATE INDEX idx_tp_pay_order   ON commerce.tenant_payment (pay_order_no);
CREATE INDEX idx_tp_status      ON commerce.tenant_payment (pay_status);
CREATE INDEX idx_tp_tenant      ON commerce.tenant_payment (tenant_id);
```

- **`pay_order_no` UNIQUE** 是 database.md §11 "支付不能双份" 的落地（同一支付单不可重复入账）；幂等回调按 `channel_transaction_no` + `pay_order_no` 去重。
- **线下路径可先行**（不依赖网关）：`pay_source='offline'` + `offline_*` + 凭证 URL，由 operator 审核置 `paid`；线上路径在网关接入后启用 `channel_*`。
- `transaction_id` 改为指向 `tenant_transaction` 的真实 FK（deploy 为裸 uuid）：支付成功时同事务写一条不可变流水（见 §9.12 步骤）。

### 9.7 `tenant_refund`（退款，双状态机）【沿用 + FK/CHECK】

```sql
CREATE TABLE commerce.tenant_refund (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  bill_id       uuid NOT NULL REFERENCES commerce.tenant_invoice(id),
  pay_record_id uuid NOT NULL REFERENCES commerce.tenant_payment(id),       -- 退哪笔支付
  transaction_id uuid REFERENCES commerce.tenant_transaction(id),           -- 退款成功写冲正流水
  refund_no     varchar(64) NOT NULL UNIQUE,
  refund_amount numeric(12,2) NOT NULL,
  currency      varchar(16) DEFAULT 'CNY',
  refund_reason varchar(512),
  refund_type   varchar(32) DEFAULT 'normal',         -- normal | partial | dispute
  audit_status  varchar(32) NOT NULL DEFAULT 'pending',  -- pending → approved | rejected
  audit_remark  text, auditor_id uuid, audit_at timestamptz,
  channel_refund_no varchar(128),                       -- 网关退款单号（占位）
  refund_status varchar(32) NOT NULL DEFAULT 'pending',  -- pending → processing → success | failed
  refund_at     timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tr_audit  CHECK (audit_status  IN ('pending','approved','rejected')),
  CONSTRAINT chk_tr_refund CHECK (refund_status IN ('pending','processing','success','failed'))
);
CREATE INDEX idx_tr_audit_status ON commerce.tenant_refund (audit_status);
CREATE INDEX idx_tr_refund_no    ON commerce.tenant_refund (refund_no);
CREATE INDEX idx_tr_tenant       ON commerce.tenant_refund (tenant_id);
```

- 两段状态机（commerce.md §7.3）：先**审核**（`audit_status`: pending→approved/rejected），通过后才进**执行**（`refund_status`: pending→processing→success/failed）。
- 退款**不回改原支付/流水**（账本不可变，§9.8），而是退款成功时**追加一条冲正流水**（`tenant_transaction.trade_type='refund'`，金额为负向或独立冲正记录），并回写 `tenant_credit`（若退回预付款池）。

### 9.8 `tenant_transaction`（资金流水，不可变账本）【修订：承接 database.md §11 DB RULE】

```sql
CREATE TABLE commerce.tenant_transaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,                       -- 资金账户主体 = org/tenant（方案A）
  bill_id       uuid,                                 -- 关联账单（出账扣款时）
  transaction_no varchar(64) NOT NULL UNIQUE,
  trade_type    varchar(32) NOT NULL,                 -- recharge(充值) | consume(出账扣减) | refund(退款) | grant(赠送) | adjust(冲正)
  amount        numeric(12,2) NOT NULL,               -- 本笔变动（正=入账，负=出账；或按 trade_type 约定方向）
  currency      varchar(16) DEFAULT 'CNY',
  balance_before numeric(12,2) NOT NULL,              -- 变动前 tenant_credit.balance 快照
  balance_after  numeric(12,2) NOT NULL,              -- 变动后快照；与 tenant_credit 乐观锁配合可对账重建
  trade_status  varchar(32) NOT NULL DEFAULT 'success',
  related_no    varchar(128),                          -- 关联单号（pay_order_no / refund_no）
  remark        varchar(512),
  operator_id   uuid, client_ip varchar(64),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 故意无 updated_at / deleted_at：append-only，永不修改/软删
  CONSTRAINT chk_tt_trade_type CHECK (trade_type IN ('recharge','consume','refund','grant','adjust'))
);
CREATE INDEX idx_tt_tenant     ON commerce.tenant_transaction (tenant_id);
CREATE INDEX idx_tt_trade_type ON commerce.tenant_transaction (trade_type);
CREATE INDEX idx_tt_no         ON commerce.tenant_transaction (transaction_no);
```

**不可变约束（承接 database.md §11 / `commerce.md` §9.1，登记 §17）**：

```sql
-- 实现取 RAISE EXCEPTION 触发器，而非 `DO INSTEAD NOTHING` RULE。
-- 理由（与 §8.4 同源，rank 17）：DO INSTEAD NOTHING 会“静默吞写”——UPDATE/DELETE 返回成功但 0 行，
--   篡改企图被悄悄无视。金融账本被改必须“硬失败、可告警”，不能静默 no-op；
--   commerce.md §9.1 本就要求“触发异常”，与 RAISE 一致。
CREATE OR REPLACE FUNCTION commerce.tt_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tenant_transaction 不可变（账本是法律证据），更正请追加冲正流水(trade_type=adjust/refund)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tt_no_update BEFORE UPDATE ON commerce.tenant_transaction
  FOR EACH ROW EXECUTE FUNCTION commerce.tt_block_mutation();
CREATE TRIGGER trg_tt_no_delete BEFORE DELETE ON commerce.tenant_transaction
  FOR EACH ROW EXECUTE FUNCTION commerce.tt_block_mutation();
```

> **回写 database.md §11（登记 §17）**：§11 措辞为"`tenant_transaction` 不可变（DB 规则阻止 UPDATE/DELETE）"。实现应明确为 **RAISE EXCEPTION 触发器**而非 `DO INSTEAD NOTHING` RULE（避免静默吞写，rank 17 同源）；database.md "DB 规则" 应据此校订为"DB 级不可变约束（RAISE 触发器）"。

- 流水是**预付款池 `tenant_credit` 的唯一变动通道**：任何 `tenant_credit.balance` 变化都必须伴随一条 `tenant_transaction`，`balance_before`/`balance_after` 与 `tenant_credit.version` 自增形成可重建对账链（"账本不可变" + "支付不能双份"）。

### 9.9 `tenant_credit`（预付款池 = billing_account.prepaid_balance，乐观锁）【修订】

```sql
CREATE TABLE commerce.tenant_credit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL UNIQUE,               -- 一 org/tenant 一池（uidx_tc_tenant）
  currency      varchar(16) NOT NULL DEFAULT 'CNY', -- ADR-11 billing_account.currency
  balance       numeric(12,2) NOT NULL DEFAULT 0,   -- 预付款余额（prepaid_balance）
  total_granted numeric(12,2) NOT NULL DEFAULT 0,   -- 累计赠送/充值
  total_consumed numeric(12,2) NOT NULL DEFAULT 0,  -- 累计出账消耗
  version       integer NOT NULL DEFAULT 0,          -- 乐观锁：UPDATE ... WHERE version=:v（防并发扣款丢失）
  created_at    timestamptz NOT NULL DEFAULT now(),  -- 【修订】deploy 缺，补齐
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

- = ADR-11 `Organization.billing_account.prepaid_balance/currency`；**方案A**：直接挂 `tenant_id`，不另立汇总表。
- **乐观锁并发模型**：出账/扣减用 `UPDATE tenant_credit SET balance=balance-:amt, version=version+1, ... WHERE tenant_id=:t AND version=:v`，影响 0 行即重试——配合 §9.8 不可变流水，杜绝"双份扣款 / 余额漂移"。
- **多币种**：当前 `tenant_id` 唯一 = 单币种/org。若未来需多币种，改唯一键为 `(tenant_id, currency)`（登记 runbook §9.15 待决项 #5）。

### 9.10 `tenant_billing_address`（开票抬头）+ 9.11 `tenant_payment_method`（支付方式）【沿用】

```sql
CREATE TABLE commerce.tenant_billing_address (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,                         -- 方案A，FK→identity.tenant
  invoice_tax_type varchar(32) NOT NULL,            -- general | special（普票/专票税种；发票形态见 receipt.invoice_type）
  title       varchar(256) NOT NULL,                 -- 抬头
  tax_no      varchar(64), phone varchar(64), address varchar(512),
  bank_name   varchar(256), bank_account varchar(256),
  is_default  boolean NOT NULL DEFAULT false,        -- 每 tenant 至多一条 default（应用层保障/部分唯一索引可选）
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_tba_tenant ON commerce.tenant_billing_address (tenant_id);

CREATE TABLE commerce.tenant_payment_method (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  method_type varchar(32) NOT NULL,                  -- wechat | alipay | bank_card | bank_transfer ...
  status      varchar(32) NOT NULL DEFAULT 'active', -- active | disabled
  display_name varchar(128) NOT NULL,
  external_id varchar(256),                           -- 网关侧绑定标识（token 化，非卡号明文）
  is_default  boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_tpm_status CHECK (status IN ('active','disabled'))
);
CREATE INDEX idx_tpm_tenant ON commerce.tenant_payment_method (tenant_id);
CREATE INDEX idx_tpm_status ON commerce.tenant_payment_method (status);
```

- 两表均"一 tenant 多条 + `is_default`"，与 `tenant_credit`（单行）共同构成方案A 的三表分离 billing account（v1.1 §5）。
- `tenant_payment_method.external_id` 存网关 token 化绑定标识，**不存卡号/密钥明文**（与 §2.2 铁律一致）；网关未接入前主要承载线下方式登记。

### 9.12 月末 org 结算流程（charged 订阅费 + 计量超额 → 预付款扣减/开票）（rank 20）

ADR-11 MVP-3 闭环，单事务/批跑（`service-billing`）：

```
① rollup 取数（按 org=tenant + bill_cycle）
   a. charged 订阅费：扫该 tenant 下各 workspace 的 active tenant_subscription，
      仅取 plan_component.billing_kind='charged' 的组件 × plan_version.price
      → 每 (workspace, subscription) 生成一条 item_type='subscription_fee'。
   b. 计量超额：读 §8.7 usage_summary 该周期 charged 计量(metric_key)，按 §11 model_price_rule 计价
      → 每 (workspace, product, metric) 生成一条 item_type='metered_overage'，usage_summary_ref 锁源。
   （bundled_free 组件不计——ADR-11 §11.8④“仅 charged”。）
② 生成账单：INSERT tenant_invoice(tenant_id=org, bill_cycle, total=SUM(items), payable=total-discount, status='unpaid')
            + tenant_invoice_item × N（带 workspace_id 成本归集，rank 20）。
③ 预付款扣减（若 tenant_credit.balance>0）：
   UPDATE tenant_credit SET balance=balance-:deduct, total_consumed=total_consumed+:deduct, version=version+1
     WHERE tenant_id=:org AND version=:v;            -- 乐观锁，0 行则重试
   INSERT tenant_transaction(trade_type='consume', amount=:deduct, balance_before/after, bill_id=:invoice);  -- 不可变
   回写 invoice.paid_amount/bill_status（足额→paid；不足→partial）。
④ 余额不足部分：走 tenant_payment（线上网关 / 线下转账+凭证）补齐 → 成功再写一条 tenant_transaction。
⑤ 开票：按需 INSERT tenant_invoice_receipt（fapiao），快照 tenant_billing_address 的抬头/税号/银行。
```

```sql
-- rollup 视图骨架（按 org 汇总各 workspace 的 charged 成本，rank 20 的查询形态）
SELECT s.tenant_id AS org_id, s.workspace_id, s.id AS subscription_id,
       pc.product_id, pc.tier, (pv.price) AS charged_fee
FROM commerce.tenant_subscription s
JOIN product.plan_version pv   ON pv.id = s.plan_version_id
JOIN product.plan_component pc ON pc.plan_version_id = pv.id AND pc.billing_kind = 'charged'
WHERE s.tenant_id = :org AND s.status = 'active'
  AND s.start_at < :cycle_end AND (s.end_at IS NULL OR s.end_at >= :cycle_start)
ORDER BY s.workspace_id;   -- 计量超额另从 §8.7 usage_summary 同维度 UNION
```

- 该流程**所有金额变动经不可变流水 + 乐观锁**（§9.8/§9.9），满足"账本不可变 / 支付不能双份"；workspace 仅作成本归集维度，结算与扣款落在 org/tenant。

### 9.13 状态机汇总（commerce.md §7）

- **账单 `tenant_invoice.bill_status`**：`unpaid → paying → paid`；`unpaid/paying → partial`（预付款+部分支付）；`unpaid → overdue`（逾期）；`* → cancelled`（作废）。
- **支付 `tenant_payment.pay_status`**：`pending → pending_verify → paid | failed`；`pending/pending_verify → closed`（超时）；`paid → refunding`（申请退款）。
- **退款 `tenant_refund`**：审核 `audit_status: pending → approved | rejected`；执行 `refund_status: pending → processing → success | failed`。
- **发票 `tenant_invoice_receipt.invoice_status`**：`applying → approved → issued → sent`；`applying → rejected`；`issued → voided`（红冲）。

> 📦 **落地/迁移**：原「9.14 非 Prisma DDL → §17 登记 + database.md 回写清单 / 9.15 依赖待决项」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 10. Provisioning 与外部应用集成（新建·字段级，rank 21）

> v1.1 **完全未提**，但两张表 `tenant_app_provisioning` / `app_webhook_delivery` 自 commerce 域起即**生产在用**（deploy `schema.prisma` L1004–1040，`@@schema("commerce")`）。本章为其首次字段级落地，并把它们与 §7 `product.product_webhook`、§8 计量内核对齐。**(rank 21)**

### 10.0 定位：开通与订阅正交、方向与 consume 相反

两条独立生命周期，**互不充要**：

| 维度     | 订阅（§8/§9）                                                   | 开通 / provisioning（本章）                                                                                                          |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 表达     | **商业权利**：workspace 买了哪个 plan_version、配额池余量、账单 | **业务空间初始化**：外部产品仓（如 ruyin、umbra）侧"这个 workspace 的业务空间已建好/已拆除"                                          |
| SoT      | `tenant_subscription` + `quota_pool`                            | `tenant_app_provisioning`（状态机）                                                                                                  |
| 触发关系 | 订阅创建/变更**触发**开通事件                                   | 但开通**不等于**订阅：可"已订未开（pending）"、"退订但业务空间延迟拆除（仍 provisioned）"、"跨 plan 升降级期间保持 provisioned 不变" |

**方向性（关键区分，避免与 §8 混淆）**：

- 本章 `app_webhook_delivery` = **平台 → 产品（outbound、异步、webhook 推送）**，承载开通/生命周期事件。
- §8 consume = **产品 → 平台（inbound、同步、`POST /usage/consume`，非 webhook）**，承载用量。
  两者方向、协议、SoT 全部不同，不可复用同一通道。

---

### 10.1 `commerce.tenant_app_provisioning`（开通状态机）

【新建（字段级）/修订】对应 deploy `commerce.tenant_app_provisioning`（L1004–1020，生产在用、v1.1 未字段级，rank 21）；本章修订主体键 **workspace 化** + `application_id→product_id`（scope-key 调和，rank 6/15），并删 `plan_id`（落实正交，见下）。

```sql
commerce.tenant_app_provisioning (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,                       -- 开通主体（新增；与 §8 一致，见 §10.4）  [rank 6/15]
  tenant_id         uuid NOT NULL,                       -- 结算/rollup 反查（沿用 deploy；workspace 所属 org/tenant 派生）
  product_id        uuid NOT NULL REFERENCES product.product(id),  -- 原 application_id；agent+application 已并为 product  [rank 6/15]
  status            varchar(32) NOT NULL DEFAULT 'pending',  -- pending | provisioned | deprovisioned
  version           integer     NOT NULL DEFAULT 0,      -- 单调版本：每次状态迁移 +1，作乐观锁 + 投递排序键（§10.2）
  provisioned_at    timestamptz,                          -- 产品确认开通成功的时刻
  deprovisioned_at  timestamptz,                          -- 拆除完成的时刻
  metadata          jsonb,                                -- 开通上下文（区域/初始化参数/产品侧 space_id 回执等）
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tap_status CHECK (status IN ('pending','provisioned','deprovisioned')),
  CONSTRAINT uq_tap_workspace_product UNIQUE (workspace_id, product_id)   -- 每 workspace+product 至多一条
);
CREATE INDEX idx_tap_product_id ON commerce.tenant_app_provisioning (product_id);
CREATE INDEX idx_tap_tenant_id  ON commerce.tenant_app_provisioning (tenant_id);   -- org/tenant 维度 rollup 反查
```

要点：

- **状态机**（沿用 deploy 的三态，不超前加 transient/failed，遵起步阶段最小化）：
  `pending`（订阅已建、待向产品推送开通）→ `provisioned`（产品回执成功）→ `deprovisioned`（退订后拆除完成）。
  重新订阅 = **复用同一行**（受 `uq_tap_workspace_product` 约束），`deprovisioned → pending → provisioned` 回流，每跳 `version += 1`。投递成败明细不落本行，记入 §10.2。
- **`version` 双职**：① 乐观锁，防并发状态迁移互相覆盖；② **投递排序键**——`app_webhook_delivery` 携带迁移时的 `version`，产品端据此**丢弃乱序到达的旧事件**（webhook 至少一次 + 可能乱序，靠版本号收敛到最终态）。
- **删除 deploy 的 `plan_id`**（落实正交）：开通生命周期**不依赖**具体 plan——同一 workspace 跨 plan 升降级期间保持 `provisioned` 不变，"开通时挂哪个 plan" 属审计信息，归 §10.2 投递 payload，不污染状态行。
- `workspace_id` / `tenant_id` 为裸 `uuid`（**不建跨 schema FK 到 identity**，与 §8.2 `quota_pool.workspace_id` 一致处理；跨 schema FK 全局策略见 runbook §18.1#3 待决）。`product_id` 用 `REFERENCES product.product(id)`，沿用 §8.2 `quota_pool` 同款跨 schema FK 先例。

---

### 10.2 `commerce.app_webhook_delivery`（投递记录：retry / lease / idempotency / 最终送达）

【新建（字段级）/修订】对应 deploy `commerce.app_webhook_delivery`（L1022–1040，生产在用，rank 21）；本章修订主体键 workspace 化 + `application_id→product_id`（rank 6/15），并**补齐 deploy 缺失的 `idempotency_key`、`provisioning` 关联、终态集与死信**。

```sql
commerce.app_webhook_delivery (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key       varchar(128) NOT NULL,           -- 去重键（新增，rank 21）：派生自 product_id+event_type+provisioning_version，防同一逻辑事件重复入队
  provisioning_id       uuid REFERENCES commerce.tenant_app_provisioning(id),  -- 关联开通行（可空：非开通类生命周期事件）
  provisioning_version  integer,                          -- 入队时的开通版本，投到产品端供其丢弃乱序旧事件
  workspace_id          uuid NOT NULL,                    -- 与开通主体一致（新增，rank 6/15）
  tenant_id             uuid NOT NULL,                    -- rollup 反查（沿用）
  product_id            uuid NOT NULL REFERENCES product.product(id),  -- 原 application_id（rank 6/15）
  event_type            varchar(64) NOT NULL,             -- provisioned | deprovisioned | subscription_changed | quota_warning ...
  payload               jsonb       NOT NULL,             -- 事件负载（含触发时的 plan_version_id 等审计上下文）
  status                varchar(32) NOT NULL DEFAULT 'pending',  -- pending | delivering | delivered | failed | dead
  attempts              integer     NOT NULL DEFAULT 0,
  max_attempts          integer     NOT NULL DEFAULT 8,   -- 超过则转 dead（死信），停止重试
  response_code         integer,                          -- 末次 HTTP 响应码
  last_error            varchar(512),                     -- 末次失败摘要（超时/4xx/5xx/签名拒绝）
  signature             varchar(256),                     -- 本次投递的 HMAC 头值（用 §7 webhook_secret_ref 签发），审计/重放
  leased_by             varchar(64),                      -- 抢占该行的投递 worker 标识
  leased_until          timestamptz,                      -- 租约到期（防并发/僵死 worker 重复投递）
  last_attempt_at       timestamptz,
  next_retry_at         timestamptz,                      -- 指数退避下次可投时刻
  delivered_at          timestamptz,                      -- 终态 delivered 时刻
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_awd_status CHECK (status IN ('pending','delivering','delivered','failed','dead')),
  CONSTRAINT uq_awd_idempotency UNIQUE (idempotency_key)  -- 全局去重，幂等入队  [rank 21]
);
-- 投递 worker 领取队列：待投/可重试 + 到期；status 与 next_retry_at 复合（不用 now() 部分索引，同 §8.2 教训）
CREATE INDEX idx_awd_claim             ON commerce.app_webhook_delivery (status, next_retry_at);
CREATE INDEX idx_awd_workspace_product ON commerce.app_webhook_delivery (workspace_id, product_id);
CREATE INDEX idx_awd_provisioning      ON commerce.app_webhook_delivery (provisioning_id);
```

投递语义：

- **入队幂等**：同一逻辑事件（同 product+event+provisioning_version）经 `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` 只产生一行，避免重复推送（与 §8.5 `usage_idempotency` 同思路，但**各自独立**：那张管 inbound consume，这张管 outbound 投递）。
- **lease 领取（防并发重复投递）**：worker 以租约抢占——
  `UPDATE ... SET status='delivering', leased_by=:w, leased_until=now()+lease, attempts=attempts+1, last_attempt_at=now() WHERE id IN (SELECT id FROM commerce.app_webhook_delivery WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at<=now()) AND (leased_until IS NULL OR leased_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT :n)`。
  `SKIP LOCKED` 让多 worker 并行不抢锁；`leased_until` 过期即可被另一 worker 接管（崩溃 worker 自愈）。
- **retry / 终态**：成功 → `status='delivered'`、`delivered_at=now()`、`response_code` 落值；可重试失败 → `status='failed'`、`attempts++`、`next_retry_at=now()+backoff(attempts)`（指数退避）；`attempts>=max_attempts` → `status='dead'`（**死信**，停止重试、转人工/告警）。
- **签名**：投递前按 `product_id` 查 §7 `product.product_webhook` 取 `webhook_url`+`webhook_secret_ref`，对 `payload` 做 HMAC 得 `signature` 头，产品端用同一密钥**验签**确认请求确来自平台、未被篡改（平台自签密钥，非 Provider Key，可正常入平台库——见 §7/runbook §0.4）。
- **非 append-only**：本表是**可变工作队列**（status/attempts/lease 频繁就地改），明确**不套用** §8.4 `tenant_usage_event` 的 append-only RAISE 触发器；亦**无需分区**（生命周期事件量远低于每次 AI 调用，与 §8.4 / `support.audit_log` 的高频分区表不同）。留存靠定期归档/清理 `delivered` 旧行（策略见 runbook §10.5 待决）。

---

### 10.3 与 §7 `product.product_webhook` 的分工（静态配置 vs 每次投递）

二者**职责正交、所在 schema 不同、生命周期不同**，不可合并：

| 维度       | §7 `product.product_webhook`（**静态端点配置**）           | §10 `commerce.app_webhook_delivery`（**每次投递记录**）                                          |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 粒度       | **每产品一行**（PK = `product_id`）                        | **每次投递一行**                                                                                 |
| 回答的问题 | "发到**哪**、用**哪个**签名"                               | "**发了什么**、结果**如何**"                                                                     |
| 字段       | `home_url` / `webhook_url` / `webhook_secret_ref`          | `event_type` / `payload` / `status` / `attempts` / `response_code` / `lease` / `idempotency_key` |
| 性质       | 配置态，随产品长存、几乎只读                               | 运行态，随事件产生、可归档清理                                                                   |
| schema     | `product`（产品目录的一部分）                              | `commerce`（与订阅/计量同域）                                                                    |
| 协作       | 投递时 dispatcher 按 `product_id` join 取端点 + 取签名密钥 | 用上一列结果 HMAC 签名并落本表记录每次结果                                                       |

调用链：`tenant_subscription` 状态变更 / `quota_pool` 预警 → 生成 `tenant_app_provisioning` 状态迁移（`version++`）→ 幂等 `INSERT app_webhook_delivery` → worker lease 领取 → 按 `product_id` 查 `product_webhook` 端点+密钥 → HMAC 签名 POST → 落 `status`/`response_code`/重试。

---

### 10.4 开通主体 = workspace（与 §8 一致性，解此前 §10 待决项）

deploy 现表主体为 `(tenant_id, application_id)`。本章**锁定主体 = workspace**，理由与 §8 完全一脉：

1. **§8 已将 subscription/quota/usage 全部 workspace 化**；开通是"为某个**业务空间**初始化"，业务空间的天然边界就是 workspace。
2. **workspace_id 是平台权威隔离键**：§16 明确产品侧 RAG/向量按 **workspace 级隔离**，且该 `workspace_id` 必须来自平台 entitlement 体系、不接受产品端自声明——开通推送正是下发该权威隔离键的时机。tenant 级单条记录无法表达"workspace A 已开通、workspace B 未开通"。
3. **命名沿用 §8.1 先例**：§8.1 `tenant_subscription` 虽 workspace 化（加 `workspace_id NOT NULL`、保 `tenant_id` 供 rollup），**仍保留 `tenant_` 表名**。本章对 `tenant_app_provisioning` 作完全相同处理：表名不改、`workspace_id` 为真实主体、`tenant_id` 留作 org/tenant 维度结算 rollup 反查。

因此唯一约束由 `(tenant_id, application_id)` 改为 `(workspace_id, product_id)`。

---

> 📦 **落地/迁移**：原「10.5 退役 / 迁移 / 依赖与待决」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 11. model 治理域 + scope-key 调和 + Model Platform DB 目标平面（新建·字段级）

> 现状权威：`deploy/.../schema.prisma` 的 5 张 `@@schema("model")` 表（`ModelProvider`/`ModelDefinition`/`ModelGrant`/`ModelPriceRule`/`ModelPolicy`）+ `model-platform.md` §1/§2/§5。
> v1.1 仅在全景图提及 model、且 §4.2 的措辞把"已确认取消 gateway"误当成"model 已覆盖"——实际从未字段级落地，故本章为**新建字段级**（rank 19）。
> 本章交付三件事：(a) 逐表对照 deploy 的字段级定义与命名裁定；(b) **scope-key 调和**——旧 `tenant/application/agent` 轴 ↔ 新计量 `workspace/product/metric` 轴的映射口径（rank 6，§8 的硬前置）；(c) **Model Platform DB**（`routing`/`key`/`reqlog`）目标平面的字段级草图与跨库关联链路。

### 11.0 现状底数与本章决策回顾

| 项                     | 现状（deploy 基线）                                                                      | 本章处置                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 平台库 `model` schema  | 5 表，全 `@@schema("model")`，是 Model Platform 的**配置来源**（model-platform.md §5.1） | 字段级沿用 + 5 处修订（§11.2）                                                            |
| provider 密钥          | 不入任何库，运行环境注入（`vx-model-platform`）                                          | 目标态 → Model Platform DB `key`（§11.5），平台库**不接触明文**（database.md §11 铁律 7） |
| 请求日志 + AI 调用明细 | 暂无独立落地（仅运行时日志）                                                             | 目标态 → Model Platform DB `reqlog`，承接 §8.9② 被丢 AI 维度（rank 5）                    |
| gateway schema         | 已取消（runbook §0.4 / §12）                                                             | 不在平台库建；相关能力分流到本章 Model Platform DB + §7 `product.product_webhook`         |
| 计量写入               | 旧 writer 直写 `commerce.tenant_usage_event`（tenant 轴）                                | 切到 §8.3 `POST /usage/consume`（workspace 轴），**协调式迁移**（runbook §11.6，rank 5）  |

**迁移策略归类**：`model` 域**非在产运营数据**——provider/model/price_rule/policy 均为平台 seed 配置，`model_grant` 当前亦为 seed（尚无真实租户授权流量），故归 **"可重建 + reseed"**（同 commerce/product，runbook §0.3）。**唯一例外**：一旦有真实 `model_grant` 授权 + 旧 writer 在写 `tenant_usage_event`，scope-key 切换即为**协调式破坏性迁移**，须等 consume API 切换完成（runbook §11.6），不可裸 drop。

### 11.1 命名裁定（`provider` → `model_provider`，runbook §18.2 已决 = 全按 database.md）

- **裁定（runbook §18.2，owner 2026-07-01）：采用 `model.model_provider`**（= database.md §3.6），弃 deploy 现名 `provider`。数据可重灌（无生产数据）→ 改名仅需重建 + reseed + Prisma `ModelProvider @@map("model_provider")`，与 model-platform 代码/seed 锁步（工程线）。
- **归一到 database.md §3.6 约定**：`model_provider` / `model`(bare) / `model_grant` / `model_price_rule` / `model_policy`——即"`model` 表保 bare、其余 `model_` 前缀"，与 database.md 一致，本章全章据此。

### 11.2 逐表字段级（对照 deploy）

#### 11.2.1 `model.model_provider`【改名 provider→model_provider（runbook §18.2）· 微修】（deploy `ModelProvider @@map("provider")`）

provider 注册表（doubao / claude / 阿里云 / 火山 / private）。沿用 deploy 全字段，仅登记两处建议。

```sql
model.model_provider (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code varchar(64)  NOT NULL UNIQUE,                       -- doubao | claude | private | …
  provider_type varchar(32)  NOT NULL DEFAULT 'online',            -- online | self_hosted | private
  provider_name varchar(128) NOT NULL,
  description   varchar(512),
  logo_url      text, homepage_url text, console_url text, billing_url text,  -- 展示/运维用，非敏感
  is_active     boolean NOT NULL DEFAULT true,
  config        jsonb,                                              -- 非敏感连接元数据（超时/区域）；密钥不入此处
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz                                           -- 软删（deploy 已有）
);
```

- 微修建议（rank 19 子项，可选）：若 provider 需多态（active/degraded/disabled），把 `is_active boolean` 升级为 `status varchar(32) + CHECK`（§3.2 规范）；当前二态保持 boolean。
- **铁律**：`config` 与全表**不得**存 provider API Key（明文或可逆引用），密钥归 §11.5 `key.provider_api_key`。

#### 11.2.2 `model.model`【修订】（deploy `ModelDefinition`，`@@map("model")`）

Vxture 模型注册表（model_code / endpoint / 协议 / 能力标签 / 非敏感 config）。

```sql
model.model (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid REFERENCES model.model_provider(id),  -- 权威 provider 引用（FK，deploy 已有，nullable）
  model_code      varchar(128) NOT NULL UNIQUE,         -- 调用方唯一引用键（不接触 key）
  model_type      varchar(32)  NOT NULL DEFAULT 'chat', -- chat | embedding | rerank | …
  protocol        varchar(64)  NOT NULL,                -- openai | anthropic | …（adapter 选择）
  model_name      varchar(128) NOT NULL,
  description     varchar(512),
  endpoint_url    text NOT NULL,                        -- 目标态可下沉 routing.provider_config（见 §11.5 待决）
  context_window  integer, max_output_tokens integer,
  capabilities    text[] NOT NULL DEFAULT '{}',         -- vision | tools | json_mode …
  supports_streaming boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  sort            integer NOT NULL DEFAULT 999,
  config          jsonb,                                -- 含 fallbackModelCodes 等非敏感运行时配置
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

- **修订（本章新发现，rank 19）**：deploy 同时存在 `provider_id uuid (FK)` **和** `provider varchar(64)`（provider_code 字符串冗余）两条 provider 引用——**裁定保留 `provider_id` 为唯一权威 FK，退役 `provider` 字符串列**（去双写、防漂移）；若运行时确需免 join 取 provider_code，改为视图/投影列而非可写裸列。记入 §17 回写。
- `endpoint_url` 现挂 model 行；目标态可能下沉到 Model Platform DB `routing.provider_config`（按 provider 维护连接），**两处只能有一处权威**，列为 §11.5 待决。

#### 11.2.3 `model.model_grant`【修订·调和核心】（deploy `ModelGrant`）

租户→模型**技术授权 / 灰度白名单**（不是配额、不是计费），是"租户上界"（model-platform.md §1.1/§5.1）。当前为旧 scope 轴，调和详见 §11.3。

```sql
model.model_grant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        uuid NOT NULL REFERENCES model.model(id),
  tenant_id       uuid NOT NULL,                        -- 授权上界主体（保留；见 §11.3 轴语义）
  application_id  uuid,                                 -- 应用维度（agent/workflow/api_client/internal_service）
  application_type varchar(32),                         -- CHECK IN ('agent','workflow','api_client','internal_service')
  agent_id        uuid,                                 -- 【退役过渡】legacy，= application_id WHERE application_type='agent'
  priority        integer NOT NULL DEFAULT 100,
  is_active       boolean NOT NULL DEFAULT true,
  reason          varchar(512),
  expires_at      timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

- **修订**：`application_type` 补 `CHECK`（deploy 为裸 varchar，枚举 = agent/workflow/api_client/internal_service，model-platform.md §1.1）。
- **`agent_id` 退役过渡**：保留至所有调用方改走 `application_id + application_type='agent'`（model-platform.md §7：`agentId` deprecated alias），切换后 drop（记入 runbook §11.6 协调迁移）。
- **轴语义（关键）**：grant 维持 `tenant`(+`application`) 轴**作为授权上界**，**不**重命名为 workspace/product——授权与计量是两套语义（授权=能不能调；计量=扣谁的额）。二者经 §11.3 **映射口径**（非列改名）桥接。若日后需 workspace 级收窄授权，再加 `workspace_id uuid NULL`（"窄于 tenant"，runbook §11.7 待决）。

#### 11.2.4 `model.model_price_rule`【沿用·微修】（deploy `ModelPriceRule`）

**provider 成本费率**（Vxture 付给上游的钱），用于毛利分析/供应商结算——**不是**面向客户的标价（客户费在 product.plan_version/commerce）。历史版本靠 `effective_at/expires_at` 叠加，无软删（不设 `deleted_at`，append 新规则）。

```sql
model.model_price_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id           uuid NOT NULL REFERENCES model.model(id),
  billing_mode       varchar(32) NOT NULL DEFAULT 'token',   -- token | request（决定计量 metric，见 §11.3）
  currency           varchar(16) NOT NULL DEFAULT 'CNY',
  unit_tokens        integer     NOT NULL DEFAULT 1000000,   -- 单价对应的 token 基数（每百万 token）
  input_unit_price   numeric(18,8) NOT NULL DEFAULT 0,       -- ⚠ 见精度注
  output_unit_price  numeric(18,8) NOT NULL DEFAULT 0,
  request_unit_price numeric(18,8) NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  effective_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,                            -- 历史版本：新费率开始即给旧行置 expires_at
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- ⚠ **精度不一致（本章新发现，rank 19）**：deploy 用 `numeric(18,8)`，§3.2 标价规范为 `numeric(18,6)`。per-token 单价极小（百万 token 基数），(18,8) 有其理由——**裁定登记为 §3.2 的"provider 成本费率例外"**（保 18,8），而非强行降精度；记入 §17 回写让 §3.2 显式承认该例外。
- 注：此表是 §8.9② "commerce 只承载计费 metric(amount)" 之外的**成本侧**；客户被扣的是 metric（如 ai.tokens），Vxture 内部按本表换算成本，二者解耦。

#### 11.2.5 `model.model_policy`【沿用】（deploy `ModelPolicy`）

模型访问策略（rpm/tpm/tpd 限流 + 并发 + 上下文上限），tenant 级（`tenant_id NULL` = 平台默认）。`UNIQUE(model_id, tenant_id)`。无软删（版本化同 price_rule）。

```sql
model.model_policy (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          uuid NOT NULL REFERENCES model.model(id),
  tenant_id         uuid,                                  -- NULL = 平台默认策略
  name              varchar(128),
  priority          integer NOT NULL DEFAULT 100,
  max_concurrent    integer,
  rate_limit_rpm    integer,                               -- requests / min
  rate_limit_tpm    bigint,                                -- tokens / min（BIGINT，§3.2）
  rate_limit_tpd    bigint,                                -- tokens / day
  max_context_tokens integer,
  is_active         boolean NOT NULL DEFAULT true,
  effective_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, tenant_id)
);
```

- **限流 ≠ 配额**：policy 是**技术速率门**（rpm/tpm/tpd，运行时 Model Platform 强制），与 §8 `quota_pool` 的**商业配额**正交：policy 防滥用/护上游 QPS，quota_pool 管"买了多少额度"。两者都在生成前 gate，但读不同源。

### 11.3 scope-key 调和（硬前置，rank 6）

**问题**：`model_grant` / 旧 `tenant_usage_event` 用 **`tenant_id` / `application_id`+`application_type` / `agent_id`**；§8 新计量用 **`workspace_id` / `product_id` / `metric_key`**。两轴不打通，`reqlog.request_record` ↔ `commerce.tenant_usage_event` ↔ `model_grant` 无法按单一 `request_id` join，consume 也无从知道扣哪个 `quota_pool`。**这是 §8 consume API 切换的硬前置**——映射口径未建则不可切换（runbook §11.6）。

**映射口径（旧轴 → 新轴，consume 边界处一次性解析后写入 usage_event）**：

| 新轴           | 来源口径                                                                                                                                             | 取数路径                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace_id` | 取自**当前 active 订阅**：调用方上下文的 `tenant_id` + 目标 `product_id` → 该 tenant 下持有该 product 订阅的 workspace（成本中心，ADR-11 §11.1 SoT） | `commerce.tenant_subscription WHERE tenant_id=? AND product...active` → `workspace_id`                                                                                                                                               |
| `product_id`   | 经 **agent_catalog → product** 解析：`application_id`/`agent_id`（`application_type='agent'`）→ 其所属 product                                       | `product.agent_catalog`（§7 product 域映射表）按 `application_id`→`product_id`；非 agent 应用（workflow/api_client/internal_service）按调用方声明的 product 上下文                                                                   |
| `metric_key`   | 取自 **model 计费单位**：`model_price_rule.billing_mode` 决定计量 metric                                                                             | `billing_mode='token'` → product 的 token metric（如 `ai.tokens`，divisible）；`billing_mode='request'` → 调用计数 metric（如 `ai.calls`，atomic）。metric 的 `consume_mode` 见 §7 `product_metric.consume_mode`（§8.3 step 4 分支） |

要点：

- **解析方向单一**：旧轴 → 新轴，在 Model Platform 调用 `POST /usage/consume`（§8.3）**之前**由 Model Platform 解析完成，consume 只收 `{workspace_id, product_id, metric_key, amount, idempotency_key, request_id}`，**不感知** tenant/application/agent 轴。
- **`amount` 的口径**：token 模式下 `amount` = 计费 token 数（单一 BIGINT）；**input/output 拆分不进 commerce**，归 `reqlog`（§8.9② / §11.5）。即 commerce 收"一个数"，AI 明细留在 Model Platform DB。
- **grant 不参与计量轴改名**：`model_grant` 仍按 tenant/application 轴做**授权 gate**（能不能调），与计量轴解耦；二者经本表口径在边界处对齐，故同一 `request_id` 可串起 grant 决策 / quota 扣减 / reqlog 明细。
- **`agent_catalog` 归属（跨轮依赖，rank 3）**：`product.agent_catalog`（application/agent → product 映射）在 database.md §3.4 为**规划态**，§7 本轮**不落字段级**（§7 开头澄清）。本章 consume 解析**依赖**其落地——属**跨轮硬前置**：agent_catalog 未落地前 scope-key 不可调和、consume 不可切（runbook §11.6）。其字段级 DDL 待 agent_catalog 立项时按 §7 同构补，登记 runbook §18。

### 11.4 Model Platform 接入面：只读配额 gate + consume 独占写（§8.9① 已确认，rank 6/15）

consume 是 AI 热路径同步调用，Model Platform 在"生成前"需门控，故拆成**读/写两个面**：

- **只读配额 gate / CHECK 面（Model Platform 用）**：授权 Model Platform **直读 `commerce.quota_pool`**（须走 §8.9 周期感知 `effective_used` 视图/表达式，**严禁裸读 `quota_used`**——惰性归零下会返回过期满载余量，rank 7）**或**专用 balance API（区别于产品面 `/platform/entitlements`）。此面**只读、不扣**。
- **consume 独占写**：实际扣减唯一经 §8.3 `commerce` consume 服务单事务（usage_idempotency 先占幂等 + `FOR UPDATE` 全序锁 + atomic/divisible 分支 + 上行 `tenant_usage_event(_pool)`）。Model Platform/产品端**禁止**直写任何用量/配额表（database.md §11 铁律 3）。
- **同步 + 有界本地 fail-open + 异步对账**（§8.9① 已确认）：consume 同步调用；commerce 不可用时 Model Platform 按**有界额度本地放行**（保 AI 可用性），事后异步对账补记 `tenant_usage_event`（兼顾可用性与计量正确性）。fail-open 额度上限是运营配置（admin.setting）。

### 11.5 Model Platform DB 目标平面（`routing` / `key` / `reqlog`，database.md §4）

> 独立库 `vxturestudio_modelruntime_main`（目标态独立实例 `vx-modelruntime-pg`；当前 `vx-model-platform` 先复用平台库 `model`/`commerce`，§3.1）。独立原因：reqlog 写入量极高（每次 AI 调用一条），与平台库共实例伤 OLTP。**跨库不建 FK**；一致性靠应用层 + 单一 `request_id`（runbook §11.6）。**唯一上行写**回平台库的是 `commerce.tenant_usage_event`（经 §8.3 consume，不绕过）。

#### 11.5.1 `key` schema（provider 密钥，平台库永不接触明文，铁律 7）

```sql
key.provider_api_key (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code varchar(64) NOT NULL,                 -- 逻辑引用 model.model_provider.provider_code（跨库，无 FK）
  key_alias     varchar(128) NOT NULL,                -- 多 key 轮换/区分
  encrypted_key bytea NOT NULL,                        -- AES-256 密文，内存解密，绝不出库明文
  key_scope     varchar(32) NOT NULL DEFAULT 'shared', -- shared | dedicated（专属租户/产品）
  is_active     boolean NOT NULL DEFAULT true,
  last_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_code, key_alias)
);
key.key_rotation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_api_key_id uuid NOT NULL REFERENCES key.provider_api_key(id),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  rotated_by uuid, reason varchar(256)
);
```

#### 11.5.2 `reqlog` schema（高频请求日志 + 被丢 AI 维度，rank 5；按月分区）

承接 §8.9② 从 commerce 剥离的 AI 调用明细（input/output token 拆分、model_code、latency、agent/feature 等）。

```sql
reqlog.request_record (                               -- 每次 AI 请求一行（高频）
  id              uuid DEFAULT gen_random_uuid(),
  request_id      varchar(128) NOT NULL,              -- 跨库关联键（→ commerce.tenant_usage_event.request_id）
  -- 隔离/归属维度（旧轴，审计保留）
  tenant_id uuid, workspace_id uuid, product_id uuid, user_id uuid,
  application_id uuid, application_type varchar(32), agent_id uuid, feature_id uuid,
  downstream_identity_hash varchar(128),              -- 四段复合(tenant+workspace+product+user) 哈希，应用层统一函数现算（v1.1 §4.2）
  -- AI 调用明细（commerce 不存这些）
  model_code  varchar(128), provider_code varchar(64),
  input_tokens bigint, output_tokens bigint, total_tokens bigint,
  latency_ms  integer, usage_type varchar(16),        -- normal | retry | test
  status      varchar(32),                            -- success | error | timeout
  business_id varchar(128),
  -- 计费回链（仅成功且计费的请求才有）
  billed_metric_key varchar(64), billed_amount bigint,
  usage_event_id uuid,                                -- 跨库引用 commerce.tenant_usage_event.id（无 FK）
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);                    -- 按月，预建 + DEFAULT 兜底（同 §8.4 模式）
CREATE INDEX idx_reqlog_request_id ON reqlog.request_record (request_id);

reqlog.error_record (                                 -- 错误/异常明细
  id uuid DEFAULT gen_random_uuid(),
  request_id varchar(128), provider_code varchar(64), model_code varchar(128),
  error_code varchar(64), error_message text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

- **失败调用不计费**：`status='error'` 的请求只进 `reqlog`，**不**触发 consume、**不**写 `commerce.tenant_usage_event`（model-platform.md §5.1：failed attempts are not customer usage events）。
- **四段复合下游标识**（v1.1 §4.2 / model-platform.md §2）：`tenant+workspace+product+user` 经应用层统一哈希函数现算，作为传给上游 provider 的隔离标识 + 落 `downstream_identity_hash`；该原则是 **Model Platform DB（key/reqlog）的设计约束**，平台库不建对应表。

#### 11.5.3 `routing` schema（连接/路由/降级，字段级较轻）

```sql
routing.provider_config ( id uuid PK, provider_code varchar(64) NOT NULL,
  endpoint_url text, timeout_ms integer, retry_policy jsonb, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
routing.model_route ( id uuid PK, model_code varchar(128) NOT NULL, provider_code varchar(64) NOT NULL,
  weight integer NOT NULL DEFAULT 100, is_active boolean NOT NULL DEFAULT true );
routing.fallback_rule ( id uuid PK, model_code varchar(128) NOT NULL,
  fallback_model_codes text[] NOT NULL DEFAULT '{}', condition varchar(64), is_active boolean NOT NULL DEFAULT true );
```

- **`endpoint_url` 权威待决**：现挂平台库 `model.model.endpoint_url`；目标态可下沉 `routing.provider_config`。**二选一**，避免双写（runbook §11.7）。

> 📦 **落地/迁移**：原「11.6 协调式破坏性迁移 / 11.7 待回写 database.md + 待决」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

## 13. safety 域（沿用 v1 §4.3）

**目标**：建结构占位，不接真实审核执行。

**关键内容**：`moderation_policy`(tenant_id NULL=平台默认，rules jsonb，is_active 默认 false) / `moderation_log`(direction input/output，result 默认 not_checked，关联 request_id)。默认值区分"没查过"vs"查过通过"。

---

## 14. operator/admin 域：运营身份安全 + 平台治理

> 范围：平台运营控制面（`y.vxture.com`）的运营人员身份域 + 平台级治理（配置 / 灰度 / 公告 / 维护 / 治理记录）。
> 权威专项：运营身份安全的字段级权威设计在 `docs/30-design/identity-platform-operator.md`（下称"专项 §6"）。**本章不复制专项**，只做三件事：(a) 把运营身份域在 v2 总纲里的落库归口讲清（schema=`admin`、与客户 realm 五维硬隔离）；(b) 补齐专项不覆盖的**平台治理表**字段级规格；(c) 收口 schema 命名、表计数、治理表命名等二次分析遗留问题。
> 现状底数：`deploy/database/prisma/schema.prisma`（76 model，权威基线）中本域 16 张表，全部带 `@@schema("ops")`。identity/iam/admin 自 2026-06-18 上生产，本域改动一律走**保数据迁移**（`ALTER SCHEMA RENAME` / 加列带默认或可空再回填 / 就地 `UPDATE`），**不 reseed**。

---

### 14.0 边界与红线（先立规矩）

运营身份域（operator）与客户身份域（`identity.*` tenant_user）是**两套完全隔离的账号体系**，专项 §1 立的红线在 v2 继续生效，落库层面表现为：

- **schema 隔离**：运营身份 + 平台治理统一归 `admin`（原 `ops`，见 runbook §14.1）；客户身份归 `identity`。
- **数据隔离不变量（硬约束）**：`admin.operator_*` 对 `identity.*` 与 `iam.role|permission` **零外键**；运营人员的会话 / 刷新 / 验证码 / 登录尝试**不得**落在 `identity.*`（专项 §7.2 已修复的现网泄漏，v2 不得回退）。
- **realm 隔离**：`iam.oidc_client(client_id=admin).realm = 'workforce'`（§5.3 已将取值由 `'operator'` 收窄为 `'workforce'`）；token `sub=opr_<id>`、`userType=operator`、`aud=admin`（单值），与客户 token（`usr_` / `customer` / 各租户 aud）**结构性互拒**。
- **共享基础设施（允许、非身份数据）**：`iam.oidc_client(admin)`、`iam.signing_key`（RS256 JWKS 双 realm 共用），二者对运营账号**无外键**。
- **审计落点**：运营全链路审计复用 `support.audit_log`，以 `actor_type=operator` 逻辑隔离（已按月分区、保留 ≥2 年），不在本域新建审计表。

> 与 §8 计量内核的关系：运营域与计量/订阅/配额**零交叉**（无 FK、无 realm 串味），§8 的 quota_pool / usage 全序瀑布等机制与本章互不影响。

---

> 📦 **落地/迁移**：原「14.1 schema `ops` → `admin`：不是改名，是一次锁步收口 (rank 16)」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。

### 14.2 本域表计数与命名清单（更正 rank 16）

v1.1 笼统写"16 张表"，既未点出**带 `operator_` 前缀的是 11 张**，也未指出治理表存在"设计 2 张 / 现实 1 张"的文档-现实分叉。在此一次性收口：

| 口径                                      | 表数   | 构成                                                                                                                                                                      |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **deploy 现实**（schema.prisma 权威基线） | **16** | 11 张 `operator_*` + 5 张治理/配置（setting / feature_flag / announcement / maintenance / **governance_record**）                                                         |
| **database.md §3.7 设计**                 | **17** | 同 11 张 `operator_*` + setting / feature_flag / announcement / maintenance + **risk_record + compliance_event**（设计拆 2 张，deploy 实际合并为 governance_record 1 张） |

**11 张带 `operator_` 前缀**（运营身份域，专项 §6）：`operator_account` / `operator_credential` / `operator_mfa` / `operator_webauthn_credential` / `operator_recovery_code` / `operator_verification` / `operator_login_attempt` / `operator_refresh_token` / `operator_role` / `operator_permission` / `operator_role_permission`。

> 结论：v2 **采纳 database.md §3.7（17 张，治理记录拆 `risk_record` + `compliance_event`，runbook §18.2 owner 决）**；数据可重灌无迁移成本，重建时按拆分建两表 + reseed，deploy 的 `governance_record` 单表退役。差额仅在治理记录 1-vs-2 张，与 operator 身份 11 张无关。

---

### 14.3 运营身份域（11 张表，引用专项 §6，不复制）

字段级权威规格见专项 §6.3，v2 此处只给**落库目录 + 关键列 + 安全语义 + v2 修订点**。除 §14.3.2 标【修订】者外，其余 10 张**沿用** deploy 现表（结构与专项 §6.3 一致）。

#### 14.3.1 表目录

| 表（admin.\*）                 | 标记          | 职责                                     | 关键列（节选）                                                                                                         | 来源                 |
| ------------------------------ | ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `operator_account`             | 【修订】      | 运营账号主体（单角色模型）               | `role_id` FK→operator*role、`username` U、`email?` U、`phone?` U、`status`、`is_system`、`last_login*\*`、`deleted_at` | deploy + 专项 §6.3   |
| `operator_credential`          | 【沿用】      | 1:1 密码凭据                             | PK `operator_id`、`password_hash`（**Argon2id**，OTP-only 可空）、`failed_attempts`、`locked_until`                    | deploy + 专项 §6.3   |
| `operator_mfa`                 | 【沿用】      | 1:1 MFA 状态/策略/TOTP                   | PK `operator_id`、`policy`、`totp_secret`（**加密落库**）、`totp_enabled`、`webauthn_required`                         | deploy + 专项 §6.3   |
| `operator_webauthn_credential` | 【沿用】      | 1:N Passkey 凭据                         | `credential_id` U、`public_key` bytea、`sign_count` bigint（防克隆）、`transports text[]`、`aaguid`                    | deploy + 专项 §6.3   |
| `operator_recovery_code`       | 【沿用】      | 1:N 恢复码（注册批量~10、单次）          | `code_hash`、`used_at`                                                                                                 | deploy + 专项 §6.3   |
| `operator_verification`        | 【沿用】      | 邮箱/手机 OTP（首因子 + step-up）        | `operator_id?`（定位前可空）、`target_type`、`purpose`(login/step_up)、`code_hash`、`expires_at`(TTL≤5min)、`used_at`  | deploy + 专项 §6.3   |
| `operator_login_attempt`       | 【沿用】      | 风控/限流（append-only）                 | `identifier`、`auth_method`、`result`、`ip_address`、`user_agent`                                                      | deploy + 专项 §6.3   |
| `operator_refresh_token`       | 【沿用】      | opaque 刷新（轮换+重放检测）             | `session_id`(=vx_sid_op)、`client_id='admin'`、`token_hash` U、`rotated_from`、`status`                                | deploy + 专项 §6.3   |
| `operator_role`                | 【沿用】      | 运营角色目录（单角色）                   | `role_code` U、`name_en`/`name_i18n_key`、`is_system`、`sort`、**`mfa_min_level`**（角色级 MFA 下限）                  | deploy + 专项 §6.3   |
| `operator_permission`          | 【沿用】      | 树形权限 + 菜单路由                      | `parent_id`（自引用）、`perm_code` U、`perm_type`、`route_path`/`component`/`icon`、`is_visible`                       | deploy + 专项 §6.3   |
| `operator_role_permission`     | 【沿用】      | 角色↔权限关联                            | 复合 PK `(role_id, permission_id)`，硬删除、无更新语义                                                                 | deploy + 专项 §6.3   |
| `operator_session`             | 【新建·预留】 | 会话 DB 镜像（专项 P4，可列举/强制下线） | `session_id`(=vx_sid_op) U、`amr`、`status`、`last_active_at`、`expires_at`                                            | 专项 §6.3（Phase 3） |

> Phase 1 会话仅 Redis（`vx_sid_op`）；`operator_session` 是专项 P4 的可选 DB 镜像，**不**复用 `identity.auth_session`（红线）。

#### 14.3.2 `operator_account` 修订：去客户域泄漏 + 补 is_system (rank 16)

deploy 现表与专项 §6.3 存在一处漂移：deploy `operator_account` 含 `account_type VARCHAR(16) DEFAULT 'personal'`、且**缺** `is_system`。`account_type='personal'` 对运营账号无业务语义（运营人员不存在 personal/organization 之分，那是客户 realm `tenant.type` 的概念），属客户域字段模板泄漏；而专项 §6.3 要求的 `is_system`（预建超管不可删）反而缺失。v2 收口对齐专项 §6.3：

```sql
-- 保数据迁移（生产域）：补 is_system → 回填预建超管 → 去客户域泄漏列
ALTER TABLE admin.operator_account ADD COLUMN is_system boolean NOT NULL DEFAULT false;
UPDATE admin.operator_account SET is_system = true WHERE username = 'superadmin';  -- 预建超管不可删
ALTER TABLE admin.operator_account DROP COLUMN account_type;                        -- 客户域泄漏，operator 无语义

-- realm 取值随 §5.3 收窄（同一锁步事务外，topology 层）
UPDATE iam.oidc_client SET realm = 'workforce' WHERE realm = 'operator';
```

#### 14.3.3 状态域 CHECK 收口（v2 命名规范）

deploy 现表的状态列为裸 `VARCHAR`（Prisma 不生成 CHECK）。v2 按 database.md §9（状态用 `VARCHAR(32)+CHECK`、不用 PG ENUM）补 `chk_` 约束，取值域稳定者优先：

```sql
ALTER TABLE admin.operator_account
  ADD CONSTRAINT chk_operator_account_status CHECK (status IN ('active','disabled','locked'));
ALTER TABLE admin.operator_mfa
  ADD CONSTRAINT chk_operator_mfa_policy     CHECK (policy IN ('disabled','optional','required'));
ALTER TABLE admin.operator_refresh_token
  ADD CONSTRAINT chk_operator_refresh_status CHECK (status IN ('active','rotated','revoked'));
```

#### 14.3.4 安全语义（落库视角，详见专项 §2/§3/§5）

- **Argon2id 全量**：`operator_credential.password_hash` 消除现网 operator bcrypt 债；OTP-only 账号可空。
- **MFA 策略取最严**：`effective = max(平台默认 admin.setting:operator.mfa.policy, 角色下限 operator_role.mfa_min_level, 个人覆盖 operator_mfa.policy)`；`required` 未注册 → 下次登录强制 enroll。
- **高权限强制 WebAuthn**：`operator_mfa.webauthn_required=true` 时仅 TOTP 被拒。
- **锁定 / 短会话 / step-up**：失败计数 `operator_credential.failed_attempts` + `locked_until`；会话短 TTL（idle≤30min/abs≤8h，专项 §2.3）；高危路由要求重认证第二因子（`amr`/`acr` 记于 token 与 `operator_session`）。
- **隔离不变量校验**：`admin.operator_*` 对 `identity.*`/`iam.role|permission` 无 FK；operator 的 refresh/login_attempt/verification 不出现在 `identity.*`（v2 验收项，承自专项 §8）。

---

### 14.4 平台治理表（专项不覆盖，v2 字段级补齐）

5 张治理/配置表归 `admin` schema，不带 `operator_` 前缀。除 announcement 标【修订】外均【沿用】deploy 现表，DDL 以 v2 命名规范（idx*/uidx*/chk\_、状态 VARCHAR+CHECK）重写。

#### 14.4.1 `admin.setting`（全局配置 KV + 加密）【沿用，原 ops.setting / database.md §3.7】

```sql
CREATE TABLE admin.setting (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    config_group    varchar(64)  NOT NULL,
    config_key      varchar(128) NOT NULL,
    value_type      varchar(20)  NOT NULL DEFAULT 'string',  -- string | int | bool | json
    config_value    text         NOT NULL,
        -- is_encrypted=true 时存密文：应用层信封加密，密钥进 secret manager，DB 不持明文
    is_sensitive    boolean      NOT NULL DEFAULT false,      -- 敏感（脱敏展示）
    is_encrypted    boolean      NOT NULL DEFAULT false,      -- config_value 是否密文
    is_readonly     boolean      NOT NULL DEFAULT false,      -- 仅代码/迁移可改
    validation_rule varchar(512),
    description     text,
    created_by      uuid,
    updated_by      uuid,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uk_admin_setting_key UNIQUE (config_key)
);
CREATE INDEX idx_admin_setting_group ON admin.setting (config_group);
```

> 平台默认 MFA 策略落此表：`config_key='operator.mfa.policy'`（取值 disabled/optional/required，供 §14.3.4 策略解析）。键名字符串**不随 schema 改名变化**，仅引用限定名由 `ops.setting` → `admin.setting`。

#### 14.4.2 `admin.feature_flag`（灰度百分比 + 逐租户覆盖）【沿用，原 ops.feature_flag】

```sql
CREATE TABLE admin.feature_flag (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key            varchar(128) NOT NULL,
    category            varchar(64)  NOT NULL DEFAULT 'release',
    environment         varchar(32)  NOT NULL DEFAULT 'all',   -- all | <env>
    description         varchar(512),
    is_globally_enabled boolean      NOT NULL DEFAULT false,
    is_archived         boolean      NOT NULL DEFAULT false,
    rollout_percentage  integer      NOT NULL DEFAULT 0,        -- 灰度比例 0–100
    tenant_overrides    jsonb        NOT NULL DEFAULT '{}',     -- {tenant_id: true|false}，逐租户强开/强关
    expires_at          timestamptz,                           -- 临时开关自动失效
    created_by          uuid,
    updated_by          uuid,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uk_admin_feature_flag_key UNIQUE (flag_key),
    CONSTRAINT chk_admin_ff_rollout CHECK (rollout_percentage BETWEEN 0 AND 100)
);
CREATE INDEX idx_admin_ff_category    ON admin.feature_flag (category);
CREATE INDEX idx_admin_ff_environment ON admin.feature_flag (environment);
```

> `tenant_overrides` 的 key 为 `identity.tenant.id`，**不建跨 schema FK**（admin↔identity 隔离），按值解析；命中 override 优先于 `rollout_percentage`。

#### 14.4.3 `admin.announcement`（按 plan / tenant_type 过滤）【修订，原 ops.announcement】

修订点：`target_tenant_types` 取值对齐锁定决策 `tenant.type ∈ {personal, organization}`（团队改名后**不得**再出现 `team`）；`target_plans` 对齐 `product.plan.plan_code`。

```sql
CREATE TABLE admin.announcement (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_type   varchar(32)  NOT NULL,
    severity            varchar(16)  NOT NULL DEFAULT 'info',   -- info | warning | critical
    status              varchar(32)  NOT NULL DEFAULT 'draft',  -- draft | published | archived
    lang                varchar(16)  NOT NULL DEFAULT 'zh-CN',
    title               varchar(256) NOT NULL,
    content             text         NOT NULL,
    cta_label           varchar(64),
    cta_url             varchar(512),
    target_plans        varchar(64)[] NOT NULL DEFAULT '{}',    -- 按 product.plan.plan_code 过滤；空=全部
    target_tenant_types varchar(32)[] NOT NULL DEFAULT '{}',    -- personal | organization；空=全部
    is_dismissible      boolean      NOT NULL DEFAULT true,
    publish_at          timestamptz  NOT NULL,
    expires_at          timestamptz,
    meta                jsonb,
    created_by          uuid         NOT NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    deleted_at          timestamptz
);
CREATE INDEX idx_admin_ann_publish_at ON admin.announcement (publish_at);
CREATE INDEX idx_admin_ann_status     ON admin.announcement (status);
```

#### 14.4.4 `admin.maintenance`（维护窗口声明）【沿用，原 ops.maintenance】

```sql
CREATE TABLE admin.maintenance (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity           varchar(16)  NOT NULL DEFAULT 'minor',     -- minor | major | critical
    status             varchar(32)  NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | cancelled
    title              varchar(256) NOT NULL,
    description        text,
    impact_description text,
    affected_services  varchar(64)[] NOT NULL DEFAULT '{}',
    start_at           timestamptz  NOT NULL,
    end_at             timestamptz  NOT NULL,
    actual_end_at      timestamptz,                                -- 实际结束（与计划 end_at 对账）
    created_by         uuid         NOT NULL,
    updated_by         uuid,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_admin_maint_status CHECK (status IN ('scheduled','in_progress','completed','cancelled'))
);
CREATE INDEX idx_admin_maint_start_at ON admin.maintenance (start_at);
CREATE INDEX idx_admin_maint_status   ON admin.maintenance (status);
```

#### 14.4.5 治理记录：拆 `risk_record` + `compliance_event`（runbook §18.2 已决 = 采纳 database.md §3.7）

owner 决策（2026-07-01）：采纳 `database.md §3.7` 的**两张专属表**，弃 deploy 现状的通用 `governance_record` 单表。数据可重灌（无生产数据）→ 直接按拆分建两表 + reseed，**无 `INSERT…SELECT` 迁移成本**。deploy 现状（`governance_record` PK(kind,id)）在重建时退役。

```sql
-- 租户风险评估记录（database.md §3.7）
CREATE TABLE admin.risk_record (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid         NOT NULL,                  -- 评估对象（identity.tenant，跨 schema 无 FK）
    risk_level   varchar(32)  NOT NULL DEFAULT 'normal', -- normal | follow_up | high
    risk_score   integer,                                -- 可选量化分
    scope        varchar(160),
    reason       text         NOT NULL DEFAULT '',
    reviewer_id  uuid,                                   -- 运营复核人（admin.operator_account，逻辑引用无 FK）
    tags         text[]       NOT NULL DEFAULT '{}',
    source_table varchar(128), source_id varchar(128),   -- 触发来源回溯
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT chk_admin_risk_level CHECK (risk_level IN ('normal','follow_up','high'))
);
CREATE INDEX idx_admin_risk_record_tenant ON admin.risk_record (tenant_id, risk_level);
CREATE INDEX idx_admin_risk_record_tags ON admin.risk_record USING gin (tags);

-- 合规事件记录（database.md §3.7）
CREATE TABLE admin.compliance_event (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid,                                -- 关联租户（可空：平台级合规事件）
    event_type      varchar(64)  NOT NULL,               -- kyc / 审查 / 处置 …（枚举待业务，runbook §18.4）
    status          varchar(32)  NOT NULL DEFAULT 'open',-- open | in_review | resolved | dismissed
    regulation_code varchar(64),                         -- 对应法规/条款
    evidence_url    text,                                -- 证据材料引用（对象存储 URL）
    handler_id      uuid,                                -- 处置运营（admin.operator_account，逻辑引用无 FK）
    detail          jsonb,
    tags            text[]       NOT NULL DEFAULT '{}',
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT chk_admin_compliance_status CHECK (status IN ('open','in_review','resolved','dismissed'))
);
CREATE INDEX idx_admin_compliance_event_tenant ON admin.compliance_event (tenant_id, status);
CREATE INDEX idx_admin_compliance_event_tags ON admin.compliance_event USING gin (tags);
```

> 收口：v2 与 database.md §3.7 现已同名（`admin.risk_record` + `admin.compliance_event`，运营治理 → 17 张）；deploy 的 `governance_record` 单表在重建时退役、不保留。tenant_id/operator 引用均**跨 schema 逻辑引用、无 FK**（runbook §18.1）。子域枚举（event_type 等）待业务补（runbook §18.4）。

---

### 14.5 迁移与隔离不变量小结

| 项                                                                | 处置                                                               | 数据策略                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| schema `ops`→`admin`                                              | `ALTER SCHEMA RENAME` + ~30 处引用锁步（工程线）                   | 保数据                        |
| `operator_account` 去 `account_type`、补 `is_system` (rank 16)    | 加列带默认 → 回填超管 → drop 泄漏列                                | 保数据                        |
| realm `operator`→`workforce`（§5.3）                              | `iam.oidc_client` 就地 `UPDATE`                                    | 保数据                        |
| 状态列补 `chk_`（§9 规范）                                        | 各表 `ADD CONSTRAINT chk_*`                                        | 保数据                        |
| `announcement.target_tenant_types` 取值对齐 personal/organization | 应用层取值收口 + seed 修正                                         | 保数据                        |
| 治理记录拆表（§14.4.5，runbook §18.2 已决=采纳 database.md）      | 拆 `risk_record` + `compliance_event`（弃 governance_record 单表） | 数据可重灌，重建两表 + reseed |

**隔离不变量（v2 验收）：** `admin.operator_*` 对 `identity.*`/`iam.role|permission` 零外键；operator 的 session/refresh/login*attempt/verification 不落 `identity.*`；operator token（`workforce`/`opr\*`/`userType=operator`/`aud=admin`）与客户 token 结构性互拒；运营审计经 `support.audit_log(actor_type=operator)`。

---

## 15. support 域：工单 / 审计 / 通知

> 来源：deploy `schema.prisma` `support` schema 4 表（`ticket` / `ticket_comment` / `audit_log` / `notification_log`，行 1766–1876）+ `database.md` §3.8。
> 二次分析结论：**四表已在 deploy 字段级完整落地**，本章不"新设计"，而是 ① 给出字段级权威引用（raw DDL）；② 命名收口（`ticket_comment` vs `ticket_comment` 二选一、索引前缀统一）；③ 补 §9 强制的 `CHECK` 与 `audit_log` 按月 RANGE 分区 / 留存自动化（Prisma 表达不了，归 §17 非 Prisma DDL 清单）；④ 修复几处与 §8 同类的分区/不可变缺陷（注 `对齐 §8 rank N`）。
> `support` schema **保留**（§3.1，目标 8 schema 之一）。工单功能为 console/admin 侧能力，生产表已建但基本为空，迁移姿态见 runbook §15.6。

### 15.0 域定位与三类写入语义（先厘清，避免误加触发器）

| 表                 | 写入语义                                                                   | 是否 append-only                                           | 是否分区                     | 说明                                 |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `ticket`           | 可变（status/assignee/SLA 时间戳随生命周期更新）+ 软删                     | 否                                                         | 否                           | 工单聚合根，行数低（每租户支持请求） |
| `ticket_comment`   | **仅追加**（一旦写入不改）                                                 | **是**（BEFORE UPDATE RAISE）                              | 否                           | 工单流水，含评论/状态变更/指派等     |
| `audit_log`        | **仅追加**                                                                 | **是**（BEFORE UPDATE OR DELETE RAISE）                    | **是（按月 RANGE）**         | 操作审计，高频写、留存 ≥2 年         |
| `notification_log` | **可变**（status / delivered_at / opened_at / retry_count 由投递回执回填） | **否**（投递追踪要 UPDATE，**不得**加 append-only 触发器） | 否（可选未来分区，见 §15.5） |

三类语义不同是本域最易踩的坑：`notification_log` 因要承接 provider 投递/打开回执 **必须可 UPDATE**，绝不能套用 `audit_log` 的不可变触发器；反之 `audit_log` / `ticket_comment` 必须封死写后修改。

### 15.1 `ticket`【沿用 deploy / 修订 database.md §3.8】

工单聚合根。对应 deploy `SupportTicket`（行 1769–1802）、database.md §3.8 `ticket`。

```sql
support.ticket (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,                       -- 归属租户(org/personal)；不建跨 schema FK
  account_id           uuid,                                -- 报单账号(可空：邮件/匿名渠道)；逻辑引用 identity.users
  ticket_no            varchar(64) NOT NULL,                -- 人类可读单号，应用生成(可选序列 support.ticket_no_seq)
  category             varchar(64)  NOT NULL DEFAULT 'general',   -- 业务分类(开放分类法，应用校验，不设 CHECK)
  priority             varchar(16)  NOT NULL DEFAULT 'p2',
  source               varchar(64)  NOT NULL DEFAULT 'console',
  status               varchar(32)  NOT NULL DEFAULT 'open',
  title                varchar(200) NOT NULL,
  description          text NOT NULL DEFAULT '',
  reporter_name        varchar(100),
  assignee_id          uuid,                                -- 受理坐席；逻辑引用 admin.operator_account(workforce realm)，不建跨 schema FK
  assignee_name        varchar(100),
  tags                 varchar(64)[] NOT NULL DEFAULT '{}',
  satisfaction_score   integer,                             -- 满意度 1..5
  satisfaction_comment varchar(512),
  -- SLA 时间线 ----------------------------------------------------------
  sla_breach_at        timestamptz,    -- 计算出的"违约时刻"(到点未首响/未解决即违约)
  first_response_at    timestamptz,    -- 首次坐席响应
  due_at               timestamptz,    -- 期望解决截止
  resolved_at          timestamptz,    -- 解决(可被 reopen 清空/重设)
  closed_at            timestamptz,    -- 关闭(终态)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,                         -- 软删
  CONSTRAINT uidx_support_ticket_no UNIQUE (ticket_no),
  CONSTRAINT chk_support_ticket_priority     CHECK (priority IN ('p0','p1','p2','p3')),
  CONSTRAINT chk_support_ticket_status       CHECK (status IN ('open','pending','in_progress','resolved','closed','reopened','cancelled')),
  CONSTRAINT chk_support_ticket_source       CHECK (source IN ('console','website','email','admin','api')),
  CONSTRAINT chk_support_ticket_satisfaction CHECK (satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5)
);
CREATE INDEX idx_support_ticket_tenant_status   ON support.ticket (tenant_id, status);
CREATE INDEX idx_support_ticket_priority_updated ON support.ticket (priority, updated_at DESC);
CREATE INDEX idx_support_ticket_assignee        ON support.ticket (assignee_id) WHERE assignee_id IS NOT NULL;   -- 坐席工作台(新增)
CREATE INDEX idx_support_ticket_deleted_at      ON support.ticket (deleted_at);
```

要点 / 与 deploy 的差异：

- **SLA 五时间戳已齐全**（deploy 已落 `sla_breach_at` / `first_response_at` / `due_at` / `resolved_at` + `closed_at`），本章仅明确语义：`sla_breach_at` 是**派生的违约时刻**（由 priority→SLA 策略在创单时算出、首响/解决后清算），不是状态。
- **修订（§9 收口）**：deploy 的 `status`/`priority`/`source`/`satisfaction_score` 仅有 `DEFAULT` 无 `CHECK` → 本章按 §3.2 补 `chk_` 约束（状态用 `VARCHAR+CHECK`，不用 PG ENUM）。`category` 为开放分类法，维持无 CHECK、应用层校验。
- **修订（索引前缀收口）**：deploy 唯一约束名 `uq_support_ticket_no` → 收口为 `uidx_`（§3.2 规范为 `uidx_`，本域 `uq_` 是历史漂移）。
- **新增** `idx_support_ticket_assignee`（部分索引），支撑坐席工作台"我的工单"。
- `assignee_id` 指向 `admin.operator_account`（workforce realm 运营人员），`account_id` 指向 `identity.users`（customer realm 终端用户）——**均逻辑引用、不建跨 schema FK**（保 support 写入轻量、actor 可能注销，与 §17 跨库无 FK 原则一致）。
- **不引入 `workspace_id`**：工单是租户/账号级支持工件、非计量对象，无需跟随 §8 的 workspace 化（守起步阶段最小化）。如未来需按工作区归档再加。

### 15.2 `ticket_comment`【命名收口 = 采用 `ticket_comment`（database.md §3.8，runbook §18.2 采纳）；弃 deploy 现名 `ticket_event`。注：本表承载工单流水——评论/状态变更/指派等事件，名 comment 但语义含事件】

工单流水（评论、状态变更、指派、SLA 事件统一一张表）。对应 deploy `SupportTicketEvent`（行 1805–1820）。

> **命名二选一（解 runbook §18.2 待决 #4）**：deploy = `ticket_comment`，database.md §3.8 = `ticket_comment`。**采用 `ticket_comment`**。理由：① 它是**事件流**而非单纯评论——`event_type` 可取 `comment`/`status_changed`/`assigned`/`reopened`/`sla_breached`/`satisfaction_submitted`，`comment` 只是其一，`ticket_comment` 语义偏窄；② deploy 已落地此名、无重命名成本；③ append-only 事件流是工单系统行业基线。database.md §3.8 需回写（见 notesForSplice）。

```sql
support.ticket_comment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support.ticket(id) ON DELETE CASCADE,
  event_type  varchar(64) NOT NULL,        -- comment | status_changed | assigned | reopened | sla_breached | satisfaction_submitted | ...
  actor_type  varchar(32) NOT NULL,        -- customer | operator | system
  actor_id    uuid,                        -- 可空(system 事件)
  actor_name  varchar(100) NOT NULL,       -- 冗余留痕(actor 注销后仍可读)
  payload     jsonb NOT NULL DEFAULT '{}', -- 评论正文/前后值/附件引用等
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_support_ticket_comment_actor CHECK (actor_type IN ('customer','operator','system'))
);
CREATE INDEX idx_support_ticket_comment_ticket_created ON support.ticket_comment (ticket_id, created_at DESC);
```

append-only 实现（**对齐 §8.4 rank 17**：用 RAISE 触发器，**禁用 `DO INSTEAD NOTHING` RULE**，否则静默吞写）：

```sql
CREATE OR REPLACE FUNCTION support.tg_ticket_comment_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'support.ticket_comment is append-only (no UPDATE)'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_ticket_comment_no_update
  BEFORE UPDATE ON support.ticket_comment
  FOR EACH ROW EXECUTE FUNCTION support.tg_ticket_comment_immutable();
```

要点 / 修订：

- **修订（新增不可变触发器）**：deploy 仅 `@@map` 注释声明 append-only，**无实际约束** → 本章补 `BEFORE UPDATE RAISE` 触发器（列入 §17）。
- **CASCADE 与 append-only 的协调**：仅封 `UPDATE`，**保留 `ON DELETE CASCADE`**。`ticket` 走软删（`deleted_at`），常规流程绝不硬删，事件因此天然不可删；`CASCADE` 仅作**数据生命周期/留存到期 purge**（清理工单时连带清事件）的兜底——故不封 `DELETE`（封了会让 purge 失败）。这与 `audit_log`（封 UPDATE+DELETE、按分区 detach 清理）的取舍不同，因 `ticket_comment` 数据量低、靠父表 purge。
- **修订（§9 收口）**：`actor_type` 补 `chk_` 约束，取值与 `audit_log` 统一（customer=终端用户/customer realm；operator=运营/workforce realm；system=系统自动）。

### 15.3 `audit_log`【沿用 deploy 字段 + 新建分区 / 留存 DDL】（对齐 §8.4 rank 4/16/17）

平台操作审计，跨域记录"谁在何时对什么做了什么、成败、前后值"。对应 deploy `SupportAuditLog`（行 1823–1848）、database.md §3.8。**append-only + 按月 RANGE 分区 + 留存 ≥2 年**。

```sql
support.audit_log (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_type    varchar(32)  NOT NULL,        -- customer | operator | system | api
  actor_id      uuid NOT NULL,
  tenant_id     uuid,                          -- 可空(平台级操作)
  action        varchar(128) NOT NULL,         -- e.g. 'tenant.member.invite'
  result        varchar(32)  NOT NULL DEFAULT 'success',
  resource_type varchar(64)  NOT NULL,
  resource_id   varchar(128) NOT NULL,
  error_code    varchar(64),
  before        jsonb,                         -- 变更前快照(可空)
  after         jsonb,                         -- 变更后快照(可空)
  request_id    varchar(128),                  -- 跨库关联键(§17)：reqlog ↔ usage_event ↔ moderation_log
  duration_ms   integer,
  ip_address    varchar(64),
  user_agent    varchar(512),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),                -- 分区键必须进 PK（对齐 §8.4 rank 4）
  CONSTRAINT chk_support_audit_actor  CHECK (actor_type IN ('customer','operator','system','api')),
  CONSTRAINT chk_support_audit_result CHECK (result   IN ('success','failure','denied'))
) PARTITION BY RANGE (created_at);             -- 按月；预建分区 + DEFAULT 兜底（对齐 §8.4 rank 16）

-- 父表建索引，自动传播到所有分区
CREATE INDEX idx_support_audit_tenant_created   ON support.audit_log (tenant_id, created_at DESC);
CREATE INDEX idx_support_audit_actor            ON support.audit_log (actor_id, created_at DESC);
CREATE INDEX idx_support_audit_action           ON support.audit_log (action);
CREATE INDEX idx_support_audit_resource         ON support.audit_log (resource_type, resource_id);   -- 资源历史(新增)
CREATE INDEX idx_support_audit_request_id       ON support.audit_log (request_id) WHERE request_id IS NOT NULL;
```

append-only（封 UPDATE + DELETE；分区父声明、传播全分区；**禁 RULE**，对齐 §8.4 rank 17）：

```sql
CREATE OR REPLACE FUNCTION support.tg_audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'support.audit_log is append-only (no UPDATE/DELETE)'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON support.audit_log
  FOR EACH ROW EXECUTE FUNCTION support.tg_audit_log_immutable();
```

要点 / 修订：

- **修订（PK，对齐 §8.4 rank 4）**：deploy PK = 单列 `id`，**无法 RANGE 分区**（PG 要求分区键 ∈ 任一唯一约束）→ 本章 PK 改 `(id, created_at)`。
- **修订（取消单列 `created_at` 索引）**：deploy `idx_audit_log_created_at` 在分区表上冗余（分区裁剪已按时间），删除；改用复合 `(tenant_id, created_at)`、`(actor_id, created_at)` 支撑"某租户/某人时间线"。
- **新增** `idx_support_audit_resource (resource_type, resource_id)`：deploy 缺，支撑"某资源的变更史"查询。
- **修订（索引前缀收口）**：deploy 索引名漏 `support_` 段（`idx_audit_log_*`）→ 收口为 `idx_support_audit_*`。
- **修订（§9 收口）**：`result` 补 `chk_`（success/failure/denied）。
- `request_id` 是 §17 单一跨库关联键（gateway 取消后跨库不建 FK，靠 `request_id` 串 Model Platform DB `reqlog` ↔ `commerce.tenant_usage_event` ↔ `safety.moderation_log`）。
- **已列入 §17** 非 Prisma DDL 清单（"support.audit_log 按月分区"）；本章把它具体化为 PK 修订 + 分区 + 不可变触发器 + 留存（§15.5）。

### 15.4 `notification_log`【沿用 deploy】（多渠道 + 投递/打开追踪）

通知发送流水（邮件 / 短信 / 站内 / webhook 等）。对应 deploy `SupportNotificationLog`（行 1851–1876）、database.md §3.8。**可变**（status/delivered_at/opened_at/retry_count 由回执回填，**不加** append-only 触发器）。

```sql
support.notification_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  account_id          uuid,
  channel             varchar(32)  NOT NULL,        -- email | sms | inapp | webhook | push
  template_code       varchar(64)  NOT NULL,        -- 模板键(与发送服务模板表对齐，不在本库建模板)
  status              varchar(32)  NOT NULL,        -- queued | sent | delivered | opened | failed | bounced
  reference_type      varchar(64),                  -- 业务来源类型(ticket / invoice / verification ...)
  reference_id        varchar(128),                 -- 业务来源 id
  recipient           varchar(256) NOT NULL,        -- 收件地址(邮箱/手机号/设备 token)
  subject             varchar(256),
  provider            varchar(64),                  -- 发送商(dypnsapi / mail-provider / ...)
  provider_message_id varchar(256),                 -- 发送商回执 id：投递/打开 webhook 据此回写
  error_message       text,
  retry_count         integer NOT NULL DEFAULT 0,
  delivered_at        timestamptz,                  -- 投递成功时刻(回执回填)
  opened_at           timestamptz,                  -- 打开时刻(像素/回执回填)
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_support_notif_channel CHECK (channel IN ('email','sms','inapp','webhook','push')),
  CONSTRAINT chk_support_notif_status  CHECK (status  IN ('queued','sent','delivered','opened','failed','bounced'))
);
CREATE INDEX idx_support_notif_tenant_created  ON support.notification_log (tenant_id, created_at DESC);
CREATE INDEX idx_support_notif_account         ON support.notification_log (account_id);
CREATE INDEX idx_support_notif_status          ON support.notification_log (status);
CREATE INDEX idx_support_notif_channel         ON support.notification_log (channel);
CREATE INDEX idx_support_notif_provider_msg    ON support.notification_log (provider_message_id) WHERE provider_message_id IS NOT NULL;  -- 回执反查(新增)
CREATE INDEX idx_support_notif_reference       ON support.notification_log (reference_type, reference_id) WHERE reference_id IS NOT NULL;  -- 来源回查(新增)
```

要点 / 修订：

- **新增** `idx_support_notif_provider_msg`：deploy 缺。投递/打开 webhook 回调以 `provider_message_id` 为键回写 `status`/`delivered_at`/`opened_at`，无此索引回写需全表扫描。
- **新增** `idx_support_notif_reference`：按业务来源（如某工单/某发票）反查通知历史。
- **修订（§9 收口 + 前缀）**：`channel`/`status` 补 `chk_`；索引名收口为 `idx_support_notif_*`（deploy 为 `idx_notif_log_*`）。
- **不加 append-only 触发器**：本表设计上要 UPDATE（投递回执、重试计数），是与 `audit_log`/`ticket_comment` 的关键区别。
- 留存策略见 §15.5（短留存 + 定期清理；高增量未来可分区）。

### 15.5 分区与留存自动化

**`audit_log` 按月 RANGE 分区（强制，留存 ≥2 年）**：

```sql
-- 1) 预建分区（建库脚本预建当月 + 未来 N 个月）
CREATE TABLE support.audit_log_y2026m07 PARTITION OF support.audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- ... 逐月 ...
-- 2) DEFAULT 兜底分区：预建漏档时不丢写(对齐 §8.4 rank 16)
CREATE TABLE support.audit_log_default PARTITION OF support.audit_log DEFAULT;

-- 3) 滚动维护(pg_cron 或外部调度，月度执行)：
--    a. 创建"下下月"分区(始终领先 ≥1 月)
--    b. 留存 ≥2 年：detach + drop 早于 now()-24 个月的分区(DROP 整分区，毫秒级、不写 WAL 海量行)
--    c. 巡检 DEFAULT 分区是否意外有行(有=漏建分区告警，按月范围重分配)
CREATE OR REPLACE FUNCTION support.fn_audit_log_maintain(retain_months int DEFAULT 24) ...
```

- 留存阈值 24 个月（满足 database.md §3.8"≥2 年"）。审计为高频写、不可删，靠 **DROP PARTITION** 实现 O(1) 过期清理；逐行 DELETE 在审计量级下不可行（且被不可变触发器封死）。
- 与 §8.4 `tenant_usage_event(_pool)` 同模式（预建 + DEFAULT 兜底 + 滚动 detach/drop），运维脚本可共用一套分区维护函数。

**`ticket` / `ticket_comment` 留存**：低增量、不分区。`ticket` 软删（`deleted_at`），按业务保留期（如终态后 N 年）由 purge job 硬删，连带 `ON DELETE CASCADE` 清 `ticket_comment`。

**`notification_log` 留存**：增量中等、不含强合规要求 → 短留存（建议 6–12 个月，按 `created_at` 定期批量删除）。若日发送量增长到需要，再升级为按月 RANGE 分区（同 `audit_log` 模式），届时同样需把 PK 改为 `(id, created_at)`——本章先不分区，避免起步阶段超前建设。

> 📦 **落地/迁移**：原「15.6 迁移姿态」已迁至 [平台数据架构落地 runbook](./data_platform_300_migration.md)；本文（设计）只述最终态。
