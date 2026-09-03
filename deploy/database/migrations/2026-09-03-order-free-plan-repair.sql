-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P1-c：caimc 首单（ORD-202609-C5EE090AE8）套餐版本修正
--
-- P1-a 回填时订单的 plan_version_id 取自订阅行——而那条订阅行早已被旧模型的升级"就地"改成了
-- vxtpl-starter，于是 ¥0 的 free 首单在交易订单里显示成「入门版 · 月付 ¥0.00」。账单明细行
-- 写的是「Vxtpl Free」，owner 2026-09-03 核对：第一单 = free 月付 ¥0.00 无需支付。
-- 把该订单的 plan_version_id 改回 vxtpl-free 现行版本（同产品；金额本就是 0 不动）。幂等。
--
-- 用法（生产，以 owner 身份）：db-init action=migrate。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE free_pv uuid; free_product uuid; n int;
BEGIN
  SELECT pl.current_version_id INTO free_pv
    FROM product.plans pl WHERE pl.plan_code = 'vxtpl-free' AND pl.deleted_at IS NULL;
  IF free_pv IS NULL THEN
    RAISE NOTICE '[order-free-plan] vxtpl-free has no current version, skipped';
    RETURN;
  END IF;
  SELECT pc.product_id INTO free_product
    FROM product.plan_components pc
   WHERE pc.plan_version_id = free_pv AND pc.component_role = 'primary'
   ORDER BY pc.priority ASC, pc.sort_order ASC LIMIT 1;

  UPDATE billing.orders o
     SET plan_version_id = free_pv,
         operator_remark = COALESCE(o.operator_remark || ' | ', '') || 'product_330 repair 2026-09-03: plan_version → vxtpl-free (backfill took the upgraded row''s version)',
         updated_at = now()
   WHERE o.order_no = 'ORD-202609-C5EE090AE8'
     AND o.product_id = free_product
     AND o.plan_version_id <> free_pv;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[order-free-plan] rows repaired=% (0 = already correct or order absent)', n;
END $$;

COMMIT;
