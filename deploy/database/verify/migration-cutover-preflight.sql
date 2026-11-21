-- migration-cutover-preflight.sql - Refuse unsafe migration before business DDL.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category deployment-verification
-- @author AI-Generated
-- @date 2026-11-20
-- Identity query for a separately approved read-only inventory:
-- SELECT encode(sha256(convert_to(current_database() || E'\n' ||
--   coalesce(inet_server_addr()::text,'local') || E'\n' ||
--   coalesce(inet_server_port()::text,'local') || E'\n' || current_user,'UTF8')),'hex');
-- Ingress and schedulers must remain stopped through verification; this snapshot
-- cannot prove that an idle connection will never write again.

SELECT set_config('vx.migrate_target', :'target_sha256', false);
SELECT set_config('vx.migrate_quiesced_at', :'quiesced_at', false);
DO $$
DECLARE
  actual text;
  age_seconds numeric;
BEGIN
  actual := encode(sha256(convert_to(current_database() || E'\n' ||
    coalesce(inet_server_addr()::text,'local') || E'\n' ||
    coalesce(inet_server_port()::text,'local') || E'\n' || current_user,'UTF8')),'hex');
  IF current_setting('vx.migrate_target') <> actual THEN
    RAISE EXCEPTION 'MIGRATION_TARGET_MISMATCH';
  END IF;
  age_seconds := extract(epoch from clock_timestamp()) - current_setting('vx.migrate_quiesced_at')::bigint;
  IF age_seconds < 0 OR age_seconds > 3600 THEN
    RAISE EXCEPTION 'MIGRATION_CUTOVER_EVIDENCE_EXPIRED';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    AND NOT pg_has_role(current_user,'pg_read_all_stats','USAGE') THEN
    RAISE EXCEPTION 'MIGRATION_ACTIVITY_VISIBILITY_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
    AND pid<>pg_backend_pid() AND backend_type='client backend'
    AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)) THEN
    RAISE EXCEPTION 'MIGRATION_TRANSACTIONS_NOT_DRAINED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) THEN
    RAISE EXCEPTION 'MIGRATION_PREPARED_TRANSACTIONS_NOT_DRAINED';
  END IF;
END $$;
\echo MIGRATION_PREFLIGHT_OK
