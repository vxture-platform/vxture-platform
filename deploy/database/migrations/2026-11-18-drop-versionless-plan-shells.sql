-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-18-drop-versionless-plan-shells.sql
-- 清掉零版本的套餐壳：套餐行在、版本一个都没有——桌面看不见、码被占着、也补不了版本
--
-- ── 怎么来的（owner 2026-09-27 撞到：「tenderforge-starter 怎么被占用了，无法创建」）──
-- 建套餐是「套餐行 + v1 草稿 + 主组件」一个事务，但「删除草稿」只删版本行，不看它是不是
-- 最后一个版本。删掉唯一的 v1 之后套餐行留下，于是：
--   · 套餐矩阵按「版本 → 主组件」定档位，零版本的行被 JOIN 丢掉，桌面上那一格显示为空；
--   · 再建同码：档位占用检查只看版本/组件，放行；INSERT 撞 uq_plans_plan_code，报
--     「already exists」——运营看到的是「被占用、无法创建」；
--   · 给壳开新草稿也不行：新草稿要从已有版本克隆，零版本 → 「no versions to clone from」。
-- 生产实测（2026-09-27，reporting_ro）：20 条套餐里 4 条是壳——tenderforge-free（09-17 建、
-- 09-18 删草稿）、tenderforge-starter（09-22 建、两分钟后删草稿）、karda-business /
-- karda-enterprise（08-20 由 seed 同秒建，v1 草稿后来没了，成因未追）；四条均未被方案绑定。
-- seed-catalog.mjs 给 karda 五档各建「套餐 + 草稿 v1 + 主组件」，且 on conflict do nothing：
-- 新库不会长出壳；清掉之后若 seed 再跑，长回来的也是带 v1 的正常套餐，不是壳。
--
-- ── 做什么 ──
-- 删掉「零版本且未被方案绑定」的套餐行。套餐级外键只有两条：plan_versions.plan_id
--（CASCADE，此处本就零行）与 solution_plans.plan_id（NO ACTION，用 NOT EXISTS 让开——绑着
-- 壳的方案本身就是坏数据，留给人看，本迁移不碰，只在 NOTICE 里点名）。订阅与订单都挂在
-- 版本上，零版本 ⇒ 零客户足迹，与 admin「删除套餐」的可删判据同义。
-- 配套代码（同一 PR）：admin-bff 删版本时若是套餐唯一的版本则 409，改走「删除套餐」；
-- 此后壳不再产生，本迁移只清存量。
--
-- 重复执行安全：条件删除，第二遍命中 0 行。计数只进 RAISE NOTICE，不做断言。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  removed_n     integer;
  removed_codes text;
  skipped_codes text;
BEGIN
  WITH gone AS (
    DELETE FROM product.plans p
     WHERE NOT EXISTS (SELECT 1 FROM product.plan_versions v WHERE v.plan_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM product.solution_plans sp WHERE sp.plan_id = p.id)
    RETURNING p.plan_code
  )
  SELECT count(*), string_agg(plan_code, ', ' ORDER BY plan_code)
    INTO removed_n, removed_codes
    FROM gone;

  RAISE NOTICE 'drop-versionless-plan-shells: removed % plan shell(s)%',
    removed_n,
    CASE WHEN removed_n > 0 THEN ' — ' || removed_codes ELSE '' END;

  -- 还剩的零版本行只能是「被方案绑着」的：点名，交给人处理。
  SELECT string_agg(p.plan_code, ', ' ORDER BY p.plan_code)
    INTO skipped_codes
    FROM product.plans p
   WHERE NOT EXISTS (SELECT 1 FROM product.plan_versions v WHERE v.plan_id = p.id);

  IF skipped_codes IS NOT NULL THEN
    RAISE NOTICE 'drop-versionless-plan-shells: still versionless but bound by a solution, left for a human: %',
      skipped_codes;
  END IF;
END $$;

COMMIT;
