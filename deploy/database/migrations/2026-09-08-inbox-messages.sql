-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — product_330 P2-g：站内消息表 support.inbox_messages（owner 2026-09-03「通知先做站内 + 邮件」）
--
-- 收件人视角的消息实体（每人一行，可读/未读）；发送账本仍是 support.notification_logs。
-- 去重键 (account_id, template_code, reference_type, reference_id)：扫描作业每分钟重跑，
-- 同一到期 / 同一订单 / 同一退款阶段只通知一次。
-- 表级 SELECT/INSERT/UPDATE/DELETE 由 97 的 DEFAULT PRIVILEGES 自动给 platform_svc；
-- 这里只补列级 UPDATE 白名单（与 98_column_locks.sql 逐字一致）与跨 schema FK（与 90 一致）。
-- 幂等：IF NOT EXISTS / duplicate_object 吞异常。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS support.inbox_messages (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,
    account_id      uuid          NOT NULL,
    template_code   varchar(64)   NOT NULL,
    title           varchar(256)  NOT NULL,
    body            text          NOT NULL,
    link            varchar(512),
    reference_type  varchar(64)   NOT NULL,
    reference_id    varchar(128)  NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_inbox_messages_dedupe UNIQUE (account_id, template_code, reference_type, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_created ON support.inbox_messages (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_unread  ON support.inbox_messages (account_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_tenant          ON support.inbox_messages (tenant_id);

DO $$ BEGIN
  ALTER TABLE support.inbox_messages
    ADD CONSTRAINT fk_inbox_messages_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON support.inbox_messages TO platform_svc;
GRANT SELECT ON support.inbox_messages TO reporting_ro;
REVOKE UPDATE ON support.inbox_messages FROM platform_svc;
GRANT UPDATE (tenant_id, account_id, template_code, title, body, link, reference_type, reference_id, read_at) ON support.inbox_messages TO platform_svc;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM support.inbox_messages;
  RAISE NOTICE '[inbox-messages] table ready, rows=%', n;
END $$;

COMMIT;
