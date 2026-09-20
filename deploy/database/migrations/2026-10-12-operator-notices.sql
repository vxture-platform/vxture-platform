-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-12-operator-notices.sql
--
-- 运营通告（三平面之间同步信息）。owner 2026-09-20：「预留为 opera，产品上线、
-- 新增等，给发信息，由于这些平台是不同人员使用，信息需要同步」；分工是
-- 「面向客户的由 admin 发布，面向内部运营的由 opera 发布」。
--
-- 对应 DDL：deploy/database/ddl/80_admin.sql（admin.operator_notices /
-- admin.operator_notice_reads）与 98_column_locks.sql。
--
-- 全部幂等：migrate 是**全量重放**，这份脚本会被反复执行。
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin.operator_notices (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    target_planes  varchar(16)[] NOT NULL DEFAULT '{}',
    severity       varchar(16)   NOT NULL DEFAULT 'info',
    title          varchar(256)  NOT NULL,
    body           text          NOT NULL,
    link           varchar(512),
    source         varchar(16)   NOT NULL DEFAULT 'manual',
    reference_type varchar(64),
    reference_id   varchar(128),
    published_at   timestamptz   NOT NULL DEFAULT now(),
    expires_at     timestamptz,
    created_by     uuid,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    deleted_at     timestamptz
);

DO $$
BEGIN
    ALTER TABLE admin.operator_notices
        ADD CONSTRAINT chk_operator_notices_severity
        CHECK (severity IN ('info','warning','critical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE admin.operator_notices
        ADD CONSTRAINT chk_operator_notices_source
        CHECK (source IN ('manual','system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE admin.operator_notices
        ADD CONSTRAINT chk_operator_notices_planes
        CHECK (target_planes <@ ARRAY['admin','opera','arche']::varchar(16)[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE admin.operator_notices
        ADD CONSTRAINT chk_operator_notices_reference
        CHECK ((source = 'system') = (reference_type IS NOT NULL AND reference_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_notices_system
    ON admin.operator_notices (reference_type, reference_id)
    WHERE source = 'system' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operator_notices_live
    ON admin.operator_notices (published_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admin.operator_notice_reads (
    notice_id   uuid        NOT NULL,
    operator_id uuid        NOT NULL,
    read_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notice_id, operator_id)
);

DO $$
BEGIN
    ALTER TABLE admin.operator_notice_reads
        ADD CONSTRAINT operator_notice_reads_notice_id_fkey
        FOREIGN KEY (notice_id) REFERENCES admin.operator_notices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE admin.operator_notice_reads
        ADD CONSTRAINT operator_notice_reads_operator_id_fkey
        FOREIGN KEY (operator_id) REFERENCES admin.operator_account(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_operator_notice_reads_operator
    ON admin.operator_notice_reads (operator_id, read_at DESC);

-- 列锁：生产的 platform_svc 受 98 列锁约束，少授权会让整条 UPDATE 吃 42501。
-- 锚点列（id / created_by / created_at，以及 reads 表的两个主键列）不授权。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
        REVOKE UPDATE ON admin.operator_notices FROM platform_svc;
        GRANT UPDATE (target_planes, severity, title, body, link, source,
                      reference_type, reference_id, published_at, expires_at,
                      updated_at, deleted_at)
            ON admin.operator_notices TO platform_svc;
        GRANT SELECT, INSERT, DELETE ON admin.operator_notices TO platform_svc;

        REVOKE UPDATE ON admin.operator_notice_reads FROM platform_svc;
        GRANT UPDATE (read_at) ON admin.operator_notice_reads TO platform_svc;
        GRANT SELECT, INSERT, DELETE ON admin.operator_notice_reads TO platform_svc;
    END IF;
END $$;

DO $$
DECLARE
    n_tables int;
BEGIN
    SELECT count(*) INTO n_tables
      FROM information_schema.tables
     WHERE table_schema = 'admin'
       AND table_name IN ('operator_notices', 'operator_notice_reads');
    RAISE NOTICE '[operator-notices] 两张表就位（实测 % 张）', n_tables;
END $$;
