-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P2-b：退款策略平台参数（admin.settings）
--
-- refund.window_hours   = 24    履约起多少小时内可申请（首次购买）
-- refund.max_usage_ratio = 0.10  消耗性配额已用比阈值（≥ 则不可退）
-- 与 seed-catalog 同一段 insert；幂等（on conflict do nothing）。运营改值走治理台「平台参数」。
--
-- 同批：billing.orders.chk_orders_fulfilled 放行 refunded——退款单保留履约痕迹
-- （fulfilled_at / subscription_id 不清空，回滚订阅只改订阅态），原约束只认 fulfilled。
-- drop + add 幂等（db-init 全量重放）。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE billing.orders DROP CONSTRAINT IF EXISTS chk_orders_fulfilled;
ALTER TABLE billing.orders ADD CONSTRAINT chk_orders_fulfilled
  CHECK ((status IN ('fulfilled','refunded')) = (fulfilled_at IS NOT NULL AND subscription_id IS NOT NULL));

INSERT INTO admin.settings (config_group, config_key, value_type, config_value, description, description_key, created_by, created_at, updated_at)
VALUES
  ('commerce', 'refund.window_hours', 'int', '24',
   'Refund window in hours after fulfilment (first purchase of a product only).',
   'ops.setting.refund.window_hours.desc', NULL, now(), now()),
  ('commerce', 'refund.max_usage_ratio', 'string', '0.10',
   'Max consumed share of consumable quota (0-1) for a refund to stay eligible.',
   'ops.setting.refund.max_usage_ratio.desc', NULL, now(), now())
ON CONFLICT (config_key) DO NOTHING;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM admin.settings WHERE config_key IN ('refund.window_hours', 'refund.max_usage_ratio');
  RAISE NOTICE '[refund-policy-settings] rows present=% (expect 2)', n;
END $$;

COMMIT;
