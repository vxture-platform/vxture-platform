-- ═══════════════════════════════════════════════════════════════════════════
-- 50_billing.sql — schema billing（账单 / 发票 / 支付 / 退款 / 不可变流水 / 预付款池）
-- 设计权威：docs/design/data_commerce_210_billing.md（字段级）
-- 定位：Organization/Tenant = billing account（资金/结算主体）；tenant_id 为结算主体键。
-- 域内 FK 内联（invoice_items/receipts/payments/refunds/prepaid_charges/mandates）；
--   跨 schema FK（*.tenant_id→tenancy、workspace_id→tenancy、subscription_id→metering、
--   product_id→product、created_by/updated_by/user_id→account）一律见 90（铁律一）。
-- 跨 realm 身份（actor_id/created_by_id=operator 时、auditor_id）裸 UUID 不建 FK（边界#2/铁律七）。
-- 金融例外：payments/refunds/credits/transactions/prepaid_charges 无 deleted_at（作废走状态/冲正流水）。
-- transactions append-only 不可变（无 updated_at/deleted_at，硬阻断触发器见 95_triggers.sql）。
-- 可视码（bill_no/invoice_no/pay_order_no/refund_no/transaction_no）永不做 FK 目标（铁律二）。
-- 表序 = 域内依赖序：transactions/credits → billing_addresses/payment_methods →
--   payment_mandates → invoices → invoice_items/invoice_receipts → payments → refunds → prepaid_charges。
-- ═══════════════════════════════════════════════════════════════════════════

-- 资金流水（不可变账本）。预付款池 credits 的唯一变动通道；balance_before/after 与 credits.version
-- 形成可重建对账链。append-only：仅 created_at，无 updated_at/deleted_at；硬阻断触发器见 95。
-- tenant_id 跨 schema→tenancy.tenants（90）；actor_id 裸 UUID（边界#2）；bill_id 逻辑引用不建 FK。
CREATE TABLE billing.transactions (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,                         -- 跨 schema→tenancy.tenants（90）
    bill_id         uuid,                                           -- 关联账单，逻辑引用（跨分区/已删场景，不强制 FK）
    transaction_no  varchar(64)   NOT NULL,                         -- 可视码 TXN-{YYYYMM}-{10位随机hex}（visibleCode() 同规，唯一约束兜底）
    trade_type      varchar(32)   NOT NULL,                         -- recharge/consume/refund/grant/adjust
    source_method   varchar(24),                                   -- 充值方式（仅 recharge/grant 填），可扩展
    amount          numeric(12,2) NOT NULL,                         -- 本笔变动，正=入账负=出账
    currency        varchar(16)   NOT NULL DEFAULT 'CNY',
    balance_before  numeric(12,2) NOT NULL,                         -- 变动前 credits.balance 快照
    balance_after   numeric(12,2) NOT NULL,                         -- 变动后 credits.balance 快照
    trade_status    varchar(32)   NOT NULL DEFAULT 'success',
    related_no      varchar(128),                                  -- 关联单号（pay_order_no/refund_no）
    remark          varchar(512),
    actor_type      varchar(16)   NOT NULL,                         -- §0.1 system/customer/operator
    actor_id        uuid,                                          -- 裸值，按 actor_type 解引用（边界#2）
    client_ip       varchar(64),
    created_at      timestamptz   NOT NULL DEFAULT now(),           -- append-only：无 updated_at/deleted_at
    CONSTRAINT uq_transactions_transaction_no UNIQUE (transaction_no),
    CONSTRAINT chk_transactions_trade_type    CHECK (trade_type IN ('recharge','consume','refund','grant','adjust')),
    CONSTRAINT chk_transactions_source_method CHECK (source_method IN ('online','offline','recharge_card','credit_voucher','operator')),
    CONSTRAINT chk_transactions_actor_type    CHECK (actor_type IN ('system','customer','operator'))
);
CREATE INDEX idx_transactions_tenant_id  ON billing.transactions (tenant_id);
CREATE INDEX idx_transactions_trade_type ON billing.transactions (trade_type);

-- 预付款池（org/tenant 级，一 org 一池；乐观锁 version）。充值 recharge/赠送 grant 同入本池。
-- billing_mode：postpaid=锚定周期出应收账单；prepaid=用量实时(~5min)扣本池+自然月对账单。
-- 金融例外：无 deleted_at（作废走状态/冲正流水）。tenant_id 跨 schema→tenancy.tenants（90，UNIQUE）。
CREATE TABLE billing.credits (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,                         -- 跨 schema→tenancy.tenants（90），一 org 一池
    billing_mode    varchar(16)   NOT NULL DEFAULT 'postpaid',      -- 预留：postpaid/prepaid
    currency        varchar(16)   NOT NULL DEFAULT 'CNY',
    balance         numeric(12,2) NOT NULL DEFAULT 0,               -- 预付款余额
    total_granted   numeric(12,2) NOT NULL DEFAULT 0,               -- 累计赠送/充值
    total_consumed  numeric(12,2) NOT NULL DEFAULT 0,               -- 累计出账消耗
    version         int           NOT NULL DEFAULT 0,               -- 乐观锁
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_credits_tenant_id     UNIQUE (tenant_id),
    CONSTRAINT chk_credits_billing_mode CHECK (billing_mode IN ('postpaid','prepaid'))
);

-- 开票抬头（地址三层 SoT 第二层，可复用簿）。与组织注册地址各自独立；申请发票时快照进 invoice_receipts。
-- created_by/updated_by 跨 schema→account.users（90，客户 realm 确定用专名 FK）；tenant_id→tenancy（90）。
CREATE TABLE billing.billing_addresses (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid          NOT NULL,                       -- 跨 schema→tenancy.tenants（90）
    invoice_tax_type  varchar(32)   NOT NULL,                       -- general/special
    title             varchar(256)  NOT NULL,                       -- 抬头
    tax_no            varchar(128),
    phone             varchar(32),
    address           varchar(512),
    bank_name         varchar(256),
    bank_account      varchar(256),
    is_default        boolean       NOT NULL DEFAULT false,         -- 每 tenant 至多一条 default
    created_by        uuid          NOT NULL,                       -- 跨 schema→account.users（90）
    updated_by        uuid,                                         -- 跨 schema→account.users（90）
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    CONSTRAINT chk_billing_addresses_tax_type CHECK (invoice_tax_type IN ('general','special'))
);
CREATE INDEX idx_billing_addresses_tenant_id  ON billing.billing_addresses (tenant_id);
CREATE INDEX idx_billing_addresses_deleted_at ON billing.billing_addresses (deleted_at);
-- 每 tenant 至多 1 条 default（部分唯一，排除软删）
CREATE UNIQUE INDEX uq_billing_addresses_one_default_per_tenant
    ON billing.billing_addresses (tenant_id) WHERE is_default AND deleted_at IS NULL;

-- 支付方式（token 化外部标识，不存卡号/密钥明文）。
-- created_by/updated_by 跨 schema→account.users（90，客户 realm 确定用专名 FK）；tenant_id→tenancy（90）。
CREATE TABLE billing.payment_methods (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid          NOT NULL,                           -- 跨 schema→tenancy.tenants（90）
    method_type   varchar(32)   NOT NULL,                           -- wechat/alipay/bank_card/bank_transfer
    status        varchar(32)   NOT NULL DEFAULT 'active',
    display_name  varchar(128)  NOT NULL,
    external_id   varchar(256),                                     -- 网关侧绑定标识，token 化
    is_default    boolean       NOT NULL DEFAULT false,
    last_used_at  timestamptz,
    created_by    uuid          NOT NULL,                           -- 跨 schema→account.users（90）
    updated_by    uuid,                                             -- 跨 schema→account.users（90）
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    CONSTRAINT chk_payment_methods_status CHECK (status IN ('active','disabled'))
);
CREATE INDEX idx_payment_methods_tenant_id  ON billing.payment_methods (tenant_id);
CREATE INDEX idx_payment_methods_deleted_at ON billing.payment_methods (deleted_at);
-- 每 tenant 至多 1 条 default（部分唯一，排除软删）
CREATE UNIQUE INDEX uq_payment_methods_one_default_per_tenant
    ON billing.payment_methods (tenant_id) WHERE is_default AND deleted_at IS NULL;

-- 代扣签约（自动续订授权）【结构预留，业务陆续接】。余额续订不需本表。
-- payment_method_id 域内 FK→payment_methods（内联）；user_id 跨 schema→account.users（90，签约人）；
-- tenant_id→tenancy（90）。metering.subscriptions.payment_mandate_id 反向引用本表。
CREATE TABLE billing.payment_mandates (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid          NOT NULL,                   -- 跨 schema→tenancy.tenants（90）
    user_id               uuid          NOT NULL,                   -- 跨 schema→account.users（90，签约授权人）
    payment_method_id     uuid          NOT NULL REFERENCES billing.payment_methods(id),  -- 域内真 FK
    gateway_agreement_no  varchar(128),                             -- 网关签约号/mandate token（token 化）
    status                varchar(16)   NOT NULL DEFAULT 'pending',
    signed_at             timestamptz,
    expires_at            timestamptz,
    max_amount_per_cycle  numeric(12,2),                            -- 单周期扣款上限（风控）
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    deleted_at            timestamptz,
    CONSTRAINT chk_payment_mandates_status CHECK (status IN ('pending','active','paused','cancelled','expired'))
);
CREATE INDEX idx_payment_mandates_tenant_status ON billing.payment_mandates (tenant_id, status);
CREATE INDEX idx_payment_mandates_method_id     ON billing.payment_mandates (payment_method_id);
CREATE INDEX idx_payment_mandates_deleted_at    ON billing.payment_mandates (deleted_at);

-- 订单（product_330 §2.1，owner 2026-09-03 决策 1：订单从 metering.subscriptions 拆出成独立实体）。
-- 订单 = 钱、意图、履约态的载体；订阅只回答"现在有什么"。履约（fulfill）是订单→订阅的唯一入口（幂等）。
-- 状态机：pending_payment → pending_verify → paid → fulfilled → refunded；旁路 cancelled（仅未付）/ expired（TTL）。
-- tenant_id/workspace_id→tenancy、product_id/plan_version_id→product、from_subscription_id/subscription_id→metering（均见 90）。
-- created_by_id 裸值（按 created_by_type 解引用，边界#2）。金融例外：无 deleted_at（作废走 status）。
-- 2026-09-03 起 metering.subscriptions.order_no / payment_ttl_minutes / 账单备注里的 intent JSON 停写（P2 退役）。
CREATE TABLE billing.orders (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no              varchar(64)   NOT NULL,                   -- 可视码 ORD-{YYYYMM}-{10位随机hex}（沿用 visibleCode）
    tenant_id             uuid          NOT NULL,                   -- 跨 schema→tenancy.tenants（90），结算主体
    workspace_id          uuid          NOT NULL,                   -- 跨 schema→tenancy.workspaces（90），权益主体
    product_id            uuid          NOT NULL,                   -- 跨 schema→product.products（90）；plan_version 主组件产品（冗余，唯一索引/查询用）
    plan_version_id       uuid          NOT NULL,                   -- 跨 schema→product.plan_versions（90），目标套餐版本
    intent                varchar(16)   NOT NULL,                   -- new / upgrade / renew
    cycle_unit            varchar(16)   NOT NULL,
    cycle_count           int           NOT NULL DEFAULT 1,
    from_subscription_id  uuid,                                     -- 跨 schema→metering.subscriptions（90）；upgrade / renew 的原订阅
    subscription_id       uuid,                                     -- 跨 schema→metering.subscriptions（90）；履约后指向（new 建的 / upgrade·renew 改的）
    list_amount           numeric(12,2) NOT NULL,                   -- 标价 P_new
    credit_amount         numeric(12,2) NOT NULL DEFAULT 0,         -- 升级折抵（product_330 §4.1）
    payable_amount        numeric(12,2) NOT NULL,                   -- max(0, list − credit)
    leftover_amount       numeric(12,2) NOT NULL DEFAULT 0,         -- 折抵溢出，进预付款
    currency              varchar(16)   NOT NULL DEFAULT 'CNY',
    proration             jsonb,                                    -- 折抵输入与结果快照 {days_left, days_total, r, u, alpha, p_old, credit_time, credit_usage}
    status                varchar(24)   NOT NULL DEFAULT 'pending_payment',
    payment_ttl_minutes   int,                                      -- 付款时效（个人 30 / 组织 2880）
    declared_at           timestamptz,                              -- 客户申报付款
    paid_at               timestamptz,                              -- 运营确认 / 网关回调
    fulfilled_at          timestamptz,                              -- 履约完成
    closed_at             timestamptz,                              -- cancelled / expired / refunded 落地时间
    close_reason          varchar(32),                              -- customer_cancel / operator_void / ttl_expired / refunded / backfill
    created_by_type       varchar(16)   NOT NULL,                   -- §0.1 system/customer/operator
    created_by_id         uuid,                                     -- 裸值，按 type 解引用（边界#2）
    operator_remark       varchar(512),
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_orders_order_no         UNIQUE (order_no),
    CONSTRAINT chk_orders_intent          CHECK (intent IN ('new','upgrade','renew')),
    CONSTRAINT chk_orders_status          CHECK (status IN ('pending_payment','pending_verify','paid','fulfilled','cancelled','expired','refunded')),
    CONSTRAINT chk_orders_cycle_unit      CHECK (cycle_unit IN ('day','week','month','year','perpetual')),
    CONSTRAINT chk_orders_cycle_count     CHECK (cycle_count >= 1),
    CONSTRAINT chk_orders_from            CHECK ((intent <> 'new') = (from_subscription_id IS NOT NULL)),
    CONSTRAINT chk_orders_amounts         CHECK (list_amount >= 0 AND credit_amount >= 0 AND payable_amount >= 0 AND leftover_amount >= 0),
    CONSTRAINT chk_orders_fulfilled       CHECK ((status = 'fulfilled') = (fulfilled_at IS NOT NULL AND subscription_id IS NOT NULL)),
    CONSTRAINT chk_orders_created_by_type CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_orders_payment_ttl     CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1)
);
CREATE INDEX idx_orders_tenant_created ON billing.orders (tenant_id, created_at DESC);
CREATE INDEX idx_orders_workspace      ON billing.orders (workspace_id);
CREATE INDEX idx_orders_status         ON billing.orders (status);
CREATE INDEX idx_orders_subscription   ON billing.orders (subscription_id);
-- 一个工作区一个产品同一时刻只能有一张在途订单（product_330 §8 不变式 1）
CREATE UNIQUE INDEX uidx_orders_open_per_product ON billing.orders (workspace_id, product_id)
  WHERE status IN ('pending_payment','pending_verify','paid');

-- 订单事件（append-only 审计，product_330 P1-b2）：订单阶段（下单 / 申报 / 驳回 / 收款 / 履约 / 取消 /
-- 过期 / 恢复）的时间线。此前这些事件记在 metering.subscription_histories 上——订单不再有订阅行可挂，
-- 且 TTL 重锚（payment_rejected）、付款页驳回横幅都读这里。order_id 域内 FK；actor_id 裸值（边界#2）。
CREATE TABLE billing.order_events (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid          NOT NULL REFERENCES billing.orders(id) ON DELETE RESTRICT,  -- 域内真 FK
    event_type    varchar(32)   NOT NULL,                   -- created / payment_declared / payment_rejected / payment_confirmed / fulfilled / cancelled / order_expired / restored（开放）
    from_status   varchar(24),
    to_status     varchar(24),
    actor_type    varchar(16)   NOT NULL,                   -- §0.1 system/customer/operator
    actor_id      uuid,                                     -- 裸值，按 type 解引用（边界#2）
    remark        text,
    client_ip     varchar(64),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_order_events_actor_type CHECK (actor_type IN ('system','customer','operator'))
);
CREATE INDEX idx_order_events_order_created ON billing.order_events (order_id, created_at DESC);

-- 账单头（org/tenant 级 rollup，月末归集落点）。total_amount 已含折扣/税净额；payable_amount=total_amount
-- （不再减 discount_amount，消除双减）。tenant_id→tenancy、subscription_id→metering（90）。
-- created_by_id 裸值（按 created_by_type 解引用 account.users / operator，边界#2）。
CREATE TABLE billing.invoices (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid          NOT NULL,                       -- 跨 schema→tenancy.tenants（90），结算主体
    bill_no           varchar(64)   NOT NULL,                       -- 可视码 INV-{YYYYMM}-{10位随机hex}（visibleCode() 同规，唯一约束兜底）
    subscription_id   uuid,                                         -- 跨 schema→metering.subscriptions（90，可空：rollup 跨多订阅）
    order_id          uuid          REFERENCES billing.orders(id),  -- 域内真 FK（product_330：订单账单必填，周期账单/计量超额行为空）
    bill_cycle        varchar(8)    NOT NULL,                       -- 如 '202607'
    cycle_start_date  date          NOT NULL,
    cycle_end_date    date          NOT NULL,
    total_amount      numeric(12,2) NOT NULL DEFAULT 0,             -- = SUM(item.total_amount)，已含折扣/税净额
    discount_amount   numeric(12,2) DEFAULT 0,                      -- 派生展示镜像，不参与计算
    payable_amount    numeric(12,2) NOT NULL DEFAULT 0,             -- = total_amount
    paid_amount       numeric(12,2) DEFAULT 0,                      -- 预付款扣减 + 线上/线下实付
    currency          varchar(16)   DEFAULT 'CNY',
    bill_status       varchar(32)   NOT NULL DEFAULT 'unpaid',
    bill_type         varchar(32)   DEFAULT 'normal',
    paid_at           timestamptz,
    payment_method    varchar(64),                                  -- 冗余展示，权威在 payments
    transaction_no    varchar(128),                                 -- 关联 transactions.transaction_no（可视码，非 FK）
    created_by_type   varchar(16)   NOT NULL,                       -- §0.1 system/customer/operator
    created_by_id     uuid,                                         -- 裸值，按 type 解引用（边界#2）
    operate_remark    text,                                         -- 运营手工出账/调整备注
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    CONSTRAINT uq_invoices_bill_no          UNIQUE (bill_no),
    CONSTRAINT chk_invoices_bill_status     CHECK (bill_status IN ('unpaid','paying','paid','partial','cancelled','overdue')),
    CONSTRAINT chk_invoices_bill_type       CHECK (bill_type IN ('normal','one_off','adjustment','prepaid_statement')),
    CONSTRAINT chk_invoices_created_by_type CHECK (created_by_type IN ('system','customer','operator'))
);
CREATE INDEX idx_invoices_tenant_cycle ON billing.invoices (tenant_id, bill_cycle);
CREATE INDEX idx_invoices_bill_status  ON billing.invoices (bill_status);
CREATE INDEX idx_invoices_deleted_at   ON billing.invoices (deleted_at);
CREATE INDEX idx_invoices_order_id     ON billing.invoices (order_id);

-- 账单明细行（+workspace 成本归集）。两类计费行：subscription_fee / metered_overage
-- （从 metering.usage_events 按订阅锚定周期窗口求和，不读汇总表）。bill_id 域内 FK（内联）；
-- tenant_id/workspace_id→tenancy、subscription_id→metering、product_id→product（90）。
CREATE TABLE billing.invoice_items (
    id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id            uuid          NOT NULL REFERENCES billing.invoices(id),  -- 域内真 FK
    tenant_id          uuid          NOT NULL,                      -- 冗余结算主体，跨 schema→tenancy.tenants（90）
    workspace_id       uuid          NOT NULL,                      -- 成本中心归集键，跨 schema→tenancy.workspaces（90）
    subscription_id    uuid,                                        -- 跨 schema→metering.subscriptions（90，charged 行必填）
    product_id         uuid,                                        -- 跨 schema→product.products（90）
    metric_key         varchar(64),                                 -- 计量超额行填
    item_name          varchar(128)  NOT NULL,
    item_type          varchar(32)   NOT NULL,
    item_unit          varchar(64),
    quantity           numeric(12,4) DEFAULT 1,
    unit_price         numeric(12,2) DEFAULT 0,                     -- 单价，到分（资金类一律两位小数；原 18,6 经 2026-09-03 迁移收口）
    total_amount       numeric(12,2) NOT NULL DEFAULT 0,           -- 行小计，并入头表 total
    usage_cycle_start  timestamptz,                                 -- 计量超额行结算窗口（订阅锚定周期），供复算追溯
    usage_cycle_end    timestamptz,
    remark             varchar(512),
    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT chk_invoice_items_item_type
        CHECK (item_type IN ('subscription_fee','metered_overage','credit_adjustment','discount','tax','addon_fee'))  -- addon_fee: 加油包/扩展包(2026-08-20 用量配额线)
);
CREATE INDEX idx_invoice_items_bill_id      ON billing.invoice_items (bill_id);
CREATE INDEX idx_invoice_items_workspace_id ON billing.invoice_items (workspace_id);
CREATE INDEX idx_invoice_items_item_type    ON billing.invoice_items (item_type);
CREATE INDEX idx_invoice_items_deleted_at   ON billing.invoice_items (deleted_at);

-- 中国增值税发票 fapiao（地址三层 SoT 第三层，值快照非外键）。一张账单可拆多张发票（bill_id 非唯一）。
-- bill_id 域内 FK（内联）；tenant_id→tenancy（90）；created_by_id 裸值（客户/运营，边界#2）；
-- auditor_id 恒为 operator（裸值→admin.operator_accounts，边界#2）。
CREATE TABLE billing.invoice_receipts (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid          NOT NULL,                  -- 跨 schema→tenancy.tenants（90），开票主体
    bill_id                uuid          NOT NULL REFERENCES billing.invoices(id),  -- 域内真 FK（非唯一）
    invoice_no             varchar(64)   NOT NULL,                  -- 平台内部发票申请号，可视码
    invoice_type           varchar(32)   NOT NULL,                  -- electronic_general/electronic_special/paper_special
    invoice_tax_type       varchar(32)   NOT NULL,                  -- general/special
    invoice_title          varchar(256)  NOT NULL,                  -- 抬头
    tax_no                 varchar(128),                            -- 专票必填
    company_info           jsonb         NOT NULL,                  -- 结构化抬头快照
    bank_info              jsonb,                                   -- 专票必填
    address_info           jsonb,                                   -- 纸质发票快递用
    invoice_amount         numeric(12,2) NOT NULL,                  -- 价税合计
    tax_amount             numeric(12,2) DEFAULT 0,
    currency               varchar(16)   DEFAULT 'CNY',
    invoice_status         varchar(32)   NOT NULL DEFAULT 'applying',
    status_remark          text,
    invoice_code           varchar(64),                             -- 税务局发票代码（开具后回填）
    invoice_electronic_no  varchar(64),
    invoice_file_url       text,                                    -- PDF/OFD
    issued_at              timestamptz,
    express_company        varchar(64),
    express_no             varchar(64),
    send_at                timestamptz,
    created_by_type        varchar(16)   NOT NULL,                  -- §0.1 customer/operator（去 system）
    created_by_id          uuid          NOT NULL,                  -- 裸值，按 type 解引用（边界#2）
    auditor_id             uuid,                                    -- 审核人恒为 operator（裸值→admin.operator_accounts，边界#2）
    audit_at               timestamptz,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now(),
    deleted_at             timestamptz,
    CONSTRAINT uq_invoice_receipts_invoice_no    UNIQUE (invoice_no),
    CONSTRAINT chk_invoice_receipts_type         CHECK (invoice_type IN ('electronic_general','electronic_special','paper_special')),
    CONSTRAINT chk_invoice_receipts_tax_type     CHECK (invoice_tax_type IN ('general','special')),
    CONSTRAINT chk_invoice_receipts_status       CHECK (invoice_status IN ('applying','approved','issued','sent','rejected','voided')),
    CONSTRAINT chk_invoice_receipts_created_by_type CHECK (created_by_type IN ('customer','operator'))
);
CREATE INDEX idx_invoice_receipts_bill_id     ON billing.invoice_receipts (bill_id);
CREATE INDEX idx_invoice_receipts_tenant_id   ON billing.invoice_receipts (tenant_id);
CREATE INDEX idx_invoice_receipts_status      ON billing.invoice_receipts (invoice_status);
CREATE INDEX idx_invoice_receipts_deleted_at  ON billing.invoice_receipts (deleted_at);

-- 支付（线上+线下多渠道+凭证）。pay_order_no 唯一落地"支付不能双份"。channel_* 为网关占位（未接入为空）。
-- 金融例外：无 deleted_at（作废走 pay_status）。bill_id 域内 FK ON DELETE RESTRICT；
-- transaction_id 域内 FK（支付成功写流水）；tenant_id→tenancy（90）；actor_id 裸值（边界#2）。
CREATE TABLE billing.payments (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid          NOT NULL,                  -- 跨 schema→tenancy.tenants（90）
    bill_id                uuid          NOT NULL REFERENCES billing.invoices(id) ON DELETE RESTRICT,  -- 域内真 FK
    transaction_id         uuid          REFERENCES billing.transactions(id),  -- 域内真 FK（支付成功后写流水）
    pay_order_no           varchar(64)   NOT NULL,                  -- 可视码，"支付不能双份"
    pay_source             varchar(32)   NOT NULL DEFAULT 'online',
    pay_channel            varchar(32),                             -- wechat/alipay/unionpay/bank
    pay_method             varchar(32),                             -- qrcode/h5/app
    offline_pay_type       varchar(32),                             -- bank_transfer/cash/check
    offline_payer_name     varchar(128),
    offline_pay_time       timestamptz,
    offline_evidence_url   text,
    total_amount           numeric(12,2) NOT NULL,
    paid_amount            numeric(12,2) DEFAULT 0,
    currency               varchar(16)   DEFAULT 'CNY',
    pay_status             varchar(32)   NOT NULL DEFAULT 'pending',
    status_msg             text,
    channel_order_no       varchar(128),                            -- 网关侧（占位，未接入为空）
    channel_transaction_no varchar(128),                            -- 网关侧（占位）
    channel_raw_data       jsonb,                                   -- 回调原文留存
    pay_expire_at          timestamptz,
    paid_at                timestamptz,
    closed_at              timestamptz,
    actor_type             varchar(16)   NOT NULL DEFAULT 'customer',  -- §0.1 system/customer/operator
    actor_id               uuid,                                    -- 裸值，按 actor_type 解引用（边界#2）
    operate_remark         text,                                    -- 线下支付/手工对账备注
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_payments_pay_order_no  UNIQUE (pay_order_no),
    CONSTRAINT chk_payments_pay_source   CHECK (pay_source IN ('online','offline','voucher')),  -- 'voucher' = settlement leg (product_321 P7)
    CONSTRAINT chk_payments_pay_status   CHECK (pay_status IN ('pending','pending_verify','paid','failed','closed','refunding')),
    CONSTRAINT chk_payments_actor_type   CHECK (actor_type IN ('system','customer','operator'))
);
CREATE INDEX idx_payments_bill_id   ON billing.payments (bill_id);
CREATE INDEX idx_payments_pay_status ON billing.payments (pay_status);
CREATE INDEX idx_payments_tenant_id  ON billing.payments (tenant_id);

-- 退款（双状态机：审核 audit_status → 执行 refund_status）。退款不回改原支付/流水，成功时追加冲正流水
-- （transactions.trade_type='refund'）并回写 credits。金融例外：无 deleted_at（作废走状态）。
-- bill_id/pay_record_id/transaction_id 域内 FK（内联）；tenant_id→tenancy（90）；
-- created_by_id 裸值（客户/运营，边界#2）；auditor_id 恒为 operator（裸值，边界#2）。
CREATE TABLE billing.refunds (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid          NOT NULL,                       -- 跨 schema→tenancy.tenants（90）
    bill_id           uuid          NOT NULL REFERENCES billing.invoices(id),      -- 域内真 FK
    pay_record_id     uuid          NOT NULL REFERENCES billing.payments(id),      -- 域内真 FK
    transaction_id    uuid          REFERENCES billing.transactions(id),           -- 域内真 FK（退款成功写冲正流水）
    order_id          uuid          REFERENCES billing.orders(id),                 -- 域内真 FK（product_330 §5：退款挂订单，成功后回滚订阅）
    refund_no         varchar(64)   NOT NULL,                       -- 可视码
    refund_amount     numeric(12,2) NOT NULL,
    currency          varchar(16)   DEFAULT 'CNY',
    refund_reason     varchar(512),
    refund_type       varchar(32)   DEFAULT 'normal',               -- normal/partial/dispute
    audit_status      varchar(32)   NOT NULL DEFAULT 'pending',
    audit_remark      text,
    auditor_id        uuid,                                         -- 审核人恒为 operator（裸值→admin.operator_accounts，边界#2）
    audit_at          timestamptz,
    channel_refund_no varchar(128),                                 -- 网关退款单号（占位）
    refund_status     varchar(32)   NOT NULL DEFAULT 'pending',
    refund_at         timestamptz,
    created_by_type   varchar(16)   NOT NULL,                       -- §0.1 customer/operator（去 system）
    created_by_id     uuid          NOT NULL,                       -- 裸值，按 type 解引用（边界#2）
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_refunds_refund_no          UNIQUE (refund_no),
    CONSTRAINT chk_refunds_refund_type       CHECK (refund_type IN ('normal','partial','dispute')),
    CONSTRAINT chk_refunds_audit_status      CHECK (audit_status IN ('pending','approved','rejected')),
    CONSTRAINT chk_refunds_refund_status     CHECK (refund_status IN ('pending','processing','success','failed')),
    CONSTRAINT chk_refunds_created_by_type   CHECK (created_by_type IN ('customer','operator'))
);
CREATE INDEX idx_refunds_audit_status ON billing.refunds (audit_status);
CREATE INDEX idx_refunds_tenant_id    ON billing.refunds (tenant_id);
CREATE INDEX idx_refunds_bill_id      ON billing.refunds (bill_id);
CREATE INDEX idx_refunds_pay_record   ON billing.refunds (pay_record_id);
CREATE INDEX idx_refunds_order_id     ON billing.refunds (order_id);

-- 预付费实时扣费批次（~5min）【结构预留，业务陆续接】。窗口用自然时间（非订阅锚定），pay-as-you-go。
-- idempotency_key 全局唯一防同窗口重复扣。金融例外：无 updated_at/deleted_at（仅 created_at）。
-- transaction_id 域内 FK（本批 consume 流水）；tenant_id/workspace_id→tenancy（90）。
CREATE TABLE billing.prepaid_charges (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid          NOT NULL,                        -- 跨 schema→tenancy.tenants（90），扣款主体
    workspace_id     uuid,                                          -- 跨 schema→tenancy.workspaces（90，可空=跨 ws 汇总扣）
    window_start     timestamptz   NOT NULL,                        -- 计费用量窗口 [start,end)（自然时间滚动）
    window_end       timestamptz   NOT NULL,
    idempotency_key  varchar(128)  NOT NULL,                        -- = tenant+window 派生，防同窗口重复扣
    amount           numeric(12,2) NOT NULL,                        -- 本批扣款额（窗口内 usage×price 汇总）
    currency         varchar(16)   NOT NULL DEFAULT 'CNY',
    breakdown        jsonb,                                         -- 按 product/metric 明细（供对账单展开）
    transaction_id   uuid          NOT NULL REFERENCES billing.transactions(id),  -- 域内真 FK（consume 流水）
    status           varchar(16)   NOT NULL DEFAULT 'charged',
    created_at       timestamptz   NOT NULL DEFAULT now(),          -- append-only
    CONSTRAINT uq_prepaid_charges_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT chk_prepaid_charges_status CHECK (status IN ('charged','failed','reversed'))
);
CREATE INDEX idx_prepaid_charges_tenant_id      ON billing.prepaid_charges (tenant_id);
CREATE INDEX idx_prepaid_charges_transaction_id ON billing.prepaid_charges (transaction_id);
CREATE INDEX idx_prepaid_charges_status         ON billing.prepaid_charges (status);
CREATE INDEX idx_prepaid_charges_window         ON billing.prepaid_charges (tenant_id, window_start);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_invoice_items_subscription ON billing.invoice_items (subscription_id);
CREATE INDEX idx_invoice_items_product      ON billing.invoice_items (product_id);
CREATE INDEX idx_invoice_items_tenant       ON billing.invoice_items (tenant_id);
CREATE INDEX idx_invoices_subscription      ON billing.invoices (subscription_id);
CREATE INDEX idx_payments_transaction       ON billing.payments (transaction_id);
CREATE INDEX idx_refunds_transaction        ON billing.refunds (transaction_id);
CREATE INDEX idx_payment_mandates_user      ON billing.payment_mandates (user_id);
CREATE INDEX idx_prepaid_charges_workspace  ON billing.prepaid_charges (workspace_id);
