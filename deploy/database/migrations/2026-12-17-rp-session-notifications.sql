-- Add commit-time wake-up hints without changing the durable receipt contract.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-24

BEGIN;

-- NOTIFY is a wake-up hint. Durable receipts remain the source of truth.
CREATE OR REPLACE FUNCTION session.notify_rp_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('rp_session_revoked', json_build_object(
    'issuer',NEW.issuer,'client_id',NEW.client_id,'realm',NEW.realm,
    'environment',NEW.environment,'sid',NEW.sid
  )::text);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_rp_revocation_notify
  AFTER INSERT ON session.rp_revocation_receipts
  FOR EACH ROW EXECUTE FUNCTION session.notify_rp_revocation();

COMMIT;
