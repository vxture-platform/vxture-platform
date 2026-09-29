-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 租户菜单新增「帮助与支持」组与「工单」页（owner 2026-09-29）
--
-- owner 裁决：**新组，放在「设置与安全」上方**。组里今天只有一项（工单）；
-- 文档中心是第三批的事（它是第七个门户，不是一页），那一批落地后这里会多一项。
--
--   · 新增 tenant.menu.help_support（组，无路由，sort 40）
--   · 新增 tenant.menu.tickets（/tickets，挂在上面那一组下，sort 10）
--   · tenant.menu.advanced_settings 40 → 50、tenant.menu.platform 50 → 60
--
-- **两个新节点都不挂操作码。** 工单的可见范围是租户级（owner 裁决 1），同租户成员
-- 看同一批单；挂一个码等于让租户里的一部分人看不到自己单位提过什么单，而求助不是
-- 一项需要被授权的能力。`tenant.menu.inbox` 是同一形状的既有先例。
--
-- **为什么要动 sort。** seed 的 sort 是按兄弟下标算的（(i+1)*10），把新组插在
-- subscription_billing 与 advanced_settings 之间，后两组的下标就整体后移一位。
-- 新库由 seed 直接写出正确的 sort；**存量库只跑迁移不跑 seed**，所以这两行必须在
-- 这里显式改，否则线上的「帮助与支持」会和「高级设置」并列在同一个 sort 上，
-- 屏幕顺序变成按 id 的随机序。
--
-- **i18n 键用 seed 的那套 `catalog.access.menu.*`。** 2026-09-23 那份
-- （tenant.menu.skills）写的是 `access.menu.skills`，与 seed 写进新库的
-- `catalog.access.menu.skills.name` 不是同一个键——那一处的分叉留在原处不在本次
-- 动，但新增的两行按 seed 的约定写，免得新库与存量库对同一节点取到两个键。
--
-- 幂等：整份可重跑（新节点走 ON CONFLICT DO UPDATE、改序走带 IS DISTINCT FROM 的
-- UPDATE）。用法：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 组节点（无路由，根上）───────────────────────────────────────────────
INSERT INTO access.permissions (
  perm_code, perm_type, perm_name, perm_name_key,
  parent_id, route_path, icon, is_system,
  description, description_key, sort, created_at, updated_at
)
VALUES (
  'tenant.menu.help_support', 'menu', '帮助与支持',
  'catalog.access.menu.help_support.name',
  NULL, NULL, 'chat-dots', true,
  '帮助与支持', 'catalog.access.menu.help_support.desc', 40, now(), now()
)
ON CONFLICT (perm_code) DO UPDATE SET
  perm_name_key = excluded.perm_name_key,
  description_key = excluded.description_key,
  parent_id = excluded.parent_id,
  route_path = excluded.route_path,
  perm_type = excluded.perm_type,
  icon = excluded.icon,
  sort = excluded.sort,
  updated_at = now();

-- ── ② 页面节点（/tickets，挂在组下）──────────────────────────────────────
INSERT INTO access.permissions (
  perm_code, perm_type, perm_name, perm_name_key,
  parent_id, route_path, icon, is_system,
  description, description_key, sort, created_at, updated_at
)
SELECT 'tenant.menu.tickets', 'menu', '工单',
       'catalog.access.menu.tickets.name',
       p.id, '/tickets', 'chat-dots', true,
       '工单', 'catalog.access.menu.tickets.desc', 10, now(), now()
  FROM access.permissions p
 WHERE p.perm_code = 'tenant.menu.help_support'
ON CONFLICT (perm_code) DO UPDATE SET
  perm_name_key = excluded.perm_name_key,
  description_key = excluded.description_key,
  parent_id = excluded.parent_id,
  route_path = excluded.route_path,
  perm_type = excluded.perm_type,
  icon = excluded.icon,
  sort = excluded.sort,
  updated_at = now();

-- ── ③ 后面两组顺延（新组插在它们前面）───────────────────────────────────
UPDATE access.permissions SET sort = 50, updated_at = now()
 WHERE perm_code = 'tenant.menu.advanced_settings' AND sort IS DISTINCT FROM 50;

UPDATE access.permissions SET sort = 60, updated_at = now()
 WHERE perm_code = 'tenant.menu.platform' AND sort IS DISTINCT FROM 60;

DO $$
DECLARE v int;
BEGIN
  -- 页面节点在、路由对、挂在新组下。
  SELECT count(*) INTO v
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE c.perm_code = 'tenant.menu.tickets'
     AND c.route_path = '/tickets'
     AND p.perm_code = 'tenant.menu.help_support';
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:tenant.menu.tickets 不存在、路由不对、或没挂在 help_support 下';
  END IF;

  -- 组节点在根上且无路由(组不是页面,给它一个路由会让侧栏多出一个点不开的条目)。
  SELECT count(*) INTO v FROM access.permissions
   WHERE perm_code = 'tenant.menu.help_support'
     AND parent_id IS NULL AND route_path IS NULL;
  IF v <> 1 THEN
    RAISE EXCEPTION '迁移未落地:tenant.menu.help_support 不在根上或带了路由';
  END IF;

  -- i18n 键必须非空:基线审计 [C2] 要求 seeded 行 perm_name_key/description_key 都有值。
  SELECT count(*) INTO v FROM access.permissions
   WHERE perm_code IN ('tenant.menu.help_support', 'tenant.menu.tickets')
     AND coalesce(perm_name_key, '') <> ''
     AND coalesce(description_key, '') <> '';
  IF v <> 2 THEN
    RAISE EXCEPTION 'i18n 键未落地:新增两个菜单节点的 perm_name_key/description_key 有空值';
  END IF;

  -- 不挂操作码:这两个节点下不该有 api 码改挂过来。
  SELECT count(*) INTO v
    FROM access.permissions c
    JOIN access.permissions p ON p.id = c.parent_id
   WHERE p.perm_code IN ('tenant.menu.help_support', 'tenant.menu.tickets')
     AND c.perm_type = 'api';
  IF v <> 0 THEN
    RAISE EXCEPTION '帮助与支持两节点下不该挂操作码(工单是租户级可见,不设门)';
  END IF;

  -- 同级序号不撞:根上这几组两两不同序,否则屏幕顺序退化成按 id 排。
  SELECT count(*) INTO v FROM (
    SELECT sort FROM access.permissions
     WHERE parent_id IS NULL AND perm_code LIKE 'tenant.menu.%'
     GROUP BY sort HAVING count(*) > 1
  ) dup;
  IF v <> 0 THEN
    RAISE EXCEPTION '租户菜单根上有同序的组:侧栏顺序会变成按 id 排';
  END IF;
END $$;

COMMIT;
