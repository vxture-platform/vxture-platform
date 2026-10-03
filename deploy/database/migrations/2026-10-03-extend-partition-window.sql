-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 分区预建窗口从 2027-02-01 推到 2028-02-01（存量库那一半）
--
-- 依据：owner 2026-10-03「这是什么意图，暂时不要复杂化」。
--
-- 背景：96_partitions.sql 原先写「起点 2026-07 + 未来 6 个月」= 覆盖到 2027-02-01，
-- 并把每月滚动交给注释里的「维护 Job（pg_cron / 外部调度）」—— 那个 Job 不存在、
-- pg_cron 没装、它提到的「巡检有行=告警」也不存在。窗口走到头之后，
-- metering.usage_events（计费事件）、usage_event_pools、support.audit_logs 的写入
-- 静默落进 *_default 分区：不丢数，但分区失效、按月 detach/drop 做不了，且零信号。
--
-- 为什么单改 DDL 不够：**新库按 DDL+seed 直建、不跑迁移**，而存量库建库那天就定了
-- 窗口、再也不会重跑 96_partitions.sql。所以 DDL 那一半只让新库受益；生产要靠这一份。
-- （2026-10-03 之前 migrations 里一份分区改动都没有，所以生产窗口一直是最初那 7 个月。）
--
-- 本迁移不装任何调度、不改父表、不动既有分区，只把缺的月份子表建出来。
-- 窗口再往后推时：改 96_partitions.sql 的 cover_until **并**另写一份同形的迁移。
-- 剩余不足 90 天时 CI 的 check-partition-window.mjs 会红，到那时自然会提醒。
--
-- 幂等：整份可重跑（to_regclass 守卫，与 DDL 同一判据）。
-- 顺序：与部署无先后依赖（纯建空子表，旧代码照常写）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
-- 分区边界按会话 TimeZone 解释，而仓里没钉它（RDS 参数组决定）。与 96_partitions.sql 同一个
-- 理由钉成 UTC：DDL 与本迁移隔着几个月、两次运行，会话 TZ 若不同，靠西那一边会留下
-- **静默 8 小时缺口**（真库复现过）。SET LOCAL 只管本事务。
SET LOCAL TIME ZONE 'UTC';

DO $$
DECLARE
  parts text[] := ARRAY['metering.usage_events', 'metering.usage_event_pools', 'support.audit_logs'];
  -- 与 96_partitions.sql 的 cover_until 同值。两处必须一致 —— 不一致的症状是
  -- 「新库和存量库窗口不同」，而那种差异不报错。
  cover_until date := date '2028-02-01';
  cover_from  date := date '2026-07-01';
  qname text; sch text; tbl text; child text; mn date; nm date;
  made int := 0; have int := 0;
BEGIN
  FOREACH qname IN ARRAY parts LOOP
    sch := split_part(qname, '.', 1);
    tbl := split_part(qname, '.', 2);

    -- 父表必须已经是分区表，否则这份迁移跑在一个没预期的库上，要吵不要静默跳过。
    IF NOT EXISTS (
      SELECT 1 FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = sch AND c.relname = tbl
    ) THEN
      RAISE EXCEPTION '[partition-window] %.% 不是分区父表 —— 先确认 96_partitions.sql 已 apply', sch, tbl;
    END IF;

    mn := cover_from;
    WHILE mn < cover_until LOOP
      nm := mn + interval '1 month';
      child := tbl || '_y' || to_char(mn, 'YYYY') || 'm' || to_char(mn, 'MM');
      IF to_regclass(format('%I.%I', sch, child)) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
          sch, child, sch, tbl, mn, nm);
        made := made + 1;
      ELSE
        have := have + 1;
      END IF;
      mn := nm;
    END LOOP;
  END LOOP;
  RAISE NOTICE '[partition-window] 新建 % 个月分区，已存在 % 个（三张表合计），窗口覆盖到 %',
    made, have, cover_until;
END $$;

-- ── 审计段：把每张表的真实窗口上界读回来，PR 里贴这几行 ────────────────────
--    不是装饰 —— 「某张表少铺了几个月」只有在这里看得见。上界从 pg_class 的分区边界
--    里取，不从上面那个变量回显（回显变量只能证明我写了什么，证明不了库里有什么）。
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '[partition-window] 各表实际覆盖到（不含 _default）';
  FOR r IN
    SELECT n.nspname || '.' || parent.relname AS tbl,
           -- 取上界：`TO ('2028-02-01 00:00:00+00')`。两个坑都踩过了 ——
           -- ① 边界是 **timestamptz** 不是裸日期，所以日期后面是空格、不是引号，
           --    模式末尾再要一个引号就永远匹配不上（回 NULL，而审计段打 NULL
           --    看起来像「没铺」，不像「我的正则错了」）；
           -- ② 用 `[(]` 不用 `\(` —— 反斜杠在这条链路上会被吃掉。
           max(
             substring(
               pg_get_expr(child.relpartbound, child.oid)
               from 'TO [(]''([0-9][0-9-]+)'
             )::date
           ) AS cover_until
      FROM pg_inherits i
      JOIN pg_class child  ON child.oid  = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace n  ON n.oid = parent.relnamespace
     WHERE parent.relname IN ('usage_events', 'usage_event_pools', 'audit_logs')
       AND pg_get_expr(child.relpartbound, child.oid) NOT LIKE '%DEFAULT%'
     GROUP BY 1
     ORDER BY 1
  LOOP
    RAISE NOTICE '  % → %  （距今 % 天）',
      r.tbl, r.cover_until, (r.cover_until - current_date);
  END LOOP;
END $$;

COMMIT;
