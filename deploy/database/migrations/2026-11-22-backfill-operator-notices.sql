-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-22-backfill-operator-notices.sql
-- 把近 30 天已经发给客户、运营却从未看到的消息补进运营通告
--
-- ── 为什么 ──
-- owner 2026-09-28：「刚才用户订阅的退款，退订，admin 平台一条消息都没有。」同批已经接上
-- 「客户消息 → 运营通告」的镜像（dispatcher 写 admin.operator_notices，source='system'），
-- 但镜像只从部署那一刻起生效。在它之前发生的事——生产上 09:49 那笔 ¥99 退款申请、三条退订、
-- 若干次申报付款——客户都收到了消息，运营侧一条记录都没有。
-- 这一份把那段空白补上：数据源就是客户自己收到的那条站内信。
--
-- ── 补什么、不补什么 ──
-- 补：`support.inbox_messages` 近 30 天的**事件**（按 模板码 + 引用对象 去重，一个事件一条，
--     不按收件人；同一事件发给三个人只补一条）。标题与正文用客户收到的原文——运营与客户
--     看到的是同一句话，这正是本批要的「完整一致」。
-- 不补：30 天之前的（运营已无从跟进）、软删的租户消息（同一条唯一键仍在，不重复）。
-- 严重度照镜像表那四个 warning 模板判，其余 info；info 30 天后退出列表，warning 留着直到有人处理。
-- 链接：客户那条 link 是 console 路径（还带 UUID），admin 用不了；能从引用对象查到订单可视码的
--     给 `/orders/{order_no}`，查不到就不给链接——宁可没有，不给一个点开是 404 的。
--
-- 重复执行安全：`ON CONFLICT (reference_type, reference_id) WHERE source='system' AND deleted_at IS NULL`
-- 与 `uq_operator_notices_system` 同一把锁；第二遍命中 0 行。镜像上线后产生的新通告用同一套
-- 去重键，所以本份与镜像不会互相重复。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  inserted_n integer;
  window_n   integer;
BEGIN
  SELECT count(DISTINCT (m.template_code, m.reference_type, m.reference_id))
    INTO window_n
    FROM support.inbox_messages m
   WHERE m.created_at > now() - interval '30 days';

  WITH events AS (
    SELECT DISTINCT ON (m.template_code, m.reference_type, m.reference_id)
           m.template_code,
           m.reference_type,
           m.reference_id,
           m.title,
           m.body,
           m.tenant_id,
           m.created_at
      FROM support.inbox_messages m
     WHERE m.created_at > now() - interval '30 days'
     ORDER BY m.template_code, m.reference_type, m.reference_id, m.created_at ASC
  ),
  shaped AS (
    SELECT e.template_code,
           e.reference_type,
           e.reference_id,
           e.title,
           e.body,
           e.created_at,
           coalesce(nullif(t.display_name, ''), nullif(t.name, ''), '租户') AS tenant_name,
           -- 与 operator-mirror 的严重度分档一致：钱在等人、或事情没办成的是 warning。
           CASE WHEN e.template_code IN ('refund.requested', 'refund.failed',
                                         'order.payment_declared', 'subscription.cancelled_refunded')
                THEN 'warning' ELSE 'info' END AS severity,
           -- 引用对象能查到订单可视码就给 admin 的订单详情链接，否则不给链接。
           CASE
             WHEN e.reference_type = 'order' AND e.reference_id ~ '^[0-9a-f-]{36}$'
               THEN (SELECT o.order_no FROM billing.orders o WHERE o.id = e.reference_id::uuid)
             WHEN e.reference_type = 'refund' AND e.reference_id ~ '^[0-9a-f-]{36}$'
               THEN (SELECT o2.order_no FROM billing.refunds r
                       JOIN billing.orders o2 ON o2.id = r.order_id
                      WHERE r.id = e.reference_id::uuid)
             ELSE NULL
           END AS order_no
      FROM events e
      LEFT JOIN tenancy.tenants t ON t.id = e.tenant_id
  ),
  ins AS (
    INSERT INTO admin.operator_notices
      (target_planes, severity, title, body, link, source, reference_type, reference_id, published_at, expires_at)
    SELECT ARRAY['admin']::varchar(16)[],
           s.severity,
           left(s.title, 256),
           s.tenant_name || ' · ' || s.body,
           CASE WHEN s.order_no IS NULL THEN NULL ELSE '/orders/' || s.order_no END,
           'system',
           'customer_event',
           s.template_code || ':' || s.reference_type || ':' || s.reference_id,
           s.created_at,
           CASE WHEN s.severity = 'info' THEN s.created_at + interval '30 days' ELSE NULL END
      FROM shaped s
    ON CONFLICT (reference_type, reference_id) WHERE source = 'system' AND deleted_at IS NULL
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted_n FROM ins;

  RAISE NOTICE '[backfill-operator-notices] 近 30 天客户事件 % 个，本次补录 % 条运营通告',
    window_n, inserted_n;
END $$;

COMMIT;
