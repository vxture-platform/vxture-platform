-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 账号信息页「设为默认」租户(owner 2026-09-05,第八轮走查)
--
-- 账号信息页所在租户展开区,每个租户名称右侧可「设为默认」:作用在**每次登录后默认
-- 进入的租户**。落在成员关系上而不是账号资料上:默认租户只对「本人是其成员」的
-- 租户有意义,成员关系没了(退出 / 租户注销)默认自然消失,登录解析回落到个人租户。
--
--   tenancy.tenant_memberships.is_default boolean NOT NULL DEFAULT false
--   部分唯一索引:每用户至多一条 is_default
--
-- 表在 98 列锁之下:同时补 platform_svc 的列级 GRANT(DDL 已同步)。
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE tenancy.tenant_memberships
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_one_default_per_user
  ON tenancy.tenant_memberships (user_id) WHERE is_default;

GRANT UPDATE (is_default) ON tenancy.tenant_memberships TO platform_svc;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_memberships' AND column_name = 'is_default';
  IF v = 0 THEN RAISE EXCEPTION '[membership-default] tenant_memberships.is_default 未就位'; END IF;
  SELECT count(*) INTO v FROM pg_indexes
   WHERE schemaname = 'tenancy' AND tablename = 'tenant_memberships'
     AND indexname = 'uq_tenant_memberships_one_default_per_user';
  IF v = 0 THEN RAISE EXCEPTION '[membership-default] 部分唯一索引未就位'; END IF;
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_memberships'
     AND column_name = 'is_default' AND privilege_type = 'UPDATE' AND grantee = 'platform_svc';
  IF v = 0 THEN RAISE EXCEPTION '[membership-default] platform_svc 未获得 is_default 的 UPDATE 权'; END IF;
  RAISE NOTICE '[membership-default] tenant_memberships.is_default 已就位(每用户至多一条),列级 UPDATE 已授';
END $$;

COMMIT;
