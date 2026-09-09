-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 租户菜单新增「工作空间」（owner 2026-09-09）
--
-- 背景：owner 就「两层用户只展示一次」裁定 **先把工作空间做成真轴**，而不是加第二个
-- 成员列表。在此之前工作空间是个 1:1 的隐含物——建租户时插一条 `default workspace`，
-- 之后再没有第二条，也没有任何建 / 改 / 停的入口。现在写侧有了，就该有自己一页。
--
--   · 新增 tenant.menu.tenant_workspaces（/workspaces），挂在「账号与租户」组下
--
-- **码名为什么不是 tenant.menu.workspace**：那个码已被**根域**占着
-- （`tenant.menu.workspace` = console 这个域本身）。同名会把一页挂到域上去。
--
-- **不动 tenant.workspace.manage 的归属**：操作码一码一父，它现在挂在 `/tenant`
-- 那个页面节点下。新页用它当**门**，不是再挂一行父子关系——两页共用一个码走门，
-- 是权限体系里既有的做法（perms 表达归属、不表达开门）。改归属要另作裁定。
--
-- perm_name_key / description_key 是 i18n 键，**不能省**：基线审计（30-verify 的
-- [C2]）要求 seeded 行两列都非空。命名照同族既有行：access.menu.<x> / .desc。
--
-- 幂等：整份可重跑（ON CONFLICT DO UPDATE）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO access.permissions (
  perm_code, perm_name, perm_name_key, description_key,
  route_path, perm_type, icon, parent_id, sort
)
SELECT v.code, v.name, v.name_key, v.desc_key,
       v.route, 'menu', v.icon, p.id, v.sort
  FROM (VALUES
    ('tenant.menu.tenant_workspaces', '工作空间',
     'access.menu.tenant_workspaces', 'access.menu.tenant_workspaces.desc',
     '/workspaces', 'stack', 'tenant.menu.account_tenant', 40)
  ) AS v(code, name, name_key, desc_key, route, icon, parent_code, sort)
  JOIN access.permissions p ON p.perm_code = v.parent_code
ON CONFLICT (perm_code) DO UPDATE SET
  perm_name = excluded.perm_name,
  perm_name_key = excluded.perm_name_key,
  description_key = excluded.description_key,
  parent_id = excluded.parent_id,
  route_path = excluded.route_path, perm_type = excluded.perm_type,
  icon = excluded.icon, sort = excluded.sort, updated_at = now();

-- 自检 1：节点进去了，且**挂在正确的父下**（挂错父不会报错，只会在权限树里跑到
-- 另一组底下，而那正是最难被发现的一类错）。
DO $$
DECLARE parent_code text;
BEGIN
  SELECT p.perm_code INTO parent_code
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE c.perm_code = 'tenant.menu.tenant_workspaces';
  IF parent_code IS DISTINCT FROM 'tenant.menu.account_tenant' THEN
    RAISE EXCEPTION 'tenant.menu.tenant_workspaces 的父是 %，应为 tenant.menu.account_tenant',
      coalesce(parent_code, '(无)');
  END IF;
END $$;

-- 自检 2：两个 i18n 键都非空——基线审计 [C2] 卡的就是这两列。
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM access.permissions
   WHERE perm_code = 'tenant.menu.tenant_workspaces'
     AND (coalesce(perm_name_key, '') = '' OR coalesce(description_key, '') = '');
  IF bad > 0 THEN
    RAISE EXCEPTION 'tenant.menu.tenant_workspaces 的 i18n 键为空（基线审计会红）';
  END IF;
END $$;

-- 自检 3：菜单码不该进 role_permissions（授权只按操作码走）。这条不是新规矩，
-- 是既有不变式——顺手确认这次没把它破了。
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM access.role_permissions rp
    JOIN access.permissions p ON p.id = rp.permission_id
   WHERE p.perm_code = 'tenant.menu.tenant_workspaces';
  IF bad > 0 THEN
    RAISE EXCEPTION '菜单码被授权了 % 行——菜单码不进 role_permissions', bad;
  END IF;
END $$;

COMMIT;
