-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 产品行加「带理由跳过上线闸门」的三列
--
-- owner 2026-09-17：放宽上线条件，目的是让流程能「先上线再联调」。
--
-- ── 为什么不是把检查项降级或删掉 ──
--
-- 调研结论是上线门六项**没有一项结构性锁死**：三项自动检查（换票 / 拉权益 /
-- 报用量）产品后端各调一次就点亮，不需要客户、订阅或套餐；两项人工按对方回报
-- 勾；一项登记即满足。所以"放宽"不该削弱条件——条件本身是可达的，削弱只会让
-- 这道门以后什么也证明不了。
--
-- 改为允许**带理由的显式跳过并留痕**：条件照旧，但运营者可以在写明理由之后
-- 越过它先上线，去做联调；跳过的事实留在产品行上，供后续复验时对照。
--
-- ── 三列各自答什么 ──
--
--   launch_override_at       什么时候跳过的（NULL = 从未跳过，正常上线）
--   launch_override_by       谁跳的（裸 UUID→admin.operator_accounts，不建 FK，边界#2）
--   launch_override_pending  跳过时哪几项还没满足（jsonb 数组，存 item_code）
--
-- 理由本身不入这张表，进 support.audit_logs 的 after——审计是问责台账，
-- 产品行只需要答「这个产品是不是带着缺项上线的、缺的是哪几项」，那正是
-- 产品页常驻提示与后续复验要读的东西。
--
-- ── 列级锁 ──
-- 三列都不是锚点（非 PK、非 `_no`、非 created_*），按规则属可写列，已同步进
-- `98_column_locks.sql` 的 GRANT 白名单。28d 每次重放该文件，无需在此写 GRANT。
--
-- 幂等：ADD COLUMN IF NOT EXISTS + 末尾断言。可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS launch_override_at timestamptz;

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS launch_override_by uuid;

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS launch_override_pending jsonb;

COMMENT ON COLUMN product.products.launch_override_at IS
  '带理由跳过上线闸门的时刻；NULL = 从未跳过（正常上线）。理由本身在 support.audit_logs。';

COMMENT ON COLUMN product.products.launch_override_by IS
  '执行跳过的运营者；裸值→admin.operator_accounts（不建 FK，边界#2）。';

COMMENT ON COLUMN product.products.launch_override_pending IS
  '跳过当时尚未满足的 gate=launch 必填项 item_code 数组（jsonb）。产品页据此常驻提示，复验后这些项转满足即不再提示。';

-- ── 断言：三列都在，且类型对 ────────────────────────────────────────────────
-- 不写「全库某类共 N 个」式的计数断言（lint:migration-counts）：migrate 是全量
-- 重放，那种断言会随无关新增失效。这里只断言本迁移自己做的事。
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(want.col || '(' || want.typ || ')', '、' ORDER BY want.col)
    INTO missing
    FROM (VALUES
      ('launch_override_at',      'timestamp with time zone'),
      ('launch_override_by',      'uuid'),
      ('launch_override_pending', 'jsonb')
    ) AS want(col, typ)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'product'
     AND c.table_name   = 'products'
     AND c.column_name  = want.col
   WHERE c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM want.typ;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '[launch-override] 加列后仍缺失或类型不符：%', missing;
  END IF;

  RAISE NOTICE '[launch-override] 三列就位（launch_override_at / _by / _pending）';
END $$;

COMMIT;
