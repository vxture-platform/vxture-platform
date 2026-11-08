-- ═══════════════════════════════════════════════════════════════════════════
-- 30_credential.sql — schema credential（本地凭据：密码 / 多因素 / WebAuthn / 恢复码）
-- 设计权威：docs/design/data_identity_200_schema.md §3
-- 本 schema 全部表 user_id → account.users 为跨 schema FK（铁律一，真 FK），
--   一律不内联，见 90_cross_schema_fk.sql（DO 幂等包裹，ON DELETE CASCADE）。
-- 域内无 FK。铁律四：MFA / WebAuthn / 恢复码「建全字段不接线」。
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1 本地密码凭据（1:1）。核心鉴权与 account.users 认证列拆分，安全列独立此表。
-- password_hash 可空：phone-code-only 用户无密码。user_id 跨 schema→account.users（90）。
CREATE TABLE credential.user_credentials (
    user_id                 uuid         PRIMARY KEY,                 -- 跨 schema→account.users（90，CASCADE）
    password_hash           varchar(255),                            -- Argon2id；phone-code-only 用户可空
    password_changed_at     timestamptz,
    force_password_change   boolean      NOT NULL DEFAULT false,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now()
);

-- 3.2 多因素策略（1:1，预留，铁律四建全不接线）。user_id 跨 schema→account.users（90）。
CREATE TABLE credential.user_mfas (
    user_id            uuid         PRIMARY KEY,                      -- 跨 schema→account.users（90，CASCADE）
    policy             varchar(32)  NOT NULL DEFAULT 'off',
    totp_secret        varchar(255),                                 -- 加密存储
    totp_enabled       boolean      NOT NULL DEFAULT false,
    version            uuid         NOT NULL DEFAULT gen_random_uuid(),
    last_counter       bigint       NOT NULL DEFAULT -1,
    webauthn_required  boolean      NOT NULL DEFAULT false,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_mfas_policy CHECK (policy IN ('off','optional','required'))
);

-- 3.3 WebAuthn 凭据（1:N，预留）。user_id 跨 schema→account.users（90）。
-- 无 updated_at：可变列仅 sign_count/last_used_at，按设计只保留 created_at + last_used_at。
CREATE TABLE credential.user_webauthn_credentials (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid         NOT NULL,                            -- 跨 schema→account.users（90，CASCADE）
    credential_id  varchar(255) NOT NULL,
    public_key     text         NOT NULL,
    sign_count     bigint       NOT NULL DEFAULT 0,                  -- 防克隆计数
    transports     text[],
    device_name    varchar(96),
    created_at     timestamptz  NOT NULL DEFAULT now(),
    last_used_at   timestamptz,
    CONSTRAINT uq_user_webauthn_credentials_credential_id UNIQUE (credential_id)
);
CREATE INDEX idx_user_webauthn_credentials_user_id ON credential.user_webauthn_credentials (user_id);

-- 3.4 一次性恢复码（1:N，预留）。code_hash 为 sha256（varchar(64)）。
-- user_id 跨 schema→account.users（90）。可变列仅 used_at，无 updated_at（按设计）。
CREATE TABLE credential.user_recovery_codes (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL,                               -- 跨 schema→account.users（90，CASCADE）
    code_hash   varchar(64)  NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_recovery_codes_user_id ON credential.user_recovery_codes (user_id);
