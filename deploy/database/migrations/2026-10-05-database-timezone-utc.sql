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
-- 作用面（二）——RDS 今天若不是 UTC，钉成 UTC 后下面这些**会话依赖**的 SQL 跟着变（裁定 4 设计 §2.3，
-- 逐条按仓里 file:line 核过，2026-10-04；此前只写在提交信息里）。假设原会话是 Asia/Shanghai：
--   · 变得正确：bff/admin-bff/src/routers/tenants.router.ts:1610 当前月键 to_char(now(),'YYYYMM')
--     ——月表是 UTC 键，原来每月 1 日 00:00–08:00 北京时间读的是「下个月」键，拿到 0；
--   · 「本月」从北京月变 UTC 月（首日多/少 8 小时）：tenants.router.ts:1438-1439、
--     services/commerce/billing/src/repository/pg-billing.repository.ts:103-104；
--   · 「今天」同理：bff/arche-bff/src/routers/governance-overview.router.ts:124、
--     services/notification/notice/src/repository/pg-notice.repository.ts:97（digest 的「今天读过」）；
--   · **落库值变化**：services/commerce/subscription/src/repository/pg-order.repository.ts:316-317
--     的 bill_cycle / cycle_start_date / cycle_end_date（now()::date）、pg-addon.repository.ts:171 的 YYYYMM
--     ——北京 00:00–08:00 下的单，日期少一天。账单周期本就应锚定订阅；要不要改成显式 at time zone
--     **待 owner 定**（同批未做；登记见 10-tech-debt.md TD-051 的 2026-10-04 注）；
--   · 装饰性：bff/admin-bff/src/routers/payments.router.ts:148、bff/console-bff/src/routers/subscription.router.ts:2379
--     单号前缀里的日期；
--   · ::text 读出的 timestamptz 文本偏移从 +08 变 +00（new Date() 两种都正确解析；有 .slice(0,10) 取日期的
--     消费方会变——未逐个读）。
--   RDS 今天已是 UTC 则以上全部无变化，本迁移只是把运气固化成约定。
--
-- 权限：ALTER DATABASE … SET 需要库 owner。28d 用 rds-owner.env / platform.env 的账号跑，通常是 owner；
-- 若不是，这里**只告警、不中断**迁移链（WARNING 里给出 owner 该跑的那一句），随后的自检用 NOTICE 说明
-- 现状。硬断言不在这里：deploy/database/verify/database-timezone.sql 由 30-verify 每次跑，缺了就红。
--
-- 新库不跑迁移（DDL + seed 直建）：同一句已在 00_schemas.sql 末尾；本迁移只服务存量库。
-- 幂等：ALTER DATABASE SET 重跑是覆写同值，无副作用；pg_db_role_setting 两遍之间不变。
-- 拼法：规范写法是 'UTC'（本迁移写的）；自检与 30-verify 同时认 'Etc/UTC'（RDS owner 手工设过、非 owner
-- 路径下不会被覆写），两处与 platform-api 启动自检同一个集合，不分大小写。
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
       AND EXISTS (
         SELECT 1 FROM unnest(s.setconfig) AS c
          WHERE lower(c) IN ('timezone=utc', 'timezone=etc/utc')
       )
  ) THEN
    RAISE NOTICE '[tz] database-level TimeZone=UTC is set on %', current_database();
  ELSE
    RAISE NOTICE '[tz] database-level TimeZone=UTC is NOT set on % (30-verify stays red until the DB owner runs: ALTER DATABASE % SET timezone = ''UTC'';)',
      current_database(), quote_ident(current_database());
  END IF;
END $$;
