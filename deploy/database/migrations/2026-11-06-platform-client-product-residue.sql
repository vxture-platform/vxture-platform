-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-06-platform-client-product-residue.sql
-- 平台级 OIDC 客户端名下的产品行残留 —— 今天只有 ruyin 一个，判据不写死名字
--
-- owner 2026-09-23：「ruyin 是不是也撤离了，原来的软删」——是，而且它就是同一份残留。
--
-- ── 事实，有据可查 ──
-- `2026-08-31-ruyin-declassify.sql` 把 ruyin 从「目录商品」降成「平台级 first-party
-- 客户端」，产品行的处置选了**软删**，理由写在那份迁移里：「可逆、留审计」。
--   · 2026-08-31 的 db-init（run 33362494645）：`soft-deleted 1 ruyin product row(s)`
--   · 此后每一次 migrate 都是 `0` —— 那条 UPDATE 带 `deleted_at IS NULL`，
--     已软删的行不再命中
-- 也就是说那一行**至今还躺在 product.products 里**。
--
-- 而 atlas / runos 的第一版正是照这个先例做的软删，2026-09-23 被 owner 推翻：
-- 「不是软删，要彻底从产品体系中清理，哪里报错修哪里，不留残留」。
-- 推翻的是机制，那 ruyin 这一行就是同一个机制留下的同一份东西。
--
-- ── 软删在这件事上为什么不算数 ──
-- 一行软删的产品，在**不过滤 `deleted_at` 的读路径**上照样出现。换票受众解析就曾经
-- 是这样：`select ... where product_code = $1 and status = 'active'`，没有 deleted_at
-- 条件——所以 2026-09-23 之前，一行软删的 ruyin **仍然是一个合法的换票受众**。
-- 那条过滤是 PR #469 才补上的。软删给人「已经处理掉了」的印象，而它没有。
--
-- ── 判据：不写死名字 ──
-- 一个 `client_kind='platform'` 的客户端（website / console / admin / opera / arche /
-- ruyin / atlas / runos …）是**平台自身的登录端**，不是目录商品；库上
-- `chk_oidc_clients_kind_product` 已经保证它 `product_id` 为空。若
-- `product.products` 里还有一行同名的，那就是「既当客户端又当商品」的旧形态残留。
--
-- 写死 'ruyin' 只能处理今天这一个；写成判据，下一次谁再把一个平台端建成产品、
-- 或者再做一次降级而忘了清行，这份迁移与基线审计的 C4 都会接住。
--
-- 同批在 `deploy/database/verify/baseline-assertions.sql` 加了 **C4** 不变式：
-- 平台级客户端不得有同名产品行（软删也算）。它每次 migrate / verify 都跑，
-- 所以这不是一次性清理，是一条会一直成立的规矩。
--
-- ── 仍然拒绝执行的一种情况：真的有人买过 ──
-- 与 2026-11-04 同规矩：有订阅 / 订单 / 账单项 / 用量 / 配额池指向这些行就停手并报
-- 出来。ruyin 在 2026-08-31 之前是一件真的上过架的商品，所以这一条不是形式——
-- 真有足迹就该让 owner 当面定，而不是让一条迁移替他决定。
--
-- 幂等：以「还有没有这样的行」为条件，删完重跑什么都不做。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① 圈定残留行 + 钱与用量的前置检查 ────────────────────────────────────
DO $$
DECLARE
  codes   text;
  n_sub   bigint; n_usage bigint; n_pool bigint; n_order bigint; n_item bigint;
BEGIN
  SELECT string_agg(p.product_code || CASE WHEN p.deleted_at IS NOT NULL THEN '(软删)' ELSE '(未删)' END,
                    '、' ORDER BY p.product_code)
    INTO codes
    FROM product.products p
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code
   WHERE c.client_kind = 'platform';
  RAISE NOTICE '[platform-client-residue] 命中 %', coalesce(codes, '(无)');

  SELECT count(*) INTO n_sub FROM metering.subscriptions s
    JOIN product.products p ON p.id = s.product_id
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code AND c.client_kind = 'platform';
  SELECT count(*) INTO n_usage FROM metering.usage_events u
    JOIN product.products p ON p.id = u.product_id
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code AND c.client_kind = 'platform';
  SELECT count(*) INTO n_pool FROM metering.quota_pools q
    JOIN product.products p ON p.id = q.product_id
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code AND c.client_kind = 'platform';
  SELECT count(*) INTO n_order FROM billing.orders o
    JOIN product.products p ON p.id = o.product_id
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code AND c.client_kind = 'platform';
  SELECT count(*) INTO n_item FROM billing.invoice_items i
    JOIN product.products p ON p.id = i.product_id
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code AND c.client_kind = 'platform';

  IF n_sub + n_usage + n_pool + n_order + n_item <> 0 THEN
    RAISE EXCEPTION
      '[platform-client-residue] 这些行有客户足迹（订阅 % / 用量 % / 配额池 % / 订单 % / 账单项 %）—— 不替 owner 决定怎么处置一件客户付过钱的东西，先报上去',
      n_sub, n_usage, n_pool, n_order, n_item;
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE _residue ON COMMIT DROP AS
  SELECT p.id, p.product_code
    FROM product.products p
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code
   WHERE c.client_kind = 'platform';

-- ── ② 组件：逐条点名后删掉（锁版本守卫同 2026-11-04 临时关掉）─────────────
ALTER TABLE product.plan_components DISABLE TRIGGER trg_plan_component_guard_lock;

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT pl.plan_code, pv.version_no, pv.status, x.product_code, pc.component_role
      FROM product.plan_components pc
      JOIN _residue x ON x.id = pc.product_id
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans pl ON pl.id = pv.plan_id
     ORDER BY pl.plan_code, pv.version_no
  LOOP
    n := n + 1;
    RAISE NOTICE '[platform-client-residue] 删组件：套餐 % v%（%）挂着 %（role=%）',
      r.plan_code, r.version_no, r.status, r.product_code, r.component_role;
  END LOOP;
  RAISE NOTICE '[platform-client-residue] 组件合计 % 行', n;
END $$;

DELETE FROM product.plan_components pc USING _residue x WHERE x.id = pc.product_id;

ALTER TABLE product.plan_components ENABLE TRIGGER trg_plan_component_guard_lock;

-- ── ③ 这些产品自己那些套餐：组件清空后一并删掉 ────────────────────────────
-- 判据两条都要（同 2026-11-04）：plan_code 以残留产品码打头 + 现在一个组件都不剩。
-- ruyin 实测应为零：ruyin-free 早由 U 线改名 umbra-free，那是 umbra 的套餐、不在此列。
CREATE TEMP TABLE _residue_plans ON COMMIT DROP AS
  SELECT pl.id, pl.plan_code
    FROM product.plans pl
   WHERE EXISTS (SELECT 1 FROM _residue x WHERE pl.plan_code LIKE x.product_code || '-%')
     AND NOT EXISTS (SELECT 1 FROM product.plan_versions pv
                       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
                      WHERE pv.plan_id = pl.id);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _residue_plans;
  RAISE NOTICE '[platform-client-residue] 待删套餐 % 个：%', n,
    coalesce((SELECT string_agg(plan_code, '、' ORDER BY plan_code) FROM _residue_plans), '(无)');
END $$;

UPDATE product.plans SET current_version_id = NULL WHERE id IN (SELECT id FROM _residue_plans);
DELETE FROM product.plan_prices
 WHERE plan_version_id IN (SELECT pv.id FROM product.plan_versions pv
                            WHERE pv.plan_id IN (SELECT id FROM _residue_plans));
DELETE FROM product.solution_plans WHERE plan_id IN (SELECT id FROM _residue_plans);
DELETE FROM product.plan_versions  WHERE plan_id IN (SELECT id FROM _residue_plans);
DELETE FROM product.plans          WHERE id      IN (SELECT id FROM _residue_plans);

-- ── ④ 其余引用：按外键目录遍历，一张表都不漏（同 2026-11-04 的理由）───────
DO $$
DECLARE fk record; n_del bigint; n_total bigint := 0;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND c.confrelid = 'product.products'::regclass
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.conrelid)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'DELETE FROM %s t USING _residue x WHERE x.id = t.%I', fk.tbl, fk.col);
    GET DIAGNOSTICS n_del = ROW_COUNT;
    IF n_del > 0 THEN
      RAISE NOTICE '[platform-client-residue] 清引用：%.% → % 行', fk.tbl, fk.col, n_del;
      n_total := n_total + n_del;
    END IF;
  END LOOP;
  RAISE NOTICE '[platform-client-residue] 引用合计清掉 % 行', n_total;
END $$;

-- ── ⑤ 产品行本身 ─────────────────────────────────────────────────────────
DELETE FROM product.products p USING _residue x WHERE x.id = p.id;

COMMIT;

DO $$
DECLARE n int; codes text;
BEGIN
  /* 与基线审计 C4 同一条判据，在这里先自检一次：迁移跑完却没清干净的话，
     应该在这份迁移里失败，而不是几步之后在审计里失败——那时看到的是一条
     与现场无关的报错。 */
  SELECT count(*) INTO n
    FROM product.products p
    JOIN appoidc.oidc_clients c ON c.client_id = p.product_code
   WHERE c.client_kind = 'platform';
  IF n <> 0 THEN
    SELECT string_agg(p.product_code, '、' ORDER BY p.product_code) INTO codes
      FROM product.products p
      JOIN appoidc.oidc_clients c ON c.client_id = p.product_code
     WHERE c.client_kind = 'platform';
    RAISE EXCEPTION '[platform-client-residue] 还有 % 行平台级客户端的同名产品行（%）', n, codes;
  END IF;

  /* ruyin / ruyin-beta 的客户端必须还在且 active —— 桌面端登录靠的是它们。
     这一条是这份迁移的反面：删的是产品行，**不是**登录能力。 */
  SELECT count(*) INTO n FROM appoidc.oidc_clients
   WHERE client_id IN ('ruyin','ruyin-beta')
     AND client_kind = 'platform' AND product_id IS NULL AND status = 'active';
  IF n <> 2 THEN
    RAISE EXCEPTION '[platform-client-residue] ruyin/ruyin-beta 客户端不是两个 active 的平台级（实为 %）—— 桌面端登录会断', n;
  END IF;

  RAISE NOTICE '[platform-client-residue] 平台级客户端名下已无产品行；ruyin/ruyin-beta 两个客户端仍 active，桌面端登录不受影响';
END $$;
