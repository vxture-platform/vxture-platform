-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P1-c：订单 / 订阅数据清理（v0.26.48 上线后的核对结果）
--
-- ① （撤销）重复的 caimc 修复审计行：subscription_histories 是 append-only（95_triggers
--    forbid_mutation，DELETE 直接 RAISE，2026-09-03 生产实跑抓到）。多出的那条 operator_adjusted
--    留着——审计表不删行；源文件已加 NOT EXISTS 守卫，不会再多。
-- ② order_events 回填把旧模型「升级镜像行」的 cancelled 历史也复制到了已履约的升级订单上——那是旧
--    模型的内部动作（镜像行被标 cancelled），不是这张单的事；删掉，时间线只留真实订单事件。
-- ③ 自动续费默认开（owner 决策 5：free 与付费一样显示自动续期、可关闭）：旧下单路径把 auto_renew
--    写成 false；对在用订阅里从未被客户 / 运营显式关闭过（无 auto_renew_off 历史）的行翻回 true。
--    续费引擎（P2-c）上线前该标志只影响展示与「到期不续」提示。
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

-- ③ 自动续费默认开（未显式关闭过的在用订阅）
-- 试用行除外：chk_subscriptions_trial_no_renew 禁止 trial 自动续费——2026-09-06 空库 DDL +
-- 全量重放 + seed 的消费方形态跑出来的（db-init 每次重放，库里只要有一条试用就整跑失败）。
UPDATE metering.subscriptions s
   SET auto_renew = true, updated_at = now()
 WHERE s.deleted_at IS NULL
   AND s.status IN ('active', 'expiring')
   AND s.subscription_kind <> 'trial'
   AND s.auto_renew = false
   AND NOT EXISTS (
     SELECT 1 FROM metering.subscription_histories h
      WHERE h.subscription_id = s.id AND h.change_type = 'auto_renew_off'
   );

DO $$
DECLARE n_dup bigint; n_off bigint;
BEGIN
  SELECT count(*) INTO n_dup FROM metering.subscription_histories
   WHERE change_type = 'operator_adjusted' AND remark LIKE 'product_330 repair:%';
  SELECT count(*) INTO n_off FROM metering.subscriptions
   WHERE deleted_at IS NULL AND status IN ('active','expiring') AND subscription_kind <> 'trial' AND auto_renew = false;
  RAISE NOTICE '[order-data-repair] repair audit rows=% (append-only, duplicates stay), live subscriptions still auto_renew=false=%', n_dup, n_off;
END $$;

COMMIT;
