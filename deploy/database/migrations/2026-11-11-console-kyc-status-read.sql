-- Allow Console to read personal identity status without identity documents.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-11
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
GRANT USAGE ON SCHEMA kyc TO svc_console_bff;
GRANT SELECT (user_id, status) ON kyc.user_kycs TO svc_console_bff;
COMMIT;
