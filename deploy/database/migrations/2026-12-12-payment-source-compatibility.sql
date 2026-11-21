-- payment-source-compatibility.sql - Preserve historical balance payment evidence.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-20
-- This expands the stored value domain without rewriting or classifying payments.
-- Balance payments are not cash receipts and require manual refund review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE billing.payments DROP CONSTRAINT IF EXISTS chk_payments_pay_source;
ALTER TABLE billing.payments ADD CONSTRAINT chk_payments_pay_source
    CHECK (pay_source IN ('online','offline','voucher','balance'));
COMMIT;
