-- ═══════════════════════════════════════════════════════════════════════════
-- 20_tenancy.sql — schema tenancy（租户 / 工作空间 / 成员 / 邀请）
-- 设计权威：docs/design/data_identity_200_schema.md §5
-- 域内 FK（含复合）内联；跨 schema FK（→account.users / →access.roles）见 90。
-- 表序 = 域内依赖序：tenants→profiles/logos/workspaces→memberships→ws_memberships→invitations。
-- ═══════════════════════════════════════════════════════════════════════════

-- 租户（personal 个人 / organization 组织）。owner_user_id 跨 schema→account.users（见 90）。
CREATE TABLE tenancy.tenants (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_no            bigint       NOT NULL,  -- 可视码 12 位:个人租户=owner 的 user_no(人租同号);组织租户自取主体号(95 触发器分配,§11)
    name                 varchar(128) NOT NULL,
    type                 varchar(16)  NOT NULL,
    owner_user_id        uuid         NOT NULL,                    -- 跨 schema→account.users（90）
    status               varchar(32)  NOT NULL DEFAULT 'active',
    verification_status  varchar(32)  NOT NULL DEFAULT 'unverified',  -- 反规范化只读，SoT=kyc.tenant_verifications
    verification_type    varchar(32),
    workspace_counter    int          NOT NULL DEFAULT 0,          -- 内部记账:workspace_no 终身分配数(触发器递增,不外显,不复用)
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT uq_tenants_tenant_no          UNIQUE (tenant_no),
    CONSTRAINT chk_tenants_type              CHECK (type IN ('personal','organization')),
    CONSTRAINT chk_tenants_status            CHECK (status IN ('active','suspended','deleted')),
    CONSTRAINT chk_tenants_verification_status CHECK (verification_status IN ('unverified','pending','verified','rejected')),
    CONSTRAINT chk_tenants_workspace_counter   CHECK (workspace_counter BETWEEN 0 AND 999)  -- 999=每租户终身 workspace 硬上限(编号方案,owner 定案 2026-08-19)
);
CREATE INDEX idx_tenants_owner_user_id ON tenancy.tenants (owner_user_id);
CREATE INDEX idx_tenants_type          ON tenancy.tenants (type);
CREATE INDEX idx_tenants_status        ON tenancy.tenants (status);
CREATE INDEX idx_tenants_deleted_at    ON tenancy.tenants (deleted_at);
-- 每 user 至多 1 个 personal 租户（部分唯一）
CREATE UNIQUE INDEX uq_tenants_one_personal_per_owner ON tenancy.tenants (owner_user_id) WHERE type = 'personal';

-- 租户资料：与 tenants 1:1 解耦，展示 / 本地化字段（logo 大文件另置 tenant_logos；
-- 联系人 2026-07-05 迁出至 tenant_contacts 1:N —— 二次吸纳 inputs/tenancy_core_tables.sql §4，
-- round-1 吸纳曾把 1:N 有损折叠为本表 4 个 contact_* 列，见 data_identity_200 §5.8 说明）。
CREATE TABLE tenancy.tenant_profiles (
    tenant_id            uuid         PRIMARY KEY REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    description          text,
    industry             varchar(64),
    scale                varchar(32),
    website              varchar(255),
    country_code         varchar(8),
    address              varchar(255),
    postal_code          varchar(16),
    is_billing_recipient boolean      NOT NULL DEFAULT false,
    timezone             varchar(64),
    language             varchar(16),
    currency             varchar(8),
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now()
);

-- 日常联系人：1:N 多类型（primary/billing/technical/security/legal）。
-- 来源 = inputs/tenancy_core_tables.sql §4（原稿忠实落地）；user_id 联系人是平台用户时
-- 关联（跨 schema FK → account.users，见 90_cross_schema_fk.sql）。
CREATE TABLE tenancy.tenant_contacts (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid         NOT NULL REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    contact_type  varchar(16)  NOT NULL,             -- primary | billing | technical | security | legal
    name          varchar(128) NOT NULL,
    title         varchar(128),                       -- 职务
    email         varchar(128) NOT NULL,
    phone         varchar(32),
    user_id       uuid,                               -- 可选：联系人是平台用户时关联（FK 见 90）
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, contact_type, email)
);
CREATE INDEX idx_tenant_contacts_tenant_type ON tenancy.tenant_contacts (tenant_id, contact_type);

-- 租户品牌资产字节（大文件单独表，参考 account.user_avatars；小图内联，按 hash 版本化）。
-- 2026-07-05 升多变体（owner 拍板）：PK (tenant_id, kind)，与 tenant_branding 分工 =
-- 本表存字节 SoT，branding 存品牌语义 + 外链覆盖位；生效 URL 派生规则见 branding 头注。
CREATE TABLE tenancy.tenant_logos (
    tenant_id     uuid         NOT NULL REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    kind          varchar(16)  NOT NULL DEFAULT 'logo',  -- logo | logo_dark | icon | favicon | email_logo
    data          bytea        NOT NULL,
    content_type  varchar(32)  NOT NULL,
    hash          varchar(64)  NOT NULL,
    source        varchar(16)  NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind),
    CHECK (kind IN ('logo', 'logo_dark', 'icon', 'favicon', 'email_logo'))
);

-- 品牌语义（1:1）：品牌色 + 外链覆盖位。分工（2026-07-05 owner 拍板）：字节 SoT =
-- tenant_logos(tenant_id, kind)；本表 *_url 仅作外链托管覆盖位（现阶段 NULL，迁 OSS/CDN
-- 后启用）。生效 URL = coalesce(branding.*_url, 由 logos 派生的 API 路由
-- /api/tenant/:id/brand/:kind?v=hash)——单一派生规则，无双 SoT。如需文件元数据/历史
-- 版本，后续增设 tenant_brand_assets 明细表（铁律四预留）。来源 =
-- inputs/tenancy_core_tables.sql §5（round-1 吸纳丢失，2026-07-05 二次吸纳恢复，
-- 见 data_identity_200 §5.9）。
CREATE TABLE tenancy.tenant_branding (
    tenant_id         uuid         PRIMARY KEY REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    logo_url          varchar(512),                   -- 横版全标，浅色背景
    logo_dark_url     varchar(512),                   -- 深色模式变体
    icon_url          varchar(512),                   -- 方形，侧边栏/头像位
    favicon_url       varchar(512),
    email_logo_url    varchar(512),                   -- 邮件模板专用（邮件客户端不支持深色切换）
    brand_color       char(7),                        -- 主品牌色 '#RRGGBB'
    brand_color_dark  char(7),
    updated_by        uuid,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CHECK (brand_color      IS NULL OR brand_color      ~ '^#[0-9A-Fa-f]{6}$'),
    CHECK (brand_color_dark IS NULL OR brand_color_dark ~ '^#[0-9A-Fa-f]{6}$')
);

-- 工作空间：tenant 1:N。注册即建 1 个 default。UNIQUE(id, tenant_id) 供复合 FK 引用。
CREATE TABLE tenancy.workspaces (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_no  bigint       NOT NULL,  -- 可视码 15 位:完整租户号(12位)+租户内序号001-999(95 触发器分配,§11)
    tenant_id     uuid         NOT NULL REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    name          varchar(128) NOT NULL,
    is_default    boolean      NOT NULL DEFAULT false,
    description   text,
    icon          varchar(64),
    status        varchar(16)  NOT NULL DEFAULT 'active',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT uq_workspaces_workspace_no UNIQUE (workspace_no),
    CONSTRAINT uq_workspaces_id_tenant UNIQUE (id, tenant_id),         -- 复合 FK 目标
    CONSTRAINT chk_workspaces_status   CHECK (status IN ('active','archived','deleted'))
);
CREATE INDEX idx_workspaces_tenant_id  ON tenancy.workspaces (tenant_id);
CREATE INDEX idx_workspaces_deleted_at ON tenancy.workspaces (deleted_at);
-- 每 tenant 至多 1 个 default workspace（部分唯一）
CREATE UNIQUE INDEX uq_workspaces_one_default_per_tenant ON tenancy.workspaces (tenant_id) WHERE is_default;

-- 租户成员与治理角色。role 走复合 FK (role_id, role_scope)→access.roles（见 90）。
-- default_workspace_id 复合 FK 锁"默认 ws 必属本 tenant"（域内）。title/department/… 为 HR 展示属性，非授权。
CREATE TABLE tenancy.tenant_memberships (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid         NOT NULL REFERENCES tenancy.tenants(id) ON DELETE CASCADE,
    user_id              uuid         NOT NULL,                    -- 跨 schema→account.users（90）
    role_id              uuid         NOT NULL,                    -- 复合→access.roles（90）
    role_scope           varchar(16)  NOT NULL,
    status               varchar(32)  NOT NULL DEFAULT 'active',
    default_workspace_id uuid,                                    -- 复合 FK（域内，下方）
    title                varchar(64),                             -- HR 展示属性，非授权属性
    department           varchar(64),
    employee_no          varchar(32),
    job_level            varchar(32),
    member_extra         jsonb,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_memberships_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT chk_tenant_memberships_status CHECK (status IN ('active','suspended','removed')),
    -- 默认 ws 必属本 tenant（复合，域内）；NULL 行自动放行
    CONSTRAINT fk_tenant_memberships_default_ws
        FOREIGN KEY (default_workspace_id, tenant_id)
        REFERENCES tenancy.workspaces (id, tenant_id)
);
CREATE INDEX idx_tenant_memberships_user_id ON tenancy.tenant_memberships (user_id);
CREATE INDEX idx_tenant_memberships_role    ON tenancy.tenant_memberships (role_id, role_scope);  -- 复合,兼作 FK 支撑(2026-08-19)
CREATE INDEX idx_tenant_memberships_status  ON tenancy.tenant_memberships (status);

-- 工作空间成员。复合 FK 保 ws⊆tenant 且 ws-member⊆tenant-member 两不变量（域内）。
CREATE TABLE tenancy.workspace_memberships (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid         NOT NULL,
    tenant_id     uuid         NOT NULL,
    user_id       uuid         NOT NULL,                          -- 完整性经下方 (tenant_id,user_id) 复合保证
    role_id       uuid         NOT NULL,                          -- 复合→access.roles（90）
    role_scope    varchar(16)  NOT NULL,
    status        varchar(32)  NOT NULL DEFAULT 'active',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_workspace_memberships_ws_user UNIQUE (workspace_id, user_id),
    CONSTRAINT chk_workspace_memberships_status CHECK (status IN ('active','suspended','removed')),
    -- ws 真属本 tenant（复合，域内，CASCADE）
    CONSTRAINT fk_workspace_memberships_ws_tenant
        FOREIGN KEY (workspace_id, tenant_id)
        REFERENCES tenancy.workspaces (id, tenant_id) ON DELETE CASCADE,
    -- ws 成员 ⊆ tenant 成员（复合，域内，CASCADE）
    CONSTRAINT fk_workspace_memberships_tenant_member
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES tenancy.tenant_memberships (tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_workspace_memberships_user_id ON tenancy.workspace_memberships (user_id);
CREATE INDEX idx_workspace_memberships_role    ON tenancy.workspace_memberships (role_id, role_scope);  -- 复合,兼作 FK 支撑(2026-08-19)
CREATE INDEX idx_workspace_memberships_status  ON tenancy.workspace_memberships (status);

-- 成员邀请（org / workspace）。role 复合→access.roles（90）。
CREATE TABLE tenancy.invitations (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    scope         varchar(16)  NOT NULL,
    tenant_id     uuid         REFERENCES tenancy.tenants(id),
    workspace_id  uuid         REFERENCES tenancy.workspaces(id),
    target_type   varchar(16)  NOT NULL,
    target        varchar(128) NOT NULL,
    role_id       uuid         NOT NULL,                          -- 复合→access.roles（90）
    role_scope    varchar(16)  NOT NULL,
    status        varchar(32)  NOT NULL DEFAULT 'pending',
    token_hash    varchar(64)  NOT NULL,
    expires_at    timestamptz  NOT NULL,
    accepted_at   timestamptz,
    created_by    uuid         NOT NULL,                          -- 跨 schema→account.users（90）
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT chk_invitations_status    CHECK (status IN ('pending','accepted','expired','revoked'))
);
CREATE INDEX idx_invitations_tenant_id    ON tenancy.invitations (tenant_id);
CREATE INDEX idx_invitations_workspace_id ON tenancy.invitations (workspace_id);
CREATE INDEX idx_invitations_status       ON tenancy.invitations (status);
CREATE INDEX idx_invitations_expires_at   ON tenancy.invitations (expires_at);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_invitations_role              ON tenancy.invitations (role_id, role_scope);
CREATE INDEX idx_tenant_contacts_user          ON tenancy.tenant_contacts (user_id);
CREATE INDEX idx_tenant_memberships_default_ws ON tenancy.tenant_memberships (default_workspace_id, tenant_id);
CREATE INDEX idx_workspace_memberships_tenant_user ON tenancy.workspace_memberships (tenant_id, user_id);
CREATE INDEX idx_workspace_memberships_ws_tenant ON tenancy.workspace_memberships (workspace_id, tenant_id);
