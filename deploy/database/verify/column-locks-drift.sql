-- ═══════════════════════════════════════════════════════════════════════════
-- column-locks-drift.sql — 列级锁「声明 ↔ 活库」一致性断言（read-only）
--
-- 依据：2026-09-07 生产事故。98_column_locks.sql 只在 28-apply（全量 DDL）里跑，
-- 已有库永远不重放；product_330 新增的列（metering.subscriptions.paid_amount /
-- current_order_id / product_id、billing.invoices.order_id、billing.refunds.order_id
-- 等 5 张表）在生产始终没被 GRANT 给 platform_svc。履约写它们 → 42501 → 订阅已生效
-- 而订单停在 paid，且后续每次重试都撞唯一索引，永远好不了。
--
-- 为什么静态守卫看不见：scripts/guardrails/check-anchor-writes.mjs 拿应用代码比对的是
-- **仓库里的** 98 文件，文件是对的、活库是旧的——两边都"自洽"，差异只存在于第三方。
-- 这正是「消费方形态必须被跑到」：判据必须落在活库上。
--
-- 判据双向：
--   · 活库缺声明列 → 应用 UPDATE 会 42501（本次事故）
--   · 活库多出声明外的列 → 锚点列没锁住，铁律八失效（本次 billing.order_events 即是）
-- 任一方向非空即 RAISE，psql 非零退出 → 30-verify 红 → db-init run 红。
--
-- 挂载点：deploy/scripts/30-verify-platform-baseline.sh（/ddl 已挂载 DDL 目录）。
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

create temporary table lockfile_lines (line text);
-- 整行读入：用绝不会出现在 SQL 文本里的分隔/引号字节，避免逗号与引号被当作字段。
\copy lockfile_lines from '/ddl/98_column_locks.sql' with (format csv, delimiter E'\x01', quote E'\x02')

create temporary view declared_grants as
select tbl, col
  from (
    select lower((regexp_match(line, 'ON[[:space:]]+([a-z0-9_]+\.[a-z0-9_]+)[[:space:]]+TO[[:space:]]+platform_svc', 'i'))[1]) as tbl,
           unnest(
             string_to_array(
               regexp_replace(
                 (regexp_match(line, 'GRANT[[:space:]]+UPDATE[[:space:]]*\(([^)]*)\)', 'i'))[1],
                 '[[:space:]]', '', 'g'),
               ',')
           ) as col
      from lockfile_lines
     where line ~* '^[[:space:]]*GRANT[[:space:]]+UPDATE[[:space:]]*\('
  ) t
 where tbl is not null and col <> '';

create temporary view actual_grants as
select table_schema || '.' || table_name as tbl, column_name as col
  from information_schema.column_privileges
 where grantee = 'platform_svc' and privilege_type = 'UPDATE';

do $$
declare
  declared_n bigint;
  missing_txt text;
  extra_txt   text;
begin
  select count(*) into declared_n from declared_grants;
  -- 判据自身必须先站得住：解析不出任何声明 = 检查失效，抛错，绝不"通过"。
  if declared_n = 0 then
    raise exception '[column-locks-drift] 从 98_column_locks.sql 解析不到任何 GRANT —— 判据失效，拒绝给出通过结论';
  end if;

  select string_agg(t, E'\n  ') into missing_txt from (
    select d.tbl || ': ' || string_agg(d.col, ', ' order by d.col) as t
      from declared_grants d
      left join actual_grants a on a.tbl = d.tbl and a.col = d.col
     where a.col is null
     group by d.tbl order by d.tbl
  ) s;

  select string_agg(t, E'\n  ') into extra_txt from (
    select a.tbl || ': ' || string_agg(a.col, ', ' order by a.col) as t
      from actual_grants a
      left join declared_grants d on d.tbl = a.tbl and d.col = a.col
     where d.col is null
       and exists (select 1 from declared_grants y where y.tbl = a.tbl)
     group by a.tbl order by a.tbl
  ) s;

  if missing_txt is not null or extra_txt is not null then
    raise exception E'[column-locks-drift] 活库列级 GRANT 与 98_column_locks.sql 不一致：\n  缺少（应用 UPDATE 会 42501）:\n  %\n  多出（锚点列没锁住）:\n  %\n修法：CONFIRM_MIGRATE=yes bash deploy/scripts/28d-apply-migrations.sh（会重放列锁）',
      coalesce(missing_txt, '（无）'), coalesce(extra_txt, '（无）');
  end if;

  raise notice '[column-locks-drift] OK —— % 条声明列级授权与活库一致', declared_n;
end $$;
