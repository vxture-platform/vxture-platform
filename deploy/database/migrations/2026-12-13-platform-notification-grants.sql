-- Match the existing clean-install notification writer permissions.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-21
BEGIN;
GRANT USAGE ON SCHEMA support TO svc_platform_api;
GRANT SELECT, INSERT, UPDATE ON support.inbox_messages TO svc_platform_api;
GRANT SELECT, INSERT, UPDATE ON support.notification_logs TO svc_platform_api;
COMMIT;
