-- ═══════════════════════════════════════════════════════════════════════════
-- 库驱动的 i18n 键统一成 `catalog.<…>.name` / `catalog.<…>.desc`
-- （owner 2026-09-22 两条裁定：「六张表一次性治」「库驱动的另起顶层」）。
--
-- ── 病症一：名键与说明键在嵌套 messages 树里不可共存 ──
-- 旧方案是 `<X>` 与 `<X>.desc` 两个平级键。next-intl 按点号逐级下钻：前者要求
-- `<X>` 这个节点是字符串、后者要求它是对象——**一棵树里不可能同时成立**。
-- 于是这些词条一条也写不出来，`t.has()` 恒假、静默回落到库里的英文名列，不报错。
-- 全库实测 6 张表 / 230 行全是这个形状（admin.operator_role 已于 2026-10-23 单独治过）。
--
-- 症状不是「没人翻译」，是「按这个键格式没法翻译」。两者在界面上长得一模一样。
--
-- ── 病症二：库驱动的键与页面自己的词条共用顶层 ──
-- `access.perm.*` / `access.role.*` 落进 console 已有的 `access` 命名空间，而那里
-- 装的是某个页面自己的文案（access.title / access.description / access.back…）。
-- 今天不冲突（该节点下没有 perm/role 子键），但两类词条寿命不同——一个跟页面走、
-- 一个跟数据走——共用顶层迟早互相踩。`ops` 与 arche 的关系同理。
--
-- 所以库驱动的一律搬进**专属顶层 `catalog`**。实测该顶层在六个门户的 messages 里
-- 全空，不会撞既有词条。
--
-- ── 归一后的不变式（一句话，可被守卫检查）──
--   凡目录表的 `*_key` 列，值必须以 `catalog.` 开头、以 `.name` 或 `.desc` 结尾。
--
-- ── 零视觉风险 ──
-- 这 230 行对应的词条**一条都不存在**（六个门户实测：loyalty/product 顶层全空，
-- ops 下只有 2026-10-23 加的角色那组，access 下只有 console 页面自己的文案）。
-- 所以改完仍旧全部回落到英文名列，显示与改前逐字相同；本迁移只是把「以后能翻译」
-- 这条路打通。
--
-- ── 幂等 ──
-- 每张表都以 `NOT LIKE 'catalog.%'` 为闸；跑第二遍时全部已带前缀 ⇒ 0 行。
-- 基串先剥掉可能已有的 `.name` 后缀再重拼，所以 operator_role（已是 `.name` 结尾）
-- 也能正确变成 `catalog.….name`，不会拼成 `.name.name`。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t        record;
  moved    int;
  total    int := 0;
  tables   int := 0;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('admin',   'operator_role',           'role_name_key'),
      ('admin',   'operator_permission',     'perm_name_key'),
      ('access',  'permissions',             'perm_name_key'),
      ('access',  'roles',                   'role_name_key'),
      ('product', 'plans',                   'plan_name_key'),
      ('product', 'launch_checklist_items',  'item_name_key'),
      ('loyalty', 'level_policies',          'level_name_key')
    ) AS v(sch, tbl, namecol)
  LOOP
    /* 基串 = 现值剥掉尾部的 `.name`（若有）。说明键一律由基串重拼，
       不沿用旧的 description_key——旧值正是那个写不出来的 `<X>.desc`。 */
    EXECUTE format($q$
      UPDATE %I.%I
         SET %I           = 'catalog.' || regexp_replace(%I, '\.name$', '') || '.name',
             description_key = 'catalog.' || regexp_replace(%I, '\.name$', '') || '.desc'
       WHERE %I IS NOT NULL
         AND %I NOT LIKE 'catalog.%%'
    $q$, t.sch, t.tbl, t.namecol, t.namecol, t.namecol, t.namecol, t.namecol);
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved > 0 THEN
      tables := tables + 1;
      total := total + moved;
      RAISE NOTICE '  %.% → % 行', t.sch, t.tbl, moved;
    END IF;
  END LOOP;

  RAISE NOTICE '[db-i18n-namespace] 归一 % 张表 / % 行（第二遍应为 0 张）', tables, total;
END $$;

-- ── 不变式断言：归一之后不该再有任何一行不合规 ──────────────────────────────
DO $$
DECLARE
  t      record;
  bad    int;
  total  int := 0;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('admin',   'operator_role',           'role_name_key'),
      ('admin',   'operator_permission',     'perm_name_key'),
      ('access',  'permissions',             'perm_name_key'),
      ('access',  'roles',                   'role_name_key'),
      ('product', 'plans',                   'plan_name_key'),
      ('product', 'launch_checklist_items',  'item_name_key'),
      ('loyalty', 'level_policies',          'level_name_key')
    ) AS v(sch, tbl, namecol)
  LOOP
    EXECUTE format($q$
      SELECT count(*) FROM %I.%I
       WHERE %I IS NOT NULL
         AND (%I NOT LIKE 'catalog.%%' OR %I NOT LIKE '%%.name'
              OR description_key IS NULL
              OR description_key NOT LIKE 'catalog.%%' OR description_key NOT LIKE '%%.desc')
    $q$, t.sch, t.tbl, t.namecol, t.namecol, t.namecol) INTO bad;
    IF bad > 0 THEN
      RAISE WARNING '  %.% 仍有 % 行不合规', t.sch, t.tbl, bad;
      total := total + bad;
    END IF;
  END LOOP;

  IF total > 0 THEN
    RAISE EXCEPTION '[db-i18n-namespace] 归一后仍有 % 行不满足「catalog. 开头 + .name/.desc 结尾」', total;
  END IF;
  RAISE NOTICE '[db-i18n-namespace] 不变式成立：七张目录表的键全部 catalog.* + .name/.desc';
END $$;
