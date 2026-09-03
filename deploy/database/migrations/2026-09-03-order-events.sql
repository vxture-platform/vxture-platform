-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P1-b2：订单事件表 billing.order_events + 旧订单阶段历史回填
--
-- P1-b2 起订单阶段（下单 / 申报 / 驳回 / 收款 / 履约 / 取消 / 过期 / 恢复）不再产生订阅行，
-- 事件不能再挂 metering.subscription_histories；TTL 重锚（payment_rejected）与付款页驳回横幅改读本表。
-- 回填：P1-a 回填出来的订单，其旧订阅行上的订单阶段历史（order_created / payment_declared /
-- payment_rejected / offline_payment_confirmed / cancelled / order_expired / restored）复制一份到本表，
-- 让 TTL 锚点与时间线连续。幂等：表 IF NOT EXISTS；回填按 (order_id, event_type, created_at) 去重。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS billing.order_events (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid          NOT NULL REFERENCES billing.orders(id) ON DELETE RESTRICT,
    event_type    varchar(32)   NOT NULL,
    from_status   varchar(24),
    to_status     varchar(24),
    actor_type    varchar(16)   NOT NULL,
    actor_id      uuid,
    remark        text,
    client_ip     varchar(64),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_order_events_actor_type CHECK (actor_type IN ('system','customer','operator'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order_created ON billing.order_events (order_id, created_at DESC);

-- 回填旧订单阶段历史（订单行 = 旧模型里 order_no 相同的订阅行）
INSERT INTO billing.order_events (order_id, event_type, from_status, to_status, actor_type, actor_id, remark, client_ip, created_at)
SELECT o.id,
       CASE h.change_type
         WHEN 'order_created'             THEN 'created'
         WHEN 'offline_payment_confirmed' THEN 'payment_confirmed'
         ELSE h.change_type
       END,
       h.from_status, h.to_status, h.actor_type, h.actor_id, h.remark, h.client_ip, h.created_at
  FROM metering.subscription_histories h
  JOIN metering.subscriptions s ON s.id = h.subscription_id
  JOIN billing.orders o ON o.order_no = s.order_no
 WHERE h.change_type IN ('order_created','payment_declared','payment_rejected','offline_payment_confirmed',
                         'cancelled','order_expired','restored')
   AND NOT EXISTS (
     SELECT 1 FROM billing.order_events e
      WHERE e.order_id = o.id AND e.created_at = h.created_at
        AND e.event_type = CASE h.change_type
                             WHEN 'order_created' THEN 'created'
                             WHEN 'offline_payment_confirmed' THEN 'payment_confirmed'
                             ELSE h.change_type END
   );

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM billing.order_events;
  RAISE NOTICE '[order-events] order_events rows=%', n;
END $$;

COMMIT;
