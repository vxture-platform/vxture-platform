-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P1-c：订单 / 订阅数据清理（v0.26.48 上线后的核对结果）
--
-- ① （撤销）重复的 caimc 修复审计行：subscription_histories 是 append-only（95_triggers
--    forbid_mutation，DELETE 直接 RAISE，2026-09-03 生产实跑抓到）。多出的那条 operator_adjusted
--    留着——审计表不删行；源文件已加 NOT EXISTS 守卫，不会再多。
-- ② order_events 回填把旧模型「升级镜像行」的 cancelled 历史也复制到了已履约的升级订单上——那是旧
--    模型的内部动作（镜像行被标 cancelled），不是这张单的事；删掉，时间线只留真实订单事件。
-- ③ （撤销，2026-09-03 晚）原「自动续费默认开」的翻标步骤已删除：owner 改为默认关、需客户在订单
--    确认页显式开启（见 2026-09-07-auto-renew-opt-in.sql）；这一步每次重放都会把客户没开过的翻成开。
--
-- 全部幂等，可重复执行。用法（生产，以 owner 身份）：db-init action=migrate。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ② 已履约订单上的镜像行 cancelled 事件（order_events 不是 append-only 表，见 95_triggers）
DELETE FROM billing.order_events e
 USING billing.orders o
 WHERE e.order_id = o.id
   AND o.status = 'fulfilled'
   AND e.event_type = 'cancelled'
   AND e.remark LIKE 'upgrade applied to %';

DO $$
DECLARE n_dup bigint;
BEGIN
  SELECT count(*) INTO n_dup FROM metering.subscription_histories
   WHERE change_type = 'operator_adjusted' AND remark LIKE 'product_330 repair:%';
  RAISE NOTICE '[order-data-repair] repair audit rows=% (append-only, duplicates stay)', n_dup;
END $$;

COMMIT;
