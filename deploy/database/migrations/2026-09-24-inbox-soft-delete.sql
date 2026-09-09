-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 站内消息支持删除（owner 2026-09-09）
--
-- 「消息中心该把没删的全部显示出来，并且能删」。删除走**软删**：
--   · 消息是通知的送达记录，硬删之后「这条通知发过没有」就查不到了，而
--     dispatcher 的去重恰恰依赖那条记录（唯一键 收件人 × 模板 × 业务引用，
--     冲突即视为已通知过）。硬删会让同一条通知重新发一遍。
--   · 租户删的是「我不想再看见它」，不是「这件事没发生过」。
--
-- 因此加 `deleted_at`，读路径过滤，dispatcher 的去重**不看这一列**。
--
-- 索引：列表查询是 `account_id = ? and deleted_at is null order by created_at desc`，
-- 建一条与之同形的部分索引；已删的行不进索引，长期看比全表索引小。
--
-- support 域不在列级锁清单里（column-locks.shared.mjs 无 support.* 条目），
-- 所以这里只需给服务账号常规授权，不涉及 98 列锁的同步。
--
-- 幂等：整份可重跑。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE support.inbox_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN support.inbox_messages.deleted_at IS
  '租户删除时刻（软删）。读路径过滤；dispatcher 的送达去重**不看这一列**——'
  '删除表达的是「不想再看见」，不是「这件事没发生过」。';

CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_live
  ON support.inbox_messages (account_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- 服务账号要能写这一列（软删是 UPDATE）。角色不存在时跳过：本机开发库没有它。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc') THEN
    GRANT UPDATE (deleted_at) ON support.inbox_messages TO platform_svc;
  END IF;
END $$;

-- ── 后置断言：只查本迁移做过的事 ──────────────────────────────────────────
-- **不做**「全库某类共 N 个」式的绝对计数：migrate 是全量重放，每份跑在最终状态上，
-- 那种数会随后来的任何一次新增而失效（2026-09-09 三条一起炸过，见
-- scripts/guardrails/check-migration-absolute-counts.mjs）。
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'support' AND table_name = 'inbox_messages'
     AND column_name = 'deleted_at';
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:support.inbox_messages.deleted_at 不存在';
  END IF;

  SELECT count(*) INTO v FROM pg_indexes
   WHERE schemaname = 'support' AND indexname = 'idx_inbox_messages_account_live';
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:idx_inbox_messages_account_live 未建';
  END IF;

  -- 已有行必须全是「未删」——加列默认 NULL，这一条防的是有人给了非空默认值。
  SELECT count(*) INTO v FROM support.inbox_messages WHERE deleted_at IS NOT NULL;
  IF v <> 0 THEN
    RAISE EXCEPTION '存量消息被标成了已删:% 行', v;
  END IF;
END $$;

COMMIT;
