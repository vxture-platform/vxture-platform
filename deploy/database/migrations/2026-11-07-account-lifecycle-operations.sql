-- @package @vxture/service-account
-- @layer Domain
-- @category migration
-- @author AI-Generated
-- @date 2026-11-07
-- Apply with the database owner before rolling out lifecycle APIs. No backfill:
-- historical requests without a cleanup ledger remain ineligible for purge.
BEGIN;

-- Customer deletion work is committed with the retention transition.
CREATE TABLE IF NOT EXISTS account.lifecycle_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES account.users(id),
    deletion_requested_at timestamptz NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    payload jsonb NOT NULL DEFAULT '{"sessions":[]}'::jsonb,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_lifecycle_request UNIQUE (user_id,deletion_requested_at),
    CONSTRAINT chk_lifecycle_status CHECK (status IN ('pending','completed','purge_ready','cancelled')),
    CONSTRAINT chk_lifecycle_attempts CHECK (attempts>=0),
    CONSTRAINT chk_lifecycle_payload CHECK (jsonb_typeof(payload)='object' AND payload ? 'sessions' AND jsonb_typeof(payload->'sessions')='array')
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_pending ON account.lifecycle_operations(next_attempt_at) WHERE status='pending';

GRANT SELECT,INSERT,UPDATE,DELETE ON account.lifecycle_operations TO platform_svc,svc_auth_bff;
-- The existing purge job needs only the completion predicate, never payload writes.
GRANT SELECT ON account.lifecycle_operations TO svc_platform_api;

-- account.lifecycle_operations [anchor: id, user_id, deletion_requested_at, created_at]
REVOKE UPDATE ON account.lifecycle_operations FROM platform_svc;
GRANT UPDATE (status,payload,attempts,next_attempt_at,last_error,updated_at) ON account.lifecycle_operations TO platform_svc;

-- Identity lifecycle coordinates only these commerce facts and cancellation writes.
GRANT USAGE ON SCHEMA billing TO svc_auth_bff;
GRANT SELECT ON billing.invoices,billing.orders,billing.payments,billing.credits,
  billing.transactions,billing.refunds,billing.invoice_receipts,billing.invoice_items,billing.order_events TO svc_auth_bff;
GRANT UPDATE (status,closed_at,close_reason,updated_at) ON billing.orders TO svc_auth_bff;
GRANT UPDATE (bill_status,updated_at) ON billing.invoices TO svc_auth_bff;
GRANT UPDATE (deleted_at,updated_at) ON billing.invoice_items TO svc_auth_bff;
GRANT INSERT ON billing.order_events TO svc_auth_bff;

COMMIT;
