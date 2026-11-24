BEGIN;
-- Explicit change receivers, durable work, inbox and monotonic RP barriers.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

-- ============================================================================
-- Immutable endpoint registration is separate from standard OIDC logout.
-- ============================================================================
CREATE TABLE IF NOT EXISTS session.identity_change_receivers (
  stream_id uuid PRIMARY KEY REFERENCES session.identity_change_streams(stream_id),
  receiver_uri varchar(512) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION session.guard_change_receiver()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.stream_id,OLD.receiver_uri) IS DISTINCT FROM ROW(NEW.stream_id,NEW.receiver_uri) THEN
    RAISE EXCEPTION 'Change receiver scope is immutable; provision a new client';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_change_receiver_scope BEFORE UPDATE ON session.identity_change_receivers
  FOR EACH ROW EXECUTE FUNCTION session.guard_change_receiver();

CREATE TABLE IF NOT EXISTS session.identity_change_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES session.identity_change_receivers(stream_id),
  sequence bigint NOT NULL,
  receiver_uri varchar(512) NOT NULL,
  event_payload jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','quarantined')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  retry_until timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  lease_id uuid,
  lease_until timestamptz,
  last_error varchar(64),
  delivered_at timestamptz,
  UNIQUE(stream_id,sequence),
  FOREIGN KEY(stream_id,sequence) REFERENCES session.identity_change_events(stream_id,sequence)
);
CREATE INDEX IF NOT EXISTS idx_identity_change_pending ON session.identity_change_deliveries(available_at,id) WHERE status='pending';
CREATE OR REPLACE FUNCTION session.enqueue_identity_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- Capture even while disabled. Enabling delivery never changes the destination.
  INSERT INTO session.identity_change_deliveries(stream_id,sequence,receiver_uri)
    SELECT NEW.stream_id,NEW.sequence,receiver_uri FROM session.identity_change_receivers WHERE stream_id=NEW.stream_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_change_enqueue AFTER INSERT ON session.identity_change_events
  FOR EACH ROW EXECUTE FUNCTION session.enqueue_identity_change();
REVOKE ALL ON FUNCTION session.enqueue_identity_change() FROM PUBLIC;

-- ============================================================================
-- ACK requires both inbox and invalidation barriers in one transaction.
-- ============================================================================
CREATE TABLE IF NOT EXISTS session.rp_identity_inbox (
  issuer varchar(512) NOT NULL,
  client_id varchar(64) NOT NULL,
  environment varchar(16) NOT NULL CHECK(environment IN ('prod','beta','dev')),
  realm varchar(16) NOT NULL DEFAULT 'customer' CHECK(realm='customer'),
  event_id uuid NOT NULL,
  fact jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(issuer,client_id,environment,realm,event_id)
);
CREATE TABLE IF NOT EXISTS session.rp_identity_versions (
  issuer varchar(512) NOT NULL,
  client_id varchar(64) NOT NULL,
  environment varchar(16) NOT NULL CHECK(environment IN ('prod','beta','dev')),
  realm varchar(16) NOT NULL DEFAULT 'customer' CHECK(realm='customer'),
  kind varchar(16) NOT NULL CHECK(kind IN ('context','access')),
  subject_key varchar(128) NOT NULL,
  sub varchar(128) NOT NULL,
  version bigint NOT NULL CHECK(version>=0),
  PRIMARY KEY(issuer,client_id,environment,realm,kind,subject_key)
);
CREATE OR REPLACE FUNCTION session.notify_identity_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.version>OLD.version THEN
    PERFORM pg_notify('rp_identity_changed',json_build_object('issuer',NEW.issuer,'client_id',NEW.client_id,
      'realm',NEW.realm,'environment',NEW.environment,'kind',NEW.kind,'subject_key',NEW.subject_key,'sub',NEW.sub)::text);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_rp_identity_notify AFTER INSERT OR UPDATE ON session.rp_identity_versions
  FOR EACH ROW EXECUTE FUNCTION session.notify_identity_version();

DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['platform_svc','svc_auth_bff'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('GRANT SELECT ON session.identity_change_receivers TO %I',role_name);
 EXECUTE format('GRANT UPDATE(enabled) ON session.identity_change_receivers TO %I',role_name);
 EXECUTE format('GRANT SELECT,UPDATE ON session.identity_change_deliveries TO %I',role_name);
 END IF; END LOOP;
 FOREACH role_name IN ARRAY ARRAY['platform_svc','svc_console_bff','svc_admin_bff','svc_website_bff'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('GRANT SELECT,INSERT ON session.rp_identity_inbox TO %I',role_name);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON session.rp_identity_versions TO %I',role_name);
 END IF; END LOOP; END; $$;
COMMIT;
