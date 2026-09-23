-- ═══════════════════════════════════════════════════════════════════════════
-- 补上席位指标 `seat.max`（owner 2026-09-23：「需要补充 seats 指标，必须项，
-- 默认为 1」）。与同批的 2026-10-27 退役 `member.max` 是一件事的两半：
-- 摘掉那个不生效的占位，补上真正按产品分配的席位。
--
-- ── 席位是什么（data_commerce_250 §0）──
-- 某个**产品**在某个工作区里，允许多少个自然人使用。owner 原话：「销售智能体 10
-- 席位、方案智能体 5 席位，都来自这 100，可能还有重叠」。
--   · 单个产品的席位数 ≤ 容器的成员数
--   · 各产品席位数之和**不设上限**（重叠是正常的，不是超卖）
-- 与 2026-10-25 那道租户成员闸是两个维度：那条管「最多能装多少人」，这条管
-- 「某个产品能给其中几个人用」。
--
-- ── 键名为什么是 seat.max 而不是裸 seats ──
-- product_220 成文的 `limits` 键规范：键 = `merge_strategy='max'` 的 metric_key，
-- 命名惯例 `{entity}.max`。裸 `seats` 看不出是上限类，也进不了那条规范；
-- 与既有的 `member.max` / `dataset.max` / `service_endpoint.max` 同形才对。
-- 单位仍写 `seats`——键名表意、单位表量纲，两回事。
--
-- ── 「必须项」= 六个可订阅产品都登记 ──
-- 现状只有 arda(10) 与 karda(3) 有指标，atlas/runos/umbra/vxtpl 是零。席位是通用
-- 概念，不是某个产品特有，所以按产品逐个登记（`product_metrics` 的行就是
-- 「这个产品计量什么」）。不进 `platform_metrics`：那张表的语义是「有成本的共享池」，
-- 席位零成本，与 owner「配额只给有成本的」那条裁定打架。
--
-- ── 「默认为 1」= 每个套餐组件的 quota 里给 1 ──
-- 只给**尚未写**这个键的组件补 1，已经写了的不动——将来运营给某档位设成 10，
-- 重放本迁移不该把它冲回 1（同 metric_catalog 命名那条的理由）。
--
-- 已发布版本同样要补：它们现在缺这个键，而 `limits` 就高合并遇到缺键会当 0，
-- 等于「一个人都不能用」。这是本迁移必须碰锁定版本的理由，做法与 10-27 同：
-- 只在本事务内禁用守卫触发器、改完立刻恢复并断言、逐行留痕。
--
-- 重复执行安全。
-- ═══════════════════════════════════════════════════════════════════════════

-- ① 六个可订阅产品登记 seat.max
INSERT INTO product.product_metrics
  (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period)
SELECT p.id, 'seat.max', 'max', NULL, 'seats', 'none'
  FROM product.products p
 WHERE p.deleted_at IS NULL
   AND p.standalone_subscribable
   AND NOT EXISTS (
     SELECT 1 FROM product.product_metrics m
      WHERE m.product_id = p.id AND m.metric_key = 'seat.max'
   );

-- ② 中文名（与 metric_catalog 那批同一口径：名字是键的属性）
INSERT INTO product.metric_catalog (metric_key, display_name, description)
VALUES ('seat.max', '席位', '该产品可供多少名成员使用；同一个人可同时占用多个产品的席位')
ON CONFLICT (metric_key) DO NOTHING;

-- ③ 每个套餐组件默认 1
DO $$
DECLARE
  added int;
  r     record;
BEGIN
  FOR r IN
    SELECT p.plan_code, pv.version_no, pv.status
      FROM product.plan_components pc
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans p ON p.id = pv.plan_id
     WHERE NOT (pc.quota ? 'seat.max')
     ORDER BY p.plan_code, pv.version_no
  LOOP
    RAISE NOTICE '[seat-max] 补默认值 %  v%  (%)', r.plan_code, r.version_no, r.status;
  END LOOP;

  ALTER TABLE product.plan_components DISABLE TRIGGER trg_plan_component_guard_lock;
  UPDATE product.plan_components
     SET quota = quota || '{"seat.max": 1}'::jsonb
   WHERE NOT (quota ? 'seat.max');
  GET DIAGNOSTICS added = ROW_COUNT;
  ALTER TABLE product.plan_components ENABLE TRIGGER trg_plan_component_guard_lock;

  RAISE NOTICE '[seat-max] 套餐组件补默认值 % 处（第二遍应为 0）', added;
END $$;

DO $$
DECLARE
  products int;
  missing  int;
  guard    char(1);
BEGIN
  SELECT count(*) INTO products
    FROM product.product_metrics WHERE metric_key = 'seat.max';
  SELECT count(*) INTO missing
    FROM product.plan_components WHERE NOT (quota ? 'seat.max');
  SELECT tgenabled INTO guard
    FROM pg_trigger
   WHERE tgrelid = 'product.plan_components'::regclass
     AND tgname = 'trg_plan_component_guard_lock';

  IF missing > 0 THEN
    RAISE EXCEPTION '[seat-max] 仍有 % 个套餐组件没有 seat.max', missing;
  END IF;
  /* 破例之后守卫必须回到原位——这条断言就是为它写的。 */
  IF guard IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION '[seat-max] trg_plan_component_guard_lock 未恢复（tgenabled=%）', guard;
  END IF;

  RAISE NOTICE '[seat-max] % 个产品登记了 seat.max；套餐组件 0 缺失；锁定守卫已恢复', products;
END $$;
