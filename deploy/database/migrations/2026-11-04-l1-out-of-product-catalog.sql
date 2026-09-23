-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-04-l1-out-of-product-catalog.sql
-- atlas / runos 彻底退出产品体系 —— 它们是平台基础环境，不是面向客户的订阅商品
--
-- owner 2026-09-23：「L0、L1 层级的产品都是平台的基础环境，不应出现在平台的产品中」
-- 「基础平台的 OIDC 原则上等同 opera、admin、console，根本不是面向客户的订阅产品」
-- 「不是软删，要彻底从产品体系中清理，哪里报错修哪里，不能在这个根本问题上妥协，
--   更不能留残留问题」。
--
-- 所以这里做的不是「退役一个产品」，是**把两个从来就不是产品的东西从产品体系里拔掉**。
--
-- ── 为什么第一版的软删不行 ──
-- 初版照 2026-08-31 ruyin 降级的先例做软删（置 `deleted_at`）。2026-09-23 的生产
-- migrate 在前置检查上停住，报出**生产上有 7 个组件把 atlas / runos 当 bundled
-- 组件挂在别的产品套餐里**（本机库是 0，本地怎么跑都出不来）。
--
-- 软删对这 7 行是**最坏的一种处置**：权益解析那条 SQL
-- （`services/identity/iam/.../pg-entitlement.repository.ts`）带
-- `and prod.deleted_at is null`，于是产品一软删，这些订阅去查 atlas 权益就返回
-- 「未订阅」——**两侧都不报错，只是那一项从此不生效**。一行还在、引用还在、查询
-- 静默返回空，正是 owner 说的「残留问题」。
--
-- 硬删则不给这种中间态留地方：引用要么一并清掉、要么外键当场拦住。**删不掉的东西
-- 会报错，而报错是可以修的；静默失效不是。**
--
-- ── L0 不在范围内 ──
-- `product.platform_metrics`（ai.credit / compute.* / storage.*）本来就不在产品表里
-- （product_100 §1「L0 不是产品」），无须动。
--
-- ── 这件事会打断什么：换票受众 ──
-- auth-bff 原先这么解析受众：
--     select product_code from product.products where product_code = $1 and status = 'active'
-- 也就是说 atlas / runos **能被换票指向，靠的正是它们在产品表里那一行**。断了的后果
-- 不只是 karda / arda 的 C1 出站调不到上游——opera 与 admin 自己也是用 `aud="atlas"`
-- 换票去调上游管理面的。
--
-- 所以同批**先给受众另立落点**（PR #469 已合并）：解析改成「active 产品 **或**
-- `PLATFORM_LEVEL_S2S_TARGETS` ∩ active 的平台级 OIDC 客户端」。判据从商品目录搬回
-- 客户端表——「这个受众存不存在」本来就该问客户端表。
--
-- **顺序要求**：本迁移与那份代码必须同批上线。硬删之后产品表里连行都没有了，
-- 解析要是还只认产品表，换票当场就断——这一条比软删那一版更硬。
--
-- ── 仍然拒绝执行的一种情况：真的有人买过 ──
-- 钱和用量不在「残留」的范畴里：有订阅 / 有订单 / 有账单项 / 有用量事件 / 有配额池
-- 指向 L1 产品，就**停手并报出来**。那不是对根本问题的妥协，是「不许静默删掉一件
-- 客户付过钱的东西」——真出现了要 owner 当面定怎么处置，而不是让一条迁移替他决定。
-- 2026-09-23 实测这五项在生产上都是 0，被拦下的只有搭售组件。
--
-- ── 搭售组件怎么处置：删掉，并逐条记账 ──
-- 那 7 行是把基础设施当商品搭进套餐——正是 owner 要清的东西。atlas / runos 的访问
-- 授权轴另有其物（product_100 §5：atlas 模型授权 `product-endpoint-grants` 产品轴、
-- runos 能力授权 `capability-grants` subjectType=product），配额走 L0 平台计量池
-- （`quota_pools.product_id IS NULL` 的工作区级池）。搭售这条路与那两条重复，
-- 且只有它会因为产品行消失而静默失效。
--
-- 删它们要**关掉锁版本守卫**（`trg_plan_component_guard_lock`：已锁版本的组件不可
-- 增删改）。这是一次有意的例外，理由写在这里：那个守卫保护的是「已发布版本的内容
-- 不被偷改」，而此刻的选择不是「改不改它」，是「让它指向一个不存在的产品」还是
-- 「把它删掉」——前者外键根本不允许。每一行删之前都 RAISE NOTICE 点名（套餐码 /
-- 版本号 / 版本状态 / 产品码），所以这次例外在日志里是有据可查的，不是悄悄发生的。
--
-- ── 清引用用外键目录驱动，不手写表名 ──
-- 指向 `product.products` 的外键有 41 个（含 usage_events 的 7 个分区）。手写一份
-- 表名清单，意味着下一个人加一张引用产品的表时这份清单就漏了，而漏的表现是**下一次
-- migrate 在外键上失败**，离现场很远。所以下面直接遍历 `pg_constraint`：
-- 凡是引用 `product.products` 的列，删掉值落在这两个产品 id 上的行。
-- 加表不用回来改这份迁移，这正是「不留残留」要的性质。
--
-- 幂等：全部以「这两个产品行还在不在」为条件；删完之后重跑什么都不做。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① 钱与用量：有足迹就停手 ─────────────────────────────────────────────
DO $$
DECLARE
  n_sub    bigint;
  n_usage  bigint;
  n_pool   bigint;
  n_order  bigint;
  n_item   bigint;
BEGIN
  SELECT count(*) INTO n_sub   FROM metering.subscriptions s
    JOIN product.products p ON p.id = s.product_id WHERE p.layer = 'L1';
  SELECT count(*) INTO n_usage FROM metering.usage_events u
    JOIN product.products p ON p.id = u.product_id WHERE p.layer = 'L1';
  SELECT count(*) INTO n_pool  FROM metering.quota_pools q
    JOIN product.products p ON p.id = q.product_id WHERE p.layer = 'L1';
  SELECT count(*) INTO n_order FROM billing.orders o
    JOIN product.products p ON p.id = o.product_id WHERE p.layer = 'L1';
  SELECT count(*) INTO n_item  FROM billing.invoice_items i
    JOIN product.products p ON p.id = i.product_id WHERE p.layer = 'L1';

  /* 连软删的订阅一起数。软删的订阅记的是「这个工作区曾经买过它」——那也是足迹，
     它的历史、账单、用量都还在。判据是「有没有人碰过钱」，不是「现在还在不在」。 */
  IF n_sub + n_usage + n_pool + n_order + n_item <> 0 THEN
    RAISE EXCEPTION
      '[l1-out-of-catalog] L1 产品有客户足迹（订阅 % / 用量 % / 配额池 % / 订单 % / 账单项 %）—— 这一步不替 owner 决定怎么处置一件客户付过钱的东西，先报上去',
      n_sub, n_usage, n_pool, n_order, n_item;
  END IF;
END $$;

BEGIN;

-- ── ② 搭售组件：逐条点名后删掉 ────────────────────────────────────────────
-- 先关锁版本守卫（理由见文件头）。DISABLE TRIGGER 是 DDL，在事务里生效、随事务回滚；
-- 正常路径必须显式开回来，所以两条都在同一个事务里。
ALTER TABLE product.plan_components DISABLE TRIGGER trg_plan_component_guard_lock;

DO $$
DECLARE
  r       record;
  n_named int := 0;
BEGIN
  FOR r IN
    SELECT pl.plan_code, pv.version_no, pv.status, p.product_code, pc.component_role
      FROM product.plan_components pc
      JOIN product.products p  ON p.id = pc.product_id AND p.layer = 'L1'
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans pl ON pl.id = pv.plan_id
     ORDER BY pl.plan_code, pv.version_no, p.product_code
  LOOP
    n_named := n_named + 1;
    RAISE NOTICE '[l1-out-of-catalog] 删组件：套餐 % v%（%）挂着 %（role=%）',
      r.plan_code, r.version_no, r.status, r.product_code, r.component_role;
  END LOOP;
  RAISE NOTICE '[l1-out-of-catalog] 组件合计 % 行（含 atlas 自己那几档骨架的 primary）', n_named;
END $$;

DELETE FROM product.plan_components pc
 USING product.products p
 WHERE p.id = pc.product_id AND p.layer = 'L1';

ALTER TABLE product.plan_components ENABLE TRIGGER trg_plan_component_guard_lock;

-- ── ③ atlas 自己那几档套餐：组件已清，剩下的版本与套餐一并删掉 ────────────
-- 判据两条都要：「plan_code 以某个 L1 产品码打头」+「现在一个组件都不剩」。
-- 只用前一条会在改名之后失准；只用后一条会误伤真正空着的草稿套餐。
CREATE TEMP TABLE _l1_plans ON COMMIT DROP AS
  SELECT pl.id, pl.plan_code
    FROM product.plans pl
   WHERE EXISTS (SELECT 1 FROM product.products p
                  WHERE p.layer = 'L1'
                    AND pl.plan_code LIKE p.product_code || '-%')
     AND NOT EXISTS (SELECT 1 FROM product.plan_versions pv
                       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
                      WHERE pv.plan_id = pl.id);

DO $$
DECLARE n_plan int;
BEGIN
  SELECT count(*) INTO n_plan FROM _l1_plans;
  RAISE NOTICE '[l1-out-of-catalog] 待删套餐 % 个：%', n_plan,
    coalesce((SELECT string_agg(plan_code, '、' ORDER BY plan_code) FROM _l1_plans), '(无)');
END $$;

UPDATE product.plans SET current_version_id = NULL
 WHERE id IN (SELECT id FROM _l1_plans);
DELETE FROM product.plan_prices
 WHERE plan_version_id IN (SELECT pv.id FROM product.plan_versions pv
                            WHERE pv.plan_id IN (SELECT id FROM _l1_plans));
DELETE FROM product.solution_plans WHERE plan_id IN (SELECT id FROM _l1_plans);
DELETE FROM product.plan_versions  WHERE plan_id IN (SELECT id FROM _l1_plans);
DELETE FROM product.plans          WHERE id      IN (SELECT id FROM _l1_plans);

-- ── ④ 客户端降级：product 级 → platform 级 ────────────────────────────────
-- 必须在删产品行**之前**：外键会拦住一行还挂着 product_id 的客户端。
-- 与 opera / admin / console / website / ruyin 同类；realm 保持 customer 不变。
UPDATE appoidc.oidc_clients c
   SET client_kind = 'platform', product_id = NULL, updated_at = now()
  FROM product.products p
 WHERE p.id = c.product_id AND p.layer = 'L1';

-- ── ⑤ 其余引用：按外键目录遍历，一张表都不漏 ──────────────────────────────
DO $$
DECLARE
  fk      record;
  n_del   bigint;
  n_total bigint := 0;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'product.products'::regclass
       /* 分区表的分区各自带一份同名外键；删父表会连分区一起删，重复删一遍无害但
          会让计数虚高。只走父表与非分区表。 */
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.conrelid)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'DELETE FROM %s t USING product.products p WHERE p.id = t.%I AND p.layer = ''L1''',
      fk.tbl, fk.col);
    GET DIAGNOSTICS n_del = ROW_COUNT;
    IF n_del > 0 THEN
      RAISE NOTICE '[l1-out-of-catalog] 清引用：%.% → % 行', fk.tbl, fk.col, n_del;
      n_total := n_total + n_del;
    END IF;
  END LOOP;
  RAISE NOTICE '[l1-out-of-catalog] 引用合计清掉 % 行', n_total;
END $$;

-- ── ⑥ 产品行本身 ─────────────────────────────────────────────────────────
DELETE FROM product.products WHERE layer = 'L1';

-- ── ⑦ 把规则焊进数据层 ────────────────────────────────────────────────────
-- 删掉这两行只是处理了**今天这两个**。owner 的话是一条规则，不是一次清理。
-- 没有这条约束，明天在 opera 里登记一个 layer='L1' 的产品照样成功，而且不会有任何
-- 东西提醒谁——上一次「两份清单不一致」的教训就是这么来的：补数据不补判据。
--
-- 条件里留着 `deleted_at IS NOT NULL` 这一支：本迁移硬删之后库里已无 L1 行，但别的
-- 环境若在旧版本上跑成了软删，这条约束仍然加得上，不会被一行历史数据卡住。
-- 配套：opera 的层级下拉只给 L2/L3，不然选了 L1 会撞成 500。
ALTER TABLE product.products DROP CONSTRAINT IF EXISTS chk_products_live_layer_not_l1;
ALTER TABLE product.products ADD CONSTRAINT chk_products_live_layer_not_l1
  CHECK (deleted_at IS NOT NULL OR layer IS NULL OR layer IN ('L2','L3'));

COMMIT;

DO $$
DECLARE
  n_live     int;
  ok_check   boolean;
  n_client   int;
  n_ref      bigint := 0;
  n_one      bigint;
  fk         record;
  codes      text;
BEGIN
  /* 产品表里一行 L1 都不该剩 —— 软删也不算，这一版要的是彻底没有。 */
  SELECT count(*) INTO n_live FROM product.products WHERE layer = 'L1';
  IF n_live <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] 产品表里还有 % 行 L1 产品', n_live;
  END IF;
  SELECT count(*) INTO n_live FROM product.products
   WHERE product_code IN ('atlas', 'runos');
  IF n_live <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] atlas/runos 的产品行还在（% 行）', n_live;
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

  /* 残留反查：再遍历一次外键目录，数「引用了一个已不存在的产品」的行。
     正常情况下外键本身就保证了这个数是 0——这一段真正证明的是**上面那次遍历覆盖到了
     每一张表**：漏掉一张的话 ⑥ 的 DELETE 会先在外键上失败，根本走不到这里。
     所以它是一条廉价的自证，不是重复劳动。 */
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND c.confrelid = 'product.products'::regclass
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.conrelid)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product.products p WHERE p.id = t.%I)',
      fk.tbl, fk.col, fk.col) INTO n_one;
    n_ref := n_ref + n_one;
  END LOOP;
  IF n_ref <> 0 THEN
    RAISE EXCEPTION '[l1-out-of-catalog] 还有 % 行引用着不存在的产品', n_ref;
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
  DELETE FROM product.products WHERE product_code = '__l1_probe__';

  RAISE NOTICE '[l1-out-of-catalog] atlas/runos 已彻底退出产品体系：产品行、套餐、组件、指标与全部引用均已删除，无残留；两个客户端降为平台级（与 opera/admin/console 同类）且仍 active —— 换票受众另由平台级客户端兜底';
END $$;
