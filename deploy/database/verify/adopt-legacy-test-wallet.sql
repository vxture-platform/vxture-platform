-- adopt-legacy-test-wallet.sql - Explicit adoption of one self-created test wallet.
-- @package vxture-platform
-- @layer Infrastructure
-- @category verification
-- @author AI-Generated
-- @date 2026-11-20
-- Run with psql -X -v ON_ERROR_STOP=1 -f this-file.sql after B02/B10/B11.
-- Required variables: target_sha256, approval_ref, backup_sha256, test_data_ack.
-- test_data_ack must equal SELF_CREATED_NO_EXTERNAL_PAYMENT.
-- commit_adoption defaults to no. A real commit requires separate operator approval.
-- The target hash uses the same database/address/port/current_user identity as
-- migration-cutover-preflight.sql. Obtain it with an approved read-only query.

\set ON_ERROR_STOP on
\if :{?target_sha256}
\else
  \set target_sha256 ''
\endif
\if :{?approval_ref}
\else
  \set approval_ref ''
\endif
\if :{?backup_sha256}
\else
  \set backup_sha256 ''
\endif
\if :{?test_data_ack}
\else
  \set test_data_ack ''
\endif
\if :{?commit_adoption}
\else
  \set commit_adoption no
\endif

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
SELECT set_config('vx.wallet_adoption_target', :'target_sha256', true) AS s05_target,
       set_config('vx.wallet_adoption_approval', :'approval_ref', true) AS s05_approval,
       set_config('vx.wallet_adoption_backup', :'backup_sha256', true) AS s05_backup,
       set_config('vx.wallet_adoption_ack', :'test_data_ack', true) AS s05_ack
\gset

-- ===========================================================================
-- Exact identity and historical facts are prerequisites, never inferred sources.
-- ===========================================================================
DO $$
DECLARE
    actual_target text;
BEGIN
    actual_target := encode(sha256(convert_to(current_database() || E'\n' ||
        coalesce(inet_server_addr()::text, 'local') || E'\n' ||
        coalesce(inet_server_port()::text, 'local') || E'\n' || current_user, 'UTF8')), 'hex');
    IF current_database() <> 'vxturestudio_platform_main'
       OR current_user <> 'vxture_rds_default'
       OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
       OR current_setting('vx.wallet_adoption_target') <> actual_target THEN
        RAISE EXCEPTION 'S05_ADOPTION_TARGET_MISMATCH';
    END IF;
    IF current_setting('vx.wallet_adoption_ack') <> 'SELF_CREATED_NO_EXTERNAL_PAYMENT'
       OR current_setting('vx.wallet_adoption_approval') !~ '^[A-Za-z0-9._:-]{4,128}$'
       OR current_setting('vx.wallet_adoption_backup') !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'S05_ADOPTION_EVIDENCE_REQUIRED';
    END IF;
END $$;

DO $$
DECLARE
    wallet billing.credits%ROWTYPE;
    original_grant billing.transactions%ROWTYPE;
    original_consume billing.transactions%ROWTYPE;
BEGIN
    -- Match application lock order: orders, invoices, payments, then the wallet.
    PERFORM o.id FROM billing.orders o
      WHERE o.id = '646ef877-2795-4ed8-a3a9-b2c6ac2f4911'
         OR o.id IN (SELECT i.order_id FROM billing.invoices i JOIN billing.payments p
             ON p.bill_id = i.id WHERE p.id = '9a54431d-fda3-41fa-9eb0-08d0ed90f054')
      ORDER BY o.id FOR UPDATE;
    PERFORM i.id FROM billing.invoices i JOIN billing.payments p ON p.bill_id = i.id
      WHERE p.id = '9a54431d-fda3-41fa-9eb0-08d0ed90f054' FOR UPDATE OF i;
    PERFORM id FROM billing.payments WHERE id = '9a54431d-fda3-41fa-9eb0-08d0ed90f054' FOR UPDATE;
    SELECT * INTO wallet FROM billing.credits
      WHERE id = 'b7e90751-7726-4106-bc06-66b040897019' FOR UPDATE;
    SELECT * INTO original_grant FROM billing.transactions
      WHERE id = '295b8d57-3e4e-4154-843b-5471ab02f08a';
    SELECT * INTO original_consume FROM billing.transactions
      WHERE id = 'fcb84583-9dd9-43aa-9fec-d944f76bc8c0';

    IF wallet.id IS NULL OR wallet.tenant_id <> '00000000-0000-4000-a000-000000000200'
       OR wallet.currency IS DISTINCT FROM 'CNY' OR wallet.balance <> 532.62
       OR wallet.total_granted <> 533.62 OR wallet.total_consumed <> 1.00 OR wallet.version <> 2 THEN
        RAISE EXCEPTION 'S05_ADOPTION_WALLET_DRIFT';
    END IF;
    IF original_grant.id IS NULL OR original_consume.id IS NULL
       OR original_grant.tenant_id <> wallet.tenant_id OR original_consume.tenant_id <> wallet.tenant_id
       OR original_grant.currency <> wallet.currency OR original_consume.currency <> wallet.currency
       OR original_grant.trade_status <> 'success' OR original_consume.trade_status <> 'success'
       OR original_grant.trade_type <> 'grant' OR original_consume.trade_type <> 'consume'
       OR original_grant.source_method IS NOT NULL OR original_consume.source_method IS NOT NULL
       OR original_grant.amount <> 533.62 OR original_grant.balance_before <> 0 OR original_grant.balance_after <> 533.62
       OR original_consume.amount <> -1.00 OR original_consume.balance_before <> 533.62 OR original_consume.balance_after <> 532.62
       OR original_grant.actor_type <> 'customer' OR original_consume.actor_type <> 'customer'
       OR original_grant.actor_id IS NULL OR original_consume.actor_id IS NULL
       OR original_grant.created_at <> '2026-11-11 06:36:18.628580+00'::timestamptz
       OR original_consume.created_at <> '2026-11-11 16:49:05.018169+00'::timestamptz
       OR original_grant.related_no IS DISTINCT FROM 'ORD-202611-B3135B0D48'
       OR original_grant.bill_id IS NOT NULL
       OR (SELECT count(*) FROM billing.transactions WHERE tenant_id = wallet.tenant_id
           AND balance_before <> balance_after) <> 2 THEN
        RAISE EXCEPTION 'S05_ADOPTION_TRANSACTION_DRIFT';
    END IF;
    IF NOT EXISTS (SELECT FROM billing.orders o
        WHERE o.id = '646ef877-2795-4ed8-a3a9-b2c6ac2f4911' AND o.order_no = original_grant.related_no
          AND o.tenant_id = wallet.tenant_id AND o.currency = wallet.currency AND o.intent = 'upgrade'
          AND o.status = 'fulfilled' AND o.list_amount = 399.00 AND o.credit_amount = 932.62
          AND o.leftover_amount = 533.62 AND o.payable_amount = 0)
       OR NOT EXISTS (SELECT FROM billing.payments p JOIN billing.invoices i ON i.id = p.bill_id
        WHERE p.id = '9a54431d-fda3-41fa-9eb0-08d0ed90f054' AND p.transaction_id = original_consume.id
          AND p.tenant_id = wallet.tenant_id AND p.currency = wallet.currency AND p.pay_source = 'balance'
          AND p.pay_status = 'paid' AND p.paid_at IS NOT NULL AND p.paid_amount = 1.00
          AND p.bill_id = original_consume.bill_id AND i.tenant_id = p.tenant_id AND i.currency = p.currency
          AND i.bill_status = 'paid' AND i.deleted_at IS NULL)
       OR (SELECT count(*) FROM billing.payments WHERE transaction_id = original_consume.id) <> 1
       OR EXISTS (SELECT FROM billing.refunds WHERE pay_record_id = '9a54431d-fda3-41fa-9eb0-08d0ed90f054') THEN
        RAISE EXCEPTION 'S05_ADOPTION_ORDER_OR_PAYMENT_DRIFT';
    END IF;
END $$;

-- ===========================================================================
-- Adoption links original evidence; it never posts another grant or consumption.
-- Historical actor/time stay original. The receipt records the adoption approval.
-- ===========================================================================
CREATE TEMP TABLE s05_adoption_operations ON COMMIT DROP AS
SELECT x.operation_id AS id, c.id AS credit_id, x.operation_key AS idempotency_key,
       encode(sha256(convert_to(jsonb_build_object('policy', 's05-self-created-bonus-v1',
           'transaction', to_jsonb(t), 'creditId', c.id, 'approval', current_setting('vx.wallet_adoption_approval'),
           'backupSha256', current_setting('vx.wallet_adoption_backup'))::text, 'UTF8')), 'hex') AS request_hash,
       x.action, t.actor_type, t.actor_id, t.id AS transaction_id,
       jsonb_build_object('operationId', x.operation_id, 'transactionId', t.id, 'action', x.action,
           'amount', t.amount::text, 'balance', t.balance_after::text, 'restoredAmount', '0.00', 'expiredAmount', '0.00',
           'lotId', CASE WHEN x.action = 'bonus' THEN '97bb12c8-9404-40bd-8d10-420b303e9103' ELSE NULL END,
           'legacyAdoption', jsonb_build_object('policy', 's05-self-created-bonus-v1', 'selfCreatedTestData', true,
               'cashRefundable', false, 'registeredBy', current_user,
               'approvalReference', current_setting('vx.wallet_adoption_approval'),
               'backupSha256', current_setting('vx.wallet_adoption_backup'))) AS result,
       t.created_at
FROM (VALUES
    ('97bb12c8-9404-40bd-8d10-420b303e9101'::uuid, '295b8d57-3e4e-4154-843b-5471ab02f08a'::uuid, 'legacy-test:s05:grant', 'bonus'),
    ('97bb12c8-9404-40bd-8d10-420b303e9102'::uuid, 'fcb84583-9dd9-43aa-9fec-d944f76bc8c0'::uuid, 'legacy-test:s05:consume', 'consume')
) x(operation_id, transaction_id, operation_key, action)
JOIN billing.transactions t ON t.id = x.transaction_id
JOIN billing.credits c ON c.tenant_id = t.tenant_id;

CREATE TEMP TABLE s05_adoption_lots ON COMMIT DROP AS
SELECT '97bb12c8-9404-40bd-8d10-420b303e9103'::uuid AS id, credit_id, id AS operation_id,
       'bonus'::varchar(16) AS kind, 533.62::numeric(12,2) AS amount,
       NULL::uuid AS funding_payment_id, NULL::timestamptz AS expires_at, created_at
FROM s05_adoption_operations WHERE action = 'bonus';

CREATE TEMP TABLE s05_adoption_entries ON COMMIT DROP AS
SELECT x.entry_id AS id, o.id AS operation_id, '97bb12c8-9404-40bd-8d10-420b303e9103'::uuid AS lot_id,
       x.entry_type, x.amount, NULL::uuid AS debit_entry_id, o.created_at
FROM (VALUES
    ('97bb12c8-9404-40bd-8d10-420b303e9104'::uuid, 'bonus', 'credit', 533.62::numeric(12,2)),
    ('97bb12c8-9404-40bd-8d10-420b303e9105'::uuid, 'consume', 'consume', -1.00::numeric(12,2))
) x(entry_id, action, entry_type, amount) JOIN s05_adoption_operations o ON o.action = x.action;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM billing.wallet_accounts WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019') THEN
        INSERT INTO billing.wallet_accounts(credit_id) VALUES ('b7e90751-7726-4106-bc06-66b040897019');
        INSERT INTO billing.wallet_operations(id, credit_id, idempotency_key, request_hash, action, actor_type, actor_id, transaction_id, result, created_at)
            SELECT * FROM s05_adoption_operations;
        INSERT INTO billing.wallet_lots(id, credit_id, operation_id, kind, amount, funding_payment_id, expires_at, created_at)
            SELECT * FROM s05_adoption_lots;
        INSERT INTO billing.wallet_entries(id, operation_id, lot_id, entry_type, amount, debit_entry_id, created_at)
            SELECT * FROM s05_adoption_entries;
    END IF;

    -- Compare complete rows both ways, including receipts, timestamps and actors.
    IF EXISTS ((SELECT * FROM s05_adoption_operations EXCEPT SELECT * FROM billing.wallet_operations
                   WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019')
        UNION ALL (SELECT * FROM billing.wallet_operations WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019'
                   EXCEPT SELECT * FROM s05_adoption_operations))
       OR EXISTS ((SELECT * FROM s05_adoption_lots EXCEPT SELECT * FROM billing.wallet_lots
                   WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019')
        UNION ALL (SELECT * FROM billing.wallet_lots WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019'
                   EXCEPT SELECT * FROM s05_adoption_lots))
       OR EXISTS ((SELECT * FROM s05_adoption_entries EXCEPT SELECT * FROM billing.wallet_entries WHERE lot_id IN
                   (SELECT id FROM billing.wallet_lots WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019'))
        UNION ALL (SELECT * FROM billing.wallet_entries WHERE lot_id IN
                   (SELECT id FROM billing.wallet_lots WHERE credit_id = 'b7e90751-7726-4106-bc06-66b040897019')
                   EXCEPT SELECT * FROM s05_adoption_entries)) THEN
        RAISE EXCEPTION 'S05_ADOPTION_EXISTING_EVIDENCE_MISMATCH';
    END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;

SELECT 'S05_TEST_WALLET_VALIDATED' AS status, '532.62' AS bonus_balance,
       '0.00' AS principal_balance, false AS cash_refundable;
\if :commit_adoption
    COMMIT;
    \echo S05_TEST_WALLET_COMMITTED
\else
    ROLLBACK;
    \echo S05_TEST_WALLET_DRY_RUN_ROLLED_BACK
\endif
