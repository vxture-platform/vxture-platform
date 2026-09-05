-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 批 8:菜单树遗留节点清理
--
-- 依据:docs/70-workplan/61-console-module-inventory.md 批 8。四个租户侧菜单节点的页面
-- 早已并入别处、路由只剩跳转,节点却一直留着(各批都注明「整树清理归批 8」):
--   tenant.menu.todos         /todos     → 批 4b 并入 /inbox(待办与消息)
--   tenant.menu.security      /security  → 批 5a 并入 /profile
--   tenant.menu.organization  /tenant    → 批 5c 与 personal_tenant 同指一页
--   tenant.menu.settings      /tenant    → 批 5c 同上
-- 另:admin.menu.model_access(/model-grants「模型授权」)的页面随 #129 退役,节点未摘。
--
-- 为什么现在能删:租户侧**菜单码不进 role_permissions**(seed-catalog 注释:前端按操作码
-- 门控,菜单行只承载层级),本地与生产实测四码授权行均为 0——删码不影响任何人的权限。
-- 它们挂着的三个操作码先改挂到存活节点「租户信息」(tenant.menu.personal_tenant),
-- 与页面实际归属一致(策略卡与危险操作都在 /tenant)。
--
-- 顺带把 tenant.menu.inbox 从「高级设置」搬到「工作空间」并改名「待办与消息」——
-- 侧栏(navigation.ts)自批 4b 起就是这样放的,库里的树一直没跟上。
--
-- 幂等:整份可重跑。与 seed-catalog.mjs / core-utils tenant-permissions.ts 同源
-- (守卫 lint:permission-catalog 三处比对,本次起菜单节点 25 → 21)。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 三个操作码改挂「租户信息」
UPDATE access.permissions c
   SET parent_id = p.id, updated_at = now()
  FROM access.permissions p
 WHERE p.perm_code = 'tenant.menu.personal_tenant'
   AND c.perm_code IN ('tenant.settings.manage', 'tenant.workspace.manage', 'tenant.delete')
   AND c.parent_id IS DISTINCT FROM p.id;

-- ② 「站内消息」→「待办与消息」,搬到工作空间,排在总览之后
UPDATE access.permissions c
   SET parent_id = p.id,
       perm_name = '待办与消息',
       description = '待办与消息',
       sort = 20,
       updated_at = now()
  FROM access.permissions p
 WHERE p.perm_code = 'tenant.menu.workspace'
   AND c.perm_code = 'tenant.menu.inbox'
   AND (c.parent_id IS DISTINCT FROM p.id OR c.perm_name <> '待办与消息' OR c.sort <> 20);

-- ③ 删四个节点。先断言它们已无子节点(①② 之后应为 0),再删;role_permissions 级联。
DO $$
DECLARE v_children int;
BEGIN
  SELECT count(*) INTO v_children
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE p.perm_code IN ('tenant.menu.todos', 'tenant.menu.security',
                         'tenant.menu.organization', 'tenant.menu.settings');
  IF v_children > 0 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] 待删节点下仍有 % 个子节点,先改挂再删', v_children;
  END IF;
END $$;

DELETE FROM access.permissions
 WHERE perm_code IN ('tenant.menu.todos', 'tenant.menu.security',
                     'tenant.menu.organization', 'tenant.menu.settings');

-- ④ admin:模型授权节点(#129 已删页面)。角色映射表无级联,先删映射再删节点。
DELETE FROM admin.operator_role_permission
 WHERE permission_id IN (SELECT id FROM admin.operator_permission WHERE perm_code = 'admin.menu.model_access');
DELETE FROM admin.operator_permission WHERE perm_code = 'admin.menu.model_access';

-- ⑤ 后置断言
DO $$
DECLARE n_menu int; n_bad_parent int; n_left int; n_inbox_ok int; n_admin int;
BEGIN
  SELECT count(*) INTO n_menu FROM access.permissions WHERE perm_type = 'menu';
  IF n_menu <> 21 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] expected 21 menu nodes, found %', n_menu;
  END IF;

  SELECT count(*) INTO n_bad_parent
    FROM access.permissions c
    LEFT JOIN access.permissions p ON p.id = c.parent_id
   WHERE c.perm_code IN ('tenant.settings.manage', 'tenant.workspace.manage', 'tenant.delete')
     AND p.perm_code IS DISTINCT FROM 'tenant.menu.personal_tenant';
  IF n_bad_parent > 0 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] % 个操作码未挂到 tenant.menu.personal_tenant', n_bad_parent;
  END IF;

  SELECT count(*) INTO n_inbox_ok
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE c.perm_code = 'tenant.menu.inbox' AND p.perm_code = 'tenant.menu.workspace';
  IF n_inbox_ok <> 1 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] tenant.menu.inbox 未挂到 tenant.menu.workspace';
  END IF;

  SELECT count(*) INTO n_left FROM access.permissions
   WHERE perm_code IN ('tenant.menu.todos', 'tenant.menu.security',
                       'tenant.menu.organization', 'tenant.menu.settings');
  IF n_left > 0 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] 仍有 % 个遗留节点', n_left;
  END IF;

  SELECT count(*) INTO n_admin FROM admin.operator_permission WHERE perm_code = 'admin.menu.model_access';
  IF n_admin > 0 THEN
    RAISE EXCEPTION '[menu-tree-cleanup] admin.menu.model_access 仍在';
  END IF;

  RAISE NOTICE '[menu-tree-cleanup] 菜单节点 % 个;四个遗留节点已删,三个操作码已挂到租户信息,待办与消息已归工作空间;admin 模型授权节点已摘', n_menu;
END $$;

COMMIT;
