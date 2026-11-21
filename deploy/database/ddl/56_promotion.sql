-- ═══════════════════════════════════════════════════════════════════════════
-- 56_promotion.sql - Six voucher kinds with compatible ownership expansion.
-- Design authority: docs/30-design/data_commerce_230_promotion.md.
-- Extends the legacy three-table model without switching existing writers.
-- 域内 FK（vouchers.batch_id→voucher_batches；voucher_redemptions.voucher_id→vouchers）内联；
-- 跨 schema FK（→tenancy / →account / →billing / →metering）一律不内联，见 90_cross_schema_fk.sql（铁律一）。
-- created_by 逻辑引运营 admin.operator_accounts：跨 realm 一律裸 UUID 不建 FK（边界#2 / 铁律七），见 90 注释。
-- vouchers.code / code_prefix 为可视码，永不作 FK 目标（铁律二）；核销按归一化 code @unique 查询。
-- Internal dependency order: batches, vouchers, redemptions, operations, reservations, events, compensations.
-- effect / effect_snapshot JSONB 内金额一律整数分（cents，配置值免浮点）；落账转 numeric(12,2) 入 billing.transactions。
-- ═══════════════════════════════════════════════════════════════════════════

-- 批次模板：一次营销活动 / 一批卡的配置（kind、effect、总量、有效期）。
-- 六型：credit_voucher 代金券 / recharge_card 充值卡 / redemption 兑换码 / discount 折扣券 /
--       extension 展期券 / invite 订阅邀请（2026-09-22）。
-- invite 与另外两条发放路径的分界：它**只解锁「能买」，不改变「要付钱」**——客户
-- 自己下单自己付钱；operator_grant 是运营直接建订阅（无订单无钱），redemption 是
-- 输码抵扣。effect 装 {planCode, planVersionId}：这张邀请解锁哪个套餐。
-- kind 专属参数走 effect JSONB（§4 约定，服务层按 kind 校验），避免拆列大量 NULL。
-- tenant_id NULL=平台级；非空=定向租户批次（跨 schema→tenancy.tenants，见 90）。
-- 状态机：active↔paused；*→archived（软下线，非软删，故无 deleted_at）。
-- created_by 运营专属操作（realm=operator），裸 UUID 逻辑引 admin.operator_accounts，不建 FK（边界#2，见 90）。
CREATE TABLE promotion.voucher_batches (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid,                                            -- 跨 schema→tenancy.tenants（可空，90）
    kind            varchar(20)   NOT NULL,
    name            varchar(128)  NOT NULL,                          -- 如 "2026 新春代金券"
    code_prefix     varchar(16),                                     -- 生成码前缀，如 VX26-（可视码，非 FK 目标）
    effect          jsonb         NOT NULL,                          -- kind 专属参数（§4；金额整数分）
    total_count     int           NOT NULL,                          -- 计划发行量
    issued_count    int           NOT NULL DEFAULT 0,                -- 已发码数
    per_user_limit  int           NOT NULL DEFAULT 1,                -- 每用户领取上限
    valid_from      timestamptz   NOT NULL,
    valid_until     timestamptz   NOT NULL,
    status          varchar(16)   NOT NULL DEFAULT 'active',
    created_by      uuid,                                            -- 裸值→admin.operator_accounts（运营专属，不建 FK，边界#2，90）
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    policy_snapshot jsonb,
    claim_until     timestamptz,
    use_valid_days  int,
    per_workspace_limit int,
    per_tenant_limit int,
    reviewed_by     uuid,
    reviewed_at     timestamptz,
    frozen_at       timestamptz,
    CONSTRAINT chk_voucher_batches_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite')),
    CONSTRAINT chk_voucher_batches_status
        CHECK (status IN ('draft','active','paused','archived')),
    CONSTRAINT chk_voucher_batches_claim_window
        CHECK (claim_until IS NULL OR (valid_from < claim_until AND claim_until <= valid_until)),
    CONSTRAINT chk_voucher_batches_claim_limits
        CHECK ((use_valid_days IS NULL OR use_valid_days > 0) AND (per_workspace_limit IS NULL OR per_workspace_limit > 0) AND (per_tenant_limit IS NULL OR per_tenant_limit > 0)),
    CONSTRAINT chk_voucher_batches_policy_object
        CHECK (policy_snapshot IS NULL OR jsonb_typeof(policy_snapshot) = 'object'),
    CONSTRAINT chk_voucher_batches_review_pair
        CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
    CONSTRAINT chk_voucher_batches_total_count    CHECK (total_count >= 0),
    CONSTRAINT chk_voucher_batches_issued_count   CHECK (issued_count >= 0 AND issued_count <= total_count),
    CONSTRAINT chk_voucher_batches_per_user_limit CHECK (per_user_limit >= 1),
    CONSTRAINT chk_voucher_batches_validity       CHECK (valid_until > valid_from)
);
CREATE INDEX idx_voucher_batches_tenant_kind_status ON promotion.voucher_batches (tenant_id, kind, status);

-- 码实例：每个可核销的码（状态、定向发放目标、max_uses）。batch_id 域内真 FK（CASCADE）。
-- code = 归一化大写、去混淆字符（0/O、1/I）随机；UNIQUE 即核销查询入口，非关联键（铁律二）。
-- 状态机（§7）：issued（已生成未发放）→ assigned（定向发放）→ reserved（discount 挂未支付 invoice，占 used_count）
--   → redeemed（达 max_uses 终态）；reserved→assigned（invoice 作废释放，退 used_count，§5.1）；
--   issued/assigned→expired；*→revoked；非 discount：assigned/issued→redeemed 直接终态。
-- max_uses>1 仅 discount（折扣券可复用）；其余四型 max_uses=1 核销即终态。
-- 设计 §2 仅 created_at（token 类高频状态机表，随 refresh_tokens 惯例不设 updated_at；状态迁移经 redemptions/redeemed_at 追溯）。
-- assigned_workspace_id/assigned_user_id 跨 schema→tenancy.workspaces / account.users（见 90）。
CREATE TABLE promotion.vouchers (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id              uuid         NOT NULL REFERENCES promotion.voucher_batches(id) ON DELETE CASCADE,  -- 域内真 FK
    code                  varchar(64)  NOT NULL,                     -- 可视码（归一化大写），核销查询入口，非 FK 目标（铁律二）
    status                varchar(16)  NOT NULL DEFAULT 'issued',
    max_uses              int          NOT NULL DEFAULT 1,           -- discount 可 >1
    used_count            int          NOT NULL DEFAULT 0,
    assigned_workspace_id uuid,                                      -- 跨 schema→tenancy.workspaces（定向发放，90）
    assigned_user_id      uuid,                                      -- 跨 schema→account.users（定向发放，90）
    expires_at            timestamptz,                               -- 可覆盖批次有效期
    redeemed_at           timestamptz,                               -- 末次核销时间
    created_at            timestamptz  NOT NULL DEFAULT now(),
    -- Nullable during expansion: legacy writers do not bind tenants yet.
    assigned_tenant_id    uuid,
    claimed_at            timestamptz,
    claim_token_digest    text,
    claim_key_version     varchar(32),
    replacement_of_redemption_id uuid,
    funding_order_id      uuid,
    funding_payment_id    uuid,
    CONSTRAINT chk_vouchers_claim_credentials
        CHECK ((claim_token_digest IS NULL AND claim_key_version IS NULL) OR (claim_token_digest IS NOT NULL AND length(btrim(claim_token_digest)) > 0 AND claim_key_version IS NOT NULL AND length(btrim(claim_key_version)) > 0)),
    CONSTRAINT uq_vouchers_code UNIQUE (code),
    CONSTRAINT chk_vouchers_status
        CHECK (status IN ('issued','assigned','reserved','redeemed','expired','revoked')),
    CONSTRAINT chk_vouchers_max_uses   CHECK (max_uses >= 1),
    CONSTRAINT chk_vouchers_used_count CHECK (used_count >= 0 AND used_count <= max_uses)
);
CREATE INDEX idx_vouchers_batch_status  ON promotion.vouchers (batch_id, status);
CREATE INDEX idx_vouchers_assigned_ws   ON promotion.vouchers (assigned_workspace_id);
CREATE INDEX idx_vouchers_assigned_user ON promotion.vouchers (assigned_user_id);
CREATE INDEX idx_vouchers_assigned_tenant ON promotion.vouchers (assigned_tenant_id);
CREATE UNIQUE INDEX uidx_vouchers_claim_digest ON promotion.vouchers (claim_token_digest)
    WHERE claim_token_digest IS NOT NULL;
CREATE INDEX idx_vouchers_replacement ON promotion.vouchers (replacement_of_redemption_id);
CREATE INDEX idx_vouchers_funding_order ON promotion.vouchers (funding_order_id);
CREATE INDEX idx_vouchers_funding_payment ON promotion.vouchers (funding_payment_id);

-- 核销记录：每次核销一行，落效果追溯。voucher_id 域内真 FK（无 CASCADE，保留核销证据）。
-- kind 冗余（避免三级 JOIN）；effect_snapshot = 核销时刻 effect 快照（防批次后续改配置致追溯失真）。
-- 效果追溯用显式跨 schema FK 列（非 JSONB，铁律一，见 90）：按 kind 填对应列，其余 NULL：
--   transaction_id  credit_voucher(grant)/recharge_card(recharge) → billing.transactions
--   subscription_id redemption(新建)/extension(被延长订阅)        → metering.subscriptions
--   invoice_item_id discount 挂靠账单项                           → billing.invoice_items
--   payment_id      redemption 线下 payment 追溯                  → billing.payments
-- 不加 UNIQUE(voucher_id)——discount 复用可多次核销（§3）。设计 §3 以 redeemed_at 为时戳，无 created/updated/deleted。
-- redemption_no 是本表的对外编号：UUID 只走内部，对外一律 *_no（与 tenant_no / bill_no /
--   ticket_no / pay_order_no 同规）。补于 2026-08-07——此前本表没有可视码，BFF 只好拿
--   row.id 冒充 redemptionNo，核销台账主列因此摆着一张 UUID。
-- tenant_id/workspace_id/user_id 跨 schema→tenancy/account（核销侧强制归属，客户 realm，见 90）。
CREATE TABLE promotion.voucher_redemptions (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    redemption_no    varchar(64)  NOT NULL,                          -- 可视码（永不做 FK 目标，铁律二）
    voucher_id       uuid         NOT NULL REFERENCES promotion.vouchers(id),  -- 域内真 FK（无 CASCADE，留证据）
    tenant_id        uuid         NOT NULL,                          -- 跨 schema→tenancy.tenants（90）
    workspace_id     uuid         NOT NULL,                          -- 跨 schema→tenancy.workspaces（90）
    user_id          uuid         NOT NULL,                          -- 跨 schema→account.users（核销人，客户 realm，90）
    kind             varchar(20)  NOT NULL,                          -- 冗余，避免三级 JOIN
    effect_snapshot  jsonb        NOT NULL,                          -- 核销时刻 effect 快照
    transaction_id   uuid,                                           -- 跨 schema→billing.transactions（90）
    principal_wallet_operation_id uuid,
    bonus_wallet_operation_id uuid,
    subscription_id  uuid,                                           -- 跨 schema→metering.subscriptions（90）
    invoice_item_id  uuid,                                           -- 跨 schema→billing.invoice_items（90）
    payment_id       uuid,                                           -- 跨 schema→billing.payments（90）
    redeemed_at      timestamptz  NOT NULL DEFAULT now(),
    reservation_id   uuid,
    order_id         uuid,
    operation_id     uuid,
    CONSTRAINT uq_voucher_redemptions_redemption_no UNIQUE (redemption_no),
    CONSTRAINT uq_card_principal_wallet UNIQUE(principal_wallet_operation_id),
    CONSTRAINT uq_card_bonus_wallet UNIQUE(bonus_wallet_operation_id),
    CONSTRAINT chk_voucher_redemptions_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension','invite'))
);
CREATE INDEX idx_voucher_redemptions_tenant_ws ON promotion.voucher_redemptions (tenant_id, workspace_id);
CREATE INDEX idx_voucher_redemptions_voucher   ON promotion.voucher_redemptions (voucher_id);
CREATE INDEX idx_voucher_redemptions_user      ON promotion.voucher_redemptions (user_id);
CREATE CONSTRAINT TRIGGER card_redemption_wallet_evidence AFTER INSERT OR UPDATE ON promotion.voucher_redemptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_card_redemption_evidence();

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_voucher_redemptions_transaction  ON promotion.voucher_redemptions (transaction_id);
CREATE INDEX idx_voucher_redemptions_subscription ON promotion.voucher_redemptions (subscription_id);
CREATE INDEX idx_voucher_redemptions_invoice_item ON promotion.voucher_redemptions (invoice_item_id);
CREATE INDEX idx_voucher_redemptions_payment      ON promotion.voucher_redemptions (payment_id);
CREATE INDEX idx_voucher_redemptions_workspace    ON promotion.voucher_redemptions (workspace_id);

-- ===========================================================================
-- Durable receipts and ownership: expansion only; existing writers stay intact.
-- ===========================================================================

CREATE CONSTRAINT TRIGGER voucher_wallet_card_evidence AFTER INSERT OR UPDATE ON promotion.vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.check_wallet_card_evidence();

CREATE TABLE promotion.voucher_operations (
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
    CONSTRAINT chk_voucher_operations_request CHECK (length(btrim(operation_type)) > 0 AND length(btrim(idempotency_key)) > 0 AND length(btrim(request_hash)) > 0),
    CONSTRAINT chk_voucher_operations_result CHECK (jsonb_typeof(result) = 'object'),
    CONSTRAINT uq_voucher_operations_request UNIQUE (actor_realm, actor_id, operation_type, idempotency_key)
);
CREATE INDEX idx_voucher_operations_batch ON promotion.voucher_operations (batch_id);

CREATE TABLE promotion.voucher_reservations (
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
    CONSTRAINT chk_voucher_reservations_snapshots CHECK (jsonb_typeof(effect_snapshot) = 'object' AND jsonb_typeof(policy_snapshot) = 'object'),
    CONSTRAINT chk_voucher_reservations_terminal CHECK (
        (status = 'active' AND consumed_at IS NULL AND released_at IS NULL AND release_reason IS NULL) OR
        (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_at >= reserved_at AND released_at IS NULL AND release_reason IS NULL) OR
        (status = 'released' AND released_at IS NOT NULL AND released_at >= reserved_at AND consumed_at IS NULL AND release_reason IS NOT NULL AND length(btrim(release_reason)) > 0)),
    CONSTRAINT uq_voucher_reservations_operation UNIQUE (operation_id, voucher_id)
);
CREATE UNIQUE INDEX uidx_voucher_reservations_active ON promotion.voucher_reservations (voucher_id)
    WHERE status = 'active';
CREATE INDEX idx_voucher_reservations_order_status ON promotion.voucher_reservations (order_id, status);
CREATE INDEX idx_voucher_reservations_invoice_status ON promotion.voucher_reservations (invoice_id, status);
CREATE INDEX idx_voucher_reservations_payment ON promotion.voucher_reservations (declaration_payment_id);
CREATE INDEX idx_voucher_reservations_tenant_workspace ON promotion.voucher_reservations (tenant_id, workspace_id);
CREATE INDEX idx_voucher_reservations_workspace ON promotion.voucher_reservations (workspace_id);
CREATE INDEX idx_voucher_reservations_user ON promotion.voucher_reservations (user_id);

-- Legacy redemptions keep NULL links; never fabricate historical ownership.
ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_reservation
    FOREIGN KEY (reservation_id) REFERENCES promotion.voucher_reservations(id);
ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_operation
    FOREIGN KEY (operation_id) REFERENCES promotion.voucher_operations(id);
ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_replacement_redemption
    FOREIGN KEY (replacement_of_redemption_id) REFERENCES promotion.voucher_redemptions(id);
CREATE UNIQUE INDEX uidx_voucher_redemptions_reservation ON promotion.voucher_redemptions (reservation_id)
    WHERE reservation_id IS NOT NULL;
CREATE INDEX idx_voucher_redemptions_order ON promotion.voucher_redemptions (order_id);
CREATE INDEX idx_voucher_redemptions_operation ON promotion.voucher_redemptions (operation_id);

CREATE TABLE promotion.voucher_events (
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
CREATE INDEX idx_voucher_events_batch_created ON promotion.voucher_events (batch_id, created_at, id);
CREATE INDEX idx_voucher_events_voucher_created ON promotion.voucher_events (voucher_id, created_at, id);
CREATE INDEX idx_voucher_events_order ON promotion.voucher_events (order_id);
CREATE INDEX idx_voucher_events_operation ON promotion.voucher_events (operation_id);
CREATE INDEX idx_voucher_events_reservation ON promotion.voucher_events (reservation_id);
CREATE INDEX idx_voucher_events_redemption ON promotion.voucher_events (redemption_id);

-- ===========================================================================
-- B02 compensation intentions: workers and financial eligibility arrive in B05.
-- ===========================================================================
CREATE TABLE promotion.voucher_compensations (
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
CREATE INDEX idx_voucher_compensations_pending ON promotion.voucher_compensations (status, created_at, id);
CREATE INDEX idx_voucher_compensations_order ON promotion.voucher_compensations (order_id);
CREATE INDEX idx_voucher_compensations_refund ON promotion.voucher_compensations (refund_id);
