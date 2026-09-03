-- [product_330 P2-e] 旧列 metering.subscriptions.order_no 已删（2026-09-06）；本文件只在旧列仍在时重放，否则整体跳过（psql \if）。
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'metering' AND table_name = 'subscriptions' AND column_name = 'order_no') AS has_legacy_order_no \gset
\if :has_legacy_order_no

-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P2-d：退役 metering.subscriptions 上的旧「订单壳」
--
-- 旧模型（product_320/321）把订单记在订阅行上：status='suspended' +
-- activation_method='offline_purchase' + 最近账单未 paid = 一张待收款订单（O1 谓词）。
-- P1 起订单本体全在 billing.orders，履约（fulfill）会新建订阅行；这些壳行只剩下
-- 让 admin 列表出现「待收款」伪状态和让四个订阅动作 409 的作用。
--
-- ① 旧订单壳软删（deleted_at = now()）：订单在 billing.orders 里照旧可见/可付/可作废。
-- ② current_order_id 回填：存量行的 order_no 与 billing.orders.order_no 一一对应
--    （P1-a 回填时就是从它复制的）——填上后读侧只认 current_order_id，代码不再引用 s.order_no。
-- ③ NOTICE 报数：live 行里「order_no 非空但 current_order_id 仍空」与「活壳」都为 0，
--    下一版才能删 order_no / payment_ttl_minutes 两列（本迁移不删列，先让代码停读一版）。
-- 幂等：全程 WHERE 守卫，重放无副作用。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 旧订单壳软删
UPDATE metering.subscriptions s
   SET deleted_at = now(), updated_at = now()
 WHERE s.deleted_at IS NULL
   AND s.status = 'suspended'
   AND s.activation_method = 'offline_purchase'
   AND COALESCE(
         (SELECT i.bill_status FROM billing.invoices i
           WHERE i.subscription_id = s.id
           ORDER BY i.created_at DESC LIMIT 1),
         'unpaid') <> 'paid';

-- ② current_order_id 回填（只填 live 行；壳行已软删不管）
UPDATE metering.subscriptions s
   SET current_order_id = o.id, updated_at = now()
  FROM billing.orders o
 WHERE s.deleted_at IS NULL
   AND s.current_order_id IS NULL
   AND s.order_no IS NOT NULL
   AND o.order_no = s.order_no;

-- ③ 报数
DO $$
DECLARE
  n_orphan int;
  n_shell  int;
  n_filled int;
BEGIN
  SELECT count(*) INTO n_orphan FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL AND s.order_no IS NOT NULL AND s.current_order_id IS NULL;
  SELECT count(*) INTO n_shell FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL AND s.status = 'suspended' AND s.activation_method = 'offline_purchase';
  SELECT count(*) INTO n_filled FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL AND s.current_order_id IS NOT NULL;
  RAISE NOTICE '[legacy-order-retire] live rows with current_order_id=% ; orphan(order_no set, no current_order)=% (expect 0) ; live shells=% (expect 0)',
    n_filled, n_orphan, n_shell;
END $$;

COMMIT;

\endif
