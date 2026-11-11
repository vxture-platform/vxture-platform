-- Enable an explicit wallet payment leg without rewriting existing payments.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-11
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE billing.payments DROP CONSTRAINT chk_payments_pay_source;
ALTER TABLE billing.payments ADD CONSTRAINT chk_payments_pay_source
  CHECK (pay_source IN ('online','offline','voucher','balance'));
ALTER TABLE billing.refunds DROP CONSTRAINT chk_refunds_transfer_channel;
ALTER TABLE billing.refunds ADD CONSTRAINT chk_refunds_transfer_channel
  CHECK (transfer_channel IS NULL OR transfer_channel IN ('bank_transfer','alipay','legacy','balance'));
COMMIT;
