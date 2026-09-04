-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 删除账号(批 5b):account.users 加 30 天保留期
--
-- 依据:docs/30-design/identity/050-account.md §7(owner 2026-09-04 裁定:
-- 自助删除 → status='deleting' + deletion_requested_at,30 天内重新登录可撤销,
-- 到期由 platform-api 的 account-deletion-purge 清扫脱敏并软删个人租户)。
--
-- 三件事:① 加列 deletion_requested_at;② status CHECK 放进 'deleting';
-- ③ 新列进 platform_svc 的 UPDATE 列白名单(98_column_locks:漏授权则线上写入 42501)。
-- DDL 基线(10_account.sql / 98_column_locks.sql)已同步改;新库走 DDL,存量库走本迁移。
--
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 保留期起点
ALTER TABLE account.users
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_deletion_requested_at
  ON account.users (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

-- ② 状态值 'deleting'
ALTER TABLE account.users DROP CONSTRAINT IF EXISTS chk_users_status;
ALTER TABLE account.users
  ADD CONSTRAINT chk_users_status
  CHECK (status IN ('active','disabled','pending','deleting'));

-- ③ 列锁白名单(与 98_column_locks.sql 同一行内容;GRANT 幂等)
GRANT UPDATE (account, email, email_verified_at, phone, phone_verified_at, account_changed_at, account_login_disabled, status, source, updated_at, deleted_at, deletion_requested_at) ON account.users TO platform_svc;

COMMIT;
