-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 产品目录 / 解决方案 / 套餐 / 定价与账号 / 待办 / 搜索从遗留扁平码换成细码：
--            先补三个目录码，再给存量角色补授
--
-- 依据：owner 2026-10-04 ruling 1「一个码 tenant manage，和一个码 product manage，
-- 这个必须要拆解，首先是按照 admin，opera 两个平面，再按照同类业务维度，你参考行业
-- 梳理和拆分」。租户 / 工单两条线已于 2026-10-03（#577）拆完；本批拆掉剩下的两道粗门：
--   · platform.product.manage —— products.router 32 个入口（产品目录 / 解决方案 / 套餐 / 定价）
--   · platform.tenant.manage  —— 余下的 5 个入口（账号 3 个读 / 运营待办 / 全局搜索）
-- 两个粗码都不在目录里，由 admin-bff auth.service 的 LEGACY_CAPABILITY_BRIDGE 在运行时
-- 分别从 product:plan.manage / tenant:profile.manage 合成；本批连桥一起删。
--
-- 与 2026-10-03-tenant-ticket-fine-gates.sql 的一处不同：这次有**三个新码**
-- （product:capability.manage / product:solution.read / product:solution.manage），
-- 存量库的目录里没有它们，所以第 1 步先插目录行（行形状照 seed-catalog.mjs：
-- perm_type='api'、perm_name_key / description_key 用 `catalog.ops.perm.<码冒号→点>.name|.desc`
-- 命名空间、requires_step_up=false、parent_id 挂到所属菜单页）。
--
-- 之后谁拿到什么（判据写「今天持有某码的角色」，不写角色码字面量——治理台能建角色，
-- 写 role_code IN (...) 会漏掉自建角色，那种角色拆门当天直接丢访问）：
--   · 三个新码 → 今天持有 product:plan.manage 的每个角色。这些角色今天经旧桥**已经**能进
--     那 32 个入口（旧桥正是从 plan.manage 合成），所以这一步不放大任何人的实际可达范围，
--     只是把「凭哪个码进」换成目录里本该用的那个码。
--   · user:profile.read → 今天持有 tenant:profile.manage 的每个角色（账号 3 个读改判它；
--     seed 里这些角色本来就有，补授只服务自建角色）。
--   · 以上各码的菜单祖先按 parent_id 递归求闭包（与 seed 的 withMenuClosure 同一个结果）。
--
-- **没有任何访问收回**：目录里本来就持有 product:plan.read / price.read /
-- capability.read / user:profile.read 的 finance / engineer / support / auditor 从本批起能
-- 进它们目录里说能进的读入口（此前被粗门关在外面）；持 plan.manage 的角色拿到三个新码。
-- 价格第二道门（套餐草稿 PATCH 带 prices 时补判 product:price.manage）：seed 里持
-- plan.manage 的角色都同时持 price.manage，自建角色若只授 plan.manage，改价格会 403——
-- 那是目录在说话，不是本迁移的副作用。
--
-- 新库不跑迁移（DDL + seed 直建），三个新码与菜单挂载、角色绑定都已在 seed-catalog.mjs 里。
--
-- 幂等：整份可重跑（INSERT 全部 ON CONFLICT DO NOTHING；唯一一条 UPDATE 是 1b 的改挂，带
--       IS DISTINCT FROM 闸；无 DELETE。第二遍全部 INSERT 0 0 / UPDATE 0）。
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
    RAISE EXCEPTION '[product-fine-gates] 找不到 systemadmin 锚点账号';
  END IF;

  SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES
      ('product:plan.manage'),
      ('tenant:profile.manage'),
      ('user:profile.read'),
      ('admin.menu.product_capability'),
      ('admin.menu.solution_package')
    ) AS t(c)
   WHERE NOT EXISTS (SELECT 1 FROM admin.operator_permission p WHERE p.perm_code = t.c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '[product-fine-gates] 目录里缺这些码 / 菜单节点，先跑 2026-10-03-operator-three-planes.sql：%', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admin.operator_role_permission rp
      JOIN admin.operator_permission p ON p.id = rp.permission_id
     WHERE p.perm_code = 'product:plan.manage'
  ) THEN
    RAISE EXCEPTION '[product-fine-gates] 没有任何角色持有 product:plan.manage —— 判据取不到行，拆门当天产品目录会全员 403';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin.operator_role_permission rp
      JOIN admin.operator_permission p ON p.id = rp.permission_id
     WHERE p.perm_code = 'tenant:profile.manage'
  ) THEN
    RAISE EXCEPTION '[product-fine-gates] 没有任何角色持有 tenant:profile.manage —— 判据取不到行';
  END IF;
END $$;

-- ── 1. 三个新目录码（行形状照 seed-catalog.mjs 的 operator_permission 插入）─────────
--    parent_id 直接挂到所属菜单页（seed 是先插再 reparent，结果相同）。
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, parent_id, is_system, description, description_key,
   requires_step_up, created_by, updated_by, created_at, updated_at)
SELECT v.code, 'api', v.name,
       'catalog.ops.perm.' || replace(v.code, ':', '.') || '.name',
       (SELECT id FROM admin.operator_permission WHERE perm_code = v.menu),
       true, v.description,
       'catalog.ops.perm.' || replace(v.code, ':', '.') || '.desc',
       false, s.id, s.id, now(), now()
  FROM (VALUES
    ('product:capability.manage', 'Manage the product catalog',
     'Reorder products, edit marketing content and customer visibility', 'admin.menu.product_capability'),
    ('product:solution.read',     'View solutions',   'View solutions',   'admin.menu.solution_package'),
    ('product:solution.manage',   'Manage solutions', 'Manage solutions', 'admin.menu.solution_package')
  ) AS v(code, name, description, menu)
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (perm_code) DO NOTHING;

-- ── 1b. 套餐 / 价格四码改挂到「产品套餐」页（/plan-versions，套餐版本编辑器）────────
--    seed 的 MENU_TREE 同步改了（此前挂在只读的「服务套餐」/service-plans 上）。
--    这是菜单树形状，和 seed 的 reparent 一样属于平台持有的结构，所以这里用 UPDATE
--    对齐；IS DISTINCT FROM 让第二遍是 0 行。缺「产品套餐」节点时不动（旧树）。
UPDATE admin.operator_permission p
   SET parent_id = m.id, updated_at = now()
  FROM admin.operator_permission m
 WHERE m.perm_code = 'admin.menu.plan_version'
   AND p.perm_code IN ('product:plan.read', 'product:plan.manage', 'product:price.read', 'product:price.manage')
   AND p.parent_id IS DISTINCT FROM m.id;

-- ── 2. 操作码：按「今天持有某码的角色」补授 ──────────────────────────────────
--    (a) 三个新码 → 持 product:plan.manage 的角色（旧桥正是从它合成粗码）
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM (VALUES
    ('product:capability.manage'),
    ('product:solution.read'),
    ('product:solution.manage')
  ) AS g(new_code)
  JOIN admin.operator_permission via ON via.perm_code = 'product:plan.manage'
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = g.new_code
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
ON CONFLICT (role_id, permission_id) DO NOTHING;

--    (b) user:profile.read → 持 tenant:profile.manage 的角色（账号 3 个读入口改判它）
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT DISTINCT rp.role_id, n.id, r.is_system, s.id, now()
  FROM admin.operator_permission via
  JOIN admin.operator_role_permission rp ON rp.permission_id = via.id
  JOIN admin.operator_role r ON r.id = rp.role_id
  JOIN admin.operator_permission n ON n.perm_code = 'user:profile.read'
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE via.perm_code = 'tenant:profile.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

--    (c) super_admin 的全量不变式（seed §4.4）：新码也要进它的授权面，否则它自锁
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, p.id, true, s.id, now()
  FROM admin.operator_role r
  JOIN admin.operator_permission p
    ON p.perm_code IN ('product:capability.manage', 'product:solution.read', 'product:solution.manage')
 CROSS JOIN (SELECT id FROM admin.operator_account WHERE username = 'systemadmin') s
 WHERE r.role_code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 3. 菜单闭包：持有子节点必持有祖先 ───────────────────────────────────────
--    不写死祖先链——顺 parent_id 递归求，树以后改形状这份迁移不会悄悄失准
--    （seed 那边是 withMenuClosure 干同一件事）。
WITH RECURSIVE granted AS (
  SELECT rp.role_id, rp.permission_id
    FROM admin.operator_role_permission rp
    JOIN admin.operator_permission p ON p.id = rp.permission_id
   WHERE p.perm_code IN (
     'product:capability.manage',
     'product:solution.read',
     'product:solution.manage',
     'product:plan.read',
     'product:plan.manage',
     'product:price.read',
     'product:price.manage',
     'user:profile.read'
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

-- ── 4. 审计段：授完逐角色打印实况，PR 里贴这张表 ────────────────────────────
DO $$
DECLARE
  r record;
  n int;
BEGIN
  SELECT count(*) INTO n FROM admin.operator_permission
   WHERE perm_code IN ('product:capability.manage', 'product:solution.read', 'product:solution.manage');
  IF n <> 3 THEN
    RAISE EXCEPTION '[product-fine-gates] 三个新码应全部在目录里，实际 %', n;
  END IF;

  RAISE NOTICE '[product-fine-gates] 角色 × 产品域八码 + user:profile.read';
  FOR r IN
    SELECT ro.role_code,
           bool_or(p.perm_code = 'product:capability.read')   AS cap_r,
           bool_or(p.perm_code = 'product:capability.manage') AS cap_m,
           bool_or(p.perm_code = 'product:solution.read')     AS sol_r,
           bool_or(p.perm_code = 'product:solution.manage')   AS sol_m,
           bool_or(p.perm_code = 'product:plan.read')         AS plan_r,
           bool_or(p.perm_code = 'product:plan.manage')       AS plan_m,
           bool_or(p.perm_code = 'product:price.read')        AS price_r,
           bool_or(p.perm_code = 'product:price.manage')      AS price_m,
           bool_or(p.perm_code = 'user:profile.read')         AS user_r
      FROM admin.operator_role ro
      LEFT JOIN admin.operator_role_permission rp ON rp.role_id = ro.id
      LEFT JOIN admin.operator_permission p ON p.id = rp.permission_id
     GROUP BY ro.role_code
     ORDER BY ro.role_code
  LOOP
    RAISE NOTICE '  % | cap r/m=%/% sol r/m=%/% plan r/m=%/% price r/m=%/% user.read=%',
      r.role_code, r.cap_r, r.cap_m, r.sol_r, r.sol_m, r.plan_r, r.plan_m, r.price_r, r.price_m, r.user_r;
  END LOOP;
END $$;

COMMIT;
