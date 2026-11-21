-- Promotion B02: nullable expansion, durable receipts and ownership records.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-19
-- No binding or reservation backfill: use the read-only preflight before B04.
-- Lock timeout aborts atomically; retry during a quiet window rather than block writers.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- ===========================================================================
-- Existing rows and writers remain compatible.
-- ===========================================================================
ALTER TABLE billing.refunds ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb;
DO $$ BEGIN
    ALTER TABLE billing.refunds ADD CONSTRAINT chk_refunds_calculation_object
        CHECK (calculation_snapshot IS NULL OR jsonb_typeof(calculation_snapshot) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE promotion.voucher_batches
    ADD COLUMN IF NOT EXISTS policy_snapshot jsonb,
    ADD COLUMN IF NOT EXISTS claim_until timestamptz,
    ADD COLUMN IF NOT EXISTS use_valid_days int,
    ADD COLUMN IF NOT EXISTS per_workspace_limit int,
    ADD COLUMN IF NOT EXISTS per_tenant_limit int,
    ADD COLUMN IF NOT EXISTS reviewed_by uuid,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE promotion.vouchers
    ADD COLUMN IF NOT EXISTS assigned_tenant_id uuid,
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_token_digest text,
    ADD COLUMN IF NOT EXISTS claim_key_version varchar(32),
    ADD COLUMN IF NOT EXISTS replacement_of_redemption_id uuid,
    ADD COLUMN IF NOT EXISTS funding_order_id uuid,
    ADD COLUMN IF NOT EXISTS funding_payment_id uuid;
ALTER TABLE promotion.voucher_redemptions
    ADD COLUMN IF NOT EXISTS reservation_id uuid,
    ADD COLUMN IF NOT EXISTS order_id uuid,
    ADD COLUMN IF NOT EXISTS operation_id uuid;
ALTER TABLE promotion.voucher_batches DROP CONSTRAINT IF EXISTS chk_voucher_batches_status;
ALTER TABLE promotion.voucher_batches ADD CONSTRAINT chk_voucher_batches_status
    CHECK (status IN ('draft','active','paused','archived'));
DO $$ BEGIN
    ALTER TABLE promotion.voucher_batches ADD CONSTRAINT chk_voucher_batches_claim_window CHECK (claim_until IS NULL OR (valid_from < claim_until AND claim_until <= valid_until));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_batches ADD CONSTRAINT chk_voucher_batches_claim_limits CHECK ((use_valid_days IS NULL OR use_valid_days > 0) AND (per_workspace_limit IS NULL OR per_workspace_limit > 0) AND (per_tenant_limit IS NULL OR per_tenant_limit > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_batches ADD CONSTRAINT chk_voucher_batches_policy_object CHECK (policy_snapshot IS NULL OR jsonb_typeof(policy_snapshot) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_batches ADD CONSTRAINT chk_voucher_batches_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.vouchers ADD CONSTRAINT chk_vouchers_claim_credentials CHECK ((claim_token_digest IS NULL AND claim_key_version IS NULL) OR (claim_token_digest IS NOT NULL AND length(btrim(claim_token_digest)) > 0 AND claim_key_version IS NOT NULL AND length(btrim(claim_key_version)) > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Durable receipts and ownership: expansion only; existing writers stay intact.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS promotion.voucher_operations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_realm      varchar(16) NOT NULL,
    actor_id         uuid NOT NULL,
    operation_type   varchar(64) NOT NULL,
    idempotency_key  varchar(128) NOT NULL,
    request_hash     text NOT NULL,
    batch_id         uuid REFERENCES promotion.voucher_batches(id),
    result           jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_voucher_operations_realm CHECK (actor_realm IN ('operator','customer','system')),
    CONSTRAINT chk_voucher_operations_request CHECK (length(btrim(operation_type)) > 0
        AND length(btrim(idempotency_key)) > 0 AND length(btrim(request_hash)) > 0),
    CONSTRAINT chk_voucher_operations_result CHECK (jsonb_typeof(result) = 'object'),
    CONSTRAINT uq_voucher_operations_request UNIQUE (actor_realm, actor_id, operation_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_voucher_operations_batch ON promotion.voucher_operations (batch_id);

CREATE TABLE IF NOT EXISTS promotion.voucher_reservations (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id               uuid NOT NULL REFERENCES promotion.vouchers(id),
    order_id                 uuid NOT NULL,
    invoice_id               uuid NOT NULL,
    declaration_payment_id   uuid,
    tenant_id                uuid NOT NULL,
    workspace_id             uuid NOT NULL,
    user_id                  uuid NOT NULL,
    operation_id             uuid NOT NULL REFERENCES promotion.voucher_operations(id),
    status                   varchar(16) NOT NULL DEFAULT 'active',
    effect_snapshot          jsonb NOT NULL,
    policy_snapshot          jsonb NOT NULL,
    reserved_at              timestamptz NOT NULL DEFAULT now(),
    consumed_at              timestamptz,
    released_at              timestamptz,
    release_reason           varchar(64),
    CONSTRAINT chk_voucher_reservations_status CHECK (status IN ('active','consumed','released')),
    CONSTRAINT chk_voucher_reservations_snapshots CHECK (jsonb_typeof(effect_snapshot) = 'object'
        AND jsonb_typeof(policy_snapshot) = 'object'),
    CONSTRAINT chk_voucher_reservations_terminal CHECK (
        (status = 'active' AND consumed_at IS NULL AND released_at IS NULL AND release_reason IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_at >= reserved_at
            AND released_at IS NULL AND release_reason IS NULL)
        OR (status = 'released' AND released_at IS NOT NULL AND released_at >= reserved_at
            AND consumed_at IS NULL AND release_reason IS NOT NULL AND length(btrim(release_reason)) > 0)),
    CONSTRAINT uq_voucher_reservations_operation UNIQUE (operation_id, voucher_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_voucher_reservations_active ON promotion.voucher_reservations (voucher_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_order_status ON promotion.voucher_reservations (order_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_invoice_status ON promotion.voucher_reservations (invoice_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_payment ON promotion.voucher_reservations (declaration_payment_id);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_tenant_workspace ON promotion.voucher_reservations (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_workspace ON promotion.voucher_reservations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_user ON promotion.voucher_reservations (user_id);

-- Legacy redemptions keep NULL links; never fabricate historical ownership.
DO $$ BEGIN
ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_reservation
    FOREIGN KEY (reservation_id) REFERENCES promotion.voucher_reservations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_operation
    FOREIGN KEY (operation_id) REFERENCES promotion.voucher_operations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_replacement_redemption
    FOREIGN KEY (replacement_of_redemption_id) REFERENCES promotion.voucher_redemptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS promotion.voucher_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id     uuid NOT NULL REFERENCES promotion.voucher_operations(id),
    batch_id         uuid NOT NULL REFERENCES promotion.voucher_batches(id),
    voucher_id       uuid REFERENCES promotion.vouchers(id),
    reservation_id   uuid REFERENCES promotion.voucher_reservations(id),
    redemption_id    uuid REFERENCES promotion.voucher_redemptions(id),
    order_id         uuid,
    event_type       varchar(64) NOT NULL,
    actor_realm      varchar(16) NOT NULL,
    actor_id         uuid NOT NULL,
    reason           text,
    metadata         jsonb NOT NULL DEFAULT '{}',
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_voucher_events_realm CHECK (actor_realm IN ('operator','customer','system')),
    CONSTRAINT chk_voucher_events_type CHECK (length(btrim(event_type)) > 0),
    CONSTRAINT chk_voucher_events_metadata CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_voucher_events_batch_created ON promotion.voucher_events (batch_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_voucher_events_voucher_created ON promotion.voucher_events (voucher_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_voucher_events_order ON promotion.voucher_events (order_id);
CREATE INDEX IF NOT EXISTS idx_voucher_events_operation ON promotion.voucher_events (operation_id);
CREATE INDEX IF NOT EXISTS idx_voucher_events_reservation ON promotion.voucher_events (reservation_id);
CREATE INDEX IF NOT EXISTS idx_voucher_events_redemption ON promotion.voucher_events (redemption_id);

-- Cross-schema references follow the baseline's 90 file.
DO $$ BEGIN
    ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_assigned_tenant
        FOREIGN KEY (assigned_tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_funding_order
        FOREIGN KEY (funding_order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_funding_payment
        FOREIGN KEY (funding_payment_id) REFERENCES billing.payments(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_order
        FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_order
        FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_invoice
        FOREIGN KEY (invoice_id) REFERENCES billing.invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_payment
        FOREIGN KEY (declaration_payment_id) REFERENCES billing.payments(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_workspace
        FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_reservations ADD CONSTRAINT fk_voucher_reservations_user
        FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_events ADD CONSTRAINT fk_voucher_events_order
        FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON promotion.voucher_operations, promotion.voucher_reservations, promotion.voucher_events
    TO platform_svc, svc_admin_bff, svc_console_bff, svc_platform_api;
GRANT SELECT ON promotion.voucher_operations, promotion.voucher_reservations, promotion.voucher_events TO reporting_ro;
GRANT UPDATE (policy_snapshot, claim_until, use_valid_days, per_workspace_limit, per_tenant_limit,
    reviewed_by, reviewed_at, frozen_at) ON promotion.voucher_batches TO platform_svc;
GRANT UPDATE (assigned_tenant_id, claimed_at, claim_token_digest, claim_key_version,
    replacement_of_redemption_id, funding_order_id, funding_payment_id) ON promotion.vouchers TO platform_svc;
GRANT UPDATE (reservation_id, order_id, operation_id) ON promotion.voucher_redemptions TO platform_svc;
-- ===========================================================================
-- Promotion ownership and audit permissions, including future service roles.
-- ===========================================================================
REVOKE UPDATE, DELETE ON promotion.voucher_operations, promotion.voucher_events FROM platform_svc, svc_admin_bff, svc_console_bff, svc_platform_api;
REVOKE UPDATE, DELETE ON promotion.voucher_reservations FROM platform_svc, svc_admin_bff, svc_console_bff, svc_platform_api;
GRANT UPDATE (status, consumed_at, released_at, release_reason)
    ON promotion.voucher_reservations TO platform_svc, svc_admin_bff, svc_console_bff, svc_platform_api;

-- ===========================================================================
-- B02 refund allocation foundation: execution and aggregate caps arrive in B05.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS billing.refund_allocations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_id     uuid NOT NULL REFERENCES billing.refunds(id),
    payment_id    uuid NOT NULL REFERENCES billing.payments(id),
    currency      varchar(16) NOT NULL,
    amount        numeric(12,2) NOT NULL,
    status        varchar(16) NOT NULL DEFAULT 'reserved',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_refund_allocations_source UNIQUE (refund_id, payment_id),
    CONSTRAINT chk_refund_allocations_amount CHECK (amount > 0),
    CONSTRAINT chk_refund_allocations_status CHECK (status IN ('reserved','succeeded','released')),
    CONSTRAINT chk_refund_allocations_currency CHECK (length(btrim(currency)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_refund_allocations_payment_status ON billing.refund_allocations (payment_id, status);

-- ===========================================================================
-- B02 compensation intentions: workers and financial eligibility arrive in B05.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS promotion.voucher_compensations (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    redemption_id            uuid NOT NULL REFERENCES promotion.voucher_redemptions(id),
    order_id                 uuid NOT NULL,
    refund_id                uuid,
    replacement_voucher_id   uuid REFERENCES promotion.vouchers(id),
    compensation_type        varchar(32) NOT NULL,
    amount_cents             bigint NOT NULL,
    policy_snapshot          jsonb NOT NULL,
    status                   varchar(24) NOT NULL DEFAULT 'pending',
    reason                   text NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_voucher_compensations_source UNIQUE (redemption_id, compensation_type),
    CONSTRAINT uq_voucher_compensations_replacement UNIQUE (replacement_voucher_id),
    CONSTRAINT chk_voucher_compensations_type CHECK (compensation_type = 'refund_replacement'),
    CONSTRAINT chk_voucher_compensations_amount CHECK (amount_cents >= 0),
    CONSTRAINT chk_voucher_compensations_policy CHECK (jsonb_typeof(policy_snapshot) = 'object'),
    CONSTRAINT chk_voucher_compensations_status CHECK (status IN ('pending','completed','manual_required')),
    CONSTRAINT chk_voucher_compensations_reason CHECK (length(btrim(reason)) > 0),
    CONSTRAINT chk_voucher_compensations_result CHECK (replacement_voucher_id IS NULL OR status = 'completed')
);
CREATE INDEX IF NOT EXISTS idx_voucher_compensations_pending ON promotion.voucher_compensations (status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_voucher_compensations_order ON promotion.voucher_compensations (order_id);
CREATE INDEX IF NOT EXISTS idx_voucher_compensations_refund ON promotion.voucher_compensations (refund_id);

DO $$ BEGIN
    ALTER TABLE promotion.voucher_compensations ADD CONSTRAINT fk_voucher_compensations_order
        FOREIGN KEY (order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE promotion.voucher_compensations ADD CONSTRAINT fk_voucher_compensations_refund
        FOREIGN KEY (refund_id) REFERENCES billing.refunds(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON billing.refund_allocations, promotion.voucher_compensations TO platform_svc, svc_admin_bff, svc_console_bff, svc_platform_api;
GRANT SELECT ON billing.refund_allocations, promotion.voucher_compensations TO reporting_ro;
-- Refund allocation and compensation facts cannot be rewritten by service roles.
REVOKE UPDATE, DELETE ON billing.refund_allocations, promotion.voucher_compensations
    FROM svc_admin_bff, svc_console_bff, svc_platform_api;
REVOKE UPDATE ON billing.refund_allocations FROM platform_svc;
REVOKE UPDATE ON promotion.voucher_compensations FROM platform_svc;
REVOKE DELETE ON billing.refund_allocations, promotion.voucher_compensations FROM platform_svc;
GRANT UPDATE (status, updated_at) ON billing.refund_allocations TO platform_svc;
GRANT UPDATE (status, updated_at) ON billing.refund_allocations TO svc_admin_bff, svc_console_bff, svc_platform_api;
GRANT UPDATE (replacement_voucher_id, status, reason, updated_at) ON promotion.voucher_compensations TO platform_svc;
GRANT UPDATE (replacement_voucher_id, status, reason, updated_at) ON promotion.voucher_compensations TO svc_admin_bff, svc_console_bff, svc_platform_api;

-- Match the existing refund update whitelist; calculation snapshots are insert-only.
REVOKE UPDATE ON billing.refunds FROM svc_admin_bff, svc_console_bff, svc_platform_api;
GRANT UPDATE (tenant_id, bill_id, pay_record_id, transaction_id, order_id, refund_amount, currency, refund_reason, refund_type, audit_status, audit_remark, auditor_id, audit_at, refund_status, refund_at, transfer_channel, transfer_reference, transfer_initiated_at, transfer_initiated_by, transfer_date, transfer_attempt, payout_account_id, payout_account_label, recipient_account_name, recipient_bank_name, recipient_bank_account, created_by_type, created_by_id, updated_at) ON billing.refunds TO svc_admin_bff, svc_console_bff, svc_platform_api;

COMMIT;
-- ===========================================================================
-- Existing tables may be large: build indexes outside the expansion transaction.
-- Run via psql without -1 (the repository migration runner uses this mode).
-- An interrupted build can leave an INVALID index. Repair only this migration's
-- invalid indexes, never remove a valid index or change any voucher facts.
-- ===========================================================================
SET lock_timeout = '2s';
SET statement_timeout = '60s';
SELECT format('DROP INDEX CONCURRENTLY %I.%I;', n.nspname, c.relname)
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'promotion' AND NOT i.indisvalid
  AND c.relname IN ('idx_vouchers_assigned_tenant',
    'uidx_vouchers_claim_digest',
    'idx_vouchers_replacement',
    'idx_vouchers_funding_order',
    'idx_vouchers_funding_payment',
    'uidx_voucher_redemptions_reservation',
    'idx_voucher_redemptions_order',
    'idx_voucher_redemptions_operation')
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_assigned_tenant ON promotion.vouchers (assigned_tenant_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_vouchers_claim_digest ON promotion.vouchers (claim_token_digest)
    WHERE claim_token_digest IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_replacement ON promotion.vouchers (replacement_of_redemption_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_funding_order ON promotion.vouchers (funding_order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vouchers_funding_payment ON promotion.vouchers (funding_payment_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_voucher_redemptions_reservation ON promotion.voucher_redemptions (reservation_id)
    WHERE reservation_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voucher_redemptions_order ON promotion.voucher_redemptions (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voucher_redemptions_operation ON promotion.voucher_redemptions (operation_id);
RESET lock_timeout;
RESET statement_timeout;
