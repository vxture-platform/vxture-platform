-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-12-01-l3-layer-truth.sql — 分层收成一个真相：layer 蕴含类型族（决策 3，owner 2026-10-04）
--
-- ── 起因 ──
-- 「分层」在库里有三份编码、彼此没有任何机械链路：`layer`（定位轴）、`product_type` 的后缀族
-- `_platform` / `_agent`（类型轴）、`category_id` 1=智能体 / 2=平台（seed 造的分类表）。三者各有读者
-- （admin 绑定门只读 layer、官网分区只读类型后缀、category 只做显示），于是一个产品可以是
-- layer='L3' + product_type='general_platform' + category_id=2，库收下，三张面各说各的——
-- 官网把一个 L3 放进平台区、详情页显示「敬请期待」。生产真实在产的 L3（tenderforge / yucer）正是
-- 这样「登记了但分层没对齐」，ADR-013 还把它们的层写成了 L2。
--
-- ── 裁定 ──
-- `layer` 是定位轴的唯一权威；类型族由定位蕴含（L2 ⇒ *_platform，L3 ⇒ *_agent）；`undefined` 型是
-- 「类型未定」的占位，与任何层相容（吸收，D10）；`category_id` 的退役另起 PR。蕴含关系来自
-- product_100_matrix §1 的定义（L2「对象域平台」、L3「行业 agent 应用」），不是新立。
--
-- ── 谓词只写一次 ──
-- P := (deleted_at IS NOT NULL OR layer IS NULL OR product_type = 'undefined'
--       OR (layer = 'L2' AND right(product_type, 9) = '_platform')
--       OR (layer = 'L3' AND (product_type = 'agent' OR right(product_type, 6) = '_agent')))
-- M0 / M2 用 `NOT (P)`，M3 用 `CHECK (P)`，**逐字同一段**：M3 会拒的行没有一条逃得过 M2 的点名。
-- 两处判据不同形正是审查（§12 R2/R6）抓到的根因；lint:product-layer-family 比对 DDL 与本文件的 P 逐字相同。
-- 用 right() 不用 LIKE：'_' 在 LIKE 里是单字符通配。
--
-- ── 分段 ──
-- M0 审计：RAISE NOTICE 列出活行里 layer IS NULL 的产品，以及 NOT (P) 的产品——先看见，再动。
-- M1 回填：只填空、只填不含糊的方向——agent 族且 layer IS NULL ⇒ L3。**不**反向推 L2（umbra 是
--     general_platform 且刻意无层，platform 族推不出层）；**不**给 undefined 填层。
-- M2 停手：仍有 NOT (P) 的行 ⇒ RAISE EXCEPTION 点名。不一致不决定方向——矛盾行交 owner 在 opera
--     改完再重跑（本迁移幂等）。它同时覆盖 2026-10-10 按码回填出来的行与枚举外的历史 product_type。
-- M3 焊约束：chk_products_layer_type_family CHECK (P)，单行（列锁解析器要求），duplicate_object 吞掉。
-- M4 反向探针：事务内插、断言、删——只断言「约束存在」验不出它拦的是什么。
-- M5 98 列锁不动：layer 已在 GRANT UPDATE（2026-10-10 迁移）。
--
-- 幂等：M1 带 WHERE layer IS NULL；M2 在干净库上零命中；M3 吞 duplicate_object；M4 自清。整份一笔事务。
-- 本机验证：一次性 postgres:18-alpine 上整目录按序重放两遍（新约束会顶红前序迁移的话，单跑本份发现不了）。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── M0. 审计：先看见，再动 ───────────────────────────────────────────────────
DO $$
DECLARE
  unlayered text;
  contradictory text;
BEGIN
  SELECT string_agg(product_code || '(type=' || product_type || ')', '、' ORDER BY product_code)
    INTO unlayered
    FROM product.products
   WHERE deleted_at IS NULL AND layer IS NULL;
  RAISE NOTICE '[l3-layer-truth] 活行里尚未分层的产品：%', coalesce(unlayered, '(无)');

  SELECT string_agg(
           product_code || '(type=' || product_type || ', layer=' || coalesce(layer, 'NULL')
             || ', category=' || coalesce(category_id::text, 'NULL') || ')',
           '、' ORDER BY product_code)
    INTO contradictory
    FROM product.products
   WHERE NOT (deleted_at IS NOT NULL OR layer IS NULL OR product_type = 'undefined' OR (layer = 'L2' AND right(product_type, 9) = '_platform') OR (layer = 'L3' AND (product_type = 'agent' OR right(product_type, 6) = '_agent')));
  RAISE NOTICE '[l3-layer-truth] 回填前分层与类型族矛盾的产品：%', coalesce(contradictory, '(无)');
END $$;

-- ── M1. 回填：只填空、只填不含糊的方向 ──────────────────────────────────────
-- agent 族（含历史裸值 agent）而没有层的活行 ⇒ L3。platform 族不反推（umbra 刻意无层），undefined 不填。
UPDATE product.products
   SET layer = 'L3', updated_at = now()
 WHERE deleted_at IS NULL
   AND layer IS NULL
   AND (product_type = 'agent' OR right(product_type, 6) = '_agent');

-- ── M2. 矛盾行停手（全称否定式，与 M3 的 CHECK 逐字同一谓词）────────────────
DO $$
DECLARE
  contradictory text;
BEGIN
  SELECT string_agg(
           product_code || '(type=' || product_type || ', layer=' || coalesce(layer, 'NULL')
             || ', category=' || coalesce(category_id::text, 'NULL') || ')',
           '、' ORDER BY product_code)
    INTO contradictory
    FROM product.products
   WHERE NOT (deleted_at IS NOT NULL OR layer IS NULL OR product_type = 'undefined' OR (layer = 'L2' AND right(product_type, 9) = '_platform') OR (layer = 'L3' AND (product_type = 'agent' OR right(product_type, 6) = '_agent')));
  IF contradictory IS NOT NULL THEN
    RAISE EXCEPTION 'l3-layer-truth: 分层与类型族矛盾，先在 opera 改完再重跑（不一致不决定方向，本迁移不替人选）：%', contradictory;
  END IF;
END $$;

-- ── M3. 焊约束（单行；谓词与 M0/M2 逐字相同）────────────────────────────────
DO $$ BEGIN
  ALTER TABLE product.products ADD CONSTRAINT chk_products_layer_type_family CHECK (deleted_at IS NOT NULL OR layer IS NULL OR product_type = 'undefined' OR (layer = 'L2' AND right(product_type, 9) = '_platform') OR (layer = 'L3' AND (product_type = 'agent' OR right(product_type, 6) = '_agent')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── M4. 反向探针：约束真的拦得住、也真的放得过 ─────────────────────────────
DO $$
DECLARE
  rejected boolean;
  PROBE_BY constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  /* 每条探针只捕 check_violation：别的约束拒的不算（那说明探针本身选错了列），原样抛出。 */
  /* ① L3 + platform 族 ⇒ 必须拒 */
  BEGIN
    INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
    VALUES ('__l3_probe_a__', 'general_platform', '探针', 'draft', 'L3', PROBE_BY);
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION '[l3-layer-truth] 约束没拦住 L3 + general_platform';
  END IF;

  /* ② L3 + 既非 platform 也非 agent 的枚举外值 ⇒ 必须拒（推不出族就不许挂层） */
  BEGIN
    INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
    VALUES ('__l3_probe_b__', 'foo', '探针', 'draft', 'L3', PROBE_BY);
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION '[l3-layer-truth] 约束没拦住 L3 + foo（枚举外、无族）';
  END IF;

  /* ③ L2 + agent 族 ⇒ 必须拒（另一个方向也要拦） */
  BEGIN
    INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
    VALUES ('__l3_probe_c__', 'industry_agent', '探针', 'draft', 'L2', PROBE_BY);
    rejected := false;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION '[l3-layer-truth] 约束没拦住 L2 + industry_agent';
  END IF;

  /* ④ L3 + agent 族 ⇒ 必须放 */
  INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
  VALUES ('__l3_probe_d__', 'industry_agent', '探针', 'draft', 'L3', PROBE_BY);

  /* ⑤ L3 + undefined ⇒ 必须放（D10：占位型与任何层相容） */
  INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
  VALUES ('__l3_probe_e__', 'undefined', '探针', 'draft', 'L3', PROBE_BY);

  /* ⑥ platform 族 + 无层 ⇒ 必须放（umbra 的形状） */
  INSERT INTO product.products (product_code, product_type, product_name, status, layer, created_by)
  VALUES ('__l3_probe_f__', 'general_platform', '探针', 'draft', NULL, PROBE_BY);

  DELETE FROM product.products WHERE product_code LIKE '\_\_l3\_probe\_%' ESCAPE '\';

  RAISE NOTICE '[l3-layer-truth] chk_products_layer_type_family 就位：拦 L3+platform / L3+无族 / L2+agent，放 L3+agent / L3+undefined / platform+无层';
END $$;

COMMIT;
