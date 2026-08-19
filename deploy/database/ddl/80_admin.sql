-- ═══════════════════════════════════════════════════════════════════════════
-- 50_admin.sql — schema admin（原 ops；平台运营控制面）
-- 设计权威：docs/design/data_admin_200_schema.md（治理 6 表字段级）
--            + docs/design/identity-platform-operator.md §6（运营身份 11 表字段级）
-- 字段级 SoT：operator_* = 在产表，照 CUR schema.prisma admin model 1:1 生成（名保单数，
--   plural 化随专项协调迁移，见 doc §0/§4）；governance = 空域可重建，采 doc 目标 plural 名。
-- 红线（边界#2 realm 硬隔离）：admin.operator_* 对客户 realm 各 schema 零 FK；
--   审计不建表（复用 support.audit_logs, actor_type=operator）。
-- 域内 FK 内联；跨 schema / 跨 realm 引用一律裸 UUID 不建 FK（见 cross_schema_fks 注释）。
-- 表序 = 域内依赖序：operator_role/permission → operator_account → 附属(credential/mfa/…)
--   → operator_role_permission → 治理 6 表。
-- append-only：operator_login_attempt（触发器见 triggers_ddl）。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 运营身份域（11 表，operator_*，单数在产名）──────────────────────────────

-- 运营角色目录（单角色模型）。role_code 唯一；is_system 预建不可删；mfa_min_level 角色级 MFA 下限。
CREATE TABLE admin.operator_role (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code            varchar(64)  NOT NULL,
    status               varchar(32)  NOT NULL DEFAULT 'active',
    role_name            varchar(128) NOT NULL,                     -- 默认/回退显示名（原 name_en；统一三元）
    role_name_key        varchar(128) NOT NULL,                     -- i18n 键（原 name_i18n_key）
    description          varchar(255) NOT NULL DEFAULT '',
    description_key      varchar(128),                              -- i18n 键（原 description_i18n_key）
    is_system            boolean      NOT NULL DEFAULT false,
    is_customer_visible  boolean      NOT NULL DEFAULT false,  -- 铁律七：运营域数据客户端结构性恒不可见（统一双列保留，可接受恒 false）
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端）——预置元锚点行（sys_config/systemadmin）置 false
    sort                 int          NOT NULL DEFAULT 999,             -- UI 排序（≠ rank，非安全语义）
    rank                 int          NOT NULL DEFAULT 0,               -- 安全等级：跨 operator 操作的层级比较依据（严格大于才可管）；管理能力由 operator:account.manage 权限决定，非 rank。锚点列：不可经 API 改写（见 data_platform_100 铁律八；服务角色模型就位后加列级锁）。预置值见 data_admin_200 §4.1（super_admin=100…auditor=10）
    mfa_min_level        varchar(16)  NOT NULL DEFAULT 'optional',  -- 角色级 MFA 下限（三态）
    created_by           uuid,                                      -- 运营专属（边界#2，裸值，见注释）
    updated_by           uuid,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uidx_operator_role_code       UNIQUE (role_code),
    CONSTRAINT chk_operator_role_mfa_min_lvl CHECK (mfa_min_level IN ('disabled','optional','required'))
);
CREATE INDEX idx_operator_role_status ON admin.operator_role (status);
CREATE INDEX idx_operator_role_sort   ON admin.operator_role (sort);
CREATE INDEX idx_operator_role_rank   ON admin.operator_role (rank);

-- 树形权限 + 菜单路由。parent_id 自引用（域内自 FK 内联）；perm_code 唯一；route_path/component 前端路由。
CREATE TABLE admin.operator_permission (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id    uuid         REFERENCES admin.operator_permission(id),  -- 自引用（域内）
    perm_code    varchar(64)  NOT NULL,
    perm_name    varchar(128) NOT NULL,                            -- 显示名（统一三元；2026-07-30 64→128，见 seed-catalog.mjs 头注）
    perm_name_key varchar(128),                                    -- i18n 键（统一三元；与 access.permissions 一致）
    description_key varchar(128),                                  -- i18n 键（ops.perm.{code 冒号→点}.desc）
    perm_type    varchar(20)  NOT NULL,                            -- menu/button/api（开放集，不加 CHECK）
    route_path   varchar(255),
    component    varchar(255),
    icon         varchar(64),
    category     varchar(32),                                      -- 分组标签（与 access.permissions 一致，开放）
    description  varchar(255) NOT NULL DEFAULT '',
    is_active    boolean      NOT NULL DEFAULT true,
    is_customer_visible  boolean      NOT NULL DEFAULT false,  -- 铁律七：运营域数据客户端结构性恒不可见（统一双列保留，可接受恒 false）
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端）——预置元锚点行（sys_config/systemadmin）置 false
    is_system    boolean      NOT NULL DEFAULT true,               -- 权限目录默认系统预置（区分管理员自建）
    -- product_250 M-2：「每个操作码标注是否要求 step-up」+「step-up 策略归 platform（横向管理面，全 L1 一视同仁）」。
    -- 2026-08-13 补列（此前缺失，后果见下）：没有这一列，"什么算高危"就没有唯一定义处，各 provider 只能在
    -- 自己代码里硬编码——实测 atlas 曾在 StepUpRequiredGuard 里写死 9 个写操作，runos 一条没有，同样是托管
    -- 第三方密钥材料的金库，两边保护等级不同，而这个差异不是任何人决策的结果，是"谁先写的谁说了算"。
    -- 已闭环：atlas 2026-08-13 撤除该守卫（vxture-atlas#167），两侧 provider 现均不判，本列成为唯一判据。
    -- 默认 false：绝大多数操作不需要二次验证；标 true 的必须是**不可逆或涉及凭证材料**的操作。
    -- 消费方 = console/BFF（admin-bff / opera-bff）：读目录，命中即跑 step-up 仪式后再放行。
    -- **不是** provider 的判据——provider 无 UI、跑不了仪式，只能拒绝，且它看到的 amr 是会话级
    --（"登录时用过 MFA"）而非操作级（"此刻本人在场"），强度本就不同。见 product_250 M-2 补注。
    requires_step_up boolean  NOT NULL DEFAULT false,
    sort         int          NOT NULL DEFAULT 999,
    created_by   uuid         NOT NULL,                            -- 运营专属（裸值）
    updated_by   uuid         NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uidx_operator_permission_code UNIQUE (perm_code)
);
CREATE INDEX idx_operator_permission_parent_id ON admin.operator_permission (parent_id);
CREATE INDEX idx_operator_permission_type      ON admin.operator_permission (perm_type);
CREATE INDEX idx_operator_permission_sort      ON admin.operator_permission (sort);

-- 运营账号主体（单角色）。三标识 username(强)/email?/phone? 各唯一；is_system 预建超管；role_id 域内 FK→role。
-- 注：account_type 为在产遗留列（doc §1 目标态拟去客户域泄漏，随专项迁移移除；此处照 CUR 保留，不加 CHECK）。
-- status 亦不加 CHECK：在产 seed 存在 'system' 等值（active/disabled/locked/system…），照 CUR 开放。
CREATE TABLE admin.operator_account (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id       uuid         NOT NULL REFERENCES admin.operator_role(id),  -- 域内 FK
    username      varchar(64)  NOT NULL,
    email         varchar(128),
    email_verified boolean      NOT NULL DEFAULT false,             -- 本人发码验证过才 true；改动即回 false。带外投递(reset)只发 verified 目标（TD-017 §③，见 identity-platform-internal-delegation §11e）
    phone         varchar(32),
    phone_verified boolean      NOT NULL DEFAULT false,             -- 同 email_verified（短信通道）
    display_name  varchar(50)  NOT NULL DEFAULT '',
    status        varchar(32)  NOT NULL DEFAULT 'active',
    is_customer_visible  boolean      NOT NULL DEFAULT false,  -- 铁律七：运营域数据客户端结构性恒不可见（统一双列保留，可接受恒 false）
    is_workforce_visible boolean      NOT NULL DEFAULT true,   -- 展示可见性（运营端）——预置元锚点行（sys_config/systemadmin）置 false
    account_type  varchar(16)  NOT NULL DEFAULT 'personal',        -- 在产遗留（见表注）
    sort          int          NOT NULL DEFAULT 999,
    last_login_at timestamptz,
    last_login_ip varchar(64),
    remark        varchar(255),
    created_by    uuid,                                            -- 运营专属（裸值）
    updated_by    uuid,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT uidx_operator_account_username UNIQUE (username),
    CONSTRAINT uidx_operator_account_email    UNIQUE (email),
    CONSTRAINT uidx_operator_account_phone    UNIQUE (phone)
);
CREATE INDEX idx_operator_account_role_id    ON admin.operator_account (role_id);
CREATE INDEX idx_operator_account_status     ON admin.operator_account (status);
CREATE INDEX idx_operator_account_deleted_at ON admin.operator_account (deleted_at);
CREATE INDEX idx_operator_account_sort       ON admin.operator_account (sort);

-- 1:1 密码凭据。password_hash Argon2id（OTP-only 可空）；failed_attempts/locked_until 锁定风控。域内 FK CASCADE。
CREATE TABLE admin.operator_credential (
    operator_id           uuid         PRIMARY KEY REFERENCES admin.operator_account(id) ON DELETE CASCADE,
    password_hash         varchar(255),
    password_changed_at   timestamptz,
    force_password_change boolean      NOT NULL DEFAULT false,
    failed_attempts       int          NOT NULL DEFAULT 0,
    locked_until          timestamptz,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_operator_credential_failed_attempts CHECK (failed_attempts >= 0)
);

-- 1:1 MFA/TOTP。policy 三态（disabled/optional/required）；totp_secret 加密落库；webauthn_required 高权限强制。域内 FK CASCADE。
CREATE TABLE admin.operator_mfa (
    operator_id       uuid         PRIMARY KEY REFERENCES admin.operator_account(id) ON DELETE CASCADE,
    policy            varchar(16)  NOT NULL DEFAULT 'optional',
    totp_secret       varchar(255),
    totp_enabled      boolean      NOT NULL DEFAULT false,
    totp_confirmed_at timestamptz,
    webauthn_required boolean      NOT NULL DEFAULT false,
    enrolled_at       timestamptz,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_operator_mfa_policy CHECK (policy IN ('disabled','optional','required'))
);

-- 1:N Passkey/WebAuthn。credential_id 唯一；public_key 字节；sign_count 防克隆；transports 通道数组。域内 FK CASCADE。
CREATE TABLE admin.operator_webauthn_credential (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id   uuid         NOT NULL REFERENCES admin.operator_account(id) ON DELETE CASCADE,
    credential_id varchar(255) NOT NULL,
    public_key    bytea        NOT NULL,
    sign_count    bigint       NOT NULL DEFAULT 0,
    aaguid        varchar(64),
    transports    text[]       NOT NULL DEFAULT '{}',
    label         varchar(64),
    last_used_at  timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uidx_operator_webauthn_credential_id UNIQUE (credential_id)
);
CREATE INDEX idx_operator_webauthn_credential_operator_id ON admin.operator_webauthn_credential (operator_id);

-- 1:N 恢复码。code_hash 一次性；used_at 标记已用。域内 FK CASCADE。
CREATE TABLE admin.operator_recovery_code (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id uuid         NOT NULL REFERENCES admin.operator_account(id) ON DELETE CASCADE,
    code_hash   varchar(255) NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_operator_recovery_code_operator_id ON admin.operator_recovery_code (operator_id);

-- 邮箱/手机 OTP（login/step_up）。operator_id 可空裸值（注册/未知主体尝试，域内不建 FK，照 CUR）；
-- 行内 attempt_count/used_at 可增更（非严格不可变），无 updated_at/deleted_at。
CREATE TABLE admin.operator_verification (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id   uuid,                                            -- 可空，域内无 FK（照 CUR）
    target_type   varchar(16)  NOT NULL,                           -- email / phone
    target        varchar(128) NOT NULL,
    purpose       varchar(32)  NOT NULL,                           -- login / step_up 等（开放集）
    code_hash     varchar(64)  NOT NULL,
    attempt_count int          NOT NULL DEFAULT 0,
    expires_at    timestamptz  NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_operator_verification_target_type   CHECK (target_type IN ('email','phone')),
    CONSTRAINT chk_operator_verification_attempt_count CHECK (attempt_count >= 0)
);
CREATE INDEX idx_operator_verification_target_expires ON admin.operator_verification (target, expires_at);
CREATE INDEX idx_operator_verification_operator_id    ON admin.operator_verification (operator_id);

-- 运营登录尝试（风控/限流，append-only）。operator_id 可空裸值（标识不存在主体尝试，无 FK，照 CUR）。
-- 纯不可变审计流水，无 updated_at/deleted_at（触发器见 triggers_ddl）。
CREATE TABLE admin.operator_login_attempt (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id uuid,                                              -- 可空，无 FK（照 CUR）
    identifier  varchar(128) NOT NULL,                            -- 尝试用登录标识（username/email/phone）
    auth_method varchar(32)  NOT NULL DEFAULT 'password',
    result      varchar(32)  NOT NULL,                            -- success / bad_credentials / locked 等（开放集）
    ip_address  varchar(64)  NOT NULL,
    user_agent  varchar(512),
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_operator_login_attempt_identifier_created ON admin.operator_login_attempt (identifier, created_at DESC);
CREATE INDEX idx_operator_login_attempt_ip_created         ON admin.operator_login_attempt (ip_address, created_at DESC);
CREATE INDEX idx_operator_login_attempt_operator_id        ON admin.operator_login_attempt (operator_id);

-- opaque 刷新令牌（轮换 + 重放检测）。session_id=vx_sid_op；token_hash 唯一；rotated_from 轮换链。
-- operator_id 域内 FK CASCADE。session_id 为 varchar 会话标识（非表 FK）。
CREATE TABLE admin.operator_refresh_token (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id uuid         NOT NULL REFERENCES admin.operator_account(id) ON DELETE CASCADE,
    session_id  varchar(64)  NOT NULL,                            -- vx_sid_op 会话标识
    client_id   varchar(64)  NOT NULL DEFAULT 'admin',
    token_hash  varchar(64)  NOT NULL,
    rotated_from uuid,                                            -- 轮换链前驱（同表 id，弱引用不建自 FK）
    status      varchar(16)  NOT NULL DEFAULT 'active',
    expires_at  timestamptz  NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uidx_operator_refresh_token_hash UNIQUE (token_hash),
    CONSTRAINT chk_operator_refresh_token_status CHECK (status IN ('active','rotated','revoked','expired'))
);
CREATE INDEX idx_operator_refresh_token_operator_id ON admin.operator_refresh_token (operator_id);
CREATE INDEX idx_operator_refresh_token_session_id  ON admin.operator_refresh_token (session_id);
CREATE INDEX idx_operator_refresh_token_expires_at  ON admin.operator_refresh_token (expires_at);

-- 角色↔权限（复合 PK，无更新语义/硬删除，不设 updated_at）。role_id/permission_id 域内 FK。
CREATE TABLE admin.operator_role_permission (
    role_id       uuid         NOT NULL REFERENCES admin.operator_role(id),
    permission_id uuid         NOT NULL REFERENCES admin.operator_permission(id),
    is_system     boolean      NOT NULL DEFAULT true,               -- 预置映射 vs 管理员分配（与 access 一致）
    created_by    uuid         NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_operator_role_permission PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_operator_role_permission_permission ON admin.operator_role_permission (permission_id);

-- ── 平台治理域（6 表，plural 目标名，字段级权威=doc §2）────────────────────

-- 全局配置 KV + 信封加密。is_encrypted=true 时 config_value 存密文（密钥进 secret manager）。
-- 平台默认 MFA 策略落此：config_key='operator.mfa.policy'。created_by/updated_by 运营专属裸值。
CREATE TABLE admin.settings (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    config_group    varchar(64)  NOT NULL,
    config_key      varchar(128) NOT NULL,
    value_type      varchar(20)  NOT NULL DEFAULT 'string',
    config_value    text         NOT NULL,
    is_sensitive    boolean      NOT NULL DEFAULT false,
    is_encrypted    boolean      NOT NULL DEFAULT false,
    is_readonly     boolean      NOT NULL DEFAULT false,
    validation_rule varchar(512),
    description     text,
    description_key varchar(128),                                   -- i18n 键（ops.setting.{config_key}.desc）
    created_by      uuid,
    updated_by      uuid,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uk_settings_config_key UNIQUE (config_key),
    CONSTRAINT chk_settings_value_type CHECK (value_type IN ('string','int','bool','json'))
);
CREATE INDEX idx_settings_group ON admin.settings (config_group);

-- 灰度百分比 + 逐租户覆盖。tenant_overrides jsonb {tenant_id: true|false}（边界#4 按值解析，不建 FK，命中优先于 rollout）。
CREATE TABLE admin.feature_flags (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key            varchar(128) NOT NULL,
    category            varchar(64)  NOT NULL DEFAULT 'release',
    environment         varchar(32)  NOT NULL DEFAULT 'all',
    description         varchar(512),
    description_key     varchar(128),                               -- i18n 键（ops.flag.{flag_key}.desc）
    is_globally_enabled boolean      NOT NULL DEFAULT false,
    is_archived         boolean      NOT NULL DEFAULT false,
    rollout_percentage  int          NOT NULL DEFAULT 0,
    tenant_overrides    jsonb        NOT NULL DEFAULT '{}',        -- 边界#4 按值（key=tenancy.tenants.id）
    expires_at          timestamptz,
    created_by          uuid,
    updated_by          uuid,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uk_feature_flags_flag_key      UNIQUE (flag_key),
    CONSTRAINT chk_feature_flags_rollout_pct  CHECK (rollout_percentage BETWEEN 0 AND 100)
);
CREATE INDEX idx_feature_flags_category    ON admin.feature_flags (category);
CREATE INDEX idx_feature_flags_environment ON admin.feature_flags (environment);

-- 平台公告（按 plan / tenant_type 过滤）。target_plans/target_tenant_types 按值解析（边界#4，空=全部，不建 FK）。
CREATE TABLE admin.announcements (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_type   varchar(32)   NOT NULL,
    severity            varchar(16)   NOT NULL DEFAULT 'info',
    status              varchar(32)   NOT NULL DEFAULT 'draft',
    lang                varchar(16)   NOT NULL DEFAULT 'zh-CN',
    title               varchar(256)  NOT NULL,
    content             text          NOT NULL,
    cta_label           varchar(64),
    cta_url             varchar(512),
    target_plans        varchar(64)[] NOT NULL DEFAULT '{}',       -- 按 product.plans.plan_code 过滤（按值）
    target_tenant_types varchar(32)[] NOT NULL DEFAULT '{}',       -- personal/organization（对齐 tenancy.tenants.type）
    is_dismissible      boolean       NOT NULL DEFAULT true,
    publish_at          timestamptz   NOT NULL,
    expires_at          timestamptz,
    meta                jsonb,
    created_by          uuid          NOT NULL,                    -- 运营专属（裸值）
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    CONSTRAINT chk_announcements_severity CHECK (severity IN ('info','warning','critical')),
    CONSTRAINT chk_announcements_status   CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX idx_announcements_publish_at ON admin.announcements (publish_at);
CREATE INDEX idx_announcements_status     ON admin.announcements (status);

-- 维护窗口声明（原 maintenance 单数改 maintenance_windows）。actual_end_at 与计划对账。
CREATE TABLE admin.maintenance_windows (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    severity           varchar(16)   NOT NULL DEFAULT 'minor',
    status             varchar(32)   NOT NULL DEFAULT 'scheduled',
    title              varchar(256)  NOT NULL,
    description        text,
    impact_description text,
    affected_services  varchar(64)[] NOT NULL DEFAULT '{}',
    start_at           timestamptz   NOT NULL,
    end_at             timestamptz   NOT NULL,
    actual_end_at      timestamptz,
    created_by         uuid          NOT NULL,                    -- 运营专属（裸值）
    updated_by         uuid,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_maintenance_windows_severity CHECK (severity IN ('minor','major','critical')),
    CONSTRAINT chk_maintenance_windows_status   CHECK (status IN ('scheduled','in_progress','completed','cancelled'))
);
CREATE INDEX idx_maintenance_windows_start_at ON admin.maintenance_windows (start_at);
CREATE INDEX idx_maintenance_windows_status   ON admin.maintenance_windows (status);

-- 租户风险评估。tenant_id 裸值→tenancy.tenants（边界#3：须活过租户注销，不建 FK）。
-- reviewer_id 域内 FK→operator_account（同 schema 真 FK，ON DELETE SET NULL）。
CREATE TABLE admin.risk_records (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid          NOT NULL,                          -- 裸值→tenancy.tenants（边界#3，不建 FK）
    risk_level   varchar(32)   NOT NULL DEFAULT 'normal',
    risk_score   int,
    scope        varchar(160),
    reason       text          NOT NULL DEFAULT '',
    reviewer_id  uuid          REFERENCES admin.operator_account(id) ON DELETE SET NULL,  -- 域内真 FK
    tags         text[]        NOT NULL DEFAULT '{}',
    source_table varchar(128),
    source_id    varchar(128),
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    CONSTRAINT chk_risk_records_risk_level CHECK (risk_level IN ('normal','follow_up','high'))
);
CREATE INDEX idx_risk_records_tenant     ON admin.risk_records (tenant_id, risk_level);
CREATE INDEX idx_risk_records_tags_gin   ON admin.risk_records USING gin (tags);

-- 合规事件。tenant_id 可空裸值→tenancy.tenants（边界#3 合规留存，不建 FK；NULL=平台级）。
-- handler_id 域内 FK→operator_account（同 schema 真 FK，ON DELETE SET NULL）。event_type/status 枚举待业务。
CREATE TABLE admin.compliance_events (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid,                                          -- 裸值→tenancy.tenants（边界#3，不建 FK）
    event_type      varchar(64)  NOT NULL,
    status          varchar(32)  NOT NULL DEFAULT 'open',
    regulation_code varchar(64),
    evidence_url    text,
    handler_id      uuid         REFERENCES admin.operator_account(id) ON DELETE SET NULL,  -- 域内真 FK
    detail          jsonb,
    tags            text[]       NOT NULL DEFAULT '{}',
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT chk_compliance_events_status CHECK (status IN ('open','in_review','resolved','dismissed'))
);
CREATE INDEX idx_compliance_events_tenant   ON admin.compliance_events (tenant_id, status);
CREATE INDEX idx_compliance_events_tags_gin ON admin.compliance_events USING gin (tags);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_compliance_events_handler ON admin.compliance_events (handler_id);
CREATE INDEX idx_risk_records_reviewer     ON admin.risk_records (reviewer_id);
