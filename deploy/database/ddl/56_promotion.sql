-- ═══════════════════════════════════════════════════════════════════════════
-- 28_promotion.sql — schema promotion（卡券：批次 / 码 / 核销，五型统一）
-- 设计权威：docs/design/data_commerce_230_promotion.md
-- 取代 data_commerce_210_billing.md 早期 §7.1 coupons 单表（升级为本三表结构）。
-- 域内 FK（vouchers.batch_id→voucher_batches；voucher_redemptions.voucher_id→vouchers）内联；
-- 跨 schema FK（→tenancy / →account / →billing / →metering）一律不内联，见 90_cross_schema_fk.sql（铁律一）。
-- created_by 逻辑引运营 admin.operator_accounts：跨 realm 一律裸 UUID 不建 FK（边界#2 / 铁律七），见 90 注释。
-- vouchers.code / code_prefix 为可视码，永不作 FK 目标（铁律二）；核销按归一化 code @unique 查询。
-- 表序 = 域内依赖序：voucher_batches → vouchers → voucher_redemptions。
-- effect / effect_snapshot JSONB 内金额一律整数分（cents，配置值免浮点）；落账转 numeric(12,2) 入 billing.transactions。
-- ═══════════════════════════════════════════════════════════════════════════

-- 批次模板：一次营销活动 / 一批卡的配置（kind、effect、总量、有效期）。
-- 五型：credit_voucher 代金券 / recharge_card 充值卡 / redemption 兑换码 / discount 折扣券 / extension 展期券。
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
    CONSTRAINT chk_voucher_batches_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension')),
    CONSTRAINT chk_voucher_batches_status
        CHECK (status IN ('active','paused','archived')),
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
    CONSTRAINT uq_vouchers_code UNIQUE (code),
    CONSTRAINT chk_vouchers_status
        CHECK (status IN ('issued','assigned','reserved','redeemed','expired','revoked')),
    CONSTRAINT chk_vouchers_max_uses   CHECK (max_uses >= 1),
    CONSTRAINT chk_vouchers_used_count CHECK (used_count >= 0 AND used_count <= max_uses)
);
CREATE INDEX idx_vouchers_batch_status  ON promotion.vouchers (batch_id, status);
CREATE INDEX idx_vouchers_assigned_ws   ON promotion.vouchers (assigned_workspace_id);
CREATE INDEX idx_vouchers_assigned_user ON promotion.vouchers (assigned_user_id);

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
    subscription_id  uuid,                                           -- 跨 schema→metering.subscriptions（90）
    invoice_item_id  uuid,                                           -- 跨 schema→billing.invoice_items（90）
    payment_id       uuid,                                           -- 跨 schema→billing.payments（90）
    redeemed_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_voucher_redemptions_redemption_no UNIQUE (redemption_no),
    CONSTRAINT chk_voucher_redemptions_kind
        CHECK (kind IN ('credit_voucher','recharge_card','redemption','discount','extension'))
);
CREATE INDEX idx_voucher_redemptions_tenant_ws ON promotion.voucher_redemptions (tenant_id, workspace_id);
CREATE INDEX idx_voucher_redemptions_voucher   ON promotion.voucher_redemptions (voucher_id);
CREATE INDEX idx_voucher_redemptions_user      ON promotion.voucher_redemptions (user_id);
