-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 租户信息页走查(owner 2026-09-05,第四轮):主管理员与账号同构
--
-- 1. 联系人的「称呼」改为「性别」:与账号个人信息表的 gender 同构(male / female / NULL),
--    列 tenancy.tenant_contacts.salutation → gender,取值 mr → male、ms → female。
--    (昨天刚加的列、无真实数据;改名而不是并存,免得两套值域。)
-- 2. 地址改两段:tenancy.tenant_profiles 加 address2(地址二),address 仍是地址一。
--
-- 两表都在 98 列锁之下:新列 / 改名列同时补 platform_svc 的列级 GRANT(DDL 已同步)。
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 一、地址二 ──
ALTER TABLE tenancy.tenant_profiles ADD COLUMN IF NOT EXISTS address2 varchar(255);
GRANT UPDATE (address2) ON tenancy.tenant_profiles TO platform_svc;

-- ── 二、联系人 salutation → gender ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts' AND column_name = 'salutation')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts' AND column_name = 'gender') THEN
    ALTER TABLE tenancy.tenant_contacts RENAME COLUMN salutation TO gender;
  END IF;
END $$;

-- 两列并存:09-17 在改名之后又被整轮重跑、把 salutation 加了回来(2026-09-05 生产实测;
-- 09-17 已改成 gender 存在即跳过,这里再兜一层)。把 salutation 里的值并入 gender
-- (gender 为空时才取),再连同它的 CHECK 一起删掉,后面的断言才成立。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts' AND column_name = 'salutation')
     AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts' AND column_name = 'gender') THEN
    UPDATE tenancy.tenant_contacts
       SET gender = CASE salutation WHEN 'mr' THEN 'male' WHEN 'ms' THEN 'female' END
     WHERE gender IS NULL AND salutation IN ('mr', 'ms');
    ALTER TABLE tenancy.tenant_contacts DROP CONSTRAINT IF EXISTS chk_tenant_contacts_salutation;
    ALTER TABLE tenancy.tenant_contacts DROP COLUMN salutation;
    RAISE NOTICE '[contact-gender] salutation 与 gender 并存:已并入 gender 并删除 salutation';
  END IF;
END $$;

ALTER TABLE tenancy.tenant_contacts DROP CONSTRAINT IF EXISTS chk_tenant_contacts_salutation;

UPDATE tenancy.tenant_contacts
   SET gender = CASE gender WHEN 'mr' THEN 'male' WHEN 'ms' THEN 'female' ELSE NULL END
 WHERE gender IS NOT NULL AND gender NOT IN ('male', 'female');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_tenant_contacts_gender'
       AND conrelid = 'tenancy.tenant_contacts'::regclass
  ) THEN
    ALTER TABLE tenancy.tenant_contacts
      ADD CONSTRAINT chk_tenant_contacts_gender CHECK (gender IN ('male', 'female'));
  END IF;
END $$;

GRANT UPDATE (gender) ON tenancy.tenant_contacts TO platform_svc;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts'
     AND column_name = 'gender' AND privilege_type = 'UPDATE' AND grantee = 'platform_svc';
  IF v = 0 THEN RAISE EXCEPTION '[contact-gender] platform_svc 未获得 gender 的 UPDATE 权'; END IF;
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_profiles'
     AND column_name = 'address2' AND privilege_type = 'UPDATE' AND grantee = 'platform_svc';
  IF v = 0 THEN RAISE EXCEPTION '[contact-gender] platform_svc 未获得 address2 的 UPDATE 权'; END IF;
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema = 'tenancy' AND table_name = 'tenant_contacts' AND column_name = 'salutation';
  IF v > 0 THEN RAISE EXCEPTION '[contact-gender] salutation 列仍在'; END IF;
  RAISE NOTICE '[contact-gender] tenant_contacts.gender(male/female)与 tenant_profiles.address2 已就位,列级 UPDATE 已授';
END $$;

COMMIT;
