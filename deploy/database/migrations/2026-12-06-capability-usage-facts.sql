-- Additive migration for raw infrastructure measurements. No price, pool or data reset.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-10-21
BEGIN;
CREATE TABLE IF NOT EXISTS metering.capability_usage_events (
    id uuid PRIMARY KEY,
    reported_by text NOT NULL CHECK (reported_by = 'runos'),
    source_event_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    product_id uuid NOT NULL,
    call_id text NOT NULL,
    capability_id text NOT NULL,
    metric_key text NOT NULL,
    amount bigint NOT NULL CHECK (amount >= 0),
    unit text NOT NULL,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_capability_usage_source UNIQUE (reported_by, source_event_id),
    CONSTRAINT chk_capability_usage_measure CHECK (
      (metric_key = 'runos.call' AND unit = 'call' AND amount = 1) OR
      (metric_key = 'runos.sandbox_mb_ms' AND unit = 'mb_ms'))
);
CREATE INDEX IF NOT EXISTS idx_capability_usage_workspace ON metering.capability_usage_events (workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_capability_usage_product ON metering.capability_usage_events (product_id, occurred_at);
DO $$ BEGIN
  ALTER TABLE metering.capability_usage_events ADD CONSTRAINT fk_capability_usage_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.capability_usage_events ADD CONSTRAINT fk_capability_usage_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS trg_capability_usage_append_only ON metering.capability_usage_events;
CREATE TRIGGER trg_capability_usage_append_only
  BEFORE UPDATE OR DELETE ON metering.capability_usage_events
  FOR EACH ROW EXECUTE FUNCTION metering.forbid_mutation();
GRANT SELECT, INSERT ON metering.capability_usage_events TO platform_svc, svc_platform_api;
GRANT SELECT ON metering.capability_usage_events TO reporting_ro, svc_console_bff, svc_admin_bff;
REVOKE UPDATE, DELETE ON metering.capability_usage_events FROM platform_svc, svc_platform_api, svc_console_bff, svc_admin_bff;
COMMIT;
