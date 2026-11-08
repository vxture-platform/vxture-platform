-- Customer MFA is physically separate from workforce factor tables.
-- @package @vxture/service-account
-- @layer Domain
-- @category migration
-- @author AI-Generated
-- @date 2026-11-08
BEGIN;
ALTER TABLE account.users ADD COLUMN IF NOT EXISTS email_login_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE credential.user_mfas ADD COLUMN IF NOT EXISTS version uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE credential.user_mfas ADD COLUMN IF NOT EXISTS last_counter bigint NOT NULL DEFAULT -1;
-- Preserve column locks for both the current production role and its replacement.
GRANT UPDATE(email_login_disabled) ON account.users TO platform_svc,svc_auth_bff;
GRANT UPDATE(version,last_counter) ON credential.user_mfas TO platform_svc,svc_auth_bff;
COMMIT;
