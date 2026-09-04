-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 批 5c:三个二级页面合并为「租户信息」`/tenant`
--
-- 依据:docs/20-specs/000-platform/console/20-tenant-page-design.md(owner 2026-09-05
-- 九条决策)。租户信息 `/personal-tenant` + 组织信息 `/organization` + 系统设置
-- `/settings` 合成一个二级页面 `/tenant`;个人租户与组织租户同结构。
--
-- 两件事:
--   ① 菜单树三个节点改指 `/tenant`(**不删码**——角色授权引用它们,删码即失权;
--      同批 4b 对 tenant.menu.todos 的处理)。`tenant.menu.personal_tenant` 是这一页
--      的正主,改名「租户信息」;`tenant.menu.organization` 与 `tenant.menu.settings`
--      退居其后、同样指向 `/tenant`,它们的操作码绑定原样保留。整树的最终清理归批 8。
--   ② kyc.tenant_verifications.status 增加 `superseded`(作废):组织租户改名后原企业
--      认证即作废、需重新认证(设计 §5.1);认证记录留在历史里,租户侧的
--      tenants.verification_status 回 `unverified`,故 20_tenancy 的 CHECK 不动。
--
-- 幂等:整份可重跑。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 菜单树改指 /tenant(与 seed-catalog.mjs、core-utils tenant-permissions.ts 同源)
UPDATE access.permissions
   SET perm_name = '租户信息', route_path = '/tenant', updated_at = now()
 WHERE perm_code = 'tenant.menu.personal_tenant';

UPDATE access.permissions
   SET route_path = '/tenant', updated_at = now()
 WHERE perm_code IN ('tenant.menu.organization', 'tenant.menu.settings');

-- ② 认证状态增加「已作废」
ALTER TABLE kyc.tenant_verifications DROP CONSTRAINT IF EXISTS chk_tenant_verifications_status;
ALTER TABLE kyc.tenant_verifications
  ADD CONSTRAINT chk_tenant_verifications_status
  CHECK (status IN ('unverified','pending','verified','rejected','superseded'));

-- 后置断言:三个节点都已改指,且 superseded 可写。
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM access.permissions
   WHERE perm_code IN ('tenant.menu.personal_tenant','tenant.menu.organization','tenant.menu.settings')
     AND route_path IS DISTINCT FROM '/tenant';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '[tenant-page-merge] 仍有 % 个菜单节点未改指 /tenant', v_bad;
  END IF;
  RAISE NOTICE '[tenant-page-merge] 菜单节点已改指 /tenant;认证状态已含 superseded';
END $$;

COMMIT;
