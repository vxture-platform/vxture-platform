-- Preserve first-report attribution without guessing historical identities.
-- @package database
-- @layer Infrastructure
-- @category Migration
-- @author AI-Generated
-- @date 2026-11-15
BEGIN;
ALTER TABLE metering.token_usage_idempotencies
    ADD COLUMN IF NOT EXISTS end_user_id uuid;
REVOKE UPDATE ON metering.token_usage_idempotencies FROM platform_svc;
GRANT UPDATE (token_event_id, token_event_created_at, credits_micro,
    credit_skip_reason, whole_due, usage_event_id)
    ON metering.token_usage_idempotencies TO platform_svc;
COMMIT;
