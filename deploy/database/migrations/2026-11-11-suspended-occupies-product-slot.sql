-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 被冻结的订阅也占着 workspace×product 那个槽位
--
-- 【现场】
-- 2026-09-26 上线走查时 owner 发现：订阅被暂停期间，官网产品卡片显示的是「订阅」而不是
-- 「升级」。那只是露出来的一角——真正的问题在这条唯一索引的谓词里：
--
--   WHERE status IN ('active','trialing','expiring','overdue')   ← 没有 suspended
--
-- 于是「一个 workspace × product 至多一条当前订阅」这条不变式在冻结期间**不成立**。
-- 本机库上实测的完整链条：
--   ① 订阅 → suspended
--   ② 同 workspace×product 再 INSERT 一条 active   → 索引不拦，两行并存
--   ③ 运营点「恢复订阅」                            → 23505，那条订阅从此恢复不了
-- 付费档还会让客户再付一次钱。
--
-- 【判据】
-- 「占位」与「在服务」是两个问题，答案在 suspended 这一档上相反：
--   · 权益问题（C2 / 用量 / 消费的 active+trialing 集合）——冻结中**不给**服务，对。
--   · 占位问题（还能不能再买一份、恢复后回不回得到原地）——冻结中**仍然占着**，
--     此前答错了。
-- 一个集合被两个问题共用，就会在某一档上同时对一个、错一个。这里只改占位那一侧。
--
-- 【为什么必须在库里改】
-- 应用层的守卫（console-bff 对 intent=new 的 409）挡的是正常路径；并发两笔同时进来时
-- 只有库能兜住。两层都要有。
--
-- 幂等：先查存量违例（有就**中止并点名**，不静默失败）→ DROP + CREATE 新谓词。
-- 迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 存量违例预检：有就中止，并把是谁点出来 ─────────────────────────────
-- 直接 CREATE UNIQUE INDEX 撞上存量重复会抛一条只有一对 id 的 23505，不知道还有几组。
-- 这里先数清楚再决定做不做——人工先把重复的那些收拾掉，再重跑这条迁移。
DO $$
DECLARE n int; sample text;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT workspace_id, product_id
      FROM metering.subscriptions
     WHERE status IN ('active','trialing','expiring','overdue','suspended')
       AND deleted_at IS NULL
     GROUP BY workspace_id, product_id
    HAVING count(*) > 1
  ) t;

  IF n > 0 THEN
    SELECT string_agg(format('ws=%s product=%s ×%s', workspace_id, product_id, c), '; ')
      INTO sample
      FROM (
        SELECT workspace_id, product_id, count(*) AS c
          FROM metering.subscriptions
         WHERE status IN ('active','trialing','expiring','overdue','suspended')
           AND deleted_at IS NULL
         GROUP BY workspace_id, product_id
        HAVING count(*) > 1
         LIMIT 20
      ) d;
    RAISE EXCEPTION
      '[suspended-occupies-slot] 存量已有 % 组重复（冻结行与在用行并存）。先人工收拾再重跑本迁移：%',
      n, sample;
  END IF;
END $$;

-- ── 2. 换谓词 ───────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS metering.uidx_subscriptions_live_per_product;
CREATE UNIQUE INDEX uidx_subscriptions_live_per_product
  ON metering.subscriptions (workspace_id, product_id)
  WHERE status IN ('active','trialing','expiring','overdue','suspended')
    AND deleted_at IS NULL;

COMMIT;

-- ── 审计：证明它现在真的拦得住冻结那一档 ────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE schemaname = 'metering' AND indexname = 'uidx_subscriptions_live_per_product';
  IF def IS NULL THEN
    RAISE EXCEPTION '[suspended-occupies-slot] 唯一索引不在';
  END IF;
  -- 断言谓词本身含 suspended：只查「索引存在」会在谓词写错时照样通过。
  IF def NOT LIKE '%suspended%' THEN
    RAISE EXCEPTION '[suspended-occupies-slot] 谓词里没有 suspended：%', def;
  END IF;
  IF def NOT LIKE '%UNIQUE%' THEN
    RAISE EXCEPTION '[suspended-occupies-slot] 建成了非唯一索引：%', def;
  END IF;
  RAISE NOTICE '[suspended-occupies-slot] OK —— 冻结中的订阅也占槽位，重复购买在库级被拦下';
END $$;
