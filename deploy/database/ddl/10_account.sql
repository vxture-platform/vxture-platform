-- ═══════════════════════════════════════════════════════════════════════════
-- 10_account.sql — schema account（本地账号主体）
-- 设计权威：docs/design/data_identity_200_schema.md §1
-- 域内 FK 内联；跨 schema FK 一律见 90_cross_schema_fk.sql（铁律一）。
-- ═══════════════════════════════════════════════════════════════════════════

-- 用户主体（终端用户 / customer realm）。三标识 account/email/phone 各自唯一；
-- phone 为强制全局锚点（NOT NULL + 已验证）。瘦主体，增长信息挂属性表。
CREATE TABLE account.users (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_no              bigint       NOT NULL DEFAULT (nextval('account.principal_no_seq') * 1000 + floor(random()*1000)::bigint),  -- 可视码 12 位:主体号(§11,与组织租户共号空间)
    account              varchar(64)  NOT NULL,                     -- 登录句柄，可改限频，非关联键
    email                varchar(128),
    email_verified_at    timestamptz,
    phone                varchar(32)  NOT NULL,                     -- 强锚点
    phone_verified_at    timestamptz  NOT NULL,
    account_changed_at   timestamptz,                              -- 限频判据
    account_login_disabled boolean    NOT NULL DEFAULT false,
    status               varchar(32)  NOT NULL DEFAULT 'active',
    level_no             int          NOT NULL DEFAULT 1,          -- 反规范化只读，SoT=loyalty.level_policies
    source               varchar(32),                             -- 注册来源 web/invite/oidc，不可变事实
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    deletion_requested_at timestamptz,                             -- 自助删除申请时刻:status='deleting' 起 30 天保留期,到期清扫(050-account §7)
    CONSTRAINT uq_users_user_no  UNIQUE (user_no),
    CONSTRAINT uq_users_account  UNIQUE (account),
    CONSTRAINT uq_users_email    UNIQUE (email),
    CONSTRAINT uq_users_phone    UNIQUE (phone),
    CONSTRAINT chk_users_status  CHECK (status IN ('active','disabled','pending','deleting')),
    CONSTRAINT chk_users_level_no CHECK (level_no >= 1)
);
CREATE INDEX idx_users_status     ON account.users (status);
CREATE INDEX idx_users_level_no   ON account.users (level_no);
CREATE INDEX idx_users_deleted_at ON account.users (deleted_at);
CREATE INDEX idx_users_deletion_requested_at ON account.users (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

-- 1:1 展示 / 本地化资料（§1.2）。核心鉴权表 users 只留认证列；资料编辑接口无从触及安全列。
CREATE TABLE account.user_profiles (
    user_id       uuid         PRIMARY KEY REFERENCES account.users(id) ON DELETE CASCADE,
    display_name  varchar(96),
    avatar_url    varchar(512),
    avatar_hash   varchar(64),                                    -- 与 user_avatars.hash 冗余，供 claim 轻读
    gender        varchar(16),
    birthday      date,
    bio           varchar(512),
    language      varchar(16),
    timezone      varchar(64),
    theme         varchar(16)  DEFAULT 'system',
    preferences   jsonb,                                          -- 通知开关等细粒度偏好
    extra         jsonb,                                          -- 压力阀：备用联系人 / 社交展示等低频字段
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_profiles_theme CHECK (theme IN ('light','dark','system'))
);

-- 自定义 / 导入头像字节（§1.3）。仅承载真实头像（上传 / 三方首创导入）；默认头像是前端内联资产，不入库。
-- hash = 内容 sha256，作 URL 版本段 + ETag。大文件单独表，量级上来迁 OSS。
CREATE TABLE account.user_avatars (
    user_id       uuid         PRIMARY KEY REFERENCES account.users(id) ON DELETE CASCADE,
    data          bytea        NOT NULL,
    content_type  varchar(32)  NOT NULL,
    hash          varchar(64)  NOT NULL,
    source        varchar(16)  NOT NULL,                          -- upload / import
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- 产品收藏（console「我的订阅」/产品市场的 ★，收藏即排序优先）。行存在即收藏，
-- 取消收藏 = DELETE，全列锚点、无可写列。product_id 跨 schema→product.products（90）。
CREATE TABLE account.user_product_favorites (
    user_id     uuid         NOT NULL REFERENCES account.users(id) ON DELETE CASCADE,
    product_id  uuid         NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_product_favorites PRIMARY KEY (user_id, product_id)
);
