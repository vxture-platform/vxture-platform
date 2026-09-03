-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P2-f：自动续费默认关、客户在订单确认页显式开启（owner 2026-09-03）
--
-- ① billing.orders 加 auto_renew（客户在确认页的选择，随订单留痕；履约时写入订阅）。
-- ② metering.subscriptions.auto_renew 列默认值 true → false（新建订阅一律按订单值写，默认关）。
-- ③ 存量：此前 order-data-repair ③ 把在用订阅静默翻成了开。凡 auto_renew=true 且没有客户 / 运营
--    主动开启记录（无 auto_renew_on 历史）的在用非试用行，翻回 false，并写一条 auto_renew_off 历史
--    说明原因（有 auto_renew_on 记录的保留）。
-- 幂等：ADD COLUMN IF NOT EXISTS；SET DEFAULT 可重复；③ 翻过一次即不再命中，历史行按 remark 去重。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE billing.orders ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;
ALTER TABLE metering.subscriptions ALTER COLUMN auto_renew SET DEFAULT false;

-- 列锁同步（与 98_column_locks.sql 的 billing.orders 一条逐字一致；新列不在白名单里 platform_svc 写不进去）
REVOKE UPDATE ON billing.orders FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit, cycle_count, from_subscription_id, subscription_id, list_amount, credit_amount, payable_amount, leftover_amount, currency, proration, status, payment_ttl_minutes, auto_renew, declared_at, paid_at, fulfilled_at, closed_at, close_reason, created_by_type, created_by_id, operator_remark, updated_at) ON billing.orders TO platform_svc;

-- ③ 存量翻回：先写历史（用当前值判定），再改标志
INSERT INTO metering.subscription_histories (
  tenant_id, subscription_id, change_type, from_status, to_status, actor_type, actor_id, remark
)
SELECT s.tenant_id, s.id, 'auto_renew_off', s.status, s.status, 'system', NULL,
       'product_330 auto-renew opt-in (owner 2026-09-03): silent default reverted; enable it on the order confirmation page or under My subscriptions'
  FROM metering.subscriptions s
 WHERE s.deleted_at IS NULL
   AND s.auto_renew = true
   AND s.subscription_kind <> 'trial'
   AND NOT EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id AND h.change_type = 'auto_renew_on'
   )
   AND NOT EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id AND h.change_type = 'auto_renew_off'
        AND h.remark LIKE 'product_330 auto-renew opt-in%'
   );

UPDATE metering.subscriptions s
   SET auto_renew = false, next_renewal_at = NULL, updated_at = now()
 WHERE s.deleted_at IS NULL
   AND s.auto_renew = true
   AND s.subscription_kind <> 'trial'
   AND NOT EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id AND h.change_type = 'auto_renew_on'
   );

DO $$
DECLARE n_on int; n_off int; n_reverted int;
BEGIN
  SELECT count(*) INTO n_on  FROM metering.subscriptions WHERE deleted_at IS NULL AND auto_renew = true;
  SELECT count(*) INTO n_off FROM metering.subscriptions WHERE deleted_at IS NULL AND auto_renew = false;
  SELECT count(*) INTO n_reverted FROM metering.subscription_histories
   WHERE change_type = 'auto_renew_off' AND remark LIKE 'product_330 auto-renew opt-in%';
  RAISE NOTICE '[auto-renew-opt-in] live subscriptions auto_renew on=% off=% ; reverted-by-migration (all time)=%', n_on, n_off, n_reverted;
END $$;

COMMIT;
