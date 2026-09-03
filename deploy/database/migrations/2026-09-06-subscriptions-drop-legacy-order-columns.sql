-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P2-e：删 metering.subscriptions 上的旧订单列
--
-- 前置（P2-d，v0.26.55 已发）：代码不写不读 order_no / payment_ttl_minutes，可视码只认
-- current_order_id → billing.orders.order_no；旧订单壳已软删；存量 current_order_id 已回填。
-- 本迁移：
--   ① 断言：live 行里「order_no 非空但 current_order_id 为空」= 0 且活壳 = 0，否则 RAISE 中止
--      （删列会让这些行失去可视码——宁可 db-init 失败也不静默删）。
--   ② 删 uq_subscriptions_order_no / chk_subscriptions_payment_ttl / 两列
--      （列级 UPDATE 授权随列一起消失；98_column_locks.sql 已同步去掉 payment_ttl_minutes）。
-- 幂等：整体包在 psql \if 里——列不在就整文件跳过；引用旧列的历史迁移同样加了这道门。
-- ═══════════════════════════════════════════════════════════════════════════

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'metering' AND table_name = 'subscriptions' AND column_name = 'order_no') AS has_legacy_order_no \gset
\if :has_legacy_order_no

BEGIN;

DO $$
DECLARE
  n_orphan int;
  n_shell  int;
BEGIN
  SELECT count(*) INTO n_orphan FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL AND s.order_no IS NOT NULL AND s.current_order_id IS NULL;
  SELECT count(*) INTO n_shell FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL AND s.status = 'suspended' AND s.activation_method = 'offline_purchase';
  IF n_orphan > 0 OR n_shell > 0 THEN
    RAISE EXCEPTION '[drop-legacy-order-columns] refusing to drop: orphan=% live shells=% (run 2026-09-05-subscriptions-legacy-order-retire first / inspect rows)', n_orphan, n_shell;
  END IF;
  RAISE NOTICE '[drop-legacy-order-columns] preconditions ok (orphan=0, live shells=0) — dropping order_no / payment_ttl_minutes';
END $$;

ALTER TABLE metering.subscriptions DROP CONSTRAINT IF EXISTS uq_subscriptions_order_no;
ALTER TABLE metering.subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_payment_ttl;
ALTER TABLE metering.subscriptions DROP COLUMN IF EXISTS order_no;
ALTER TABLE metering.subscriptions DROP COLUMN IF EXISTS payment_ttl_minutes;

COMMIT;

\endif
