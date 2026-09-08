-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 租户菜单新增「技能工具」，并把「平台能力」改名「模型与能力」
-- （owner 2026-09-08）
--
-- console 的「模型与能力」是**租户视角的只读面**：回答「我这个工作空间现在能用哪些
-- 模型 / 技能，额度多少、用了多少」。它不回答「谁能用」「怎么配」——那些在运维平面
-- （opera）。代码上也是这个形状：console-bff 的 atlas.router 只有三个 @Get。
--
--   · tenant.menu.platform 改显示名「平台能力」→「模型与能力」
--   · tenant.menu.atlas    改显示名「模型接入」→「模型服务」
--   · 新增 tenant.menu.skills（/skills，占位页），挂 tenant.model.read
--
-- **码一律不动**：tenant.menu.platform / tenant.menu.atlas 在生产已有授权行，
-- 改码等于把已授出的权限打断。这次变的只是显示名，以及多一个子节点。
--
-- 技能与模型同码（tenant.model.read）：两者是同一类东西的两个供给方，拆成两个码
-- 会让「能看模型的人看不了技能」，而那不是任何人做过的裁定。
--
-- 幂等：整份可重跑（改名走 UPDATE、新节点走 ON CONFLICT DO UPDATE）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 改名（码不动）────────────────────────────────────────────────────────
UPDATE access.permissions SET perm_name = '模型与能力', updated_at = now()
 WHERE perm_code = 'tenant.menu.platform' AND perm_name IS DISTINCT FROM '模型与能力';

UPDATE access.permissions SET perm_name = '模型服务', updated_at = now()
 WHERE perm_code = 'tenant.menu.atlas' AND perm_name IS DISTINCT FROM '模型服务';

-- ── 新增「技能工具」菜单节点 ─────────────────────────────────────────────
INSERT INTO access.permissions (perm_code, perm_name, route_path, perm_type, icon, parent_id, sort)
SELECT v.code, v.name, v.route, 'menu', v.icon, p.id, v.sort
  FROM (VALUES
    ('tenant.menu.skills', '技能工具', '/skills', 'stack', 'tenant.menu.platform', 20)
  ) AS v(code, name, route, icon, parent_code, sort)
  JOIN access.permissions p ON p.perm_code = v.parent_code
ON CONFLICT (perm_code) DO UPDATE SET
  perm_name = excluded.perm_name, parent_id = excluded.parent_id,
  route_path = excluded.route_path, perm_type = excluded.perm_type,
  icon = excluded.icon, sort = excluded.sort, updated_at = now();

-- ── 操作码挂靠：**不需要新增** ───────────────────────────────────────────
-- 这个库里操作码是靠 access.permissions.parent_id 挂到菜单节点上的（见
-- 2026-09-10 那份迁移的第二段 UPDATE），一个操作码只能有一个父；
-- `tenant.model.read` 已经挂在 tenant.menu.atlas 下，不能也不必再挂一次。
-- 技能工具与模型服务共用这个码，靠的是两个菜单节点都要求它（perms 字段），
-- 不是靠多一条挂靠关系。
--
-- 初稿这里写了 `INSERT INTO access.permission_menu_links`——**那张表根本不存在**，
-- 是我凭印象编的表名。静态读 SQL 看不出来，本机库上真跑一遍才报
-- `relation "access.permission_menu_links" does not exist`。

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM access.permissions
   WHERE perm_code = 'tenant.menu.skills' AND route_path = '/skills';
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:tenant.menu.skills 不存在或路由不对';
  END IF;

  SELECT count(*) INTO v FROM access.permissions
   WHERE perm_code = 'tenant.menu.platform' AND perm_name = '模型与能力';
  IF v <> 1 THEN
    RAISE EXCEPTION '改名未落地:tenant.menu.platform 的显示名不是「模型与能力」';
  END IF;

  -- 码不能被改掉:这两行必须还在,否则已授出的权限就断了。
  SELECT count(*) INTO v FROM access.permissions
   WHERE perm_code IN ('tenant.menu.platform', 'tenant.menu.atlas');
  IF v <> 2 THEN
    RAISE EXCEPTION '原有菜单码丢失:平台能力/模型接入的 perm_code 不得改动';
  END IF;
END $$;

COMMIT;
