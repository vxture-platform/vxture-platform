-- Account security notifications belong to the recipient account, without a tenant.
-- @package @vxture/service-notification
-- @layer Domain
-- @category migration
-- @author AI-Generated
-- @date 2026-11-07
-- Apply with the database owner before rolling out tenantless notification producers.
-- Existing messages retain their tenant and deduplication anchors; no backfill.
BEGIN;
ALTER TABLE support.inbox_messages ALTER COLUMN tenant_id DROP NOT NULL;
-- Allow retry after a completed deployment without dropping the live constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='support.inbox_messages'::regclass
          AND conname='chk_inbox_messages_scope'
    ) THEN
        ALTER TABLE support.inbox_messages
            ADD CONSTRAINT chk_inbox_messages_scope CHECK (tenant_id IS NOT NULL OR (reference_type='security' AND template_code IN ('account.locked','account.unlocked','account.sessions_ended_by_operator','account.password_changed','account.password_reset','account.phone_changed','account.email_changed_old','account.email_changed_new','account.identity_linked','account.identity_unlinked','account.password_login_enabled','account.password_login_disabled','account.session_ended_by_self','account.new_device_signin')));
    END IF;
END;
$$;
COMMIT;
