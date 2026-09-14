-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 治理平台「登录与会话」拆成两页：在线会话（现状）/ 登录记录（历史）
--
-- 依据：owner 2026-09-15「这是两个内容，是不是应该拆开，一个看现状运行，一个看历史
-- 数据-可以归审计」「两点都确认，执行」。
--
--   · 身份权限 / 在线会话   /sessions       arche.menu.online_session   operator:session.read
--     （原 arche.menu.sign_in_session 原地改码，id 不变，已有授权随行）
--   · 安全审计 / 登录记录   /sign-in-logs   arche.menu.sign_in_log      audit:sign_in_log.read（新码）
--
-- 新码授给原本就看得到登录记录的角色 = 持有 operator:session.read 的角色，没有人因此
-- 失去访问。同级排序与 seed 的同级序号一致：审计日志 10、登录记录 20、风险记录 30、
-- 合规事件 40。
--
-- 幂等：整份可重跑。与 seed-catalog.mjs 同源，守卫 lint:operator-planes 核对。
-- 重放：migrate 是全量重放，2026-10-03 重放时看不见本迁移的改码，会把旧节点插回来——
-- 见第 0 步。
-- 顺序：先 migrate 再 deploy（新镜像按新码校验「登录记录」页，旧库上没有人进得去）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.operator_account WHERE username = 'systemadmin') THEN
    RAISE EXCEPTION '[sign-in-log] 找不到 systemadmin 锚点账号';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.operator_permission WHERE perm_code = 'arche.menu.security_audit') THEN
    RAISE EXCEPTION '[sign-in-log] 找不到 arche.menu.security_audit（先跑 2026-10-03-operator-three-planes）';
  END IF;
END $$;

-- ── 0. 重放自愈 ──────────────────────────────────────────────────────────────
--    2026-10-03 重放时只看得见「arche.menu.sign_in_session 不在」：第 4 步把它插回来、
--    第 8 步把 operator:session.read 挂回它下面、第 10 步按闭包给它授权。新节点已在时，
--    旧节点只是重放的副产物：子节点挪回新节点，删旧节点的授权，再删旧节点。
UPDATE admin.operator_permission c
   SET parent_id = n.id, updated_at = now()
  FROM admin.operator_permission o, admin.operator_permission n
 WHERE o.perm_code = 'arche.menu.sign_in_session'
   AND n.perm_code = 'arche.menu.online_session'
   AND c.parent_id = o.id;

DELETE FROM admin.operator_role_permission rp
 USING admin.operator_permission o
 WHERE rp.permission_id = o.id
   AND o.perm_code = 'arche.menu.sign_in_session'
   AND EXISTS (SELECT 1 FROM admin.operator_permission n WHERE n.perm_code = 'arche.menu.online_session');

DELETE FROM admin.operator_permission o
 WHERE o.perm_code = 'arche.menu.sign_in_session'
   AND EXISTS (SELECT 1 FROM admin.operator_permission n WHERE n.perm_code = 'arche.menu.online_session');

-- ── 1. 页面节点原地改码：登录与会话 → 在线会话 ─────────────────────────────
UPDATE admin.operator_permission
   SET perm_code       = 'arche.menu.online_session',
       perm_name       = '在线会话',
       description     = '在线会话',
       perm_name_key   = 'ops.arche.menu.online_session',
       description_key = 'ops.arche.menu.online_session.desc',
       updated_at      = now()
 WHERE perm_code = 'arche.menu.sign_in_session'
   AND NOT EXISTS (SELECT 1 FROM admin.operator_permission WHERE perm_code = 'arche.menu.online_session');

UPDATE admin.operator_permission
   SET perm_name = 'View operator online sessions', description = 'View operator online sessions',
       updated_at = now()
 WHERE perm_code = 'operator:session.read'
   AND (perm_name IS DISTINCT FROM 'View operator online sessions'
        OR description IS DISTINCT FROM 'View operator online sessions');

-- ── 2. 新页面节点：安全审计 / 登录记录 ──────────────────────────────────────
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, parent_id, route_path, icon,
   is_system, description, description_key, sort, created_by, updated_by, created_at, updated_at)
SELECT 'arche.menu.sign_in_log', 'menu', '登录记录', 'ops.arche.menu.sign_in_log', p.id,
       '/sign-in-logs', NULL, true, '登录记录', 'ops.arche.menu.sign_in_log.desc', 20,
       s.id, s.id, now(), now()
  FROM admin.operator_permission p
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE p.perm_code = 'arche.menu.security_audit'
ON CONFLICT (perm_code) DO UPDATE SET
  parent_id  = excluded.parent_id,
  route_path = excluded.route_path,
  perm_type  = excluded.perm_type,
  sort       = excluded.sort,
  updated_at = now();

UPDATE admin.operator_permission c
   SET sort = v.sort, updated_at = now()
  FROM (VALUES
    ('arche.menu.audit_log',        10),
    ('arche.menu.sign_in_log',      20),
    ('arche.menu.risk_record',      30),
    ('arche.menu.compliance_event', 40)
  ) AS v(code, sort)
 WHERE c.perm_code = v.code
   AND c.sort IS DISTINCT FROM v.sort;

-- ── 3. 新操作码，挂在登录记录页 ──────────────────────────────────────────────
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, parent_id, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT 'audit:sign_in_log.read', 'api', 'View operator sign-in records', 'ops.perm.audit.sign_in_log.read',
       p.id, true, 'View operator sign-in records', 'ops.perm.audit.sign_in_log.read.desc',
       false, s.id, s.id, now(), now()
  FROM admin.operator_permission p
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE p.perm_code = 'arche.menu.sign_in_log'
ON CONFLICT (perm_code) DO UPDATE SET
  parent_id  = excluded.parent_id,
  updated_at = now();

-- ── 4. 新码授给原本就看得到登录记录的角色 ────────────────────────────────────
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM admin.operator_permission via
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = 'audit:sign_in_log.read'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE via.perm_code = 'operator:session.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 5. 祖先闭包：持有子节点必持有它的全部祖先 ───────────────────────────────
WITH RECURSIVE anc AS (
  SELECT rp.role_id, p.parent_id AS id
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE p.parent_id IS NOT NULL
  UNION
  SELECT a.role_id, p.parent_id
    FROM anc a
    JOIN admin.operator_permission p ON p.id = a.id
   WHERE p.parent_id IS NOT NULL
)
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT a.role_id, a.id, r.is_system, s.id, now()
  FROM anc a
  JOIN admin.operator_role r ON r.id = a.role_id
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 6. super_admin 全量授权（data_admin_200 §4.4，无代码旁路）─────────────────
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
 CROSS JOIN admin.operator_permission p
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 7. 后置断言 ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_old int; n_node int; n_code int; n_missing int; n_total int; n_super int;
BEGIN
  SELECT count(*) INTO n_old FROM admin.operator_permission WHERE perm_code = 'arche.menu.sign_in_session';
  IF n_old > 0 THEN RAISE EXCEPTION '[sign-in-log] 旧节点 arche.menu.sign_in_session 仍在'; END IF;

  SELECT count(*) INTO n_node
    FROM admin.operator_permission c
    JOIN admin.operator_permission p ON p.id = c.parent_id
   WHERE (c.perm_code = 'arche.menu.online_session' AND p.perm_code = 'arche.menu.identity_access'
          AND c.route_path = '/sessions')
      OR (c.perm_code = 'arche.menu.sign_in_log' AND p.perm_code = 'arche.menu.security_audit'
          AND c.route_path = '/sign-in-logs');
  IF n_node <> 2 THEN RAISE EXCEPTION '[sign-in-log] 两个页面节点应各在其位，实得 %', n_node; END IF;

  SELECT count(*) INTO n_code
    FROM admin.operator_permission c
    JOIN admin.operator_permission p ON p.id = c.parent_id
   WHERE (c.perm_code = 'audit:sign_in_log.read' AND p.perm_code = 'arche.menu.sign_in_log')
      OR (c.perm_code = 'operator:session.read' AND p.perm_code = 'arche.menu.online_session');
  IF n_code <> 2 THEN RAISE EXCEPTION '[sign-in-log] 两个操作码应挂在各自页面下，实得 %', n_code; END IF;

  -- 持有 operator:session.read 的角色都拿到了 audit:sign_in_log.read
  SELECT count(*) INTO n_missing
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission via ON via.id = rp.permission_id AND via.perm_code = 'operator:session.read'
   WHERE NOT EXISTS (
     SELECT 1 FROM admin.operator_role_permission x
       JOIN admin.operator_permission n ON n.id = x.permission_id AND n.perm_code = 'audit:sign_in_log.read'
      WHERE x.role_id = rp.role_id);
  IF n_missing > 0 THEN RAISE EXCEPTION '[sign-in-log] % 个角色能看会话却拿不到登录记录', n_missing; END IF;

  SELECT count(*) INTO n_total FROM admin.operator_permission;
  SELECT count(*) INTO n_super
    FROM admin.operator_role_permission rp
    JOIN admin.operator_role r ON r.id = rp.role_id AND r.role_code = 'super_admin';
  IF n_super <> n_total THEN
    RAISE EXCEPTION '[sign-in-log] super_admin 全量授权被破坏：%/%', n_super, n_total;
  END IF;
END $$;

COMMIT;
