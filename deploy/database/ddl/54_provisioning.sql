-- ═══════════════════════════════════════════════════════════════════════════
-- 60_provisioning.sql — schema provisioning（开通生命周期 + webhook 投递 + 后台任务心跳）
-- 设计权威：docs/design/data_commerce_220_provisioning.md
-- 命名清理：schema 名 provisioning 已限定上下文 → tenant_app_provisioning/
--   app_webhook_delivery 简化为 provisionings / webhook_deliveries。
-- 域内 FK 内联（webhook_deliveries.provisioning_id → provisionings.id）；
-- 跨 schema FK（→ tenancy.workspaces/tenants、product.products）一律不内联，见 cross_schema_fks（铁律一）。
-- 三表皆「可变工作队列/状态」，非 append-only、无分区、无软删（仅 created_at/updated_at 四件套之二，
-- background_jobs 甚至只有 updated_at——job_name 主键即天然的"created"信号）。
-- 表序 = 域内依赖序：provisionings → webhook_deliveries → background_jobs（无 FK，纯宿主同域挂靠）。
-- ═══════════════════════════════════════════════════════════════════════════

-- 开通状态机（每 workspace+product 至多一条，UNIQUE 约束）。系统触发型，无独立 actor 字段——
-- 问责落在触发源（metering.subscriptions 变更 actor）+ 中央 support.audit_logs。
-- status 三态：pending → provisioned → deprovisioned；重新订阅复用同一行回流，每跳 version += 1。
-- version 双职：① 乐观锁防并发状态迁移互覆盖；② 投递排序键（webhook_deliveries 携带迁移时 version）。
-- 不含 plan_id：开通与订阅正交，跨 plan 升降级期间保持 provisioned 不变。
-- workspace_id/tenant_id/product_id 均跨 schema（不建内联 FK，见 cross_schema_fks）。
CREATE TABLE provisioning.provisionings (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid         NOT NULL,                          -- 跨 schema→tenancy.workspaces（开通主体）
    tenant_id         uuid         NOT NULL,                          -- 跨 schema→tenancy.tenants（结算/rollup 反查）
    product_id        uuid         NOT NULL,                          -- 跨 schema→product.products
    status            varchar(32)  NOT NULL DEFAULT 'pending',
    version           int          NOT NULL DEFAULT 0,               -- 单调递增，乐观锁 + 投递排序键
    provisioned_at    timestamptz,
    deprovisioned_at  timestamptz,
    metadata          jsonb,                                          -- 开通上下文（区域/初始化参数/产品侧 space_id 回执）
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_provisionings_workspace_product UNIQUE (workspace_id, product_id),
    CONSTRAINT chk_provisionings_status  CHECK (status IN ('pending','provisioned','deprovisioned')),
    CONSTRAINT chk_provisionings_version CHECK (version >= 0)
);
CREATE INDEX idx_provisionings_tenant_id  ON provisioning.provisionings (tenant_id);
CREATE INDEX idx_provisionings_product_id ON provisioning.provisionings (product_id);
CREATE INDEX idx_provisionings_status     ON provisioning.provisionings (status);

-- 平台 → 产品的 outbound 投递队列（retry / lease / 幂等 / 终态）。可变工作队列，非 append-only、
-- 无分区（量远低于用量事件），delivered 旧行靠定期归档。
-- idempotency_key 派生须含 workspace_id：开通类 hash(workspace_id+product_id+event_type+provisioning_version)；
--   非升版事件（subscription_changed/quota_warning，不自增 version）另加事件实例判别键（源记录 id/时间戳）。
-- 入队幂等 INSERT ... ON CONFLICT (idempotency_key) DO NOTHING；lease 领取用 idx_claim + FOR UPDATE SKIP LOCKED。
-- provisioning_id 同 schema 域内真 FK（内联，可空：非开通类生命周期事件）；ON DELETE SET NULL 保留投递审计。
-- workspace_id/tenant_id/product_id 跨 schema（不建内联 FK，见 cross_schema_fks）。
CREATE TABLE provisioning.webhook_deliveries (
    id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key       varchar(128)  NOT NULL,                     -- 派生含 workspace_id，防跨 workspace 撞键
    provisioning_id       uuid          REFERENCES provisioning.provisionings(id) ON DELETE SET NULL,  -- 域内真 FK，可空
    provisioning_version  int,                                        -- 入队时的开通版本
    workspace_id          uuid          NOT NULL,                     -- 跨 schema→tenancy.workspaces
    tenant_id             uuid          NOT NULL,                     -- 跨 schema→tenancy.tenants（rollup 反查）
    product_id            uuid          NOT NULL,                     -- 跨 schema→product.products
    event_type            varchar(64)   NOT NULL,                     -- provisioned/deprovisioned/subscription_changed/quota_warning
    payload               jsonb         NOT NULL,                     -- 事件负载（含触发时 plan_version_id 等审计上下文）
    status                varchar(32)   NOT NULL DEFAULT 'pending',
    attempts              int           NOT NULL DEFAULT 0,
    max_attempts          int           NOT NULL DEFAULT 8,          -- 超过转 dead
    response_code         int,                                        -- 末次 HTTP 响应码
    last_error            varchar(512),
    signature             varchar(256),                               -- HMAC 头值（product.product_webhooks.webhook_secret_ref 签发）
    leased_by             varchar(64),                                -- 抢占该行的 worker 标识
    leased_until          timestamptz,                                -- 租约到期
    last_attempt_at       timestamptz,
    next_retry_at         timestamptz,
    delivered_at          timestamptz,
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_webhook_deliveries_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT chk_webhook_deliveries_status       CHECK (status IN ('pending','delivering','delivered','failed','dead')),
    CONSTRAINT chk_webhook_deliveries_attempts     CHECK (attempts >= 0),
    CONSTRAINT chk_webhook_deliveries_max_attempts CHECK (max_attempts >= 1)
);
CREATE INDEX idx_webhook_deliveries_claim           ON provisioning.webhook_deliveries (status, next_retry_at);  -- 投递队列领取
CREATE INDEX idx_webhook_deliveries_workspace_prod  ON provisioning.webhook_deliveries (workspace_id, product_id);
CREATE INDEX idx_webhook_deliveries_provisioning_id ON provisioning.webhook_deliveries (provisioning_id);

-- 后台任务心跳（opera「任务调度」2026-08-11 建，取代 admin.governance_record——那张表
-- 设计已弃用、从未建过，见 docs/30-design/data_admin_200_schema.md）。platform-api 四个
-- @Interval 驱动的作业（provisioning-dispatch / sharing-expiry / trial-expiry /
-- order-payment-expiry）各占一行、每 tick 原地 UPSERT，不是逐 tick 追加的执行日志——
-- 这些作业最短 10s 一跳，日志化会在一天内堆出数万条噪音行，心跳表只答"这个作业活着吗、
-- 上次跑得怎么样"，不答"每一次都发生了什么"（真要追溯用 support.audit_logs 或应用日志）。
-- 落在 provisioning schema 而非更贴语义的 admin：四个作业的宿主 platform-api 只有
-- provisioning/sharing/trial/order 相关 schema 的库权限（97_service_roles.sql），没有
-- admin schema 写权限，边界不能为了这一张表破例。
-- job_name 是自然主键（进程内常量，不经用户输入，无需代理键）。
CREATE TABLE provisioning.background_jobs (
    job_name              varchar(64)   PRIMARY KEY,
    status                varchar(16)   NOT NULL DEFAULT 'idle',
    interval_ms           int,
    last_started_at       timestamptz,
    last_finished_at      timestamptz,
    last_duration_ms      int,
    last_items_processed  int,
    last_error            varchar(1024),
    run_count             bigint        NOT NULL DEFAULT 0,
    failure_count         bigint        NOT NULL DEFAULT 0,
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_background_jobs_status CHECK (status IN ('idle','running','success','failed')),
    CONSTRAINT chk_background_jobs_run_count CHECK (run_count >= 0),
    CONSTRAINT chk_background_jobs_failure_count CHECK (failure_count >= 0)
);
