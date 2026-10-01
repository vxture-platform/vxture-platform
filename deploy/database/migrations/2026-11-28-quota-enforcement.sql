-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-28-quota-enforcement.sql — B1：给「有成本」一个落点
--
-- owner 2026-10-01 两条裁定：
--   ① **硬限时平台要兜底，consume 直接拒**。这是对仓里 2026-08-10「平台记录不裁定、
--      每次 consume 都回 200」的**修正**，不是并存。
--   ② 默认档**按指标有无成本自动定**。
--
-- 裁定②此前无从执行:「有成本」在库里没有任何列表达它（2026-10-01 查证:DDL 与
-- @vxture-platform/shared 全仓搜 billable/has_cost/cost_bearing/unit_cost 零命中）。
-- 所以 2026-09-11 那条「配额只给有成本的」裁定从落地起就只能靠人记得——它不可执行也
-- 不可证伪。本迁移给它一个落点，这是本批唯一的结构改动。
--
-- ── 为什么只加这一列，不在池上存处置档 ──
-- 处置档（soft/hard）**从成本档派生，不入库**。两个判定点本来就拿得到指标：
--   · consume（`pg-consume.repository.ts`）已经为 consume_mode 查过
--     platform_metrics → 回落 product_metrics，同一处就能解析出成本档；
--   · C2 读池（`platform-entitlements.service.ts`）读 quota_pools 时已经
--     `JOIN product.platform_metrics`。
-- 更要紧的是**零个池**那种情况:工作空间从没订阅过，读不到任何池，而一个有成本的调用
-- 恰恰最该被拒——那时候池上的列根本不存在。所以判定依据必须是指标，不是池。
-- 存一份派生副本只会多一个漂移源（第一版写过，连带要加一条「有成本的池不许停在
-- soft」的不变式去给副本当警察——那个检查本身就是副本多余的证据）。
--
-- ── 为什么平台级共享键不需要这一列 ──
-- `product.platform_metrics` 的语义本身就是「有成本的共享池」——seed 里「席位零成本,
-- 故不进 platform_metrics」那条注释说明了这一点。那张表就是成本轴,进去即有成本。
-- 所以只有**产品自有的 pool 型**指标需要显式声明。
--
-- ── 回填用显式清单，看到清单外的就停 ──
-- 存量的 pool 型产品指标生产实测 8 个，逐个由 owner 定档:
--   karda.ingest / karda.search / karda.ask      → cost_bearing（都要过模型;本平台的
--                                                   推理计量唯一入口是 atlas）
--   service.api.call / quality.check.run         → zero_cost（arda 自有计算,
--                                                   owner 2026-10-01）
--   tenderforge.bid.generations                  → cost_bearing（生成标书要调模型,
--                                                   owner 2026-10-02）
--   tenderforge.document.characters              → zero_cost（存下来的文档字数,
--                                                   owner 2026-10-02）
--   tenderforge.document.exports                 → zero_cost（把已有内容转成文件,
--                                                   只花自己的算力,owner 2026-10-02）
-- **清单之外若还有 pool 型指标,本迁移 RAISE 停下,不替它猜**——猜零成本等于不封顶,
-- 猜有成本等于把客户 409 停掉,两个方向都有代价。
--
-- **第一版这里写的是「正好 5 个（karda 3 + arda 2）」,而生产是 8 个。** 错因:那个数是
-- 从 `seed/seed-catalog.mjs` 推的,而 tenderforge **整个产品都不在 seed 里**——它是通过
-- opera 的登记接口在运行时进库的,本机 seed 库里根本没有它。2026-10-02 生产 migrate 的
-- 第 3 段当场把这三个点名拦下。**这就是第 3 段存在的理由**:清单来自我手上的那份库,
-- 而回填作用于生产的那份,两份不是同一份;把「清单外」做成 RAISE 而不是默默跳过,
-- 差别正是这一次。下次扩这张表的值域,先问生产而不是问 seed。
--
-- 幂等：ADD COLUMN IF NOT EXISTS / 约束按 pg_constraint 判存在性 / 回填带 WHERE。
-- 2026-10-01 在一次性 postgres:18-alpine 上整目录重放两遍，本份两遍都 OK。
-- **2026-10-02 重验（第一次的验法不够）**：干净库验不到这次的东西——新库里没有
-- tenderforge（它不在 seed 里），清单新增的三行匹配 0 条，等于没测。所以改成
-- DDL + 真 seed 建底，再退回迁移前状态（摘掉两条 CHECK、把全部 pool 指标的
-- cost_class 清成 NULL、补上 tenderforge 那三行），整目录按序重放两遍：两遍都 OK，
-- 8 个 pool 指标全部落到应有的档，两条约束都在，且**反例被拒**（见下面那条判据的注释）。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. product_metrics.cost_class ───────────────────────────────────────────
ALTER TABLE product.product_metrics
  ADD COLUMN IF NOT EXISTS cost_class varchar(16);

COMMENT ON COLUMN product.product_metrics.cost_class IS
  'cost_bearing/zero_cost（仅 merge_strategy=pool 时非空）：这一笔会不会让我们付钱给谁。软/硬限由它派生（不入库）。平台级共享键不需要它——进 platform_metrics 即有成本。';

-- ── 2. 回填（显式清单） ─────────────────────────────────────────────────────
UPDATE product.product_metrics
   SET cost_class = 'cost_bearing'
 WHERE merge_strategy = 'pool'
   AND cost_class IS NULL
   AND metric_key IN ('karda.ingest', 'karda.search', 'karda.ask',
                      'tenderforge.bid.generations');

UPDATE product.product_metrics
   SET cost_class = 'zero_cost'
 WHERE merge_strategy = 'pool'
   AND cost_class IS NULL
   AND metric_key IN ('service.api.call', 'quality.check.run',
                      'tenderforge.document.characters',
                      'tenderforge.document.exports');

-- 平台级共享键若（违反 95 影子守卫）出现在 product_metrics 里，按「进 platform_metrics
-- 即有成本」补齐，不让它卡住迁移。
UPDATE product.product_metrics pm
   SET cost_class = 'cost_bearing'
 WHERE pm.merge_strategy = 'pool'
   AND pm.cost_class IS NULL
   AND EXISTS (SELECT 1 FROM product.platform_metrics lm WHERE lm.metric_key = pm.metric_key);

-- ── 3. 清单之外的 pool 型指标 → 停下，不猜 ──────────────────────────────────
DO $$
DECLARE
  v_unknown text;
BEGIN
  SELECT string_agg(DISTINCT p.product_code || ':' || m.metric_key, ', ' ORDER BY p.product_code || ':' || m.metric_key)
    INTO v_unknown
    FROM product.product_metrics m
    JOIN product.products p ON p.id = m.product_id
   WHERE m.merge_strategy = 'pool'
     AND m.cost_class IS NULL;

  IF v_unknown IS NOT NULL THEN
    -- RAISE 的格式串必须是**字面量**，不能用 || 拼（PL/pgSQL 语法；2026-10-01 在一次性
    -- 库上实测到 `syntax error at or near "||"`——静态检查与 CI 都看不出来）。所以这里
    -- 是一整行长字面量，别为了换行把它拆成拼接。
    RAISE EXCEPTION '本迁移的回填清单没有这些 pool 型指标，不替它们猜成本档：%。请先确认每一个是 cost_bearing 还是 zero_cost（猜零成本=不封顶，猜有成本=客户被 409 停掉），把它们加进本文件第 2 段的清单再跑。', v_unknown;
  END IF;
END
$$;

-- ── 4. 约束（按 pg_constraint 判存在性，幂等） ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_metrics_cost_class') THEN
    ALTER TABLE product.product_metrics
      ADD CONSTRAINT chk_product_metrics_cost_class CHECK (cost_class IS NULL OR cost_class IN ('cost_bearing','zero_cost'));
  END IF;
  -- pool 型必须声明成本档。缺声明不许被默默当成零成本——那个方向等于不封顶。
  --
  -- **先 DROP 再 ADD，不用 IF NOT EXISTS。** 第一版的判据是
  -- `merge_strategy <> 'pool' OR cost_class IN ('cost_bearing','zero_cost')`，它对
  -- pool + NULL **无效**：`cost_class IN (...)` 在 NULL 上求值为 NULL，整条得
  -- `false OR NULL` = NULL，而 CHECK 只在 FALSE 时拒。2026-10-02 在一次性库上实测：
  -- 约束在，`insert ... merge_strategy='pool'` 不带 cost_class 照样成功。
  -- 弱版已经随 #555 进了 DDL，所以任何在那之后按 DDL 新建的库都带着它，
  -- 而 IF NOT EXISTS 会把它原样留下。表只有个位数行，重建一次约束没有代价。
  --
  -- 值域仍由上面的 chk_product_metrics_cost_class 管，两条各管一半。
  ALTER TABLE product.product_metrics
    DROP CONSTRAINT IF EXISTS chk_product_metrics_pool_cost;
  ALTER TABLE product.product_metrics
    ADD CONSTRAINT chk_product_metrics_pool_cost CHECK (merge_strategy <> 'pool' OR cost_class IS NOT NULL);
END
$$;

-- ── 5. 审计段 ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pool_total int;
  v_cost       int;
  v_zero       int;
BEGIN
  SELECT count(*) INTO v_pool_total FROM product.product_metrics WHERE merge_strategy = 'pool';
  SELECT count(*) INTO v_cost       FROM product.product_metrics WHERE merge_strategy = 'pool' AND cost_class = 'cost_bearing';
  SELECT count(*) INTO v_zero       FROM product.product_metrics WHERE merge_strategy = 'pool' AND cost_class = 'zero_cost';

  RAISE NOTICE 'B1 成本声明：pool 型指标 % 个 —— 有成本 %、零成本 %', v_pool_total, v_cost, v_zero;

  IF v_cost + v_zero <> v_pool_total THEN
    RAISE EXCEPTION 'pool 型指标 % 个，但只有 % 个有成本档 —— 第 3 段本该拦住这种情况，它没拦住', v_pool_total, v_cost + v_zero;
  END IF;
END
$$;
