-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 租户与工单两条线从遗留扁平码换成细码：给存量角色补授细码
--
-- 依据：owner 2026-10-03「拆门，按细码粒度，先做租户和工单那两条」。
--
-- 背景（为什么只补不删）：`platform.tenant.manage` 不是目录里的 perm_code，
-- deploy/ 全树一行都没有它。它由 bff/admin-bff/src/auth/auth.service.ts 的
-- LEGACY_CAPABILITY_BRIDGE 在运行时合成，而桥的唯一来源是 `tenant:profile.manage`。
-- 也就是说「今天能进租户 / 工单 / 账号 / 待办 / 搜索的角色」= 今天持有
-- `tenant:profile.manage` 的角色，一个不多一个不少。
--
-- 本迁移之后，那些角色额外持有本域的细码，于是拆门当天没有人**因为缺码**丢掉
-- 今天看得见的东西：
--   · tenant:profile.read         租户列表 / 详情 / logo / 成员列表
--   · tenant:verification.review  实名审核列表 / 批准 / 驳回
--   · support:ticket.read         工单列表 / 详情 / 时间线
--   · 以上三码在侧栏上的菜单祖先（按 operator_permission.parent_id 递归求闭包，
--     与 seed-catalog.mjs 的 withMenuClosure 同一个结果）。BFF 不拿菜单码当门，
--     但侧栏拿它决定显不显示 —— 只补操作码会出现「有权限、侧栏里找不到入口」。
--
-- **刻意不补 `support:ticket.manage`**：目录给 operator 的是 support:ticket.read，
-- 它今天能写工单纯粹是旧桥的副作用（持 tenant:profile.manage ⇒ 合成粗码 ⇒ 十个入口
-- 全开）。按细码粒度设门就是让目录说话，所以 operator 的工单写入**按设计收回**。
-- 要改回去是一行，owner 决定：
--   INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
--   SELECT r.id, p.id, true, s.id, now()
--     FROM admin.operator_role r
--     JOIN admin.operator_permission p ON p.perm_code = 'support:ticket.manage'
--    CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
--    WHERE r.role_code = 'operator'
--   ON CONFLICT (role_id, permission_id) DO NOTHING;
--
-- 为什么判据写「持有 tenant:profile.manage 的角色」而不写角色码字面量：治理台能建
-- 角色（bff/arche-bff/src/routers/admin-roles.router.ts），活库里可能有 seed 没有的
-- 角色。写 role_code IN (...) 会漏掉它们，那些角色拆门当天直接丢访问。
--
-- 新库不跑迁移（DDL + seed 直建），而四个细码与它们的菜单挂载早就在
-- seed-catalog.mjs 里（OPERATOR_PERMISSIONS / MENU_TREE / OPERATOR_ROLE_PERMS），
-- 所以本迁移只服务存量库，seed 侧无需改动。
--
-- 幂等：整份可重跑（ON CONFLICT DO NOTHING，无 UPDATE、无 DELETE）。
-- 顺序：先 migrate 再 deploy（新镜像按细码校验；旧库上细码还没授出去会 403）。
-- 用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. 锚点：缺一个就抛，不要静默授 0 行 ────────────────────────────────────
DO $$
DECLARE
  missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.operator_account WHERE username = 'systemadmin') THEN
    RAISE EXCEPTION '[fine-gates] 找不到 systemadmin 锚点账号';
  END IF;

  SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES
      ('tenant:profile.manage'),
      ('tenant:profile.read'),
      ('tenant:verification.review'),
      ('support:ticket.read')
    ) AS t(c)
   WHERE NOT EXISTS (SELECT 1 FROM admin.operator_permission p WHERE p.perm_code = t.c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '[fine-gates] 目录里缺这些码，先跑 2026-10-03-operator-three-planes.sql：%', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admin.operator_role_permission rp
      JOIN admin.operator_permission p ON p.id = rp.permission_id
     WHERE p.perm_code = 'tenant:profile.manage'
  ) THEN
    RAISE EXCEPTION '[fine-gates] 没有任何角色持有 tenant:profile.manage —— 判据取不到行，拆门当天会全员 403';
  END IF;
END $$;

-- ── 1. 操作码：给今天持有 tenant:profile.manage 的每个角色补三个细码 ─────────
--    那三个细码覆盖的入口，这些角色今天经旧桥**已经**能进，所以这一步不放大任何
--    人的实际可达范围，只是把「凭哪个码进」换成目录里本该用的那个码。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM (VALUES
    ('tenant:profile.read'),
    ('tenant:verification.review'),
    ('support:ticket.read')
  ) AS g(new_code)
  JOIN admin.operator_permission via ON via.perm_code = 'tenant:profile.manage'
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = g.new_code
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2. 菜单闭包：持有子节点必持有祖先 ───────────────────────────────────────
--    不写死 admin.menu.support_ticket 这些字面量的祖先链 —— 顺 parent_id 递归求，
--    树以后改形状这份迁移不会悄悄失准（seed 那边是 withMenuClosure 干同一件事）。
WITH RECURSIVE granted AS (
  SELECT rp.role_id, rp.permission_id
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE p.perm_code IN (
     'tenant:profile.read',
     'tenant:verification.review',
     'support:ticket.read'
   )
), closure AS (
  SELECT g.role_id, p.parent_id AS permission_id
    FROM granted g
    JOIN admin.operator_permission p ON p.id = g.permission_id
   WHERE p.parent_id IS NOT NULL
  UNION
  SELECT c.role_id, p.parent_id
    FROM closure c
    JOIN admin.operator_permission p ON p.id = c.permission_id
   WHERE p.parent_id IS NOT NULL
)
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT c.role_id, c.permission_id, r.is_system, s.id, now()
  FROM closure c
  JOIN admin.operator_role r ON r.id = c.role_id
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 3. 审计段：授完逐角色打印实况，PR 里贴这张表 ────────────────────────────
--    不是装饰 —— 「某个角色一个工单码都没有」只有在这里看得见。
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '[fine-gates] 角色 × 本轮四个细码（manage 刻意没补，见文件头）';
  FOR r IN
    SELECT ro.role_code,
           bool_or(p.perm_code = 'tenant:profile.read')        AS t_read,
           bool_or(p.perm_code = 'tenant:profile.manage')      AS t_manage,
           bool_or(p.perm_code = 'tenant:verification.review') AS verif,
           bool_or(p.perm_code = 'support:ticket.read')        AS k_read,
           bool_or(p.perm_code = 'support:ticket.manage')      AS k_manage
      FROM admin.operator_role ro
      LEFT JOIN admin.operator_role_permission rp ON rp.role_id = ro.id
      LEFT JOIN admin.operator_permission p ON p.id = rp.permission_id
     GROUP BY ro.role_code
     ORDER BY ro.role_code
  LOOP
    RAISE NOTICE '  % | t.read=% t.manage=% verif=% ticket.read=% ticket.manage=%',
      r.role_code, r.t_read, r.t_manage, r.verif, r.k_read, r.k_manage;
  END LOOP;
END $$;

COMMIT;
