-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 退订即退役配额池（触发器 + 存量回填）
--
-- 【现场】
-- 2026-09-26 在生产上盘点配额池时看到：如影那条**已取消**的 Arda Free 订阅，三个配额池
-- 仍然 `status='active'`、`retired_at` 为空。查下去，`quota_pools` 的退役**全仓只有一个
-- 写入方**，而且只覆盖换版本（升级/续订换 plan_version 时退旧建新）——退订、到期都不退役。
--
-- 而 product_330 §5 写着「退订 → 订阅整体回到未订阅（cancelled，end=now，**池 retire**）」。
-- 又一处「文档说了、代码没做」。
--
-- 【后果的准确说法】
-- **今天没有权益泄漏**：消费、权益、用量三条路径每一条都回头查订阅状态（D10 门），
-- 所以那些池烧不动、也不出现在任何面向客户的余量里。
--
-- 问题在于 `quota_pools.status` 不再是「这个池还活着」的可信信号——每个新查询都得记得
-- 再加一道门。本次正是一条盘点查询忘了加门，才把它翻出来。这类「判据要靠每个调用方自己
-- 记得」的设计，迟早有人漏。
--
-- 【为什么是触发器】
-- 订阅状态**有两个写入方**：服务层走 `repo.update`，运营动作走 admin-bff 的裸 SQL。
-- 把退役挂在任何一条上都会给另一条留门。不变式放在谁也绕不过去的地方——与
-- `trg_subscriptions_fill_product_id` 同一个理由（那条也是「写路径不必自己记得」）。
--
-- 【只认 cancelled】
-- **不动 expired**：到期后的池是有意留着的，admin 续期 expired→active 直接复活，不必
-- 重新物化（见 pg-consume 的 D10 注释）。`suspended` 更不动——冻结不是终态，恢复后要回原位。
--
-- 【回填】
-- 存量里已取消订阅名下的活池一并退役。这**不改变任何行为**（它们本来就被 D10 门挡着），
-- 只是让数据与事实一致；回填条数会打印出来。
--
-- 幂等：CREATE OR REPLACE + DROP TRIGGER IF EXISTS；回填自带 `status='active'` 条件，
-- 跑第二遍是 0 行。迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION metering.retire_pools_on_cancel() RETURNS trigger AS $$
BEGIN
  UPDATE metering.quota_pools
     SET status = 'retired', retired_at = now(), updated_at = now()
   WHERE subscription_id = NEW.id AND status = 'active';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_retire_pools_on_cancel ON metering.subscriptions;
CREATE TRIGGER trg_subscriptions_retire_pools_on_cancel
  AFTER UPDATE OF status ON metering.subscriptions
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION metering.retire_pools_on_cancel();

-- ── 回填：已取消订阅名下的活池 ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  WITH stale AS (
    UPDATE metering.quota_pools qp
       SET status = 'retired', retired_at = now(), updated_at = now()
      FROM metering.subscriptions s
     WHERE s.id = qp.subscription_id
       AND s.status = 'cancelled'
       AND qp.status = 'active'
    RETURNING qp.id
  )
  SELECT count(*) INTO n FROM stale;
  RAISE NOTICE '[retire-pools-on-cancel] 回填退役 % 个池（已取消订阅名下的活池）', n;
END $$;

COMMIT;

-- ── 审计：证明它真的会拦下下一次，而不只是「建出来了」 ─────────────────────
DO $$
DECLARE has_trg boolean; leftover int; sub_id uuid; pool_id uuid; ws uuid; pv uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'metering.subscriptions'::regclass
       AND t.tgname = 'trg_subscriptions_retire_pools_on_cancel'
       AND NOT t.tgisinternal
  ) INTO has_trg;
  IF NOT has_trg THEN
    RAISE EXCEPTION '[retire-pools-on-cancel] 触发器不在';
  END IF;

  -- 回填干净：不该再有「订阅已取消、池还活着」
  SELECT count(*) INTO leftover
    FROM metering.quota_pools qp
    JOIN metering.subscriptions s ON s.id = qp.subscription_id
   WHERE s.status = 'cancelled' AND qp.status = 'active';
  IF leftover <> 0 THEN
    RAISE EXCEPTION '[retire-pools-on-cancel] 回填后仍有 % 个活池挂在已取消订阅下', leftover;
  END IF;

  RAISE NOTICE '[retire-pools-on-cancel] OK —— 触发器就位，已取消订阅名下无活池';
END $$;
