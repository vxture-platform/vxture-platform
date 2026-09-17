-- 2026-10-10-product-layer.sql
-- 产品分层落库：product.products 加 layer 列（owner 2026-09-17 裁定）
--
-- 起因：层级 L1/L2/L3 在库里一直没有落点。三处定义互相矛盾——
--   · 成文权威 docs/30-design/product_100_matrix.md §2 逐产品列了层；
--   · docs/20-specs/000-platform/opera/40-product-registry.md 说「层级只有一处判定，
--     由 product_type 推，没有按产品码的回退表」；
--   · packages/core/utils/src/product-taxonomy.ts 头注释却说「层级是产品的定位，
--     不是类型，单独维护」。
-- 而 layerFromProductType() 判 L1 靠 model_platform / capability_platform，这两个值
-- 不在受管枚举 PRODUCT_TYPES 里，写入面 isValidProductType 挡死 → 死分支永远走不到。
-- 实际后果：atlas / runos / arda / karda 四个全填 general_platform，一律被判成 L2，
-- opera 服务状态页把 atlas 和 runos 也显示成 L2。
--
-- 裁定：层级单独维护（这正是 product-taxonomy.ts 自己写过的话），产品定义时明确、
-- 上线后也可以改 —— 后半句意味着 layer 必须进 98 列锁的 GRANT UPDATE，否则
-- platform_svc 改一次就是 42501 整条回滚。
--
-- 值域只收 L1/L2/L3（owner：「这不是一个维度的 lay，应该拆开」）：
--   · external（umbra）是**来源**，由既有的 products.origin 承载，不占层级；
--   · client（ruyin）与 internal（hermes）不是目录产品，进不了这张表；
--   · unclassified 只是「没填」的显示态，由 NULL 表达，不进 CHECK。
-- 值域权威 = @vxture-platform/shared 的 PRODUCT_LAYERS；lint:catalog-domains 锁两处一致。
--
-- 幂等：加列 / 加约束 / 建索引 / 回填全部可重放（migrate 是全量重放）。

BEGIN;

-- ── 1. 列 ────────────────────────────────────────────────────────────────────
ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS layer varchar(8);

COMMENT ON COLUMN product.products.layer IS
  '产品分层（product_100_matrix §2）：L1=基础支撑能力 / L2=域平台 / L3=智能体。定位轴，与 product_type（类型轴）、origin（来源轴）正交。NULL=未分类。值域权威 @vxture-platform/shared PRODUCT_LAYERS，lint:catalog-domains 锁 DDL 一致。';

-- ── 2. 值域约束（封闭值域，与 product_type「扩展型 kind 不加 CHECK」不同）──────
DO $$ BEGIN
  ALTER TABLE product.products
    ADD CONSTRAINT chk_products_layer
    CHECK (layer IS NULL OR layer IN ('L1','L2','L3'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_products_layer ON product.products (layer);

-- ── 3. 回填：逐个照 product_100_matrix.md §2，不自己编 ────────────────────────
-- 只填 NULL 行：重放不覆盖运营后续在 opera 里改过的值。
UPDATE product.products SET layer = 'L1'
 WHERE layer IS NULL AND deleted_at IS NULL
   AND product_code IN ('atlas', 'runos');

UPDATE product.products SET layer = 'L2'
 WHERE layer IS NULL AND deleted_at IS NULL
   AND product_code IN ('arda', 'karda', 'terra', 'ontos');

UPDATE product.products SET layer = 'L3'
 WHERE layer IS NULL AND deleted_at IS NULL
   AND product_code IN ('vxtpl', 'raven', 'anlan', 'forge', 'xuanzhen');

-- umbra 刻意不给层级：它是外部边界，归 origin 轴（origin='third_party'）。

-- ── 4. 98 列锁：layer 可写 ───────────────────────────────────────────────────
-- 「上线后也可以改」全靠这一条。列表 = 98_column_locks.sql 现有列 + layer。
GRANT UPDATE (
  product_code, product_type, layer, category_id, product_name, product_nick,
  description, capability_keys, tags, standalone_subscribable, icon_url, sort,
  config, release_version, build_number, released_at, status, updated_by,
  description_key, is_customer_visible, is_workforce_visible, origin,
  origin_provider, release_stage, marketing, launch_override_at,
  launch_override_by, launch_override_pending, updated_at, deleted_at
) ON product.products TO platform_svc;

-- ── 5. 断言：验「填对了」，不是验「语句跑过了」 ──────────────────────────────
DO $$
DECLARE
  bad_value  int;
  atlas_layer text;
  karda_layer text;
BEGIN
  SELECT count(*) INTO bad_value
    FROM product.products
   WHERE layer IS NOT NULL AND layer NOT IN ('L1','L2','L3');
  IF bad_value > 0 THEN
    RAISE EXCEPTION 'layer 出现值域外的值 % 行', bad_value;
  END IF;

  SELECT layer INTO atlas_layer FROM product.products
   WHERE product_code = 'atlas' AND deleted_at IS NULL;
  SELECT layer INTO karda_layer FROM product.products
   WHERE product_code = 'karda' AND deleted_at IS NULL;

  -- 产品行可能尚未 seed（新库顺序），只在行存在时校验。
  IF atlas_layer IS NOT NULL AND atlas_layer <> 'L1' THEN
    RAISE EXCEPTION 'atlas 应为 L1，实际 %', atlas_layer;
  END IF;
  IF karda_layer IS NOT NULL AND karda_layer <> 'L2' THEN
    RAISE EXCEPTION 'karda 应为 L2，实际 %', karda_layer;
  END IF;
END $$;

COMMIT;
