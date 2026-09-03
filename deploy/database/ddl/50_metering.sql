-- ═══════════════════════════════════════════════════════════════════════════
-- 30_metering.sql — schema metering（订阅 / 配额 / 用量计量内核）
-- 设计权威：docs/design/data_commerce_200_metering.md（§1–§10）
-- 上级：data_platform_100_architecture.md §2.2.4 七条铁律
-- 域内 FK（含复合）内联；跨 schema FK（→tenancy / product / billing）见 90_cross_schema_fk.sql（铁律一）。
-- 跨 realm 身份引用（actor_id / created_by_id / operator_id / granted_by）一律裸 UUID，不建 FK（边界#2，铁律七）。
-- append-only（usage_events / usage_event_pools / subscription_histories）BEFORE UPDATE OR DELETE RAISE 触发器见 95_triggers.sql（禁 DO INSTEAD NOTHING RULE）。
-- 分区表（usage_events / usage_event_pools）RANGE 按月，分区键进复合 PK；预建 96 月分区 + DEFAULT 由部署编排另建。
-- 表序 = 域内依赖序：subscriptions → subscription_histories / subscription_renewals /
--   subscription_entitlement_overrides → quota_pools → quota_pool_resets →
--   usage_events → usage_event_pools → usage_idempotencies →
--   usage_summary_hours/days/weeks/months/years → entitlement_caches。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §1 订阅（workspace 化成本中心，指向不可变 plan_version）。周期锚定 start_at（非日历）。
--   product_330（2026-09-03）：订单拆到 billing.orders；升级 / 续订由订单履约**改本行**（tier/周期/到期/实付），
--   不再新增行；一个 workspace × product 至多一条当前订阅（uidx_subscriptions_live_per_product）。
--   更新轨迹见 subscription_histories（故本表不设 updated_by）。
--   跨 schema：tenant_id→tenancy.tenants、workspace_id→tenancy.workspaces、plan_version_id→product.plan_versions、
--   payment_mandate_id→billing.payment_mandates（均见 90）。created_by_id 裸 UUID（边界#2）。
CREATE TABLE metering.subscriptions (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid          NOT NULL,                     -- 跨 schema→tenancy.tenants（90），账单 rollup 反查 org
    workspace_id        uuid          NOT NULL,                     -- 跨 schema→tenancy.workspaces（90），真实主体
    plan_version_id     uuid          NOT NULL,                     -- 跨 schema→product.plan_versions（90），不可变版本
    subscription_kind   varchar(16)   NOT NULL,                     -- paid / trial / free
    cycle_unit          varchar(16)   NOT NULL,                     -- day/week/month/year/perpetual（替代旧 cycle_type）
    cycle_count         int           NOT NULL DEFAULT 1,           -- 周期倍数（7天=day×7、季=month×3、perpetual 无意义）
    start_at            timestamptz   NOT NULL,                     -- 周期锚点，投影为 quota_pools.period_anchor
    end_at              timestamptz,                                -- NULL = 永久 / 开放式滚动
    trial_end_at        timestamptz,                                -- kind=trial 试用到期（仅人工延期）
    had_trial_at        timestamptz,                                -- 曾试用标记（防重复领）
    status              varchar(32)   NOT NULL DEFAULT 'active',
    auto_renew          boolean       NOT NULL DEFAULT true,
    activation_method   varchar(24)   NOT NULL DEFAULT 'online_purchase',  -- 开通方式（可追溯来源）
    next_renewal_at     timestamptz,                                -- 下次续订触发（≈ end_at 提前量）；auto_renew=false/perpetual 时 NULL
    renewal_source      varchar(16),                                -- mandate / balance / manual
    payment_mandate_id  uuid,                                       -- 跨 schema→billing.payment_mandates（90），renewal_source=mandate 时
    order_no            varchar(128),                               -- 【退役中，product_330 P2-d】旧模型的购买单号；2026-09-03 停写、2026-09-05 起代码停读（可视码只认 current_order_id → billing.orders.order_no）；下一版删列
    payment_ttl_minutes int,                                        -- 【退役中，product_330 P2-d】旧模型订单行的付款时效；已移到 billing.orders.payment_ttl_minutes；停写停读，下一版删列
    pay_amount          numeric(12,2),                              -- 与 plan_version.price 分离
    product_id          uuid,                                       -- 主组件产品（冗余；BEFORE INSERT/UPDATE 触发器自 plan_components 填，95；跨 schema→product.products，90）product_330
    paid_amount         numeric(12,2),                              -- 本周期实付（升级折抵输入 P_old；product_330 §4.1）
    current_order_id    uuid,                                       -- 最近一次履约本行的订单（跨 schema→billing.orders，90）product_330
    currency            varchar(16)   DEFAULT 'CNY',
    created_by_type     varchar(16)   NOT NULL,                     -- §0.1 actor：system/customer/operator
    created_by_id       uuid,                                       -- 裸值，按 type 解引用 account.users / admin.operator_accounts（边界#2）
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    CONSTRAINT uq_subscriptions_order_no         UNIQUE (order_no),
    CONSTRAINT chk_subscriptions_kind            CHECK (subscription_kind IN ('paid','trial','free')),
    CONSTRAINT chk_subscriptions_cycle_unit      CHECK (cycle_unit IN ('day','week','month','year','perpetual')),
    CONSTRAINT chk_subscriptions_cycle_count     CHECK (cycle_count >= 1),
    -- 值域权威 = @vxture-platform/shared catalog-domains SUBSCRIPTION_STATUSES(lint:catalog-domains 强制一致)。
    CONSTRAINT chk_subscriptions_status          CHECK (status IN ('active','expiring','trialing','overdue','suspended','expired','cancelled')),
    CONSTRAINT chk_subscriptions_activation      CHECK (activation_method IN ('online_purchase','offline_purchase','redemption','operator_grant','trial','free')),
    CONSTRAINT chk_subscriptions_renewal_source  CHECK (renewal_source IS NULL OR renewal_source IN ('mandate','balance','manual')),
    CONSTRAINT chk_subscriptions_created_by_type CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_subscriptions_payment_ttl     CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1),
    -- 结构不变量（§1.1，须落 DDL CHECK）
    CONSTRAINT chk_subscriptions_perpetual_open  CHECK (cycle_unit <> 'perpetual' OR end_at IS NULL),
    CONSTRAINT chk_subscriptions_trial_no_renew  CHECK (subscription_kind <> 'trial' OR auto_renew = false)
);
CREATE INDEX idx_subscriptions_workspace_id    ON metering.subscriptions (workspace_id);
CREATE INDEX idx_subscriptions_tenant_id       ON metering.subscriptions (tenant_id);
CREATE INDEX idx_subscriptions_plan_version_id ON metering.subscriptions (plan_version_id);
CREATE INDEX idx_subscriptions_status          ON metering.subscriptions (status);
CREATE INDEX idx_subscriptions_next_renewal_at ON metering.subscriptions (next_renewal_at);  -- 续订 Job 扫描
CREATE INDEX idx_subscriptions_deleted_at      ON metering.subscriptions (deleted_at);
CREATE INDEX idx_subscriptions_product_id      ON metering.subscriptions (product_id);
-- product_330 §8 不变式 1：一个 workspace × product 至多一条"当前"订阅（同档不同档都不能并存）
CREATE UNIQUE INDEX uidx_subscriptions_live_per_product ON metering.subscriptions (workspace_id, product_id)
  WHERE status IN ('active','trialing','expiring','overdue') AND deleted_at IS NULL;

-- ── §2 订阅变更审计（append-only）。触发器见 95。tenant_id 跨 schema→tenancy.tenants（90）；
--   subscription_id 域内 FK→subscriptions（内联）。actor_id 裸 UUID（边界#2）。仅 created_at（不可变）。
CREATE TABLE metering.subscription_histories (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid          NOT NULL,                    -- 跨 schema→tenancy.tenants（90）
    subscription_id      uuid          NOT NULL REFERENCES metering.subscriptions(id) ON DELETE CASCADE,  -- 域内 FK
    change_type          varchar(32)   NOT NULL,                   -- created/renewed/upgraded/downgraded/cancelled（开放）
    from_plan_version_id uuid,                                     -- 历史快照（product.plan_versions 不可变；快照不建 FK，§12 未列）
    to_plan_version_id   uuid,
    from_status          varchar(32),
    to_status            varchar(32),
    actor_type           varchar(16)   NOT NULL DEFAULT 'system',  -- §0.1：system/customer/operator（原 operator_type）
    actor_id             uuid,                                     -- 裸值，按 actor_type 解引用（边界#2；原 operator_id）
    remark               varchar(512),                             -- 原 operator_remark，去前缀
    client_ip            varchar(64),
    created_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_subscription_histories_actor_type CHECK (actor_type IN ('system','customer','operator'))
);
CREATE INDEX idx_subscription_histories_change_type ON metering.subscription_histories (change_type);
CREATE INDEX idx_subscription_histories_created_at  ON metering.subscription_histories (created_at);
CREATE INDEX idx_subscription_histories_subscription ON metering.subscription_histories (subscription_id);
CREATE INDEX idx_subscription_histories_tenant_id   ON metering.subscription_histories (tenant_id);

-- ── §2.1 自动续订执行 + 催款/重试（可变工作队列，非 append-only）。成功续订同写一条 §2 history。
--   subscription_id 域内 FK→subscriptions（内联）；tenant_id 跨 schema→tenancy.tenants（90）；
--   result_transaction_id→billing.transactions、result_invoice_id→billing.invoices（均见 90）。
CREATE TABLE metering.subscription_renewals (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id       uuid          NOT NULL REFERENCES metering.subscriptions(id) ON DELETE CASCADE,  -- 域内 FK
    tenant_id             uuid          NOT NULL,                  -- 跨 schema→tenancy.tenants（90）
    cycle_seq             int           NOT NULL,                  -- 第几个续订周期（幂等键之一）
    scheduled_at          timestamptz   NOT NULL,
    renewal_source        varchar(16)   NOT NULL,                  -- mandate/balance/manual（快照自订阅）
    status                varchar(16)   NOT NULL DEFAULT 'pending',
    attempt_count         int           NOT NULL DEFAULT 0,
    max_attempts          int           NOT NULL DEFAULT 4,        -- 超过转 abandoned
    next_retry_at         timestamptz,                             -- 指数退避
    dunning_stage         int,                                     -- 催款阶段（提醒/降级/停服）
    amount                numeric(12,2),                           -- 本期应扣额
    result_transaction_id uuid,                                    -- 跨 schema→billing.transactions（90）
    result_invoice_id     uuid,                                    -- 跨 schema→billing.invoices（90）
    new_period_end        timestamptz,                             -- 续订后新周期末（回写 subscriptions.end_at）
    failure_reason        varchar(256),
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_subscription_renewals_sub_cycle   UNIQUE (subscription_id, cycle_seq),   -- 每期幂等，防重复续订
    CONSTRAINT chk_subscription_renewals_source     CHECK (renewal_source IN ('mandate','balance','manual')),
    CONSTRAINT chk_subscription_renewals_status     CHECK (status IN ('pending','processing','succeeded','failed','dunning','abandoned')),
    CONSTRAINT chk_subscription_renewals_attempt    CHECK (attempt_count >= 0)
);
CREATE INDEX idx_subscription_renewals_queue     ON metering.subscription_renewals (status, next_retry_at);  -- 队列领取
CREATE INDEX idx_subscription_renewals_tenant_id ON metering.subscription_renewals (tenant_id);

-- ── §3 运营手工权益覆盖。subscription_id 域内 FK→subscriptions（内联）；product_id 跨 schema→product.products（90）。
--   operator_id：权益覆盖 realm 确定=operator，逻辑引用 admin.operator_accounts，裸 UUID（边界#2）。
CREATE TABLE metering.subscription_entitlement_overrides (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id   uuid          NOT NULL REFERENCES metering.subscriptions(id) ON DELETE CASCADE,  -- 域内 FK
    product_id        uuid          NOT NULL,                     -- 跨 schema→product.products（90）
    override_tier_code varchar(32)  NOT NULL,                     -- 可视码，非 FK 目标（铁律二）
    operator_id       uuid,                                       -- 裸值→admin.operator_accounts（边界#2，不建 FK）
    reason            text,
    expires_at        timestamptz,                                -- NULL = 长期有效
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_subscription_entitlement_overrides UNIQUE (subscription_id, product_id)
);
CREATE INDEX idx_subscription_overrides_product ON metering.subscription_entitlement_overrides (product_id);

-- ── §4 实时余量 SoT（瀑布定序扣减，软退役不硬删）。禁裸读 quota_used（§4.1 周期感知表达式）。
--   subscription_id 域内 FK→subscriptions（内联，可空 manual_override）；
--   workspace_id 跨 schema→tenancy.workspaces、product_id→product.products（90）；granted_by 裸 UUID（边界#2）。
--   period_anchor（新增）= 订阅 start_at；周期从此点按 reset_period 整段推进（非 date_trunc 日历对齐）。
CREATE TABLE metering.quota_pools (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         uuid          NOT NULL,                   -- 跨 schema→tenancy.workspaces（90）
    subscription_id      uuid          REFERENCES metering.subscriptions(id),  -- 域内 FK，可空（manual_override / WS 级池）
    product_id           uuid,                                     -- 跨 schema→product.products（90）；NULL = WS 级池（ws_base/addon_purchase，product_220 §4.4：池属 workspace 本身、全产品可烧，不参与共享策略路由）
    metric_key           varchar(64)   NOT NULL,
    quota_limit          bigint        NOT NULL,
    quota_used           bigint        NOT NULL DEFAULT 0,         -- 禁裸读（§4.1）
    priority             int           NOT NULL DEFAULT 100,       -- 投影自 plan_component.priority，同键可重复
    component_role       varchar(16)   NOT NULL DEFAULT 'primary', -- 贡献组件的角色 primary/bundled（D6，原 billing_kind）；manual_override/加油包按 primary 记
    pool_source          varchar(32)   NOT NULL DEFAULT 'subscription',  -- subscription / manual_override / ws_base（WS 默认底量,Job 物化,策略可配）/ addon_purchase（加油包/扩展包购买 grant,product_220 §4.2）
    reset_period         varchar(16)   NOT NULL DEFAULT 'none',    -- none/day/month（按订阅锚定推进，非日历）
    period_anchor        timestamptz,                              -- 周期锚点（= 订阅 start_at / manual_override effective_at）
    current_period_start timestamptz,                              -- = period_anchor + k×reset_period ≤ now()（锚定推进）
    status               varchar(32)   NOT NULL DEFAULT 'active',  -- active / retired（软退役绝不硬删）
    retired_at           timestamptz,
    granted_by           uuid,                                     -- 逻辑引用（边界#2，不建 FK）
    grant_reason         varchar(256),
    effective_at         timestamptz   NOT NULL DEFAULT now(),
    expires_at           timestamptz,
    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_quota_pools_component_role CHECK (component_role IN ('primary','bundled')),
    -- ws_base / addon_purchase = WS 级来源（2026-08-20，用量配额线）；entitlement_grant / voucher 登记预留（product_220 §4.4），落码时再入值域
    CONSTRAINT chk_quota_pools_pool_source  CHECK (pool_source IN ('subscription','manual_override','ws_base','addon_purchase')),
    CONSTRAINT chk_quota_pools_reset_period CHECK (reset_period IN ('none','day','month')),
    CONSTRAINT chk_quota_pools_status       CHECK (status IN ('active','retired')),
    -- subscription 型池必须挂 subscription_id（§4）；其余来源可空
    CONSTRAINT chk_quota_pools_source_sub    CHECK (pool_source <> 'subscription' OR subscription_id IS NOT NULL),
    -- 仅 WS 级来源允许无产品归属（NULL product_id）
    CONSTRAINT chk_quota_pools_ws_level      CHECK (product_id IS NOT NULL OR pool_source IN ('ws_base','addon_purchase')),
    -- 周期池强制非空锚点 + 当前周期起点（§4）
    CONSTRAINT chk_quota_pools_period_anchor CHECK (reset_period = 'none' OR (current_period_start IS NOT NULL AND period_anchor IS NOT NULL))
);
-- 瀑布路由 / 加锁顺序（§4）。不设"活跃池 priority 唯一"——两 plan 默认 priority=100 须共存。
CREATE INDEX idx_quota_pools_route ON metering.quota_pools (workspace_id, product_id, metric_key, priority);

-- ── §5 配额归零审计。pool_id 域内 FK→quota_pools（内联）。使 quota_used=SUM(命中池 took) 可重建，归零可审计。
CREATE TABLE metering.quota_pool_resets (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id           uuid          NOT NULL REFERENCES metering.quota_pools(id) ON DELETE CASCADE,  -- 域内 FK
    period_start      timestamptz,
    used_before_reset bigint        NOT NULL,
    reset_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX idx_quota_pool_resets_pool ON metering.quota_pool_resets (pool_id, reset_at);

-- ── §6 用量事件头（append-only，月分区）。分区键 created_at 进复合 PK。触发器见 95。
--   workspace_id 跨 schema→tenancy.workspaces、product_id→product.products（90，见 90 对分区父 ADD）。
--   idempotency_key / request_id 普通索引（全局唯一在 usage_idempotencies）。
CREATE TABLE metering.usage_events (
    id               uuid          NOT NULL DEFAULT gen_random_uuid(),
    workspace_id     uuid          NOT NULL,                       -- 跨 schema→tenancy.workspaces（90）
    product_id       uuid          NOT NULL,                       -- 跨 schema→product.products（90）
    metric_key       varchar(64)   NOT NULL,
    total_amount     bigint        NOT NULL,                       -- 实扣 = SUM(明细.took)
    requested_amount bigint,                                       -- 409 审计用，可空
    idempotency_key  varchar(128),
    request_id       varchar(128),
    end_user_id      uuid,                                         -- 终端用户归因（产品侧可选上报,2026-08-20 用量配额线）；裸 UUID→account.users（边界#2 不建 FK）；NULL = 未归集用户（容错桶,产品未上报即空缺）
    created_at       timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)                                   -- 分区键必须进 PK
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_usage_events_route          ON metering.usage_events (workspace_id, product_id, metric_key);
CREATE INDEX idx_usage_events_idempotency    ON metering.usage_events (idempotency_key);
CREATE INDEX idx_usage_events_request_id     ON metering.usage_events (request_id);
CREATE INDEX idx_usage_events_end_user       ON metering.usage_events (workspace_id, end_user_id) WHERE end_user_id IS NOT NULL;  -- 商业版按成员统计（部分索引,未归集行不占）

-- ── §7 用量明细（append-only，与头同步月分区）。每命中池一行。触发器见 95。
--   复合 FK (event_id,event_created_at)→usage_events(id,created_at)、quota_pool_id→quota_pools（均域内内联，
--   池软退役不硬删故 FK 永远可解）。分区键 event_created_at 进复合 PK。
CREATE TABLE metering.usage_event_pools (
    event_id         uuid          NOT NULL,
    event_created_at timestamptz   NOT NULL,
    quota_pool_id    uuid          NOT NULL REFERENCES metering.quota_pools(id),  -- 域内 FK
    took             bigint        NOT NULL,
    PRIMARY KEY (event_id, event_created_at, quota_pool_id),
    CONSTRAINT fk_usage_event_pools_event
        FOREIGN KEY (event_id, event_created_at)
        REFERENCES metering.usage_events (id, created_at)          -- 域内复合 FK → 分区头
) PARTITION BY RANGE (event_created_at);
CREATE INDEX idx_usage_event_pools_quota_pool ON metering.usage_event_pools (quota_pool_id);

-- ── §8 幂等权威（非分区，全局唯一 key 才成立）。跨月重试不双扣；重放/并发重复键经 ON CONFLICT 返回先前结果。
CREATE TABLE metering.usage_idempotencies (
    idempotency_key  varchar(128)  PRIMARY KEY,                    -- 全局唯一
    event_id         uuid,
    event_created_at timestamptz,
    consumed         bigint,
    per_pool         jsonb,                                        -- 重放直接返回
    created_at       timestamptz   NOT NULL DEFAULT now()
);

-- ── §9 多维降采样汇总（纯统计/看板，永不作计费依据）。五档：时/天/周/月/年。
--   workspace_id 跨 schema→tenancy.workspaces、product_id→product.products（均见 90）。
--   计费读 usage_events 按订阅锚定周期窗口求和，实时读 quota_pools（§4.1）——本组不承担。
CREATE TABLE metering.usage_summary_hours (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    metric_key   varchar(64)   NOT NULL,
    period_hour  timestamptz   NOT NULL,
    total_amount bigint        NOT NULL DEFAULT 0,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_summary_hours UNIQUE (workspace_id, product_id, metric_key, period_hour)
);

CREATE TABLE metering.usage_summary_days (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    metric_key   varchar(64)   NOT NULL,
    period_day   date          NOT NULL,
    total_amount bigint        NOT NULL DEFAULT 0,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_summary_days UNIQUE (workspace_id, product_id, metric_key, period_day)
);

CREATE TABLE metering.usage_summary_weeks (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    metric_key   varchar(64)   NOT NULL,
    period_week  date          NOT NULL,                           -- ISO 周一
    total_amount bigint        NOT NULL DEFAULT 0,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_summary_weeks UNIQUE (workspace_id, product_id, metric_key, period_week)
);

CREATE TABLE metering.usage_summary_months (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    metric_key   varchar(64)   NOT NULL,
    period_month varchar(8)    NOT NULL,                           -- YYYYMM
    total_amount bigint        NOT NULL DEFAULT 0,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_summary_months UNIQUE (workspace_id, product_id, metric_key, period_month)
);

CREATE TABLE metering.usage_summary_years (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    metric_key   varchar(64)   NOT NULL,
    period_year  varchar(4)    NOT NULL,                           -- YYYY
    total_amount bigint        NOT NULL DEFAULT 0,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_summary_years UNIQUE (workspace_id, product_id, metric_key, period_year)
);

-- ── §10 权益短 TTL 缓存（非 SoT）。门控走实时 resolve，不读此表；仅供展示/调试加速。
--   workspace_id 跨 schema→tenancy.workspaces、product_id→product.products（均见 90）。
CREATE TABLE metering.entitlement_caches (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid          NOT NULL,                           -- 跨 schema→tenancy.workspaces（90）
    product_id   uuid          NOT NULL,                           -- 跨 schema→product.products（90）
    payload      jsonb         NOT NULL,
    resolved_at  timestamptz   NOT NULL DEFAULT now(),
    expires_at   timestamptz   NOT NULL,
    CONSTRAINT uq_entitlement_caches_ws_product UNIQUE (workspace_id, product_id)
);
CREATE INDEX idx_entitlement_caches_expires_at ON metering.entitlement_caches (expires_at);

-- 资源共享路由策略（D8，product_220 §4.3）：workspace 级"哪些产品参与共享某平台 metric"。
-- 一行 = 一个参与产品;空(某 workspace×metric 无行) = 全保留(安全默认,不熄火)。改的是消费
-- 路由(哪些池互相开放),不是 plan 授予额度(授予随版本锁死,§6)。仅平台 metric(platform_metrics)
-- 可入策略;产品级 metric 恒保留。租户管理员设定(配置面 API/UI 后置)。
CREATE TABLE metering.resource_sharing_policies (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid          NOT NULL,                             -- 跨 schema→tenancy.workspaces（90）
    tenant_id     uuid          NOT NULL,                             -- 跨 schema→tenancy.tenants（90）；rollup/一致性
    metric_key    varchar(64)   NOT NULL,                             -- 平台 metric（product.platform_metrics.metric_key，loose 引用）
    product_id    uuid          NOT NULL,                             -- 参与共享的产品；跨 schema→product.products（90）
    created_by_type varchar(16) NOT NULL,                            -- §0.1 actor（管理员/运营/系统预设）
    created_by_id uuid,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_resource_sharing_policies_row UNIQUE (workspace_id, metric_key, product_id),
    CONSTRAINT chk_resource_sharing_policies_actor CHECK (created_by_type IN ('system','customer','operator'))
);
CREATE INDEX idx_resource_sharing_policies_lookup ON metering.resource_sharing_policies (workspace_id, metric_key);

-- gauge(存量)水位表(D5,data_commerce_240)：kind='gauge' 的平台 metric(storage.bytes)
-- 按 (workspace, product, metric) 存最新绝对水位,PUT /usage/gauge 覆盖式 upsert(observed_at
-- last-write-wins)。不进 append-only 的 usage_events(gauge 不入扣减账);读侧 C2 用 Σ 水位算
-- remaining。为什么独立表而非 quota_pools.quota_used:池是每订阅一行,水位是每 (ws,product) 一个。
CREATE TABLE metering.usage_gauges (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid          NOT NULL,                             -- 跨 schema→tenancy.workspaces（90）
    product_id    uuid          NOT NULL,                             -- 跨 schema→product.products（90）
    metric_key    varchar(64)   NOT NULL,                             -- 必为 product.platform_metrics.kind='gauge'
    value         bigint        NOT NULL,                             -- 当前绝对水位;允许 0
    observed_at   timestamptz   NOT NULL,                             -- arda 侧观测时刻;LWW 排序键
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_usage_gauges_row UNIQUE (workspace_id, product_id, metric_key),
    CONSTRAINT chk_usage_gauges_value CHECK (value >= 0)
);
CREATE INDEX idx_usage_gauges_lookup ON metering.usage_gauges (workspace_id, metric_key);

-- 加油包购买单(owner 2026-08-20 用量配额线):自助购买闭环——下单(pending_payment)→
-- 线下对公申报→运营核销→结算生成 WS 级 quota_pool grant(pool_source='addon_purchase',
-- product_id NULL,priority 200 后于订阅池烧,expires_at = 开通 + validity_days)。
-- 目录字段快照拷贝(改 product.addon_packs 不影响已售单);账单 = billing.invoices
-- bill_type='one_off'(invoice_id 跨 schema→90)。quota_pool_id 域内 FK,结算后回填。
-- 0 元不适用(目录 price>0);券/抵扣暂不进加油包流(登记)。
CREATE TABLE metering.addon_purchases (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid          NOT NULL,                       -- 跨 schema→tenancy.tenants（90）
    workspace_id        uuid          NOT NULL,                       -- 跨 schema→tenancy.workspaces（90）
    pack_id             uuid          NOT NULL,                       -- 跨 schema→product.addon_packs（90,溯源;字段以快照为准）
    pack_code           varchar(64)   NOT NULL,                       -- 快照
    pack_name           varchar(128)  NOT NULL,                       -- 快照
    metric_key          varchar(64)   NOT NULL,                       -- 快照
    amount              bigint        NOT NULL,                       -- 快照(授予量)
    validity_days       int           NOT NULL,                       -- 快照
    price               numeric(12,2) NOT NULL,                       -- 快照(应付)
    currency            varchar(16)   NOT NULL DEFAULT 'CNY',
    order_no            varchar(128)  NOT NULL,                       -- 可视码 ORD-{YYYYMM}-{10hex}(铁律二,不作 FK)
    status              varchar(32)   NOT NULL DEFAULT 'pending_payment',
    payment_ttl_minutes int,                                          -- 付款时效(同订阅单口径:个人 30 / 组织 2880)
    invoice_id          uuid,                                         -- 跨 schema→billing.invoices（90）
    quota_pool_id       uuid          REFERENCES metering.quota_pools(id),  -- 域内 FK,结算后授予的池
    activated_at        timestamptz,
    cancelled_at        timestamptz,
    cancel_reason       varchar(256),
    created_by_type     varchar(16)   NOT NULL,                       -- §0.1 actor
    created_by_id       uuid,                                         -- 裸值(边界#2)
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_addon_purchases_order_no UNIQUE (order_no),
    CONSTRAINT chk_addon_purchases_status CHECK (status IN ('pending_payment','completed','cancelled')),
    CONSTRAINT chk_addon_purchases_actor  CHECK (created_by_type IN ('system','customer','operator')),
    CONSTRAINT chk_addon_purchases_ttl    CHECK (payment_ttl_minutes IS NULL OR payment_ttl_minutes >= 1),
    CONSTRAINT chk_addon_purchases_amount CHECK (amount > 0),
    -- 结算完成必须已回填池与开通时刻
    CONSTRAINT chk_addon_purchases_completed CHECK (status <> 'completed' OR (quota_pool_id IS NOT NULL AND activated_at IS NOT NULL))
);
CREATE INDEX idx_addon_purchases_workspace ON metering.addon_purchases (workspace_id, status);
CREATE INDEX idx_addon_purchases_tenant    ON metering.addon_purchases (tenant_id);
CREATE INDEX idx_addon_purchases_status    ON metering.addon_purchases (status, created_at);
CREATE INDEX idx_addon_purchases_pack      ON metering.addon_purchases (pack_id);
CREATE INDEX idx_addon_purchases_invoice   ON metering.addon_purchases (invoice_id);
CREATE INDEX idx_addon_purchases_pool      ON metering.addon_purchases (quota_pool_id);

-- ── FK 支撑索引(2026-08-19 全库体检 P2 补齐;audit 类 created_by/updated_by 引用有意不建,父行不删)──
CREATE INDEX idx_subscriptions_payment_mandate     ON metering.subscriptions (payment_mandate_id);
CREATE INDEX idx_quota_pools_subscription          ON metering.quota_pools (subscription_id);
CREATE INDEX idx_quota_pools_product               ON metering.quota_pools (product_id);
CREATE INDEX idx_entitlement_caches_product        ON metering.entitlement_caches (product_id);
CREATE INDEX idx_resource_sharing_policies_tenant  ON metering.resource_sharing_policies (tenant_id);
CREATE INDEX idx_resource_sharing_policies_product ON metering.resource_sharing_policies (product_id);
CREATE INDEX idx_subscription_renewals_txn         ON metering.subscription_renewals (result_transaction_id);
CREATE INDEX idx_subscription_renewals_invoice     ON metering.subscription_renewals (result_invoice_id);
CREATE INDEX idx_usage_events_product              ON metering.usage_events (product_id);
CREATE INDEX idx_usage_gauges_product              ON metering.usage_gauges (product_id);
CREATE INDEX idx_usage_summary_days_product        ON metering.usage_summary_days (product_id);
CREATE INDEX idx_usage_summary_hours_product       ON metering.usage_summary_hours (product_id);
CREATE INDEX idx_usage_summary_weeks_product       ON metering.usage_summary_weeks (product_id);
CREATE INDEX idx_usage_summary_months_product      ON metering.usage_summary_months (product_id);
CREATE INDEX idx_usage_summary_years_product       ON metering.usage_summary_years (product_id);
