-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 租户信息页走查(owner 2026-09-05):联系人加「称呼」
--
-- 联系人姓名后面三选一:先生 / 女士 / 未设定。落在 tenancy.tenant_contacts.salutation
-- ('mr' | 'ms' | NULL),与 title(职务)分开——title 是岗位,salutation 是称谓。
--
-- tenant_contacts 在 98 列锁之下:platform_svc 的 UPDATE 按列 GRANT,新列同时补 GRANT
-- (DDL 98_column_locks.sql 已同步)。同一轮把联系人的「国家 / 地区」从页面去掉,
-- 列(tenant_profiles.country_code)保留不动。
--
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE tenancy.tenant_contacts ADD COLUMN IF NOT EXISTS salutation varchar(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_tenant_contacts_salutation'
       AND conrelid = 'tenancy.tenant_contacts'::regclass
  ) THEN
    ALTER TABLE tenancy.tenant_contacts
      ADD CONSTRAINT chk_tenant_contacts_salutation CHECK (salutation IN ('mr', 'ms'));
  END IF;
END $$;

GRANT UPDATE (salutation) ON tenancy.tenant_contacts TO platform_svc;

DO $$
DECLARE v_grant int;
BEGIN
  SELECT count(*) INTO v_grant
    FROM information_schema.column_privileges
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts'
     AND column_name = 'salutation' AND privilege_type = 'UPDATE'
     AND grantee = 'platform_svc';
  IF v_grant = 0 THEN
    RAISE EXCEPTION '[tenant-contact-salutation] platform_svc 未获得 salutation 的 UPDATE 权';
  END IF;
  RAISE NOTICE '[tenant-contact-salutation] salutation 已加列(mr/ms CHECK),platform_svc 列级 UPDATE 已授';
END $$;

COMMIT;
