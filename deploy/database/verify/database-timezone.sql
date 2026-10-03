-- ═══════════════════════════════════════════════════════════════════════════
-- database-timezone.sql — 库级会话时区默认 = UTC 的硬断言（read-only）
--
-- 依据：owner 裁定 4（2026-10-04）「用量日表时区，默认按照 UTC+0」。默认长在被连的那一头
-- （ALTER DATABASE … SET timezone = 'UTC'：00_schemas.sql 末尾 + 迁移 2026-10-05-database-timezone-utc.sql）。
-- 那份迁移在非 owner 账号下只告警不中断——一条权限问题不该卡住整条 migrate 链——所以缺口
-- 必须有一处**每次 verify 都会红**的地方，就是这里。
--
-- 判据：pg_db_role_setting（共享目录，reporting_ro 也读得到）里本库（setdatabase = 本库 oid）、
-- 全角色（setrole = 0）的 setconfig 含 TimeZone=UTC 或 TimeZone=Etc/UTC（不分大小写）。
-- 只认库级默认，不认当前会话的 show timezone——会话值可能来自 PGTZ / 连接串 options，那是
-- 「这一条连接」碰巧是 UTC，不是「默认」。
--
-- 拼法：**规范写法是 'UTC'**（迁移与 00_schemas.sql 写的就是它）；'Etc/UTC' 同为 UTC+0 无 DST，
-- RDS owner 手工设的可能是这一种，非 owner 路径下迁移不会覆写它，这里与 platform-api 的启动
-- 自检（database-timezone.check.ts，UTC_SPELLINGS）必须认同一个集合，否则两道门对同一事实
-- 各说各话（2026-10-04 审查）。pg 原样存拼法（'utc' 存成 TimeZone=utc）、show 时才规范化，所以比
-- 较不分大小写。GMT / UTC0 这类不认：与启动自检同口径，别各自加。
--
-- 挂载点：deploy/scripts/30-verify-platform-baseline.sh（/verify 已挂载本目录）。
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_db_role_setting s
      JOIN pg_database d ON d.oid = s.setdatabase
     WHERE d.datname = current_database()
       AND s.setrole = 0
       AND EXISTS (
         SELECT 1 FROM unnest(s.setconfig) AS c
          WHERE lower(c) IN ('timezone=utc', 'timezone=etc/utc')
       )
  ) THEN
    RAISE EXCEPTION '[tz] database-level TimeZone=UTC is NOT set on % — run as the DB owner: ALTER DATABASE % SET timezone = ''UTC''; then recreate platform-api so its pool opens new sessions',
      current_database(), quote_ident(current_database());
  END IF;
  RAISE NOTICE '[tz] database-level TimeZone=UTC OK on %', current_database();
END $$;
