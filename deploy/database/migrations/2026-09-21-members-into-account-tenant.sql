-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — console 批 9:租户管理体系收敛(「成员与权限」整组撤销)
--
-- 依据:owner 2026-09-06 裁定 —— 租户侧最终只留三个板块「账号信息 / 租户信息 /
-- 成员管理」,都在「账户与租户」分组下:
--   tenant.menu.members_permissions 「成员与权限」分组   → 撤销
--   tenant.menu.members  /members   「成员管理」          → 改挂「账户与租户」
--   tenant.menu.invitations /invitations 「邀请记录」     → 并成成员管理页里的一段
--   tenant.menu.roles    /roles     「角色管理」          → 成员管理的二级页 /members/roles
-- 二级页不进菜单树(树只收侧栏那一层,`/tenant/verification` 同例),故两个页面节点
-- 连同它们的分组一起退役;旧地址 /roles 与 /invitations 仅保留跳转。
--
-- 为什么能删:租户侧**菜单码不进 role_permissions**(seed-catalog 注释:前端按操作码
-- 门控,菜单行只承载层级),三码授权行本就为 0——删码不改变任何人的权限。成员管理
-- 挂着的三个操作码(member.read / member.manage / role.assign)随节点一起搬,页面
-- 门与 BFF 守卫读的是这三个码,不受菜单层级影响。
--
-- 幂等:整份可重跑。注意生产 migrate 每次重放全部迁移文件,2026-09-10 那份会把
-- 三个节点连同分组重新建出来,本份再删一次——顺序(09-10 → 09-15 → 09-21)保证收敛。
-- 与 seed-catalog.mjs / core-utils tenant-permissions.ts 同源(守卫 lint:permission-catalog
-- 三处比对,本次起菜单节点 21 → 18)。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 成员管理改挂「账户与租户」,排在账号信息、租户信息之后(同级序号 10/20/30)
UPDATE access.permissions c
   SET parent_id = p.id, sort = 30, updated_at = now()
  FROM access.permissions p
 WHERE p.perm_code = 'tenant.menu.account_tenant'
   AND c.perm_code = 'tenant.menu.members'
   AND (c.parent_id IS DISTINCT FROM p.id OR c.sort <> 30);

-- ①b 顶层分组少了一个,后面三组的同级序号跟着补齐——seed 给同级的是 (序号+1)*10,
--    不补的话存量库是 10/20/40/50/60、新库是 10/20/30/40/50,同一棵树两个样子。
--    「高级设置」下的两条是批 8 搬走 inbox 时留下的同类空档(30/40 → 10/20),顺手补上。
UPDATE access.permissions SET sort = v.sort, updated_at = now()
  FROM (VALUES ('tenant.menu.workspace', 10),
               ('tenant.menu.account_tenant', 20),
               ('tenant.menu.subscription_billing', 30),
               ('tenant.menu.advanced_settings', 40),
               ('tenant.menu.platform', 50),
               ('tenant.menu.notifications', 10),
               ('tenant.menu.audit_logs', 20)) AS v(code, sort)
 WHERE access.permissions.perm_code = v.code
   AND access.permissions.sort <> v.sort;

-- ② 删三个节点前先断言:它们底下不再挂着**要留下的**东西(① 之后成员管理已搬走,
--    roles / invitations 本就没挂操作码——它俩自己是 members_permissions 的子节点,
--    一起删,所以不算)。还有则说明有码没改挂,宁可停下。
DO $$
DECLARE v_children int;
BEGIN
  SELECT count(*) INTO v_children
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE p.perm_code IN ('tenant.menu.members_permissions',
                         'tenant.menu.roles', 'tenant.menu.invitations')
     AND c.perm_code NOT IN ('tenant.menu.roles', 'tenant.menu.invitations');
  IF v_children > 0 THEN
    RAISE EXCEPTION '[members-into-account-tenant] 待删节点下仍有 % 个要保留的子节点,先改挂再删', v_children;
  END IF;
END $$;

DELETE FROM access.permissions
 WHERE perm_code IN ('tenant.menu.members_permissions',
                     'tenant.menu.roles', 'tenant.menu.invitations');

-- ③ 后置断言
DO $$
DECLARE n_menu int; n_parent_ok int; n_left int; n_perms int; n_sort int;
BEGIN
  SELECT count(*) INTO n_menu FROM access.permissions WHERE perm_type = 'menu';
  -- 这里**不做**「全库菜单节点应为 N 个」这类绝对计数断言。
  -- 2026-09-09 实测:三份迁移各写了一条(25 / 21 / 18),而 `migrate` 是**全量重放**
  -- ——每份跑在最终状态上,而不是它当年被写下时的那个状态。新增任何一个菜单节点,
  -- 这三条会一起炸(那天 tenant.menu.skills 就把它们全顶偏了 1)。
  -- 全局计数也证明不了本迁移做对了什么:它是一张无关状态的快照。
  -- 本块下面那些**按本迁移职责**写的断言才是判据,它们与全库有多少节点无关。

  SELECT count(*) INTO n_parent_ok
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE c.perm_code = 'tenant.menu.members' AND p.perm_code = 'tenant.menu.account_tenant';
  IF n_parent_ok <> 1 THEN
    RAISE EXCEPTION '[members-into-account-tenant] tenant.menu.members 未挂到 tenant.menu.account_tenant';
  END IF;

  -- 三个操作码仍挂在成员管理下:页面门与 BFF 守卫读的就是它们
  SELECT count(*) INTO n_perms
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE p.perm_code = 'tenant.menu.members'
     AND c.perm_code IN ('tenant.member.read', 'tenant.member.manage', 'tenant.role.assign');
  IF n_perms <> 3 THEN
    RAISE EXCEPTION '[members-into-account-tenant] 成员管理下的操作码应为 3 个,实为 %', n_perms;
  END IF;

  SELECT count(*) INTO n_left FROM access.permissions
   WHERE perm_code IN ('tenant.menu.members_permissions',
                       'tenant.menu.roles', 'tenant.menu.invitations');
  IF n_left > 0 THEN
    RAISE EXCEPTION '[members-into-account-tenant] 仍有 % 个已退役节点', n_left;
  END IF;

  -- 同级序号与 seed 一致(顶层 10..50、高级设置下 10/20),存量库与新库一棵树
  SELECT count(*) INTO n_sort FROM access.permissions p
    JOIN (VALUES ('tenant.menu.workspace', 10),
                 ('tenant.menu.account_tenant', 20),
                 ('tenant.menu.subscription_billing', 30),
                 ('tenant.menu.advanced_settings', 40),
                 ('tenant.menu.platform', 50),
                 ('tenant.menu.notifications', 10),
                 ('tenant.menu.audit_logs', 20)) AS v(code, sort) ON v.code = p.perm_code
   WHERE p.sort = v.sort;
  IF n_sort <> 7 THEN
    RAISE EXCEPTION '[members-into-account-tenant] 同级序号未补齐,对上的只有 % 个', n_sort;
  END IF;

  RAISE NOTICE '[members-into-account-tenant] 菜单节点 % 个;成员与权限分组已撤销,成员管理已归账户与租户,三个操作码随之,角色/邀请两节点退役', n_menu;
END $$;

COMMIT;
