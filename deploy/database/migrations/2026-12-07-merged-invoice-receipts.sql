-- Preserve single-bill writers while adding per-bill invoice allocations.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-10-22
BEGIN;
SET LOCAL lock_timeout = '1s';
CREATE TABLE IF NOT EXISTS billing.invoice_receipt_bills (
    receipt_id uuid NOT NULL REFERENCES billing.invoice_receipts(id),
    bill_id uuid NOT NULL REFERENCES billing.invoices(id),
    amount numeric(12,2) NOT NULL,
    PRIMARY KEY (receipt_id, bill_id)
);
CREATE INDEX IF NOT EXISTS idx_receipt_bills_bill ON billing.invoice_receipt_bills (bill_id);
INSERT INTO billing.invoice_receipt_bills (receipt_id, bill_id, amount)
SELECT id, bill_id, invoice_amount FROM billing.invoice_receipts
ON CONFLICT (receipt_id, bill_id) DO NOTHING;

CREATE OR REPLACE FUNCTION billing.link_receipt_anchor() RETURNS trigger AS $$
BEGIN
  INSERT INTO billing.invoice_receipt_bills (receipt_id, bill_id, amount)
  VALUES (NEW.id, NEW.bill_id, NEW.invoice_amount);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_receipt_anchor ON billing.invoice_receipts;
CREATE TRIGGER trg_receipt_anchor AFTER INSERT ON billing.invoice_receipts
  FOR EACH ROW EXECUTE FUNCTION billing.link_receipt_anchor();

-- Check the completed allocation, after a merged application's whole transaction.
CREATE OR REPLACE FUNCTION billing.check_receipt_allocation() RETURNS trigger AS $$
DECLARE target_id uuid; r billing.invoice_receipts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'invoice_receipts' THEN target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_id := OLD.receipt_id;
  ELSE target_id := NEW.receipt_id; END IF;
  SELECT * INTO r FROM billing.invoice_receipts WHERE id = target_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (SELECT coalesce(sum(amount), 0) FROM billing.invoice_receipt_bills WHERE receipt_id = target_id)
       <> r.invoice_amount OR NOT EXISTS (
         SELECT 1 FROM billing.invoice_receipt_bills WHERE receipt_id = target_id AND bill_id = r.bill_id
       ) THEN
    RAISE EXCEPTION 'receipt_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM billing.invoice_receipt_bills rb
    JOIN billing.invoices b ON b.id = rb.bill_id
    WHERE rb.receipt_id = target_id AND (
      b.tenant_id <> r.tenant_id OR coalesce(b.currency, 'CNY') <> coalesce(r.currency, 'CNY')
    )
  ) THEN
    RAISE EXCEPTION 'receipt_allocation_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_receipt_allocation ON billing.invoice_receipt_bills;
CREATE CONSTRAINT TRIGGER trg_receipt_allocation
  AFTER INSERT OR UPDATE OR DELETE ON billing.invoice_receipt_bills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_receipt_allocation();
DROP TRIGGER IF EXISTS trg_receipt_total ON billing.invoice_receipts;
CREATE CONSTRAINT TRIGGER trg_receipt_total
  AFTER UPDATE ON billing.invoice_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_receipt_allocation();
GRANT SELECT, INSERT, UPDATE ON billing.invoice_receipt_bills TO platform_svc, svc_console_bff, svc_admin_bff;
GRANT SELECT ON billing.invoice_receipt_bills TO reporting_ro, svc_platform_api;
REVOKE UPDATE ON billing.invoice_receipt_bills FROM platform_svc;
GRANT UPDATE (amount) ON billing.invoice_receipt_bills TO platform_svc;
COMMIT;
