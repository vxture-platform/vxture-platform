-- ═══════════════════════════════════════════════════════════════════════════
-- 回填存量已发布版本的发布时刻（owner 2026-09-22：「对已经发布的套餐，版本号进行
-- 格式化补齐日期」）。
--
-- ── 上一条迁移为什么留空，这一条为什么又填 ──
-- 2026-10-19 加 `published_at` 时我留空不回填，理由是「本列上线前发布的版本没有这个
-- 时刻可考，拿别的时刻冒充就是给一个看起来很确定的错答案」。owner 看过这个理由后
-- 仍要求补齐——那么问题就变成**用哪个代理值、它有多准**，而不是填不填。
--
-- ── 选 plan_versions.created_at，不选 plans.updated_at ──
-- 两个候选：
--   plan_versions.created_at   这一版的草稿何时开的
--   plans.updated_at           发布时会被 `SET current_version_id, updated_at = now()`
--                              写一次，**理论上更接近发布时刻**
-- 选前者。后者被后来的任何一次改动污染：2026-09-22 的「改为邀请订阅」开关也写
-- updated_at，于是 arda/karda/umbra 那几档的 plans.updated_at 现在是**翻开关那一刻**，
-- 不是发布那一刻。被污染的「更准」比诚实的近似更糟。
--
-- created_at 在本库的实际分布（迁移前实测 16 个已发布版本）：
--   arda 六档 / karda-free / umbra-free v1   2026-08-20  seed 那一次
--   vxtpl 三档 v1/v2                         08-30~09-02
--   umbra-free v2 / umbra-pro v1             09-22
-- seed 那批是同一事务里建完就发布的，created_at 就是发布时刻，准确。admin 建的那几
-- 档草稿到发布也在同日到数日内。所以这个代理值站得住。
--
-- ── 只补空的 ──
-- `published_at IS NULL` 才写。已经有真值的（本列上线之后发布的）一律不动——那些是
-- 事实，不许被近似值覆盖。所以这条迁移重复执行安全，且随着时间推移它命中的行只会
-- 越来越少、最终为零。
--
-- 只 UPDATE `published_at` 一列：它在 98 的 GRANT 名单里（上一条迁移加的）。
-- 不碰 major_no（锚点列）、不碰 version_no（锚点列）。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  filled int;
  still_null int;
BEGIN
  WITH done AS (
    UPDATE product.plan_versions
       SET published_at = created_at
     WHERE status = 'published'
       AND published_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO filled FROM done;

  SELECT count(*) INTO still_null
    FROM product.plan_versions
   WHERE status = 'published' AND published_at IS NULL;

  RAISE NOTICE '[backfill-published-at] 补齐 % 个已发布版本的发布时刻（取 created_at 为近似）；仍为空 % 个',
    filled, still_null;
END $$;
