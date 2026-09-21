-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-14-tenant-operator-notes.sql
--
-- 运营备注：运营对某租户的内部记录，租户自己看不到。
--
-- ── 为什么需要 ──
-- 库里此前没有这一列。admin 的租户详情页一直拿
-- `tenancy.tenant_profiles.description`（**租户自己写的简介**）挂在「运营备注」
-- 这个标题下 —— 同一段文字贴着两个含义相反的标签，运营以为那是自己人写的。
--
-- ── 为什么不另建历史表 ──
-- owner 2026-09-21 的口径是「信息一份即可，但要有操作记录」。当前文本留一份在
-- 本表，每次编辑写一条 support.audit_logs（tenant.operator_notes.update，带
-- before/after）。审计表本来就是运营动作的唯一台账，另起一张历史表会造出第二
-- 份说法。
--
-- 对应 DDL：deploy/database/ddl/80_admin.sql 与 98_column_locks.sql。
--
-- 全部幂等：migrate 是**全量重放**，这份脚本会被反复执行。
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin.tenant_operator_notes (
    tenant_id    uuid          PRIMARY KEY,                       -- 裸值→tenancy.tenants（边界#3，不建 FK：须活过租户注销）
    body         text          NOT NULL DEFAULT '',
    updated_by   uuid          REFERENCES admin.operator_account(id) ON DELETE SET NULL,  -- 域内真 FK
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_operator_notes_updated_by
    ON admin.tenant_operator_notes (updated_by);

-- 列锁：生产的 platform_svc 受 98 列锁约束，少授权会让整条 UPDATE 吃 42501。
-- 锚点列（tenant_id / created_at）不授权。
--
-- 基础授权也写在这里：97_service_roles.sql 的 `GRANT ... ON ALL TABLES` 只覆盖
-- 它执行当时存在的表，而 28d-apply-migrations.sh 只重跑 98_column_locks.sql、
-- 不重跑 97。不自带授权的话，活库上 platform_svc 一个字段都读不到。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
        REVOKE UPDATE ON admin.tenant_operator_notes FROM platform_svc;
        GRANT UPDATE (body, updated_by, updated_at)
            ON admin.tenant_operator_notes TO platform_svc;
        GRANT SELECT, INSERT, DELETE ON admin.tenant_operator_notes TO platform_svc;
    END IF;
END $$;

DO $$
DECLARE
    n_tables int;
BEGIN
    SELECT count(*) INTO n_tables
      FROM information_schema.tables
     WHERE table_schema = 'admin'
       AND table_name = 'tenant_operator_notes';
    RAISE NOTICE '[tenant-operator-notes] 表就位（实测 % 张）', n_tables;
END $$;
