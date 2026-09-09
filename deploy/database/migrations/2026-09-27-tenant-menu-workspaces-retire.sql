-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 撤销侧栏「工作空间」节点，入口收进租户信息页的身份卡
--
-- 依据：owner 2026-09-10 裁定 —— 工作空间是**租户的结构属性**（和「租户叫什么、
-- 谁是所有者、有几个成员」同一类），本来就该从租户信息页进；侧栏那一层是「我每天
-- 要去的地方」，工作空间不是。
--
-- 身份卡上早就有一块可折叠的工作空间清单（名字 + 默认徽标 + 可视码），只是**点不动**；
-- 这次给它接上「管理 →」，跳 `/workspaces`。页面本身保留：它是集合页、动作立即生效，
-- 不能塞进租户信息那张带「保存 / 放弃」的表单页（停用一个空间再点「放弃」，
-- 人有充分理由以为撤销了，而它不会）。
--
--   tenant.menu.tenant_workspaces  /workspaces  → 退役（节点撤销，页面与路由保留）
--
-- 为什么能删：租户侧**菜单码不进 role_permissions**（seed-catalog 注释：前端按操作码
-- 门控，菜单行只承载层级），该码授权行本就为 0——删码不改变任何人的权限。
-- `/workspaces` 的门读的是 `tenant.member.read`（看）与 `tenant.workspace.manage`
-- （建 / 改 / 停用），两者都挂在别处，不受这个节点影响。
--
-- 它是 2026-09-26 那份刚加的：一加一退两条迁移都留在历史里。生产 migrate 每次重放
-- 全部迁移文件，顺序（09-26 建 → 09-27 删）保证收敛。
--
-- 幂等：整份可重跑。
-- 与 seed-catalog.mjs / core-utils tenant-permissions.ts 同源
--（守卫 lint:permission-catalog 三处比对）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 先确认它没有被授权过（菜单码本不该进 role_permissions）。有的话说明这条
--    「删码不影响权限」的前提不成立，宁可停下也不能静默删掉别人的权限行。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM access.role_permissions rp
    JOIN access.permissions p ON p.id = rp.permission_id
   WHERE p.perm_code = 'tenant.menu.tenant_workspaces';
  IF n > 0 THEN
    RAISE EXCEPTION '[tenant-menu-workspaces-retire] 该菜单码有 % 行授权，前提不成立', n;
  END IF;
END $$;

-- ② 它不该有子节点（叶子）。有的话删掉它会把子树孤儿化。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE p.perm_code = 'tenant.menu.tenant_workspaces';
  IF n > 0 THEN
    RAISE EXCEPTION '[tenant-menu-workspaces-retire] 该节点还有 % 个子节点', n;
  END IF;
END $$;

DELETE FROM access.permissions WHERE perm_code = 'tenant.menu.tenant_workspaces';

-- ③ 自检：真的没了。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM access.permissions
   WHERE perm_code = 'tenant.menu.tenant_workspaces';
  IF n <> 0 THEN
    RAISE EXCEPTION '[tenant-menu-workspaces-retire] 节点仍在（% 行）', n;
  END IF;
END $$;

-- ④ 反向自检：**别的**菜单节点没被误删。上面那条 DELETE 按 perm_code 精确匹配，
--    但「只断言目标没了」的话，一条 `DELETE FROM access.permissions` 也能过。
DO $$
DECLARE n_menu int;
BEGIN
  SELECT count(*) INTO n_menu FROM access.permissions WHERE perm_type = 'menu';
  IF n_menu < 15 THEN
    RAISE EXCEPTION '[tenant-menu-workspaces-retire] 菜单节点只剩 % 个，删多了', n_menu;
  END IF;
  RAISE NOTICE '[tenant-menu-workspaces-retire] 菜单节点 % 个；工作空间入口收进租户信息页身份卡', n_menu;
END $$;

COMMIT;
