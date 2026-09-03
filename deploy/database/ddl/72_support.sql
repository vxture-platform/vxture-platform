-- ═══════════════════════════════════════════════════════════════════════════
-- 80_support.sql — schema support（工单 / 中央审计 / 通知）
-- 设计权威：docs/design/data_support_200_schema.md
-- 命名：plural 化——tickets / ticket_comments / audit_logs / notification_logs。
-- 域内 FK（ticket_comments.ticket_id → tickets.id）内联；
-- 跨 schema FK（tickets/notification_logs.tenant_id → tenancy.tenants）见 90（铁律一）。
-- 裸值不建 FK：account_id / assignee_id / actor_id / audit_logs.tenant_id·actor_id /
--   *.request_id（边界#1 跨库关联 · 边界#2 跨 realm · 边界#3 须活过 actor/租户注销）。
-- 三类写入语义（勿混）：tickets 可变+软删；ticket_comments append-only(仅封 UPDATE，
--   保留 CASCADE DELETE 供父表 purge)；audit_logs append-only(封 UPDATE+DELETE)+按月 RANGE 分区；
--   notification_logs 可变(投递/打开回执回填，绝不加不可变触发器)。
-- append-only 触发器见 triggers_ddl；audit_logs 月分区由部署脚本据 partitioned_tables 预建。
-- 表序 = 域内依赖序：tickets → ticket_comments → audit_logs → notification_logs。
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tickets（工单聚合根，可变 + 软删）
-- tenant_id 跨 schema→tenancy.tenants（真 FK，见 90）。account_id(报单者)/assignee_id(坐席)
-- 为逻辑引用裸值：报单者可注销工单须留存(边界#3)、坐席跨 realm workforce(边界#2)，均不建 FK。
-- 不引入 workspace_id：工单是租户/账号级支持工件、非计量对象（守起步最小化）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support.tickets (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid          NOT NULL,                       -- 跨 schema→tenancy.tenants（真 FK，90）
    account_id           uuid,                                         -- 裸值→account.users（不建 FK，边界#3）
    ticket_no            varchar(64)   NOT NULL,                       -- 可视码（永不做 FK 目标，铁律二）
    category             varchar(64)   NOT NULL DEFAULT 'general',     -- 开放分类法，无 CHECK，应用层校验
    priority             varchar(16)   NOT NULL DEFAULT 'p2',
    source               varchar(64)   NOT NULL DEFAULT 'console',
    status               varchar(32)   NOT NULL DEFAULT 'open',
    title                varchar(200)  NOT NULL,
    description          text          NOT NULL DEFAULT '',
    reporter_name        varchar(100),
    assignee_id          uuid,                                         -- 裸值→admin.operator_accounts（不建 FK，边界#2）
    assignee_name        varchar(100),
    tags                 varchar(64)[] NOT NULL DEFAULT '{}',
    satisfaction_score   int,                                          -- 1..5 或 NULL
    satisfaction_comment varchar(512),
    sla_breach_at        timestamptz,                                  -- 派生违约时刻（非状态）
    first_response_at    timestamptz,
    due_at               timestamptz,
    resolved_at          timestamptz,
    closed_at            timestamptz,
    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT uq_tickets_ticket_no          UNIQUE (ticket_no),
    CONSTRAINT chk_tickets_priority          CHECK (priority IN ('p0','p1','p2','p3')),
    CONSTRAINT chk_tickets_source            CHECK (source IN ('console','website','email','admin','api')),
    CONSTRAINT chk_tickets_status            CHECK (status IN ('open','pending','in_progress','resolved','closed','reopened','cancelled')),
    CONSTRAINT chk_tickets_satisfaction      CHECK (satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5)
);
CREATE INDEX idx_tickets_tenant_status   ON support.tickets (tenant_id, status);
CREATE INDEX idx_tickets_priority_updated ON support.tickets (priority, updated_at DESC);
CREATE INDEX idx_tickets_assignee        ON support.tickets (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tickets_deleted_at      ON support.tickets (deleted_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ticket_comments（工单流水/事件流，append-only）
-- event_type 开放集（comment/status_changed/assigned/reopened/sla_breached/…）。
-- actor_id 逻辑引用裸值，按 actor_type 跨 realm（边界#2/#3）；actor_name 冗余留痕。
-- ticket_id 域内真 FK（ON DELETE CASCADE）。append-only：仅封 UPDATE（触发器见 triggers_ddl），
-- 保留 CASCADE DELETE 供父表留存到期 purge（封 DELETE 会让 purge 失败）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support.ticket_comments (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id    uuid          NOT NULL REFERENCES support.tickets(id) ON DELETE CASCADE,  -- 域内真 FK
    event_type   varchar(64)   NOT NULL,                              -- 开放集
    actor_type   varchar(32)   NOT NULL,
    actor_id     uuid,                                                 -- 可空(system)；裸值跨 realm（边界#2/#3）
    actor_name   varchar(100)  NOT NULL,                              -- 冗余留痕（actor 注销后仍可读）
    payload      jsonb         NOT NULL DEFAULT '{}'::jsonb,          -- 正文/前后值/附件引用
    created_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_comments_actor_type CHECK (actor_type IN ('customer','operator','system'))
);
CREATE INDEX idx_ticket_comments_ticket_created ON support.ticket_comments (ticket_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. audit_logs（跨域中央审计，append-only + 按月 RANGE 分区 + 留存 ≥24 月）
-- 平台中央审计：identity/commerce/admin 全域"谁在何时对什么做了什么"统一落此。
-- 分区键 created_at 必进 PK。tenant_id/actor_id 刻意不建 FK：合规不可变记录须活过
-- 租户/actor 注销(边界#3)、actor 跨 customer/operator 两 realm(边界#2)。
-- actor_console（product_251 X-3）：这一笔是从哪个管理面发起的。**不是**用来把审计
-- 分家——全平台仍然一张表；是因为同一个运营者同时面对 opera / admin / atlas / runos
-- 四个控制台，「谁改了什么」答得出、「他当时在哪个面」答不出时，跨面对账就断在这里。
-- 可空：auth-bff 的后台通道换票不属于任何控制台，那种行就该是 NULL，不该硬编一个。
-- append-only：封 UPDATE+DELETE（触发器见 triggers_ddl）；留存靠 DROP PARTITION(O(1))。
-- 月分区 + DEFAULT 兜底由部署脚本据 partitioned_tables 预建（与 metering usage_events 共用）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support.audit_logs (
    id            uuid          NOT NULL DEFAULT gen_random_uuid(),
    actor_type    varchar(32)   NOT NULL,
    actor_id      uuid          NOT NULL,                             -- 裸值，按 actor_type 跨 realm（边界#2/#3）
    actor_console varchar(32),                                        -- 'opera'|'admin'|NULL(非控制台发起)；见下

    tenant_id     uuid,                                               -- 可空(平台级)；裸值，不建 FK（边界#3）
    action        varchar(128)  NOT NULL,                            -- 'tenant.member.invite'
    result        varchar(32)   NOT NULL DEFAULT 'success',
    resource_type varchar(64)   NOT NULL,
    resource_id   varchar(128)  NOT NULL,                            -- 可视/异构键，永不做 FK 目标（铁律二）
    error_code    varchar(64),
    before        jsonb,                                              -- 变更前快照
    after         jsonb,                                              -- 变更后快照
    request_id    varchar(128),                                       -- 裸值，跨库关联键（边界#1）
    duration_ms   int,
    ip_address    varchar(64),
    user_agent    varchar(512),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at),                                     -- 分区键必进 PK
    CONSTRAINT chk_audit_logs_actor_type CHECK (actor_type IN ('customer','operator','system','api')),
    CONSTRAINT chk_audit_logs_result     CHECK (result IN ('success','failure','denied'))
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_audit_logs_tenant_created   ON support.audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor_created    ON support.audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_action           ON support.audit_logs (action);
CREATE INDEX idx_audit_logs_resource         ON support.audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_request_id       ON support.audit_logs (request_id) WHERE request_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. notification_logs（多渠道通知，可变，投递/打开回执追踪）
-- tenant_id 跨 schema→tenancy.tenants（真 FK，普通引用短留存日志，见 90）。
-- account_id 逻辑引用裸值（收件人可注销，边界#3）。provider_message_id 供投递/打开 webhook 回写。
-- 绝不加 append-only 触发器（回执/重试须 UPDATE）；留存 6–12 月定期批删，量大再升级按月分区。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support.notification_logs (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid,                                         -- 跨 schema→tenancy.tenants（真 FK，90）
    account_id           uuid,                                         -- 裸值→account.users（不建 FK，边界#3）
    channel              varchar(32)   NOT NULL,
    template_code        varchar(64)   NOT NULL,                      -- 模板键（模板不在本库建模）
    status               varchar(32)   NOT NULL,
    reference_type       varchar(64),                                  -- 业务来源类型（ticket/invoice/verification…）
    reference_id         varchar(128),
    recipient            varchar(256)  NOT NULL,
    subject              varchar(256),
    provider             varchar(64),
    provider_message_id  varchar(256),                                 -- 回执 id，投递/打开 webhook 据此回写
    error_message        text,
    retry_count          int           NOT NULL DEFAULT 0,
    delivered_at         timestamptz,                                  -- 回执回填
    opened_at            timestamptz,                                  -- 回执回填
    created_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_notification_logs_channel     CHECK (channel IN ('email','sms','inapp','webhook','push')),
    CONSTRAINT chk_notification_logs_status      CHECK (status IN ('queued','sent','delivered','opened','failed','bounced')),
    CONSTRAINT chk_notification_logs_retry_count CHECK (retry_count >= 0)
);
CREATE INDEX idx_notification_logs_tenant_created ON support.notification_logs (tenant_id, created_at DESC);
CREATE INDEX idx_notification_logs_account        ON support.notification_logs (account_id);
CREATE INDEX idx_notification_logs_status         ON support.notification_logs (status);
CREATE INDEX idx_notification_logs_channel        ON support.notification_logs (channel);
CREATE INDEX idx_notification_logs_provider_msg   ON support.notification_logs (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_notification_logs_reference      ON support.notification_logs (reference_type, reference_id) WHERE reference_type IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. inbox_messages（站内消息，收件人视角；product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）
-- 与 notification_logs 的分工：logs 是**发送账本**（每次投递一行，治理台审计），本表是**收件箱**
-- （每个收件人一行，可读/未读）。同一条业务通知：先落本表（去重键），再按偏好发邮件并记 logs。
-- tenant_id 跨 schema→tenancy.tenants（真 FK，90）；account_id 裸值→account.users（边界#3，同 logs）。
-- 去重：(account_id, template_code, reference_type, reference_id) 唯一——扫描作业每分钟重跑，
-- 同一到期 / 同一订单 / 同一退款阶段只通知一次。可变（read_at）；留存与 logs 同策略。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support.inbox_messages (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,                             -- 跨 schema→tenancy.tenants（真 FK，90）
    account_id      uuid          NOT NULL,                             -- 收件人，裸值→account.users（边界#3）
    template_code   varchar(64)   NOT NULL,                             -- 与 notification_logs.template_code 同一套键（subscription.* / order.* / refund.*）
    title           varchar(256)  NOT NULL,
    body            text          NOT NULL,
    link            varchar(512),                                       -- console 内相对路径（点开去哪）
    reference_type  varchar(64)   NOT NULL,                             -- subscription / order / refund
    reference_id    varchar(128)  NOT NULL,                             -- 去重键：同一业务对象 + 阶段只发一次
    read_at         timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_inbox_messages_dedupe UNIQUE (account_id, template_code, reference_type, reference_id)
);
CREATE INDEX idx_inbox_messages_account_created ON support.inbox_messages (account_id, created_at DESC);
CREATE INDEX idx_inbox_messages_account_unread  ON support.inbox_messages (account_id) WHERE read_at IS NULL;
CREATE INDEX idx_inbox_messages_tenant          ON support.inbox_messages (tenant_id);
