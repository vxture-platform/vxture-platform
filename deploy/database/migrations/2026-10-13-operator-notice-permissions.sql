-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-13-operator-notice-permissions.sql
--
-- 把运营通告的三个码灌进已有库。
--
-- ── 为什么需要这一份 ──
-- 码写在 deploy/database/seed/seed-catalog.mjs 里，而 `db-init action=migrate`
-- **只重放迁移、不重放 seed**。2026-09-20 实测：跑完 2026-10-12-operator-notices
-- 之后两张表就位（124 张，审计 PASSED），但 super_admin 仍是 151/151 而不是 154
-- ——码一个都没进去。表在而码不在的后果不是 500（表有），是 opera 的「运营通告」
-- 菜单项根本不出现、发布接口一律 403。
--
-- 存量库靠这一份，全新库靠 seed，两条路落同一组行。
--
-- 全部幂等：migrate 是全量重放，这份脚本会被反复执行。
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. 前置断言 ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.operator_account WHERE username = 'systemadmin') THEN
    RAISE EXCEPTION '[operator-notice-perms] 找不到 systemadmin 锚点账号';
  END IF;
  -- 菜单节点要挂在 opera 的「运维」分组下；那一组由 2026-10-03 建。
  IF NOT EXISTS (SELECT 1 FROM admin.operator_permission WHERE perm_code = 'opera.menu.ops_maintenance') THEN
    RAISE EXCEPTION '[operator-notice-perms] 找不到 opera.menu.ops_maintenance（先跑 2026-10-03-operator-three-planes）';
  END IF;
END $$;

-- ── 1. 两个操作码 ────────────────────────────────────────────────────────────
--    i18n 两键与 seed 同一拼法：ops.perm.{code 冒号→点} / 同上 + .desc。
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'api', v.name, 'ops.perm.' || replace(v.code, ':', '.'), true, v.description,
       'ops.perm.' || replace(v.code, ':', '.') || '.desc', false, s.id, s.id, now(), now()
  FROM (VALUES
    ('ops:notice.read',   'View operator notices',                    'View operator notices'),
    ('ops:notice.manage', 'Publish / withdraw operator notices',      'Publish / withdraw operator notices')
  ) AS v(code, name, description)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (perm_code) DO NOTHING;

-- ── 2. 菜单节点，挂在「维护窗口」同一父组下 ──────────────────────────────────
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path,
   is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
SELECT 'opera.menu.ops_notice', 'menu', '运营通告', 'ops.opera.menu.ops_notice',
       m.parent_id, '/ops/notices', true, '运营通告', 'ops.opera.menu.ops_notice.desc',
       -- 排在「维护窗口」之后；它自己的 sort 加一，不去猜一个固定数。
       m.sort + 1, s.id, s.id, now(), now()
  FROM admin.operator_permission m
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE m.perm_code = 'opera.menu.ops_maintenance'
ON CONFLICT (perm_code) DO UPDATE SET
  parent_id  = excluded.parent_id,
  route_path = excluded.route_path,
  perm_type  = excluded.perm_type,
  updated_at = now();

-- ── 3. 两个操作码挂到它作用的那一页 ──────────────────────────────────────────
UPDATE admin.operator_permission c
   SET parent_id = p.id, updated_at = now()
  FROM admin.operator_permission p
 WHERE p.perm_code = 'opera.menu.ops_notice'
   AND c.perm_code IN ('ops:notice.read', 'ops:notice.manage')
   AND c.parent_id IS DISTINCT FROM p.id;

-- ── 4. 角色授权 ──────────────────────────────────────────────────────────────
--    read 给全部**非预置元锚点**角色：owner 2026-09-20「三个平台由不同人员使用，
--    信息需要同步」——读通告是所有运营者的事。sys_config 是元锚点行，不授。
--    super_admin 的全量授权由 §4.4 不变式保证，也在这里显式补上（它的授权面是
--    「整张表」，漏一行那条不变式会直接抛）。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, n.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission n ON n.perm_code IN ('ops:notice.read', 'opera.menu.ops_notice')
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code <> 'sys_config'
ON CONFLICT (role_id, permission_id) DO NOTHING;

--    manage 对齐 ops:maintenance.manage 的持有者（admin / tech_ops），外加 super_admin。
--    判据取「谁现在就能改运维侧的东西」，不另立一套名单——名单一分两处就会漂。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, true, s.id, now()
  FROM admin.operator_permission via
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_permission n ON n.perm_code = 'ops:notice.manage'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE via.perm_code = 'ops:maintenance.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, n.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission n ON n.perm_code = 'ops:notice.manage'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 5. 自检：三个码就位，且 super_admin 一个不漏 ─────────────────────────────
DO $$
DECLARE
  n_codes  int;
  n_missing int;
BEGIN
  SELECT count(*) INTO n_codes
    FROM admin.operator_permission
   WHERE perm_code IN ('ops:notice.read', 'ops:notice.manage', 'opera.menu.ops_notice');
  IF n_codes <> 3 THEN
    RAISE EXCEPTION '[operator-notice-perms] 期望 3 个码，实测 %', n_codes;
  END IF;

  -- §4.4 全量授权不变式数的是整张表：super_admin 少一行就会抛，这里提前自查。
  SELECT count(*) INTO n_missing
    FROM admin.operator_permission p
   WHERE NOT EXISTS (
     SELECT 1 FROM admin.operator_role_permission rp
       JOIN admin.operator_role r ON r.id = rp.role_id
      WHERE rp.permission_id = p.id AND r.role_code = 'super_admin');
  IF n_missing > 0 THEN
    RAISE EXCEPTION '[operator-notice-perms] super_admin 仍漏 % 个码', n_missing;
  END IF;

  RAISE NOTICE '[operator-notice-perms] 三个码就位，super_admin 全量授权无缺口';
END $$;
