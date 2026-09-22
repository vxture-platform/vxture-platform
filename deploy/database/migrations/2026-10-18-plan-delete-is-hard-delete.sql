-- ═══════════════════════════════════════════════════════════════════════════
-- 套餐删除改「真删」，并清掉存量软删行（owner 2026-09-22 裁定）。
--
-- ── 裁定 ──
--   从来没人订过 / 没下过单 / 没被方案绑过  →  真删，整行删掉
--   卖过的                                →  只有退役一条路（行还在、查得到）
-- 中间那个「软删」态被撤了。
--
-- ── 为什么必须撤 ──
-- `uq_plans_plan_code` 是普通唯一约束，不排除软删行；而档位占用检查写的是
-- `deleted_at IS NULL`。两个判据对「软删行算不算」判得不一样，于是：
--   删掉一档 → 想用回同一个 plan_code → 占用检查放你过 → INSERT 撞 23505
--   → 运营侧只看到一句「Internal server error」
-- owner 2026-09-22 在 umbra 上撞到这一条，本迁移放开被占住的码位。
--
-- ── 判据与代码同源 ──
-- 下面三条 NOT EXISTS 就是 admin-bff `readPlanDeletionImpact` 检的那三条，也正是
-- 硬删会撞的三个无 CASCADE 外键。改一处要改两处，别让它们分叉。
-- plan_versions（plan_id CASCADE）、plan_prices / plan_components
-- （plan_version_id CASCADE）是子行，随删。
--
-- ── 故意不删的那些 ──
-- 软删行里**判据不过**的（有订单/订阅/方案绑定）一行不动：那是按新模型本就该走
-- 退役的行，这里不替 owner 做决定，只把剩余数量报出来。
--
-- 不写「全库共 N 条」这类断言：migrate 是全量重放，每份跑在最终状态上，这种数会
-- 随后来的任何一次新增而失效。重复执行安全（第二次删 0 行）。
--
-- 另一条路径未变更：opera 删产品时会连带软删它名下的套餐
-- （bff/opera-bff/.../product-catalog.router.ts，那条路径上产品行本身也是软删），
-- 所以 plans.deleted_at 这一列与读路径上的 `deleted_at IS NULL` 过滤一律保留。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  freed   int;
  kept    int;
BEGIN
  WITH gone AS (
    DELETE FROM product.plans p
     WHERE p.deleted_at IS NOT NULL
       AND NOT EXISTS (
             SELECT 1
               FROM metering.subscriptions s
               JOIN product.plan_versions pv ON pv.id = s.plan_version_id
              WHERE pv.plan_id = p.id)
       AND NOT EXISTS (
             SELECT 1
               FROM billing.orders o
               JOIN product.plan_versions pv ON pv.id = o.plan_version_id
              WHERE pv.plan_id = p.id)
       AND NOT EXISTS (
             SELECT 1
               FROM product.solution_plans sp
              WHERE sp.plan_id = p.id)
    RETURNING p.plan_code
  )
  SELECT count(*) INTO freed FROM gone;

  SELECT count(*) INTO kept
    FROM product.plans p
   WHERE p.deleted_at IS NOT NULL;

  RAISE NOTICE '[plan-hard-delete] 放开码位 % 个；仍保留的软删行 % 个（有足迹，按新模型应走退役）',
    freed, kept;
END $$;
