-- Wallet sources, immutable allocations and zero-balance activation.
-- @package vxture-platform
-- @layer Infrastructure
-- @category ddl
-- @author AI-Generated
-- @date 2026-11-19

-- ===========================================================================
-- All ownership is inherited through credit_id; no historical balances are guessed.
-- ===========================================================================
CREATE TABLE billing.wallet_accounts (
    credit_id uuid PRIMARY KEY REFERENCES billing.credits(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE billing.wallet_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_id uuid NOT NULL REFERENCES billing.wallet_accounts(credit_id),
    idempotency_key varchar(128) NOT NULL,
    request_hash text NOT NULL,
    action varchar(24) NOT NULL,
    actor_type varchar(16) NOT NULL,
    actor_id uuid NOT NULL,
    transaction_id uuid NOT NULL UNIQUE REFERENCES billing.transactions(id),
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_wallet_operations_key UNIQUE(credit_id,idempotency_key),
    CONSTRAINT chk_wallet_operations_action CHECK(action IN ('principal','bonus','consume','restore','expire','reclaim')),
    CONSTRAINT chk_wallet_operations_actor CHECK(actor_type IN ('system','customer','operator')),
    CONSTRAINT chk_wallet_operations_result CHECK(jsonb_typeof(result)='object')
);

CREATE TABLE billing.wallet_lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_id uuid NOT NULL REFERENCES billing.wallet_accounts(credit_id),
    operation_id uuid NOT NULL REFERENCES billing.wallet_operations(id),
    kind varchar(16) NOT NULL,
    amount numeric(12,2) NOT NULL,
    funding_payment_id uuid REFERENCES billing.payments(id),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_wallet_lots_kind CHECK(kind IN ('principal','bonus')),
    CONSTRAINT chk_wallet_lots_amount CHECK(amount>0),
    CONSTRAINT chk_wallet_lots_funding CHECK((kind='principal')=(funding_payment_id IS NOT NULL)),
    CONSTRAINT chk_wallet_lots_expiry CHECK(kind<>'principal' OR expires_at IS NULL)
);
CREATE INDEX idx_wallet_operations_credit ON billing.wallet_operations(credit_id,created_at,id);
CREATE INDEX idx_wallet_lots_credit ON billing.wallet_lots(credit_id,created_at,id);
CREATE INDEX idx_wallet_lots_funding ON billing.wallet_lots(funding_payment_id);
CREATE INDEX idx_wallet_lots_expiry ON billing.wallet_lots(expires_at) WHERE kind='bonus';

CREATE TABLE billing.wallet_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id uuid NOT NULL REFERENCES billing.wallet_operations(id),
    lot_id uuid NOT NULL REFERENCES billing.wallet_lots(id),
    entry_type varchar(16) NOT NULL,
    amount numeric(12,2) NOT NULL,
    debit_entry_id uuid REFERENCES billing.wallet_entries(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_wallet_entries_type CHECK(entry_type IN ('credit','consume','restore','expire','reclaim')),
    CONSTRAINT chk_wallet_entries_sign CHECK((entry_type IN ('credit','restore') AND amount>0) OR (entry_type IN ('consume','expire','reclaim') AND amount<0)),
    CONSTRAINT chk_wallet_entries_restore CHECK((entry_type='restore')=(debit_entry_id IS NOT NULL))
);
CREATE INDEX idx_wallet_entries_operation ON billing.wallet_entries(operation_id);
CREATE INDEX idx_wallet_entries_lot ON billing.wallet_entries(lot_id);
CREATE INDEX idx_wallet_entries_debit ON billing.wallet_entries(debit_entry_id);

-- ===========================================================================
-- Deferred guards reconcile every posting and stop old writers bypassing sources.
-- Functions are invoker-only and never grant callers privileged writes.
-- ===========================================================================
CREATE FUNCTION billing.reject_wallet_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'immutable wallet evidence: %.%',TG_TABLE_SCHEMA,TG_TABLE_NAME USING ERRCODE='restrict_violation';
END $$;
CREATE TRIGGER wallet_accounts_immutable BEFORE UPDATE OR DELETE ON billing.wallet_accounts FOR EACH ROW EXECUTE FUNCTION billing.reject_wallet_mutation();
CREATE TRIGGER wallet_operations_immutable BEFORE UPDATE OR DELETE ON billing.wallet_operations FOR EACH ROW EXECUTE FUNCTION billing.reject_wallet_mutation();
CREATE TRIGGER wallet_lots_immutable BEFORE UPDATE OR DELETE ON billing.wallet_lots FOR EACH ROW EXECUTE FUNCTION billing.reject_wallet_mutation();
CREATE TRIGGER wallet_entries_immutable BEFORE UPDATE OR DELETE ON billing.wallet_entries FOR EACH ROW EXECUTE FUNCTION billing.reject_wallet_mutation();

CREATE FUNCTION billing.check_wallet_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet_id uuid;
BEGIN
    IF TG_TABLE_NAME='credits' THEN wallet_id:=NEW.id;
    ELSIF TG_TABLE_NAME='wallet_entries' THEN
        SELECT credit_id INTO wallet_id FROM billing.wallet_lots WHERE id=NEW.lot_id;
    ELSE wallet_id:=NEW.credit_id; END IF;
    IF NOT EXISTS(SELECT FROM billing.wallet_accounts WHERE credit_id=wallet_id) THEN RETURN NULL; END IF;
    IF EXISTS(SELECT FROM billing.credits c WHERE c.id=wallet_id AND
        (c.balance<0 OR c.balance IS DISTINCT FROM
          (SELECT coalesce(sum(e.amount),0) FROM billing.wallet_entries e JOIN billing.wallet_lots l ON l.id=e.lot_id WHERE l.credit_id=wallet_id)))
    OR EXISTS(SELECT FROM billing.wallet_lots l LEFT JOIN billing.wallet_entries e ON e.lot_id=l.id
        WHERE l.credit_id=wallet_id GROUP BY l.id HAVING coalesce(sum(e.amount),0)<0 OR coalesce(sum(e.amount),0)>l.amount
          OR coalesce(sum(e.amount) FILTER(WHERE e.entry_type='credit'),0)<>l.amount)
    OR EXISTS(SELECT FROM billing.wallet_entries e JOIN billing.wallet_lots l ON l.id=e.lot_id
        JOIN billing.wallet_operations o ON o.id=e.operation_id
        WHERE l.credit_id=wallet_id AND (o.credit_id<>l.credit_id OR
          (e.entry_type='credit' AND (e.operation_id<>l.operation_id OR o.action<>l.kind)) OR
          (e.entry_type='consume' AND o.action<>'consume') OR
          (e.entry_type='restore' AND o.action<>'restore') OR
          (e.entry_type='expire' AND o.action NOT IN ('expire','restore')) OR
          (e.entry_type='reclaim' AND o.action<>'reclaim') OR
          (e.entry_type IN ('expire','reclaim') AND l.kind<>'bonus')))
    OR EXISTS(SELECT FROM billing.wallet_entries d JOIN billing.wallet_entries r ON r.debit_entry_id=d.id
        JOIN billing.wallet_lots l ON l.id=r.lot_id WHERE l.credit_id=wallet_id
        GROUP BY d.id HAVING d.entry_type<>'consume' OR bool_or(r.lot_id<>d.lot_id) OR sum(r.amount)>-d.amount)
    OR EXISTS(SELECT FROM billing.wallet_operations o JOIN billing.transactions t ON t.id=o.transaction_id
        JOIN billing.credits c ON c.id=o.credit_id LEFT JOIN billing.wallet_entries e ON e.operation_id=o.id
        WHERE o.credit_id=wallet_id GROUP BY o.id,t.id,c.id
        HAVING coalesce(sum(e.amount),0)<>t.amount OR t.amount<>t.balance_after-t.balance_before
          OR t.tenant_id<>c.tenant_id OR t.currency<>c.currency OR t.trade_status<>'success')
    OR EXISTS(SELECT FROM billing.wallet_lots l JOIN billing.payments p ON p.id=l.funding_payment_id
        JOIN billing.credits c ON c.id=l.credit_id JOIN billing.invoices i ON i.id=p.bill_id
        LEFT JOIN billing.transactions t ON t.id=p.transaction_id WHERE l.credit_id=wallet_id AND
        (p.tenant_id<>c.tenant_id OR p.currency<>c.currency OR p.pay_source NOT IN ('online','offline')
          OR p.pay_status<>'paid' OR p.paid_at IS NULL OR i.order_id IS NOT NULL OR i.subscription_id IS NOT NULL
          OR i.bill_type<>'one_off' OR i.bill_status<>'paid' OR i.deleted_at IS NOT NULL
          OR t.id IS NULL OR t.tenant_id<>p.tenant_id OR t.currency<>p.currency OR t.bill_id IS DISTINCT FROM i.id
          OR EXISTS(SELECT FROM billing.payments other WHERE other.transaction_id=t.id AND other.id<>p.id)
          OR t.trade_type<>'recharge' OR t.trade_status<>'success' OR t.amount<>p.paid_amount
          OR t.balance_before<>t.balance_after
          OR (SELECT sum(f.amount) FROM billing.wallet_lots f WHERE f.funding_payment_id=p.id)+
             coalesce((SELECT sum(a.amount) FROM billing.refund_allocations a WHERE a.payment_id=p.id AND a.status IN ('reserved','succeeded')),0)>p.paid_amount)) THEN
        RAISE EXCEPTION 'wallet source reconciliation failed' USING ERRCODE='check_violation';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_balance_credit AFTER INSERT OR UPDATE ON billing.credits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_balance();
CREATE CONSTRAINT TRIGGER wallet_balance_activation AFTER INSERT ON billing.wallet_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_balance();
CREATE CONSTRAINT TRIGGER wallet_balance_lot AFTER INSERT ON billing.wallet_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_balance();
CREATE CONSTRAINT TRIGGER wallet_balance_operation AFTER INSERT ON billing.wallet_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_balance();
CREATE CONSTRAINT TRIGGER wallet_balance_entry AFTER INSERT ON billing.wallet_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_balance();

CREATE FUNCTION billing.check_wallet_funding_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; paid numeric;
BEGIN
    IF TG_TABLE_NAME='wallet_lots' THEN source_id:=NEW.funding_payment_id;
    ELSE source_id:=NEW.payment_id; END IF;
    IF source_id IS NULL THEN RETURN NEW; END IF;
    SELECT paid_amount INTO paid FROM billing.payments WHERE id=source_id FOR UPDATE;
    IF coalesce((SELECT sum(amount) FROM billing.wallet_lots WHERE funding_payment_id=source_id),0)+
       coalesce((SELECT sum(amount) FROM billing.refund_allocations WHERE payment_id=source_id AND status IN ('reserved','succeeded')),0)>paid THEN
        RAISE EXCEPTION 'cash source already allocated to wallet or refund' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER wallet_funding_lot AFTER INSERT ON billing.wallet_lots FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_funding_capacity();
CREATE TRIGGER wallet_funding_refund AFTER INSERT OR UPDATE ON billing.refund_allocations FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_funding_capacity();
