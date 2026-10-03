-- ═══════════════════════════════════════════════════════════════════════════
-- 96_partitions.sql — 分区子表预建（RANGE 按月）+ DEFAULT 兜底
-- apply 顺序：在分区父表建成之后（50_metering / 72_support）。幂等（to_regclass 守卫）。
-- 分区父表（父表挂的触发器/索引自动传播全子分区）：
--   metering.usage_events        PARTITION BY RANGE (created_at)
--   metering.usage_event_pools   PARTITION BY RANGE (event_created_at)
--   support.audit_logs           PARTITION BY RANGE (created_at)
-- 预建到 PARTITION_COVER_UNTIL（下面那一个日期字面量）；DEFAULT 兜底防漏档丢写（对齐 §8.4 rank 16）。
--
-- ── 2026-10-03 改了「窗口怎么表达」，没有引入任何新机制 ──
-- 原来写的是「起点 2026-07 + 未来 6 个月」，也就是**覆盖到 2027-02-01**，而原注释把滚动
-- 交给「维护 Job（pg_cron / 外部调度）」—— 那个 Job 不存在，pg_cron 也没装，它提到的
-- 「巡检有行=告警」同样不存在。于是窗口只会静默走到头：之后写入落进 _default，
-- 不丢数，但分区失效、按月 detach/drop 做不了，且**零信号**。
--
-- owner 2026-10-03：「这是什么意图，暂时不要复杂化」。所以这里**不装 pg_cron、不加作业**，
-- 只做两件最小的事：
--   ① 窗口用「覆盖到哪天」表达（一个日期，不是起点+个数），并推到 2028-02-01；
--   ② 配一道 CI 守卫 check-partition-window.mjs：剩余不足 90 天就红。
-- 守卫的判据会随时间自己变化 —— 同一份代码到 2027-11 就会红，那时把下面这个日期再往后推
-- 一次（并补一份迁移给存量库，见 ③）。这比「写个作业每月建一个」简单，代价是每年手动推一次。
--
-- ③ **改这个日期必须同时补一份迁移。** 本文件是 DDL：新库按 DDL+seed 直建、**不跑迁移**，
--    而存量库建库那天就定了窗口、再也不会重跑本文件。只改这里 = 只有新库受益，
--    生产还是旧窗口 —— 2026-10-03 之前正是这个状态（migrations 里一份分区改动都没有）。
--
-- ④ **这是对治理标准的一处显式偏离**（docs/10-standards/140-repo-governance-standard.md
--    §「已批准维护操作（周期性 DB 维护，第三类）」与整顿清单「走 db-maintenance.yml 白名单函数，
--    不是裸等人工提醒」）。那一节把分区滚动判给 `db-maintenance.yml` + cron + `ddl/incr/*` 维护函数，
--    而这三样今天都不存在；owner 2026-10-03 裁定「暂时不要复杂化」。本仓实际采用：远窗口 + CI 守卫
--    （check-partition-window.mjs，每次提交 + 每月定时）+ 年度手动推。登记：10-tech-debt.md TD-051，
--    回收条件写在那里。按 140 §偏离纪律，偏离必须在实现处引用条款、在债表记名，不得静默。
-- ═══════════════════════════════════════════════════════════════════════════

-- 分区边界列是 timestamptz，而下面的字面量是 date：转换按**执行时的会话 TimeZone**。库级默认
-- 自 2026-10-04 起钉成 UTC（00_schemas.sql 末尾 / 迁移 2026-10-05-database-timezone-utc.sql），
-- 但连接串 options / PGTZ 仍能覆盖会话值，所以这里的 SET LOCAL 是第二道锁，不是摆设。
-- 两次运行（DDL 建库那天、迁移推窗口那天）若会话 TZ
-- 不同：靠东一边会报 overlap（响），靠西一边是**静默 8 小时缺口**（缺口里的行进 _default，
-- to_regclass / 审计段 / 守卫全绿）。真库两个方向都复现过（2026-10-04 对抗审查）。所以在这里
-- 把它钉成 UTC —— 与 50_metering.sql 的汇总口径、pg-usage-rollup 的分桶键同一个时区，
-- 也是 owner 2026-10-03「默认按 UTC+0」。SET LOCAL 只管本事务，不改库级设置。
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$
DECLARE
  parts text[] := ARRAY['metering.usage_events', 'metering.usage_event_pools', 'support.audit_logs',
                        'metering.token_usage_events'];  -- #547 原始 token 用量（2026-10-04）
  -- 起点：第一条计费事件所在月，往前不需要分区。
  cover_from date := date '2026-07-01';
  -- PARTITION_COVER_UNTIL（守卫按这个名字找这一行；exclusive 上界）
  cover_until date := date '2028-02-01';
  qname text; sch text; tbl text; child text; mn date; nm date;
BEGIN
  FOREACH qname IN ARRAY parts LOOP
    sch := split_part(qname, '.', 1);
    tbl := split_part(qname, '.', 2);
    -- 按月铺到 cover_until。用 while 而不是 FOR i IN 0..N：个数与结束日期分两处写，
    -- 迟早有一处漏改，而漏改的症状是「窗口比注释说的短」—— 不报错。
    mn := cover_from;
    WHILE mn < cover_until LOOP
      nm := mn + interval '1 month';
      child := tbl || '_y' || to_char(mn, 'YYYY') || 'm' || to_char(mn, 'MM');
      IF to_regclass(format('%I.%I', sch, child)) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
          sch, child, sch, tbl, mn, nm);
      END IF;
      mn := nm;
    END LOOP;
    -- DEFAULT 兜底分区（预建漏档时不丢写）。设计上这里还该有「巡检 DEFAULT 有行 = 告警」
    -- （data_platform_200 §15.5），**那道巡检未实施** —— 见本文件头注。2026-10-04 之前这行写的是
    -- 「巡检有行=告警重分配」，与头注在同一屏里互相否定；取代要标在被取代的那一头。
    child := tbl || '_default';
    IF to_regclass(format('%I.%I', sch, child)) IS NULL THEN
      EXECUTE format('CREATE TABLE %I.%I PARTITION OF %I.%I DEFAULT', sch, child, sch, tbl);
    END IF;
  END LOOP;
END $$;
COMMIT;
