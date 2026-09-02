-- ═══════════════════════════════════════════════════════════════════════════
-- 数据修复 — 被订阅侧「续期确认」误翻成 active 的待收款订单，翻回订单壳
--
-- 依据：owner 2026-09-02 实测。客户用支付宝付了 0.01、点了「我已完成付款」（付款腿
-- pending_verify），运营在 admin「订阅管理」找不到「确认收款」，点了「续期确认」：
-- admin-bff `POST /api/subscriptions/:id/actions {renew}` 对 metering.subscriptions
-- 只看 status（不看 billing.*），把这条 suspended+offline_purchase 的订单壳翻成了
-- active 并把 end_at 延了一个周期——账单仍 unpaid、付款腿仍 pending_verify、段 2
-- 激活（quota 重锚 + provisioning webhook）一步没跑。于是运营台显示「已生效」、
-- 客户端订单流程仍「待付款/待确认」。
--
-- 同一提交里的代码修复：admin-bff resolveTargetStatus 对待收款订单壳（product_320
-- O1 谓词）一律 409，admin 订阅页改成只给「确认收款」出口。本迁移修的是已经被翻
-- 过的存量行。
--
-- 判定（全部同时成立才动）：
--   ① activation_method = 'offline_purchase' 且 status = 'active'
--   ② 最新一张未删账单 bill_status IN ('unpaid','partial')      —— 钱没到
--   ③ 没有任何一条 to_status='active' 的正规激活留痕
--      （offline_payment_confirmed / created）                   —— 从没正规开通过
--   ④ 存在 operator 写的 change_type='renewed' 留痕              —— 正是被误点翻的
--
-- 处置：status → 'suspended'，end_at → NULL（订单壳的原状：end_at 由段 2 激活时
-- 才落），auto_renew → false；append 一条 change_type='pending_order_repaired' 的
-- 留痕（actor_type=system，remark 说明来龙去脉）。翻回去之后，订单侧「确认收款」
-- 走正常的 isPendingOrderRow 分支：段 1 记账、段 2 激活开通。
--
-- 不动：billing.* 一行不碰（钱本来就没记错）；quota_pools 不碰（随 status 回到
-- inert，段 2 激活时重锚）。
--
-- 幂等：判定 ①–④ 修一次就不再成立，可重跑。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _flipped_orders ON COMMIT DROP AS
SELECT s.id, s.tenant_id, s.order_no, s.end_at
  FROM metering.subscriptions s
 WHERE s.deleted_at IS NULL
   AND s.activation_method = 'offline_purchase'
   AND s.status = 'active'
   AND (
     SELECT i.bill_status
       FROM billing.invoices i
      WHERE i.subscription_id = s.id AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 1
   ) IN ('unpaid', 'partial')
   AND NOT EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id
        AND h.to_status = 'active'
        AND h.change_type IN ('offline_payment_confirmed', 'created')
   )
   AND EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id
        AND h.change_type = 'renewed'
        AND h.actor_type = 'operator'
   );

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM _flipped_orders LOOP
    RAISE NOTICE '[repair-pending-orders] % (%): active → suspended, end_at % → NULL',
      r.order_no, r.id, r.end_at;
  END LOOP;
END $$;

INSERT INTO metering.subscription_histories (
  tenant_id, subscription_id, change_type, from_status, to_status,
  actor_type, actor_id, remark
)
SELECT tenant_id, id, 'pending_order_repaired', 'active', 'suspended',
       'system', NULL,
       '待收款订单被订阅侧「续期确认」误翻成 active（账单未结清、未正规开通），迁移翻回订单壳；请在订单管理确认收款'
  FROM _flipped_orders;

UPDATE metering.subscriptions s
   SET status = 'suspended',
       end_at = NULL,
       auto_renew = false,
       updated_at = now()
  FROM _flipped_orders f
 WHERE s.id = f.id;

-- 断言：修完之后不再有满足判定的行。
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM metering.subscriptions s
   WHERE s.deleted_at IS NULL
     AND s.activation_method = 'offline_purchase'
     AND s.status = 'active'
     AND (
       SELECT i.bill_status FROM billing.invoices i
        WHERE i.subscription_id = s.id AND i.deleted_at IS NULL
        ORDER BY i.created_at DESC LIMIT 1
     ) IN ('unpaid', 'partial')
     AND NOT EXISTS (
       SELECT 1 FROM metering.subscription_histories h
        WHERE h.subscription_id = s.id AND h.to_status = 'active'
          AND h.change_type IN ('offline_payment_confirmed', 'created')
     );
  IF n > 0 THEN
    RAISE EXCEPTION '[repair-pending-orders] % active offline order(s) with unpaid invoice remain', n;
  END IF;
END $$;

COMMIT;
