-- ═══════════════════════════════════════════════════════════════════════════
-- 三个运营角色改名：码与显示名一起改（owner 2026-09-22 裁定）。
--
--   admin      Admin        →  administrator  Administrator
--   operation  Operation    →  operator       Operator
--   tech_ops   SRE          →  engineer       Engineer
--
-- 伴生的两个 i18n 键跟着走（`ops.role.<code>` / `ops.role.<code>.desc`）——键是按码
-- 拼的，不跟着改就会指向一组不存在的词条，而 `t.has()` 恒假、静默回落到库里的英文名，
-- 不报错。
--
-- 另外四个角色（super_admin / finance / support / auditor）码与名都已对，不动。
-- sys_config 不在此列：它是系统预置内容的归集主体，`is_workforce_visible = false`
-- 本就不外显，owner 确认保持原样。
--
-- ── rank 一个都不改 ──
-- `rank` 是 98 列锁的**锚点列**（安全等级，跨 operator 操作的层级比较依据），
-- 放进 SET 列表会让整条 UPDATE 抛 42501 回滚。本次只改名，层级不动。
--
-- ── 为什么不怕被旧迁移覆盖回去 ──
-- 查过了：没有任何迁移 INSERT `admin.operator_role` 的行（五个候选全都是插
-- `operator_role_permission` 关联表）；角色行只由 seed 建，而 migrate 不重放 seed。
-- 唯一按码字面量筛的是 2026-10-05-brand-reset-codes.sql，本批已把它的 WHERE
-- 同时接受新旧两套码——否则全量重放到那一步会一条都匹配不上，新库里
-- administrator / operator 拿不到 tenant:brand.reset 与 user:avatar.reset。
--
-- ── 幂等 ──
-- 按旧码筛，跑第二遍时旧码已不存在 ⇒ 0 行。若新码已存在（seed 先跑过）则旧码行
-- 不会出现，同样 0 行，不会撞 uidx_operator_role_code。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  renamed int := 0;
  n       int;
  pair    text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['admin',     'administrator', 'Administrator'],
    ARRAY['operation', 'operator',      'Operator'],
    ARRAY['tech_ops',  'engineer',      'Engineer']
  ] LOOP
    UPDATE admin.operator_role
       SET role_code       = pair[2],
           role_name       = pair[3],
           role_name_key   = 'ops.role.' || pair[2],
           description_key = 'ops.role.' || pair[2] || '.desc',
           updated_at      = now()
     WHERE role_code = pair[1]
       AND NOT EXISTS (
             SELECT 1 FROM admin.operator_role x WHERE x.role_code = pair[2]
           );
    GET DIAGNOSTICS n = ROW_COUNT;
    renamed := renamed + n;
  END LOOP;

  RAISE NOTICE '[operator-role-rename] 改名 % 行（本批共 3 个码；第二遍应为 0）', renamed;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 顺带把 i18n 键统一成叶子节点下的 `.name` / `.desc`（owner：「i18n 支持，都显示英文」）。
--
-- 旧方案是 `ops.role.<code>` 与 `ops.role.<code>.desc` 两个平级键。**它写不出来**：
-- next-intl 按点号逐级下钻，前者要求 `<code>` 是字符串、后者要求它是对象，在一棵
-- 嵌套 JSON 里不可能同时成立。这就是为什么 `ops.*` 这一族词条六个门户里一条都没有
-- ——不是没人写，是按这个键格式写不出来。症状是 `t.has()` 恒假、静默回落到库里的
-- 英文列，不报错，所以一直没被当成缺陷。
--
-- 改成 `ops.role.<code>.name` 与 `ops.role.<code>.desc`，两条落在同一个节点下即可共存。
-- 八个角色一起改：部分集必然分叉。
--
-- 注：`admin.operator_permission` 的 `perm_name_key` 是同一个毛病（`ops.perm.x` +
-- `.desc`），不在本批范围——那一族有数百行，单独立项。
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE admin.operator_role
   SET role_name_key   = 'ops.role.' || role_code || '.name',
       description_key = 'ops.role.' || role_code || '.desc',
       updated_at      = now()
 WHERE role_name_key IS DISTINCT FROM 'ops.role.' || role_code || '.name'
    OR description_key IS DISTINCT FROM 'ops.role.' || role_code || '.desc';

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['super_admin','administrator','operator','finance','engineer','support','auditor']) c
   WHERE NOT EXISTS (SELECT 1 FROM admin.operator_role r WHERE r.role_code = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '[operator-role-rename] 改完之后这些码仍不存在：%', missing;
  END IF;
  RAISE NOTICE '[operator-role-rename] 七个外显角色码齐备';
END $$;
