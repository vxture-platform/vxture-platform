-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 租户信息页走查修正(owner 2026-09-05):租户加「简称」
--
-- 与用户的 account / display_name 同构:`name` 是认证名(改名即作废企业认证,批 5c),
-- `display_name` 是日常展示名(侧栏、租户面板、身份卡标题),自由改。新建租户两者相同,
-- 存量回填 display_name = name。
--
-- tenancy.tenants 在 98 列锁之下:platform_svc 的 UPDATE 是按列 GRANT 的,新列不进
-- GRANT 就会 42501 整条回滚——这里同时补 GRANT(DDL 98_column_locks.sql 已同步)。
--
-- 联系人关联成员用的是 tenancy.tenant_contacts.user_id(已有列、已在 GRANT 里),不动表。
--
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE tenancy.tenants ADD COLUMN IF NOT EXISTS display_name varchar(96);

UPDATE tenancy.tenants
   SET display_name = name
 WHERE display_name IS NULL;

GRANT UPDATE (display_name) ON tenancy.tenants TO platform_svc;

DO $$
DECLARE v_null int; v_grant int;
BEGIN
  SELECT count(*) INTO v_null FROM tenancy.tenants WHERE display_name IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION '[tenant-display-name] 仍有 % 行 display_name 为空', v_null;
  END IF;

  SELECT count(*) INTO v_grant
    FROM information_schema.column_privileges
   WHERE table_schema = 'tenancy' AND table_name = 'tenants'
     AND column_name = 'display_name' AND privilege_type = 'UPDATE'
     AND grantee = 'platform_svc';
  IF v_grant = 0 THEN
    RAISE EXCEPTION '[tenant-display-name] platform_svc 未获得 display_name 的 UPDATE 权';
  END IF;

  RAISE NOTICE '[tenant-display-name] display_name 已加列并回填,platform_svc 列级 UPDATE 已授';
END $$;

COMMIT;
