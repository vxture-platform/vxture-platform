-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — atlas 细粒度操作码:price_rule / policy 两组
--
-- 依据:vxture-platform#49(atlas → 平台,迁自 vxture-atlas#6)。atlas 的操作码词表信
-- (`docs/80-liaison/40-2608131600-atlas-operation-code-vocabulary.md`)2026-08-26 发出,
-- 平台侧 `seed-catalog.mjs` 的注释写着「已交办 atlas / runos 注册操作级词表,落地后这里
-- 再补标」——**两边各以为球在对方手上,细码一个都没注册**。
--
-- ## 为什么必须拆,而不是只改一个标记
--
-- #49 的第二条请求是把 `atlas.policy.update` 的 step-up 从「否」改为「是」,论证正确:
-- 策略更新是对限速 / 并发 / 上下文上限的**原地覆盖**,旧值除 `audit.change_records`
-- 外不留存,而策略面根本没有 `asOf` 可读回。决定性的例子是运维把某租户限速调高再调回
-- ——**行本身完全一样,事故窗口从这个资源上问不出来**。
--
-- 但这条请求在粗码上**无法实施**:策略更新由 `model:model.manage` 把门,而粗码同时覆盖
-- 「改 provider 简介」这类无害编辑,**刻意不标 step-up**(标了会把无害编辑也卡上二次
-- 验证)。所以要先有 `model:policy.update` 这个码。
--
-- ## 命名落到平台的形式,不照搬信里的
--
-- 信里是 `atlas.price_rule.delete`(全点号、产品码开头)。平台注册表是 14 个域、约 50 个
-- 码,**全部 `domain:object.action`**;照搬会让它成为唯一的例外,而那正是 product_251
-- X-4 禁的。域取 `model:`——现有 4 个 atlas 码(`model:provider.*` / `model:model.*`)
-- 就在这个域下,而本次拆的正是它们。
--
-- ## 本轮的边界
--
-- 拆了:price_rule / policy(#49 点名的两组)。
-- 未拆:provider / model / provider_key / api_key(19 个码)——分布在 opera-bff 约 2000 行
--       与 6 个门户页上,和本批无依赖,留下一批。
-- 不注册 `.read`:按 atlas 的原则,目录管的是动作;读由 `model:*.read` 覆盖。
-- 不注册 `grant` 组:tenant↔model 授权轴在退役(#129 已删管理面)。给退役中的轴注册权限
--       码,正是 atlas 自己反对空码的那句话:「一个码没有路由在后面,就是一个可以被授予、
--       永远用不上的权限」。
-- `endpoint` 组等 atlas 改名:`endpoints` 是通则点名的两义撞名,runos 已改自己那半。
--
-- ## 两条 delete 码背后现在真有路由
--
-- atlas 上 `DELETE /capability/price-rules/:id` 与 `.../policies/:id` 一直存在(软删除),
-- 而 **admin-bff 从未代理它们**——只注册码不补路由,得到的就是上面那种空码。本批同时
-- 补了两条代理(`bff/admin-bff/src/routers/atlas.router.ts`)。
--
-- 幂等:整份可重跑。与 `seed-catalog.mjs` 同源。
-- 用法:CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 十个细码。语句照 seed-catalog.mjs 的 OPERATOR_PERMISSIONS 循环写,包括
--    `requires_step_up` 的 do-update 语义:它是**平台持有的策略**,不是管理员自定义
--    字段,重跑必须让它回到目录声明的值。其余列保持 do-nothing,不覆盖运营改过的显示名。
INSERT INTO admin.operator_permission
  (perm_code, perm_type, perm_name, perm_name_key, is_system,
   description, description_key, requires_step_up, created_by, updated_by,
   created_at, updated_at)
SELECT
  v.perm_code,
  'api',
  v.perm_name,
  'ops.perm.' || replace(v.perm_code, ':', '.'),
  true,
  v.description,
  'ops.perm.' || replace(v.perm_code, ':', '.') || '.desc',
  v.requires_step_up,
  a.id,
  a.id,
  now(),
  now()
FROM (VALUES
  ('model:price_rule.create',     'Create model price rule',                    'Create model price rule',                                                              false),
  ('model:price_rule.update',     'Update model price rule (expiresAt only)',   'Update model price rule (expiresAt only)',                                             false),
  ('model:price_rule.activate',   'Activate model price rule',                  'Activate model price rule',                                                            false),
  ('model:price_rule.deactivate', 'Deactivate model price rule',                'Deactivate model price rule',                                                          false),
  ('model:price_rule.delete',     'Soft-delete model price rule',               'Soft-delete model price rule',                                                         false),
  ('model:policy.create',         'Create model policy',                        'Create model policy',                                                                  false),
  ('model:policy.update',         'Update model policy (high-risk)',            'In-place overwrite of rate/concurrency/context limits; no history surface (high-risk)', true),
  ('model:policy.activate',       'Activate model policy',                      'Activate model policy',                                                                false),
  ('model:policy.deactivate',     'Deactivate model policy',                    'Deactivate model policy',                                                              false),
  ('model:policy.delete',         'Soft-delete model policy',                   'Soft-delete model policy',                                                             false)
) AS v(perm_code, perm_name, description, requires_step_up)
CROSS JOIN (
  -- 锚点账号,同 seed 的 SYS:系统预置行的 created_by / updated_by。
  SELECT id FROM admin.operator_account ORDER BY created_at LIMIT 1
) AS a
ON CONFLICT (perm_code) DO UPDATE SET
  requires_step_up = excluded.requires_step_up,
  updated_at = now();

-- ② 挂到「模型平台」菜单节点下。树形是平台持有的结构,同 seed 的 do-update 语义。
--    §4.4 的全量授权不变式数的是整张表,菜单层与 api 层都算——挂错父节点不会让它掉出
--    不变式,但会让操作码在授权树上找不到,所以这一步不是装饰。
UPDATE admin.operator_permission c
   SET parent_id = p.id, updated_at = now()
  FROM admin.operator_permission p
 WHERE p.route_path = '/atlas'
   AND p.perm_type = 'menu'
   AND c.perm_code IN (
     'model:price_rule.create', 'model:price_rule.update',
     'model:price_rule.activate', 'model:price_rule.deactivate',
     'model:price_rule.delete',
     'model:policy.create', 'model:policy.update',
     'model:policy.activate', 'model:policy.deactivate',
     'model:policy.delete'
   )
   AND (c.parent_id IS DISTINCT FROM p.id);

-- ③ super_admin 全量授权(§4.4 explicit full grant,no code bypass)。
--    seed 里 super_admin 的授权是 OP_ALL 计算出来的,新码自动进;活库没有那一步,
--    所以必须在这里补——漏了的表现是「码注册了,而唯一该有它的角色没有它」,
--    而那在界面上和「功能没上线」一模一样。
INSERT INTO admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
SELECT r.id, c.id, true, a.id, now()
  FROM admin.operator_role r
 CROSS JOIN admin.operator_permission c
 CROSS JOIN (SELECT id FROM admin.operator_account ORDER BY created_at LIMIT 1) a
 WHERE r.role_code = 'super_admin'
   AND c.perm_code IN (
     'model:price_rule.create', 'model:price_rule.update',
     'model:price_rule.activate', 'model:price_rule.deactivate',
     'model:price_rule.delete',
     'model:policy.create', 'model:policy.update',
     'model:policy.activate', 'model:policy.deactivate',
     'model:policy.delete'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ④ 自检:按**本迁移动过的那 10 个码**逐个断言,不数总数。
--
--    第一版用 `count(*) ... WHERE perm_code LIKE 'model:policy.%'` 和 10 比,被
--    `lint:migration-counts` 拦下,拦得对:migrate 是**全量重放**,将来任何一次新增
--    `model:policy.*` 都会让这条断言在重放时炸,而那时炸的是一份早已正确的迁移。
--    判据要落在「本迁移声明的那些对象」上,和全库有多少行无关。
DO $$
DECLARE
  target_codes text[] := ARRAY[
    'model:price_rule.create', 'model:price_rule.update',
    'model:price_rule.activate', 'model:price_rule.deactivate',
    'model:price_rule.delete',
    'model:policy.create', 'model:policy.update',
    'model:policy.activate', 'model:policy.deactivate',
    'model:policy.delete'
  ];
  missing text[];
BEGIN
  -- ① 十个码都在
  SELECT array_agg(c) INTO missing
    FROM unnest(target_codes) c
   WHERE NOT EXISTS (
     SELECT 1 FROM admin.operator_permission p WHERE p.perm_code = c
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '这些细码没有注册上: %', missing;
  END IF;

  -- ② step-up 恰好落在 policy.update 上,一个不多一个不少。
  --    价格规则一条都不该标:它是追加写 + 有 asOf,与策略不同构。
  SELECT array_agg(perm_code) INTO missing
    FROM admin.operator_permission
   WHERE perm_code = ANY(target_codes)
     AND requires_step_up <> (perm_code = 'model:policy.update');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'step-up 标记与目录声明不一致: %', missing;
  END IF;

  -- ③ 十个码都挂在「模型平台」节点下
  SELECT array_agg(c) INTO missing
    FROM unnest(target_codes) c
   WHERE NOT EXISTS (
     SELECT 1
       FROM admin.operator_permission ch
       JOIN admin.operator_permission pa ON pa.id = ch.parent_id
      WHERE ch.perm_code = c AND pa.route_path = '/atlas'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '这些细码没有挂到 /atlas 节点下: %', missing;
  END IF;

  -- ④ super_admin 持有全部十个(§4.4 全量授权,无代码旁路)
  SELECT array_agg(c) INTO missing
    FROM unnest(target_codes) c
   WHERE NOT EXISTS (
     SELECT 1
       FROM admin.operator_role_permission rp
       JOIN admin.operator_role r ON r.id = rp.role_id
       JOIN admin.operator_permission p ON p.id = rp.permission_id
      WHERE r.role_code = 'super_admin' AND p.perm_code = c
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'super_admin 缺这些细码的授权: %', missing;
  END IF;

  RAISE NOTICE 'atlas 细码就绪:10 个已注册、挂树、授权,step-up 仅 model:policy.update';
END $$;

COMMIT;
