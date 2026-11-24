-- Durable customer sessions and short-lived authentication records.
-- Authority: docs/30-design/data_identity_200_schema.md section 8.
-- Customer login commits auth_sessions before Redis; workforce stays independent.
-- Bare user UUIDs intentionally do not cross identity-realm boundaries with FKs.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

CREATE TABLE session.auth_sessions (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    sid            varchar(64)   NOT NULL,                          -- 会话不透明标识
    user_id        uuid          NOT NULL,                          -- 裸值→account.users（不建 FK，边界#2）
    realm          varchar(16)   NOT NULL,                          -- customer / workforce（realm 硬隔离）
    auth_method    varchar(32)   NOT NULL,                          -- password / sms / oauth 等
    ip_address     varchar(64),
    user_agent     varchar(512),
    status         varchar(16)   NOT NULL DEFAULT 'active',
    last_active_at timestamptz   NOT NULL DEFAULT now(),
    expires_at     timestamptz   NOT NULL,
    revoked_at     timestamptz,
    active_org_id uuid,
    active_workspace_id uuid,
    context_version bigint NOT NULL DEFAULT 0,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_auth_sessions_sid    UNIQUE (sid),
    CONSTRAINT chk_auth_sessions_realm  CHECK (realm IN ('customer','workforce')),
    CONSTRAINT chk_auth_sessions_status CHECK (status IN ('active','revoked','expired'))
);
CREATE INDEX idx_auth_sessions_user_id    ON session.auth_sessions (user_id);
CREATE INDEX idx_auth_sessions_realm      ON session.auth_sessions (realm);
CREATE INDEX idx_auth_sessions_status     ON session.auth_sessions (status);
CREATE INDEX idx_auth_sessions_expires_at ON session.auth_sessions (expires_at);

-- Customer-only bindings survive Redis eviction and central revocation.
CREATE TABLE IF NOT EXISTS session.oidc_session_clients (
  sid varchar(64) NOT NULL REFERENCES session.auth_sessions(sid),
  client_id varchar(64) NOT NULL,
  release_channel varchar(16) NOT NULL CHECK (release_channel IN ('stable','beta','canary')),
  logout_uri varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sid, client_id)
);

-- The same immutable logical event is signed afresh for each delivery attempt.
CREATE TABLE IF NOT EXISTS session.logout_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  sid varchar(64) NOT NULL REFERENCES session.auth_sessions(sid),
  user_id uuid NOT NULL,
  client_id varchar(64) NOT NULL,
  release_channel varchar(16) NOT NULL CHECK (release_channel IN ('stable','beta','canary')),
  logout_uri varchar(512) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  retry_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  lease_id uuid,
  lease_until timestamptz,
  last_error varchar(48),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sid, client_id)
);
CREATE INDEX IF NOT EXISTS idx_logout_deliveries_pending
  ON session.logout_deliveries(available_at) WHERE status='pending';

-- Every revocation writer (including account security transactions) uses this
-- boundary. Notification is only a wake-up hint; the table is the durable queue.
CREATE OR REPLACE FUNCTION session.enqueue_customer_logout()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE logical_event uuid := gen_random_uuid();
BEGIN
  IF OLD.realm='customer' AND OLD.status<>'active' AND NEW.status='active' THEN
    RAISE EXCEPTION 'Ended customer sessions cannot be reactivated';
  END IF;
  IF NEW.realm = 'customer' AND OLD.status = 'active'
     AND NEW.status IN ('revoked','expired') THEN
    INSERT INTO session.logout_deliveries
      (event_id, sid, user_id, client_id, release_channel, logout_uri)
    SELECT logical_event, NEW.sid, NEW.user_id, b.client_id, b.release_channel, b.logout_uri
      FROM session.oidc_session_clients b
     WHERE b.sid=NEW.sid AND b.logout_uri IS NOT NULL
    ON CONFLICT (sid,client_id) DO NOTHING;
    PERFORM pg_notify('customer_session_logout', '');
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_customer_session_logout
  AFTER UPDATE OF status ON session.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION session.enqueue_customer_logout();

-- Refresh rotation chains retain a loose sid reference for legacy and realm isolation.
-- Bare user UUIDs must never resolve into the workforce authority.
CREATE TABLE session.refresh_tokens (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid         NOT NULL,                             -- 裸值→account.users（不建 FK，边界#2）
    session_id   uuid         NOT NULL,                             -- Loose central sid reference; no cross-realm FK.
    client_id    varchar(64)  NOT NULL,
    token_hash   varchar(64)  NOT NULL,
    rotated_from uuid,                                              -- 轮换链前驱（同表 id，弱引用不建 FK 自环）
    status       varchar(16)  NOT NULL DEFAULT 'active',
    expires_at   timestamptz  NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT chk_refresh_tokens_status    CHECK (status IN ('active','rotated','revoked','expired'))
);
CREATE INDEX idx_refresh_tokens_user_id    ON session.refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_session_id ON session.refresh_tokens (session_id);
CREATE INDEX idx_refresh_tokens_status     ON session.refresh_tokens (status);
CREATE INDEX idx_refresh_tokens_expires_at ON session.refresh_tokens (expires_at);

-- 邮箱 / 手机验证码。行内 attempt_count / used_at 可增更（非严格不可变），故不加 append-only 触发器；
-- 无 updated_at/deleted_at（一次性令牌，过期即弃）。user_id 可空裸 UUID（注册前无账号）。
CREATE TABLE session.user_verifications (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid,                                             -- 裸值→account.users（可空，不建 FK，边界#2）
    target_type   varchar(16)   NOT NULL,                           -- email / phone
    target        varchar(128)  NOT NULL,
    purpose       varchar(32)   NOT NULL,                           -- register / login / reset / bind 等（开放集）
    code_hash     varchar(64)   NOT NULL,
    attempt_count int           NOT NULL DEFAULT 0,
    expires_at    timestamptz   NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_verifications_target_type CHECK (target_type IN ('email','phone')),
    CONSTRAINT chk_user_verifications_attempt_count CHECK (attempt_count >= 0)
);
CREATE INDEX idx_user_verifications_user_id         ON session.user_verifications (user_id);
CREATE INDEX idx_user_verifications_target_expires  ON session.user_verifications (target, expires_at);

-- 密码重置令牌。used_at 可标记（非严格不可变），无 updated_at/deleted_at。user_id 裸 UUID。
CREATE TABLE session.password_reset_tokens (
    id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid         NOT NULL,                               -- 裸值→account.users（不建 FK，边界#2）
    token_hash varchar(64)  NOT NULL,
    expires_at timestamptz  NOT NULL,
    used_at    timestamptz,
    created_at timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_password_reset_tokens_token_hash UNIQUE (token_hash)
);
CREATE INDEX idx_password_reset_tokens_user_id    ON session.password_reset_tokens (user_id);
CREATE INDEX idx_password_reset_tokens_expires_at ON session.password_reset_tokens (expires_at);

-- 登录尝试记录，风控 / 限速。纯不可变审计流水（append-only，触发器见 triggers_ddl）。
-- 无 updated_at/deleted_at。user_id 可空裸 UUID（标识不存在的账号尝试）。
CREATE TABLE session.login_attempts (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid,                                              -- 裸值→account.users（可空，不建 FK，边界#2）
    identifier   varchar(128)  NOT NULL,                            -- 尝试用的登录标识（account/email/phone）
    auth_method  varchar(32)   NOT NULL DEFAULT 'password',
    result       varchar(32)   NOT NULL,                            -- success / bad_credentials / locked 等（开放集）
    ip_address   varchar(64)   NOT NULL,
    country_code char(2),
    user_agent   varchar(512),
    created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_identifier_created ON session.login_attempts (identifier, created_at DESC);
CREATE INDEX idx_login_attempts_ip_created         ON session.login_attempts (ip_address, created_at DESC);
CREATE INDEX idx_login_attempts_user_id            ON session.login_attempts (user_id);
