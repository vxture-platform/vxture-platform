-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 加油包/扩展包(owner 裁定 2026-08-20 用量配额线):
--   ① product.addon_packs 目录表(SKU 不经套餐机器,product_220 §0/§4.2);
--   ② metering.addon_purchases 购买单(快照 + 状态机 + 结算回填 quota_pool_id);
--   ③ 跨 schema FK + 索引 + platform_svc 基础权限与列锁。
-- 纯新增,不改既有列;与应用发布顺序:**须在携带加油包特性的应用版本之前执行**。
-- 目录数据由 seed-catalog.mjs 的 ADDON_PACKS 块灌入(migrate 后跑 seed,或
-- 走 db-init 的 migrate-seed 一体 action)。
-- 回滚:不需要(新表无人引用即闲置)。
-- 幂等:CREATE TABLE/INDEX IF NOT EXISTS;FK 用 duplicate_object 守护;GRANT 可重跑。
-- 用法(生产,以 owner 身份):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <本文件>
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ① 目录表(与 40_product.sql 定义逐字一致)─────────────────────────────
CREATE TABLE IF NOT EXISTS product.addon_packs (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_code     varchar(64)  NOT NULL,
    pack_name     varchar(128) NOT NULL,
    metric_key    varchar(64)  NOT NULL,
    amount        bigint       NOT NULL,
    validity_days int          NOT NULL,
    price         numeric(12,2) NOT NULL,
    currency      varchar(16)  NOT NULL DEFAULT 'CNY',
    status        varchar(16)  NOT NULL DEFAULT 'active',
    sort          int          NOT NULL DEFAULT 100,
    created_by    uuid,
    updated_by    uuid,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_addon_packs_pack_code   UNIQUE (pack_code),
    CONSTRAINT chk_addon_packs_status     CHECK (status IN ('active','retired')),
    CONSTRAINT chk_addon_packs_amount     CHECK (amount > 0),
    CONSTRAINT chk_addon_packs_validity   CHECK (validity_days >= 1),
    CONSTRAINT chk_addon_packs_price      CHECK (price >= 0)
);

-- ── ② 购买单(与 50_metering.sql 定义逐字一致)────────────────────────────
CREATE TABLE IF NOT EXISTS metering.addon_purchases (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid          NOT NULL,
    workspace_id        uuid          NOT NULL,
    pack_id             uuid          NOT NULL,
    pack_code           varchar(64)   NOT NULL,
    pack_name           varchar(128)  NOT NULL,
    metric_key          varchar(64)   NOT NULL,
    amount              bigint        NOT NULL,
    validity_days       int           NOT NULL,
    price               numeric(12,2) NOT NULL,
    currency            varchar(16)   NOT NULL DEFAULT 'CNY',
    order_no            varchar(128)  NOT NULL,
    status              varchar(32)   NOT NULL DEFAULT 'pending_payment',
    payment_ttl_minutes int,
    invoice_id          uuid,
    quota_pool_id       uuid          REFERENCES metering.quota_pools(id),
    activated_at        timestamptz,
    cancelled_at        timestamptz,
    cancel_reason       varchar(256),
    created_by_type     varchar(16)   NOT NULL,
    created_by_id       uuid,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_addon_purchases_order_no UNIQUE (order_no),
    CONSTRAINT chk_addon_purchases_status CHECK (status IN ('pending_payment','completed','cancelled')),
    CONSTRAINT chk_addon_purchases_actor  CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_addon_purchases_ttl    CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1),
    CONSTRAINT chk_addon_purchases_amount CHECK (amount > 0),
    CONSTRAINT chk_addon_purchases_completed CHECK (status <> 'completed' OR (quota_pool_id IS NOT NULL AND activated_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_workspace ON metering.addon_purchases (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_tenant    ON metering.addon_purchases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_status    ON metering.addon_purchases (status, created_at);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_pack      ON metering.addon_purchases (pack_id);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_invoice   ON metering.addon_purchases (invoice_id);
CREATE INDEX IF NOT EXISTS idx_addon_purchases_pool      ON metering.addon_purchases (quota_pool_id);

-- ── ③ 跨 schema FK(与 90_cross_schema_fk.sql 一致,幂等)────────────────
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_pack
    FOREIGN KEY (pack_id) REFERENCES product.addon_packs(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_invoice
    FOREIGN KEY (invoice_id) REFERENCES billing.invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ③b invoice_items.item_type 值域扩 'addon_fee'(与 52_billing.sql 一致)──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billing.invoice_items'::regclass
      AND conname = 'chk_invoice_items_item_type'
      AND pg_get_constraintdef(oid) NOT LIKE '%addon_fee%'
  ) THEN
    ALTER TABLE billing.invoice_items DROP CONSTRAINT chk_invoice_items_item_type;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billing.invoice_items'::regclass
      AND conname = 'chk_invoice_items_item_type'
  ) THEN
    ALTER TABLE billing.invoice_items ADD CONSTRAINT chk_invoice_items_item_type
      CHECK (item_type IN ('subscription_fee','metered_overage','credit_adjustment','discount','tax','addon_fee'));
  END IF;
END $$;

-- ── ④ 权限(97 的 ALL TABLES GRANT 只覆盖初始化时点,新表需显式)+ 列锁(98)──
GRANT SELECT, INSERT, UPDATE, DELETE ON product.addon_packs TO platform_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON metering.addon_purchases TO platform_svc;

REVOKE UPDATE ON product.addon_packs FROM platform_svc;
GRANT UPDATE (pack_code, pack_name, metric_key, amount, validity_days, price, currency, status, sort, updated_by, updated_at) ON product.addon_packs TO platform_svc;

REVOKE UPDATE ON metering.addon_purchases FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, pack_id, pack_code, pack_name, metric_key, amount, validity_days, price, currency, status, payment_ttl_minutes, invoice_id, quota_pool_id, activated_at, cancelled_at, cancel_reason, created_by_type, created_by_id, updated_at) ON metering.addon_purchases TO platform_svc;

COMMIT;

-- ── 核对(执行后跑一遍)────────────────────────────────────────────────────
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema||'.'||table_name IN ('product.addon_packs','metering.addon_purchases');
--   -- 期望 2
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'fk_addon_purchases_%';
--   -- 期望 4 行
--   -- seed 后:SELECT pack_code, price FROM product.addon_packs ORDER BY sort;  -- 期望 6 行
