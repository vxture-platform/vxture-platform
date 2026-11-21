-- Legacy three-table schema, frozen before the ownership expansion.
-- @package vxture-platform
-- @layer Infrastructure
-- @category test-fixture
-- @author AI-Generated
-- @date 2026-11-19
CREATE TABLE promotion.voucher_batches (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid,                                            
    kind            varchar(20)   NOT NULL,
    name            varchar(128)  NOT NULL,                          
    code_prefix     varchar(16),                                     
    effect          jsonb         NOT NULL,                          
    total_count     int           NOT NULL,                          
    issued_count    int           NOT NULL DEFAULT 0,                
    per_user_limit  int           NOT NULL DEFAULT 1,                
    valid_from      timestamptz   NOT NULL,
    valid_until     timestamptz   NOT NULL,
    status          varchar(16)   NOT NULL DEFAULT 'active',
    created_by      uuid,                                            
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_voucher_batches_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite')),
    CONSTRAINT chk_voucher_batches_status
        CHECK (status IN ('active','paused','archived')),
    CONSTRAINT chk_voucher_batches_total_count    CHECK (total_count >= 0),
    CONSTRAINT chk_voucher_batches_issued_count   CHECK (issued_count >= 0 AND issued_count <= total_count),
    CONSTRAINT chk_voucher_batches_per_user_limit CHECK (per_user_limit >= 1),
    CONSTRAINT chk_voucher_batches_validity       CHECK (valid_until > valid_from)
);
CREATE INDEX idx_voucher_batches_tenant_kind_status ON promotion.voucher_batches (tenant_id, kind, status);
-- ===========================================================================
-- Legacy voucher instances
-- ===========================================================================
CREATE TABLE promotion.vouchers (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id              uuid         NOT NULL REFERENCES promotion.voucher_batches(id) ON DELETE CASCADE,  
    code                  varchar(64)  NOT NULL,                     
    status                varchar(16)  NOT NULL DEFAULT 'issued',
    max_uses              int          NOT NULL DEFAULT 1,           
    used_count            int          NOT NULL DEFAULT 0,
    assigned_workspace_id uuid,                                      
    assigned_user_id      uuid,                                      
    expires_at            timestamptz,                               
    redeemed_at           timestamptz,                               
    created_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_vouchers_code UNIQUE (code),
    CONSTRAINT chk_vouchers_status
        CHECK (status IN ('issued','assigned','reserved','redeemed','expired','revoked')),
    CONSTRAINT chk_vouchers_max_uses   CHECK (max_uses >= 1),
    CONSTRAINT chk_vouchers_used_count CHECK (used_count >= 0 AND used_count <= max_uses)
);
CREATE INDEX idx_vouchers_batch_status  ON promotion.vouchers (batch_id, status);
CREATE INDEX idx_vouchers_assigned_ws   ON promotion.vouchers (assigned_workspace_id);
CREATE INDEX idx_vouchers_assigned_user ON promotion.vouchers (assigned_user_id);
-- ===========================================================================
-- Legacy redemption history
-- ===========================================================================
CREATE TABLE promotion.voucher_redemptions (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    redemption_no    varchar(64)  NOT NULL,                          
    voucher_id       uuid         NOT NULL REFERENCES promotion.vouchers(id),  
    tenant_id        uuid         NOT NULL,                          
    workspace_id     uuid         NOT NULL,                          
    user_id          uuid         NOT NULL,                          
    kind             varchar(20)  NOT NULL,                          
    effect_snapshot  jsonb        NOT NULL,                          
    transaction_id   uuid,                                           
    subscription_id  uuid,                                           
    invoice_item_id  uuid,                                           
    payment_id       uuid,                                           
    redeemed_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_voucher_redemptions_redemption_no UNIQUE (redemption_no),
    CONSTRAINT chk_voucher_redemptions_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite'))
);
CREATE INDEX idx_voucher_redemptions_tenant_ws ON promotion.voucher_redemptions (tenant_id, workspace_id);
CREATE INDEX idx_voucher_redemptions_voucher   ON promotion.voucher_redemptions (voucher_id);
CREATE INDEX idx_voucher_redemptions_user      ON promotion.voucher_redemptions (user_id);
CREATE INDEX idx_voucher_redemptions_transaction  ON promotion.voucher_redemptions (transaction_id);
CREATE INDEX idx_voucher_redemptions_subscription ON promotion.voucher_redemptions (subscription_id);
CREATE INDEX idx_voucher_redemptions_invoice_item ON promotion.voucher_redemptions (invoice_item_id);
CREATE INDEX idx_voucher_redemptions_payment      ON promotion.voucher_redemptions (payment_id);
CREATE INDEX idx_voucher_redemptions_workspace    ON promotion.voucher_redemptions (workspace_id);
