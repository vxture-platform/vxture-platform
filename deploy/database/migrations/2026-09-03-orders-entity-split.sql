-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P1-a：订单实体拆分（billing.orders）+ 订阅冗余列 + 回填 + caimc 修复
--
-- 依据：owner 2026-09-03 决策 1（拆订单表）/ 决策 6（caimc 随 P1 修）。设计：docs/30-design/product_330_order-entity-split.md。
-- 一行两面模型两次在生产出错（9-02 续期翻状态、9-03 升级丢周期），根因相同：订单与订阅共用一行。
--
-- 本迁移做的事（全部幂等，可重复执行）：
--   ① 建表 billing.orders（含索引 / 在途订单唯一索引）
--   ② metering.subscriptions 加 product_id / paid_amount / current_order_id；billing.invoices / refunds 加 order_id
--   ③ 跨 schema FK（与 90_cross_schema_fk.sql 同名）+ product_id 自动填充触发器（与 95 同名）
--   ④ 回填：subscriptions.product_id / paid_amount；order_no 非空的订阅行 → billing.orders（intent 自账单备注 JSON 解析，
--      status 由 订阅状态 × 账单状态 × 申报腿 映射）；invoices.order_id；subscriptions.current_order_id
--   ⑤ caimc / vxtpl 修复：行 A（free 升 starter 后就地改版本的那行）补上年付周期 / 到期 / 实付；行 B 的订单 → fulfilled 指向 A
--   ⑥ 建 uidx_subscriptions_live_per_product 前先检查并列出重复的当前订阅（有则 RAISE，人工处理后再跑）
--   ⑦ 断言 + NOTICE 计数
--
-- 不做的事：不改任何写路径（P1-b）；不删旧列（P2）。写路径切换前 orders 是只读镜像，旧谓词继续工作。
-- 之后 db-init action=migrate 的 28c 会把 vx_ddl_baseline 重签到含本次 50/52/90/95/98 改动的 DDL。
--
-- 用法（生产，以 owner 身份）：
--   CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
--   或 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① billing.orders ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.orders (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no              varchar(64)   NOT NULL,
    tenant_id             uuid          NOT NULL,
    workspace_id          uuid          NOT NULL,
    product_id            uuid          NOT NULL,
    plan_version_id       uuid          NOT NULL,
    intent                varchar(16)   NOT NULL,
    cycle_unit            varchar(16)   NOT NULL,
    cycle_count           int           NOT NULL DEFAULT 1,
    from_subscription_id  uuid,
    subscription_id       uuid,
    list_amount           numeric(12,2) NOT NULL,
    credit_amount         numeric(12,2) NOT NULL DEFAULT 0,
    payable_amount        numeric(12,2) NOT NULL,
    leftover_amount       numeric(12,2) NOT NULL DEFAULT 0,
    currency              varchar(16)   NOT NULL DEFAULT 'CNY',
    proration             jsonb,
    status                varchar(24)   NOT NULL DEFAULT 'pending_payment',
    payment_ttl_minutes   int,
    declared_at           timestamptz,
    paid_at               timestamptz,
    fulfilled_at          timestamptz,
    closed_at             timestamptz,
    close_reason          varchar(32),
    created_by_type       varchar(16)   NOT NULL,
    created_by_id         uuid,
    operator_remark       varchar(512),
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_orders_order_no         UNIQUE (order_no),
    CONSTRAINT chk_orders_intent          CHECK (intent IN ('new','upgrade','renew')),
    CONSTRAINT chk_orders_status          CHECK (status IN ('pending_payment','pending_verify','paid','fulfilled','cancelled','expired','refunded')),
    CONSTRAINT chk_orders_cycle_unit      CHECK (cycle_unit IN ('day','week','month','year','perpetual')),
    CONSTRAINT chk_orders_cycle_count     CHECK (cycle_count >= 1),
    CONSTRAINT chk_orders_from            CHECK ((intent <> 'new') = (from_subscription_id IS NOT NULL)),
    CONSTRAINT chk_orders_amounts         CHECK (list_amount >= 0 AND credit_amount >= 0 AND payable_amount >= 0 AND leftover_amount >= 0),
    CONSTRAINT chk_orders_fulfilled       CHECK ((status IN ('fulfilled','refunded')) = (fulfilled_at IS NOT NULL AND subscription_id IS NOT NULL)),
    CONSTRAINT chk_orders_created_by_type CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_orders_payment_ttl     CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1)
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON billing.orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_workspace      ON billing.orders (workspace_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON billing.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_subscription   ON billing.orders (subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_orders_open_per_product ON billing.orders (workspace_id, product_id)
  WHERE status IN ('pending_payment','pending_verify','paid');

-- ② 列 -------------------------------------------------------------------------
ALTER TABLE metering.subscriptions ADD COLUMN IF NOT EXISTS product_id       uuid;
ALTER TABLE metering.subscriptions ADD COLUMN IF NOT EXISTS paid_amount      numeric(12,2);
ALTER TABLE metering.subscriptions ADD COLUMN IF NOT EXISTS current_order_id uuid;
CREATE INDEX IF NOT EXISTS idx_subscriptions_product_id ON metering.subscriptions (product_id);
ALTER TABLE billing.invoices ADD COLUMN IF NOT EXISTS order_id uuid;
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON billing.invoices (order_id);
ALTER TABLE billing.refunds  ADD COLUMN IF NOT EXISTS order_id uuid;
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON billing.refunds (order_id);

-- ③ FK（与 90 同名，幂等）+ 触发器（与 95 同名）------------------------------------
DO $$ BEGIN ALTER TABLE billing.invoices ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.refunds ADD CONSTRAINT refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_product FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_current_order FOREIGN KEY (current_order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_workspace FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_plan_version FOREIGN KEY (plan_version_id) REFERENCES product.plan_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_from_subscription FOREIGN KEY (from_subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_subscription FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION metering.fill_subscription_product_id() RETURNS trigger AS $$
BEGIN
  IF NEW.product_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id) THEN
    SELECT pc.product_id INTO NEW.product_id
      FROM product.plan_components pc
     WHERE pc.plan_version_id = NEW.plan_version_id
       AND pc.component_role = 'primary'
     ORDER BY pc.priority ASC, pc.sort_order ASC
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subscriptions_fill_product_id ON metering.subscriptions;
CREATE TRIGGER trg_subscriptions_fill_product_id
  BEFORE INSERT OR UPDATE OF plan_version_id, product_id ON metering.subscriptions
  FOR EACH ROW EXECUTE FUNCTION metering.fill_subscription_product_id();

-- ④ 回填 ----------------------------------------------------------------------
UPDATE metering.subscriptions s
   SET product_id = pc.product_id
  FROM (
    SELECT DISTINCT ON (plan_version_id) plan_version_id, product_id
      FROM product.plan_components
     WHERE component_role = 'primary'
     ORDER BY plan_version_id, priority ASC, sort_order ASC
  ) pc
 WHERE pc.plan_version_id = s.plan_version_id
   AND s.product_id IS NULL;

UPDATE metering.subscriptions
   SET paid_amount = pay_amount
 WHERE paid_amount IS NULL AND pay_amount IS NOT NULL;

-- 订单行回填：order_no 非空的订阅行 = 旧模型里的"订单面"。
-- intent 从最新账单 operate_remark 的 JSON 解析（{"intent":"upgrade","upgrade_of":"<uuid>"}）；
-- 旧 renew（新建行）没有原订阅可指，按 new 记；upgrade 缺 upgrade_of 也按 new 记（chk_orders_from）。
WITH src AS (
  SELECT s.*,
         inv.id            AS inv_id,
         inv.bill_status,
         inv.total_amount  AS inv_total,
         inv.paid_at       AS inv_paid_at,
         inv.currency      AS inv_currency,
         CASE WHEN inv.operate_remark ~ '^\s*\{' THEN inv.operate_remark::jsonb END AS remark_json,
         EXISTS (SELECT 1 FROM billing.payments p WHERE p.bill_id = inv.id AND p.pay_status = 'pending_verify') AS has_pending_verify
    FROM metering.subscriptions s
    LEFT JOIN LATERAL (
      SELECT i.* FROM billing.invoices i
       WHERE i.subscription_id = s.id AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC LIMIT 1
    ) inv ON true
   WHERE s.order_no IS NOT NULL
), shaped AS (
  SELECT src.*,
         CASE WHEN (remark_json->>'upgrade_of') ~ '^[0-9a-fA-F-]{36}$'
              THEN (remark_json->>'upgrade_of')::uuid END AS o_from
    FROM src
), shaped2 AS (
  SELECT shaped.*,
         CASE WHEN (remark_json->>'intent') = 'upgrade' AND o_from IS NOT NULL
                   AND EXISTS (SELECT 1 FROM metering.subscriptions x WHERE x.id = shaped.o_from)
              THEN 'upgrade' ELSE 'new' END AS o_intent
    FROM shaped
), mapped AS (
  SELECT shaped2.*,
         CASE
           WHEN status IN ('active','expiring','trialing','overdue','expired') THEN 'fulfilled'
           WHEN status = 'cancelled' AND bill_status = 'paid' AND o_intent = 'upgrade' THEN 'fulfilled'
           WHEN status = 'cancelled' THEN 'cancelled'
           WHEN status = 'suspended' AND bill_status = 'paid' THEN 'paid'
           WHEN status = 'suspended' AND has_pending_verify THEN 'pending_verify'
           ELSE 'pending_payment'
         END AS o_status,
         CASE
           WHEN status IN ('active','expiring','trialing','overdue','expired') THEN id
           WHEN status = 'cancelled' AND bill_status = 'paid' AND o_intent = 'upgrade' THEN o_from
         END AS o_subscription_id
    FROM shaped2
)
INSERT INTO billing.orders (
  order_no, tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit, cycle_count,
  from_subscription_id, subscription_id, list_amount, credit_amount, payable_amount, leftover_amount, currency,
  status, payment_ttl_minutes, paid_at, fulfilled_at, closed_at, close_reason,
  created_by_type, created_by_id, operator_remark, created_at, updated_at
)
SELECT
  order_no, tenant_id, workspace_id, product_id, plan_version_id, o_intent, cycle_unit, cycle_count,
  CASE WHEN o_intent = 'upgrade' THEN o_from END,
  o_subscription_id,
  COALESCE(inv_total, pay_amount, 0), 0, COALESCE(inv_total, pay_amount, 0), 0, COALESCE(inv_currency, currency, 'CNY'),
  o_status, payment_ttl_minutes,
  CASE WHEN bill_status = 'paid' THEN COALESCE(inv_paid_at, updated_at) END,
  CASE WHEN o_status = 'fulfilled' THEN COALESCE(inv_paid_at, start_at, updated_at) END,
  CASE WHEN o_status = 'cancelled' THEN updated_at END,
  CASE WHEN o_status = 'cancelled' THEN 'backfill' END,
  created_by_type, created_by_id,
  'product_330 backfill from metering.subscriptions ' || id::text,
  created_at, updated_at
  FROM mapped
 WHERE product_id IS NOT NULL
ON CONFLICT (order_no) DO NOTHING;

-- 账单 → 订单
UPDATE billing.invoices i
   SET order_id = o.id
  FROM metering.subscriptions s
  JOIN billing.orders o ON o.order_no = s.order_no
 WHERE i.subscription_id = s.id
   AND i.order_id IS NULL;

-- 订阅 → 最近一次履约它的订单
UPDATE metering.subscriptions s
   SET current_order_id = o.id
  FROM (
    SELECT DISTINCT ON (subscription_id) subscription_id, id
      FROM billing.orders
     WHERE status = 'fulfilled' AND subscription_id IS NOT NULL
     ORDER BY subscription_id, fulfilled_at DESC
  ) o
 WHERE o.subscription_id = s.id
   AND s.current_order_id IS NULL;

-- ⑤ caimc / vxtpl 修复（owner 决策 6）--------------------------------------------
-- 行 A = ORD-202609-C5EE090AE8（原 free 月付，被升级履约就地改成 starter 但周期/到期/金额没搬）
-- 行 B = ORD-202609-D88DE76C8B（starter 年付订单，¥0.10 已收款，旧模型把它标成 cancelled）
DO $$
DECLARE
  a_id uuid; b_id uuid; ob_id uuid; b_done timestamptz;
BEGIN
  SELECT id INTO a_id FROM metering.subscriptions WHERE order_no = 'ORD-202609-C5EE090AE8';
  SELECT id, updated_at INTO b_id, b_done FROM metering.subscriptions WHERE order_no = 'ORD-202609-D88DE76C8B';
  SELECT id INTO ob_id FROM billing.orders WHERE order_no = 'ORD-202609-D88DE76C8B';
  IF a_id IS NULL OR b_id IS NULL OR ob_id IS NULL THEN
    RAISE NOTICE '[orders-split] caimc rows not found (A=%, B=%, orderB=%), repair skipped', a_id, b_id, ob_id;
    RETURN;
  END IF;

  UPDATE metering.subscriptions
     SET cycle_unit = 'year', cycle_count = 1,
         end_at = start_at + interval '1 year',
         pay_amount = 0.10, paid_amount = 0.10,
         current_order_id = ob_id,
         updated_at = now()
   WHERE id = a_id AND cycle_unit = 'month';

  UPDATE billing.orders
     SET status = 'fulfilled', intent = 'upgrade',
         from_subscription_id = a_id, subscription_id = a_id,
         fulfilled_at = COALESCE(fulfilled_at, b_done), paid_at = COALESCE(paid_at, b_done),
         closed_at = NULL, close_reason = NULL,
         operator_remark = 'product_330 repair 2026-09-03: upgrade order fulfilled onto ' || a_id::text || ' (year cycle / end_at / paid_amount restored)',
         updated_at = now()
   WHERE id = ob_id;

  -- 幂等：db-init migrate 每次都重放全部迁移文件，审计行只落一次（2026-09-03 生产第二次重放曾多出一条）。
  INSERT INTO metering.subscription_histories (tenant_id, subscription_id, change_type, from_status, to_status, actor_type, actor_id, remark)
  SELECT tenant_id, a_id, 'operator_adjusted', status, status, 'operator', NULL,
         'product_330 repair: cycle month→year, end_at=start+1y, paid_amount=0.10 (order ORD-202609-D88DE76C8B)'
    FROM metering.subscriptions
   WHERE id = a_id
     AND NOT EXISTS (
       SELECT 1 FROM metering.subscription_histories h
        WHERE h.subscription_id = a_id AND h.change_type = 'operator_adjusted'
          AND h.remark LIKE 'product_330 repair:%'
     );

  RAISE NOTICE '[orders-split] caimc repaired: subscription A=% now starter/year, order B=% fulfilled onto A', a_id, ob_id;
END $$;

-- ⑥ 当前订阅唯一索引：先列出重复，有则中止（人工处理后重跑）------------------------
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(workspace_id::text || '/' || product_id::text || ' x' || n, ', ')
    INTO dup
    FROM (
      SELECT workspace_id, product_id, count(*) AS n
        FROM metering.subscriptions
       WHERE status IN ('active','trialing','expiring','overdue') AND deleted_at IS NULL AND product_id IS NOT NULL
       GROUP BY workspace_id, product_id HAVING count(*) > 1
    ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '[orders-split] duplicate live subscriptions per workspace/product: % — resolve before creating uidx_subscriptions_live_per_product', dup;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_subscriptions_live_per_product ON metering.subscriptions (workspace_id, product_id)
  WHERE status IN ('active','trialing','expiring','overdue') AND deleted_at IS NULL;

-- ⑦ 断言 + 计数 ------------------------------------------------------------------
DO $$
DECLARE
  n_orders bigint; n_src bigint; n_missing_product bigint; n_inv_unlinked bigint; n_fulfilled_bad bigint;
BEGIN
  SELECT count(*) INTO n_src FROM metering.subscriptions WHERE order_no IS NOT NULL AND product_id IS NOT NULL;
  SELECT count(*) INTO n_orders FROM billing.orders;
  SELECT count(*) INTO n_missing_product FROM metering.subscriptions WHERE product_id IS NULL AND deleted_at IS NULL;
  SELECT count(*) INTO n_inv_unlinked
    FROM billing.invoices i JOIN metering.subscriptions s ON s.id = i.subscription_id
   WHERE s.order_no IS NOT NULL AND i.order_id IS NULL AND i.deleted_at IS NULL;
  SELECT count(*) INTO n_fulfilled_bad
    FROM billing.orders o LEFT JOIN metering.subscriptions s ON s.id = o.subscription_id
   WHERE o.status = 'fulfilled' AND s.id IS NULL;
  IF n_orders < n_src THEN
    RAISE EXCEPTION '[orders-split] backfill incomplete: orders=% < order-bearing subscriptions=%', n_orders, n_src;
  END IF;
  IF n_fulfilled_bad > 0 THEN
    RAISE EXCEPTION '[orders-split] % fulfilled orders point to a missing subscription', n_fulfilled_bad;
  END IF;
  RAISE NOTICE '[orders-split] orders=% (source rows=%), subscriptions without product_id=%, order invoices unlinked=%',
    n_orders, n_src, n_missing_product, n_inv_unlinked;
END $$;

COMMIT;
