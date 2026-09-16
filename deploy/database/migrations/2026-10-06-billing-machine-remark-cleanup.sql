-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 清掉账单运营备注里的机读串（owner 2026-09-17 走查报的）
--
-- 症状：admin 的 /billing「处理」列与账单详情的「运营备注」行，会原样打印出
--   {"intent":"upgrade","upgrade_of":"<uuid>"}
-- 里面还裸着一个 uuid，撞「任何场景只展示可视码」那条。
--
-- 病因：`billing.invoices.operate_remark` 的 DDL 注释是「运营手工出账/调整备注」,
-- 本就是人写给人看的一列，旧模型却把订单意图也塞了进来——同一列装两种东西。
--
-- 为什么现在能清：2026-09-03 的订单实体拆分（orders-entity-split）给了意图正规住所
-- ——`billing.orders.intent`（CHECK in new/upgrade/renew）与 `from_subscription_id`，
-- 并且那次迁移就是**从这一列的 JSON 解析出来回填进去的**。所以这些 JSON 已无信息
-- 价值；现行写侧也不再产生（`upgrade_of` 在 bff 与 services 层零命中）。
--
-- 只清「已经回填成功」的那些行：要求账单已关联订单、且订单的 intent 非空。没有对应
-- 订单的行一律不动——万一有没被回填到的，宁可让它继续显示，也不能把唯一的线索删掉。
--
-- 展示层另有一道防御（admin-bff 的 humanRemark 在投影处过滤），两层互不依赖：
-- 这条清数据、那条挡将来任何误写。
--
-- 幂等：跑第二次时已无匹配行，UPDATE 0。迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE n_before bigint;
BEGIN
  SELECT count(*) INTO n_before
    FROM billing.invoices i
    JOIN billing.orders o ON o.id = i.order_id
   WHERE i.operate_remark ~ '^\s*\{.*"intent"\s*:.*\}\s*$'
     AND o.intent IS NOT NULL;
  RAISE NOTICE '[billing-machine-remark] 待清理的机读备注行数=%', n_before;
END $$;

UPDATE billing.invoices i
   SET operate_remark = NULL,
       updated_at     = now()
  FROM billing.orders o
 WHERE o.id = i.order_id
   AND i.operate_remark ~ '^\s*\{.*"intent"\s*:.*\}\s*$'
   AND o.intent IS NOT NULL;

DO $$
DECLARE n_left bigint; n_orphan bigint;
BEGIN
  SELECT count(*) INTO n_left
    FROM billing.invoices i
    JOIN billing.orders o ON o.id = i.order_id
   WHERE i.operate_remark ~ '^\s*\{.*"intent"\s*:.*\}\s*$'
     AND o.intent IS NOT NULL;
  IF n_left <> 0 THEN
    RAISE EXCEPTION '[billing-machine-remark] 清理后仍有 % 行机读备注', n_left;
  END IF;

  -- 没有对应订单、或订单 intent 为空的机读备注：本迁移刻意不动它们，只报出来。
  SELECT count(*) INTO n_orphan
    FROM billing.invoices i
    LEFT JOIN billing.orders o ON o.id = i.order_id
   WHERE i.operate_remark ~ '^\s*\{.*"intent"\s*:.*\}\s*$'
     AND (o.id IS NULL OR o.intent IS NULL);
  RAISE NOTICE '[billing-machine-remark] 无订单可对照、保留原样的行数=%（展示层由 humanRemark 兜住）', n_orphan;
END $$;

COMMIT;
