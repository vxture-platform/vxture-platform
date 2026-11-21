-- Cash reserved for issued cards; conversion into wallet lots is not new revenue.
-- @package vxture-platform
-- @layer Infrastructure
-- @category ddl
-- @author AI-Generated
-- @date 2026-11-19

CREATE TABLE billing.wallet_card_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id uuid NOT NULL UNIQUE,
    payment_id uuid NOT NULL REFERENCES billing.payments(id),
    amount numeric(12,2) NOT NULL CHECK(amount>0),
    status varchar(16) NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','transferred','released')),
    principal_lot_id uuid UNIQUE REFERENCES billing.wallet_lots(id) DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_wallet_card_transfer CHECK((status='transferred')=(principal_lot_id IS NOT NULL))
);
CREATE INDEX idx_wallet_card_payment ON billing.wallet_card_allocations(payment_id);

-- ===========================================================================
-- Source locks precede wallet/batch/voucher locks in every application path.
-- ===========================================================================
CREATE OR REPLACE FUNCTION billing.check_wallet_funding_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; paid numeric;
BEGIN
    IF TG_TABLE_NAME='wallet_lots' THEN source_id:=NEW.funding_payment_id;
    ELSE source_id:=NEW.payment_id; END IF;
    IF source_id IS NULL THEN RETURN NEW; END IF;
    SELECT paid_amount INTO paid FROM billing.payments WHERE id=source_id FOR UPDATE;
    IF coalesce((SELECT sum(amount) FROM billing.wallet_lots WHERE funding_payment_id=source_id),0)+
       coalesce((SELECT sum(amount) FROM billing.wallet_card_allocations WHERE payment_id=source_id AND status='reserved'),0)+
       coalesce((SELECT sum(amount) FROM billing.refund_allocations WHERE payment_id=source_id AND status IN ('reserved','succeeded')),0)>paid THEN
        RAISE EXCEPTION 'cash source already allocated to card, wallet or refund' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER wallet_card_capacity AFTER INSERT OR UPDATE ON billing.wallet_card_allocations FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_funding_capacity();

CREATE FUNCTION billing.guard_wallet_card_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
       OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.status<>'reserved'
       OR NEW.status NOT IN ('transferred','released') THEN
        RAISE EXCEPTION 'immutable card allocation or invalid terminal transition' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER wallet_card_transition BEFORE UPDATE OR DELETE ON billing.wallet_card_allocations FOR EACH ROW EXECUTE FUNCTION billing.guard_wallet_card_transition();

-- ===========================================================================
-- Deferred evidence checks permit one atomic reservation-to-lot conversion.
-- ===========================================================================
CREATE FUNCTION billing.check_wallet_card_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE card_id uuid; a billing.wallet_card_allocations%ROWTYPE; v record;
BEGIN
    IF TG_TABLE_NAME='vouchers' THEN card_id:=NEW.id; ELSE card_id:=NEW.voucher_id; END IF;
    SELECT * INTO a FROM billing.wallet_card_allocations WHERE voucher_id=card_id;
    SELECT i.*,b.kind,b.effect,b.tenant_id batch_tenant INTO v FROM promotion.vouchers i
      JOIN promotion.voucher_batches b ON b.id=i.batch_id WHERE i.id=card_id;
    IF v.kind IS DISTINCT FROM 'recharge_card' THEN
        IF a.id IS NOT NULL THEN RAISE EXCEPTION 'card funding requires recharge card'; END IF;
        RETURN NULL;
    END IF;
    IF a.id IS NULL THEN
        IF v.status<>'revoked' AND (coalesce((v.effect->>'face_value_cents')::numeric,0)>0 OR v.funding_payment_id IS NOT NULL OR v.funding_order_id IS NOT NULL) THEN
            RAISE EXCEPTION 'principal card requires a cash allocation' USING ERRCODE='check_violation';
        END IF;
        RETURN NULL;
    END IF;
    IF v.funding_payment_id IS DISTINCT FROM a.payment_id OR v.funding_order_id IS NOT NULL
       OR a.amount*100 IS DISTINCT FROM (v.effect->>'face_value_cents')::numeric
       OR NOT EXISTS(SELECT FROM billing.payments p JOIN billing.invoices i ON i.id=p.bill_id JOIN billing.transactions t ON t.id=p.transaction_id
         WHERE p.id=a.payment_id AND p.tenant_id=v.batch_tenant AND (v.assigned_tenant_id IS NULL OR v.assigned_tenant_id=p.tenant_id)
         AND p.currency='CNY' AND p.pay_status='paid' AND p.pay_source IN ('online','offline') AND p.paid_at IS NOT NULL
         AND i.tenant_id=p.tenant_id AND i.currency=p.currency AND i.bill_type='one_off' AND i.order_id IS NULL AND i.subscription_id IS NULL AND i.bill_status='paid' AND i.deleted_at IS NULL
         AND NOT EXISTS(SELECT FROM billing.invoice_items ii WHERE ii.bill_id=i.id AND ii.subscription_id IS NOT NULL)
         AND NOT EXISTS(SELECT FROM billing.payments other WHERE other.transaction_id=t.id AND other.id<>p.id)
         AND i.paid_amount=(SELECT sum(s.paid_amount) FROM billing.payments s WHERE s.bill_id=i.id AND s.pay_status='paid')
         AND t.tenant_id=p.tenant_id AND t.bill_id=i.id AND t.currency=p.currency AND t.amount=p.paid_amount AND t.trade_type='recharge' AND t.trade_status='success' AND t.balance_before=t.balance_after)
       OR (a.status='reserved' AND v.status NOT IN ('issued','assigned','expired'))
       OR (a.status='released' AND v.status<>'revoked')
       OR (a.status='transferred' AND (v.status<>'redeemed' OR NOT EXISTS(
           SELECT FROM billing.wallet_lots l JOIN billing.credits c ON c.id=l.credit_id JOIN billing.payments p ON p.id=a.payment_id
           WHERE l.id=a.principal_lot_id AND l.kind='principal' AND l.funding_payment_id=a.payment_id AND l.amount=a.amount AND c.tenant_id=p.tenant_id))) THEN
        RAISE EXCEPTION 'card cash evidence inconsistent' USING ERRCODE='check_violation';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_card_evidence AFTER INSERT OR UPDATE ON billing.wallet_card_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_card_evidence();

CREATE FUNCTION billing.check_card_redemption_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM promotion.voucher_redemptions WHERE id=NEW.id;
    IF r.kind<>'recharge_card' THEN RETURN NULL; END IF;
    IF r.subscription_id IS NOT NULL OR r.payment_id IS NOT NULL OR r.invoice_item_id IS NOT NULL OR r.order_id IS NOT NULL
       OR r.transaction_id IS NULL OR r.operation_id IS NULL
       OR (coalesce((r.effect_snapshot->>'face_value_cents')::numeric,0)>0)<>(r.principal_wallet_operation_id IS NOT NULL)
       OR (coalesce((r.effect_snapshot->>'bonus_cents')::numeric,0)>0)<>(r.bonus_wallet_operation_id IS NOT NULL)
       OR NOT EXISTS(SELECT FROM billing.wallet_operations o JOIN billing.credits c ON c.id=o.credit_id
         WHERE o.id=coalesce(r.principal_wallet_operation_id,r.bonus_wallet_operation_id) AND o.transaction_id=r.transaction_id AND c.tenant_id=r.tenant_id)
       OR (r.principal_wallet_operation_id IS NOT NULL AND NOT EXISTS(
         SELECT FROM billing.wallet_operations o JOIN billing.wallet_lots l ON l.operation_id=o.id JOIN billing.credits c ON c.id=o.credit_id
         JOIN billing.wallet_card_allocations a ON a.voucher_id=r.voucher_id AND a.principal_lot_id=l.id
         WHERE o.id=r.principal_wallet_operation_id AND o.action='principal' AND o.idempotency_key='card:'||r.voucher_id::text||':principal' AND c.tenant_id=r.tenant_id AND c.currency='CNY'
         AND l.amount*100=(r.effect_snapshot->>'face_value_cents')::numeric AND a.status='transferred'))
       OR (r.bonus_wallet_operation_id IS NOT NULL AND NOT EXISTS(
         SELECT FROM billing.wallet_operations o JOIN billing.wallet_lots l ON l.operation_id=o.id JOIN billing.credits c ON c.id=o.credit_id
         WHERE o.id=r.bonus_wallet_operation_id AND o.action='bonus' AND o.idempotency_key='card:'||r.voucher_id::text||':bonus' AND c.tenant_id=r.tenant_id AND c.currency='CNY'
         AND l.amount*100=(r.effect_snapshot->>'bonus_cents')::numeric
         AND l.expires_at IS NOT DISTINCT FROM (r.effect_snapshot->>'bonus_expires_at')::timestamptz)) THEN
        RAISE EXCEPTION 'card redemption requires matching wallet operations' USING ERRCODE='check_violation';
    END IF;
    RETURN NULL;
END $$;
