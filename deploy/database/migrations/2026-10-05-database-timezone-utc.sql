-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 平台库会话时区默认钉成 UTC（owner 裁定 4，2026-10-04：「用量日表时区，默认按照 UTC+0」）
--
-- 背景：仓里 13 个 Pool 工厂、psql、seed、迁移都不钉会话 TimeZone，全看 RDS 参数组。真库复现：
-- pg-usage-rollup 的「hours → days」窗口谓词 `date - interval '35 days'` 是 timestamp（无时区），
-- 与 timestamptz 比较时按会话 TimeZone 解释——Asia/Shanghai 会话下每天把 UTC 第 D-36 天改写成
-- 只含 16:00–23:59Z 的 8 小时合计，次日滑出窗口再不重算；周/月/年从天表再算，残缺向上传播。
-- 代码侧已同批修成与会话无关（显式 ::timestamp at time zone 'UTC' + 事务内 SET LOCAL TIME ZONE 'UTC'）；
-- 本迁移把「默认 UTC」长在被连的那一头：任何客户端的新会话都继承，不必在每个连的那一头各接一次。
--
-- 作用面：只对**新会话**生效。迁移跑完后 platform-api 的池要重建（33-recreate-service.sh platform-api）
-- 或等下一次 deploy；db-init 本身不重建容器。
--
-- 权限：ALTER DATABASE … SET 需要库 owner。28d 用 rds-owner.env / platform.env 的账号跑，通常是 owner；
-- 若不是，这里**只告警、不中断**迁移链（WARNING 里给出 owner 该跑的那一句），随后的自检用 NOTICE 说明
-- 现状。硬断言不在这里：deploy/database/verify/database-timezone.sql 由 30-verify 每次跑，缺了就红。
--
-- 新库不跑迁移（DDL + seed 直建）：同一句已在 00_schemas.sql 末尾；本迁移只服务存量库。
-- 幂等：ALTER DATABASE SET 重跑是覆写同值，无副作用；pg_db_role_setting 两遍之间不变。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'UTC');
  RAISE NOTICE '[tz] ALTER DATABASE % SET timezone = UTC done (new sessions only)', current_database();
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING '[tz] role % is not the owner of database %; database-level TimeZone left unchanged. Run as the DB owner: ALTER DATABASE % SET timezone = ''UTC'';',
      current_user, current_database(), quote_ident(current_database());
END $$;

-- 自检：只说明现状，不中断（硬断言在 30-verify 的 database-timezone.sql）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_db_role_setting s
      JOIN pg_database d ON d.oid = s.setdatabase
     WHERE d.datname = current_database()
       AND s.setrole = 0
       AND 'TimeZone=UTC' = ANY (s.setconfig)
  ) THEN
    RAISE NOTICE '[tz] database-level TimeZone=UTC is set on %', current_database();
  ELSE
    RAISE NOTICE '[tz] database-level TimeZone=UTC is NOT set on % (30-verify stays red until the DB owner runs: ALTER DATABASE % SET timezone = ''UTC'';)',
      current_database(), quote_ident(current_database());
  END IF;
END $$;
