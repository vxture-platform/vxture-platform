-- ═══════════════════════════════════════════════════════════════════════════
-- database-timezone.sql — 库级会话时区默认 = UTC 的硬断言（read-only）
--
-- 依据：owner 裁定 4（2026-10-04）「用量日表时区，默认按照 UTC+0」。默认长在被连的那一头
-- （ALTER DATABASE … SET timezone = 'UTC'：00_schemas.sql 末尾 + 迁移 2026-10-05-database-timezone-utc.sql）。
-- 那份迁移在非 owner 账号下只告警不中断——一条权限问题不该卡住整条 migrate 链——所以缺口
-- 必须有一处**每次 verify 都会红**的地方，就是这里。
--
-- 判据：pg_db_role_setting（共享目录，reporting_ro 也读得到）里本库（setdatabase = 本库 oid）、
-- 全角色（setrole = 0）的 setconfig 含 'TimeZone=UTC'。只认库级默认，不认当前会话的
-- show timezone——会话值可能来自 PGTZ / 连接串 options，那是「这一条连接」碰巧是 UTC，不是「默认」。
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
       AND 'TimeZone=UTC' = ANY (s.setconfig)
  ) THEN
    RAISE EXCEPTION '[tz] database-level TimeZone=UTC is NOT set on % — run as the DB owner: ALTER DATABASE % SET timezone = ''UTC''; then recreate platform-api so its pool opens new sessions',
      current_database(), quote_ident(current_database());
  END IF;
  RAISE NOTICE '[tz] database-level TimeZone=UTC OK on %', current_database();
END $$;
