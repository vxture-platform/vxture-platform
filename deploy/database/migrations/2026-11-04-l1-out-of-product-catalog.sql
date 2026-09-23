-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-04-l1-out-of-product-catalog.sql
-- atlas / runos 退出产品体系 —— 它们是平台基础环境，不是面向客户的订阅商品
--
-- owner 2026-09-23：「L0、L1 层级的产品都是平台的基础环境，不应出现在平台的产品中」
-- 「基础平台的 OIDC 原则上等同 opera、admin、console，根本不是面向客户的订阅产品」。
--
-- 所以这里做的不是「退役一个产品」，是**把两个从来就不是产品的东西搬回它们该在的地方**。
-- 与 2026-08-31 的 ruyin 降级同型：那次的判据是「它是一个 OAuth 客户端，不是一件
-- 可订阅/可退役的目录商品」——atlas / runos 更进一步，它们连客户端都是平台自己的，
-- 与 opera / admin / console / website 同类。
--
-- L0 不在本迁移范围内：`product.platform_metrics`（ai.credit / compute.* / storage.*）
-- 本来就不在产品表里（product_100 §1「L0 不是产品」），无须动。
--
-- ── 这件事会打断什么：换票受众 ──
-- auth-bff 的 `resolveTargetProductCode` 今天这么解析受众：
--     select product_code from product.products where product_code = $1 and status = 'active'
-- 也就是说 atlas / runos **能被换票指向，靠的正是它们在产品表里那一行**。断了的后果不只是
-- karda / arda 的 C1 出站调不到上游——opera 与 admin 自己也是用 `aud="atlas"` 换票去调
-- 上游管理面的，模型管理与能力管理两页会跟着全线失败。
--
-- 所以本批**先给受众另立落点**：解析改成「active 产品（且未软删）**或** 平台级 OIDC
-- 客户端」。这把判据搬回了它该在的地方——**「这个受众存不存在」该问客户端表，不该问
-- 商品目录**。今天那条查询恰好没过滤 `deleted_at`，纯软删因此暂时不会断；但那是靠一个
-- **缺失的过滤**活着，谁哪天顺手补上 `AND deleted_at IS NULL`（一个看起来完全正确的
-- 修复）生产就断，而且没人会把两件事联系起来。不建在这上面。
--
-- ── 顺序要求 ──
-- 本迁移与 auth-bff 的解析改动**必须同批上线**。单独先跑本迁移（客户端已降级、产品行
-- 已软删）而解析还只认产品表，换票在下一次 deploy 之前是靠那个缺失的过滤活着的——
-- 能活，但那段时间没有任何东西保证它活着。
--
-- ── 先断言无客户足迹，再动手 ──
-- 判据照 2026-08-31 的删除规则：**无客户足迹才可移除**。有订阅 / 有用量就拒绝执行——
-- 这样不管生产上是什么状态都安全，而不是拿本机 dev 库的数字去赌生产。
--
-- 幂等：全部带幂等条件（client_kind='product' / deleted_at IS NULL），可重复执行。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n_sub    bigint;
  n_usage  bigint;
  n_pool   bigint;
  n_bundle bigint;
  r        record;
BEGIN
  /* 连软删的订阅一起数。软删的订阅记的是「这个工作区曾经买过它」——那也是足迹，
     而且它的历史、账单、用量都还在。判据是「有没有人碰过」，不是「现在还在不在」。 */
  SELECT count(*) INTO n_sub FROM metering.subscriptions s
    JOIN product.products p ON p.id = s.product_id
   WHERE p.layer = 'L1';
  SELECT count(*) INTO n_usage FROM metering.usage_events u
    JOIN product.products p ON p.id = u.product_id
   WHERE p.layer = 'L1';
  SELECT count(*) INTO n_pool FROM metering.quota_pools q
    JOIN product.products p ON p.id = q.product_id
   WHERE p.layer = 'L1';

  /* 别人的套餐把 L1 当**搭售组件**挂着的话，也停手。步骤 ② 只软删「主组件是 L1」
     的那些套餐（atlas 自己那五个骨架）；一个主组件是 vxtpl、却搭了 atlas 的套餐，
     软删 atlas 之后会变成一个指向软删产品的组件——权益解析不报错，只是那一项从
     此不生效。docs 里 80-plan-bundled-components 正好写着这种用法，所以这不是
     假想。 */
  /* 点名，不只是计数。2026-09-23 生产上这一条真的拦下了一次（7 个组件），而当时
     它只报了个数字——于是「是哪几档」得再跑一趟才知道。一条拦住动作的断言必须同时
     说出它拦的是什么，否则每次命中都要额外一个审批周期去问库。 */
  n_bundle := 0;
  FOR r IN
    SELECT pl.plan_code, pv.version_no, p.product_code, pc.component_role, pv.status
      FROM product.plan_components pc
      JOIN product.products p  ON p.id = pc.product_id AND p.layer = 'L1'
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans pl ON pl.id = pv.plan_id AND pl.deleted_at IS NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM product.plan_components pc2
         JOIN product.products p2 ON p2.id = pc2.product_id
        WHERE pc2.plan_version_id = pv.id AND pc2.component_role = 'primary'
          AND p2.layer = 'L1')
     ORDER BY pl.plan_code, pv.version_no, p.product_code
  LOOP
    n_bundle := n_bundle + 1;
    RAISE WARNING '[l1-out-of-catalog] 搭售：套餐 % v% （%） 挂着 %（role=%）',
      r.plan_code, r.version_no, r.status, r.product_code, r.component_role;
  END LOOP;
  IF n_bundle <> 0 THEN
    RAISE EXCEPTION
      '[l1-out-of-catalog] 有 % 个组件把 L1 产品搭售进了别人的套餐（逐条见上面的 WARNING）—— 软删会让这些订阅的权益查询静默返回「未订阅」（pg-entitlement.repository 的 SQL 带 prod.deleted_at is null），先定这几档怎么办',
      n_bundle;
  END IF;

  /* 有客户足迹就停手。搬走一个有人买过、用过的东西，会让那些订阅与用量指向一行
     软删的产品——报表里它们不消失，只是查不到名字了。 */
  IF n_sub <> 0 OR n_usage <> 0 OR n_pool <> 0 THEN
    RAISE EXCEPTION
      '[l1-out-of-catalog] L1 产品有客户足迹（订阅 % / 用量 % / 配额池 %）—— 先处置足迹，不能直接搬走',
      n_sub, n_usage, n_pool;
  END IF;
END $$;

BEGIN;

-- ── ① 客户端降级：product 级 → platform 级 ────────────────────────────────
-- 与 opera / admin / console / website / ruyin 同类。realm 保持 customer 不变
-- （console 本就是 customer-realm 的 platform 级客户端，它们同型）。
-- `chk_oidc_clients_kind_product((platform) = (product_id IS NULL))` 始终成立：
-- 两列一起改。
UPDATE appoidc.oidc_clients c
   SET client_kind = 'platform', product_id = NULL, updated_at = now()
  FROM product.products p
 WHERE p.id = c.product_id
   AND p.layer = 'L1'
   AND c.client_kind = 'product';

-- ── ② 套餐骨架软删 ────────────────────────────────────────────────────────
-- atlas 有五个 seed 建的套餐骨架（全是 draft 版本）。一个不卖的东西不该有货架位。
UPDATE product.plans pl
   SET deleted_at = now(), updated_at = now()
 WHERE pl.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM product.plan_versions pv
       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
       JOIN product.products p ON p.id = pc.product_id
      WHERE pv.plan_id = pl.id
        AND pc.component_role = 'primary'
        AND p.layer = 'L1'
   );

-- ── ③ 指标登记清掉 ────────────────────────────────────────────────────────
-- 席位是卖点，而它们不卖。留着是孤儿行，还会在「补计量键中文名」这类盘点里再冒出来。
DELETE FROM product.product_metrics m
 USING product.products p
 WHERE p.id = m.product_id AND p.layer = 'L1';

-- ── ④ 产品行软删 ──────────────────────────────────────────────────────────
-- 软删而非硬删：可逆、留审计，且 seed 同批把它们移出 PRODUCTS，reseed 不会重建。
UPDATE product.products
   SET deleted_at = now(), updated_at = now()
 WHERE layer = 'L1' AND deleted_at IS NULL;

-- ── ⑤ 把规则焊进数据层 ────────────────────────────────────────────────────
-- 软删两行只是处理了**今天这两个**。owner 的话是一条规则，不是一次清理：
-- 「L0、L1 层级的产品都是平台的基础环境，不应出现在平台的产品中」。
--
-- 没有这条约束，明天在 opera 里登记一个 layer='L1' 的产品照样成功，而且不会有任何
-- 东西提醒谁——上一次「两份清单不一致」的教训就是这么来的：补数据不补判据。
--
-- L1 仍留在 chk_products_layer 的值域里：刚软删的这两行带着它，那是历史事实。
-- 这一条只约束**活着的行**，所以存量库能直接加，不需要先洗数据。
-- 配套：opera 的层级下拉同批改成只给 L2/L3，不然选了 L1 会撞成 500。
ALTER TABLE product.products DROP CONSTRAINT IF EXISTS chk_products_live_layer_not_l1;
ALTER TABLE product.products ADD CONSTRAINT chk_products_live_layer_not_l1
  CHECK (deleted_at IS NOT NULL OR layer IS NULL OR layer IN ('L2','L3'));

COMMIT;

DO $$
DECLARE
  n_live     int;
  ok_check   boolean;
  n_client   int;
  n_metric   int;
  n_plan     int;
  codes      text;
BEGIN
  SELECT count(*) INTO n_live FROM product.products
   WHERE layer = 'L1' AND deleted_at IS NULL;
  IF n_live <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] 产品表里还有 % 行活的 L1 产品', n_live;
  END IF;

  /* 客户端必须还在、且已经是平台级——**这一条比产品行更要紧**：客户端没了或者
     还挂着 product_id，换票受众就解析不到，opera 的上游管理页当场全红。
     断言的是「降级成功」，不是「删掉了」。 */
  SELECT count(*) INTO n_client FROM appoidc.oidc_clients
   WHERE client_id IN ('atlas','runos')
     AND client_kind = 'platform' AND product_id IS NULL AND status = 'active';
  IF n_client <> 2 THEN
    SELECT coalesce(string_agg(client_id||'('||client_kind||')', '、'), '(无)') INTO codes
      FROM appoidc.oidc_clients WHERE client_id IN ('atlas','runos');
    RAISE EXCEPTION
      '[l1-out-of-catalog] atlas/runos 的客户端没有全部降级成 active 的平台级（实为 %）—— 换票受众会解析不到',
      codes;
  END IF;

  SELECT count(*) INTO n_metric FROM product.product_metrics m
    JOIN product.products p ON p.id = m.product_id WHERE p.layer = 'L1';
  SELECT count(*) INTO n_plan FROM product.plans pl
   WHERE pl.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM product.plan_versions pv
                   JOIN product.plan_components pc ON pc.plan_version_id = pv.id
                   JOIN product.products p ON p.id = pc.product_id
                  WHERE pv.plan_id = pl.id AND pc.component_role='primary' AND p.layer='L1');
  IF n_metric <> 0 OR n_plan <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] 残留：指标登记 % 行、活套餐 % 个', n_metric, n_plan;
  END IF;

  /* 收尾再问一次「还有没有活着的套餐指向 L1」——这一条与上面的前置检查不是同一句：
     前置检查问的是**搭售**，这一条问的是**全部**。两句都为真才说明 L1 已经从售卖
     侧完全离场。 */
  SELECT count(*) INTO n_plan
    FROM product.plan_components pc
    JOIN product.products p  ON p.id = pc.product_id AND p.layer = 'L1'
    JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
    JOIN product.plans pl ON pl.id = pv.plan_id AND pl.deleted_at IS NULL;
  IF n_plan <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] 还有 % 个活套餐的组件指向 L1 产品', n_plan;
  END IF;

  /* 反向验证：约束真的拦得住。只断言「约束存在」验不出它拦的是什么——
     pg_constraint 里有一行，和那一行会拒掉一次插入，是两件事。 */
  BEGIN
    INSERT INTO product.products
      (id, product_code, product_type, product_name, status, layer, created_by)
    VALUES (gen_random_uuid(), '__l1_probe__', 'general_platform', '探针',
            'draft', 'L1', '00000000-0000-0000-0000-000000000000');
    ok_check := false;
  EXCEPTION WHEN check_violation THEN
    ok_check := true;
  END;
  IF NOT ok_check THEN
    RAISE EXCEPTION '[l1-out-of-catalog] chk_products_live_layer_not_l1 没拦住一行活的 L1 产品';
  END IF;
  /* 探针若真插进去了（约束失效那一支）也不能留下。上面已经 RAISE 了，这里是
     第二次执行时的保险——DO 块里的 EXCEPTION 会回滚到子事务起点，所以正常路径
     什么都没留下。 */
  DELETE FROM product.products WHERE product_code = '__l1_probe__';

  RAISE NOTICE '[l1-out-of-catalog] atlas/runos 已退出产品体系：产品行软删、套餐软删、指标清空；两个客户端降为平台级（与 opera/admin/console 同类）且仍 active —— 换票受众另由平台级客户端兜底';
END $$;
