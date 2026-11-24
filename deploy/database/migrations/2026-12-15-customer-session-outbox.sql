-- Durable customer session context, RP bindings and transactional logout delivery.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-24

BEGIN;

ALTER TABLE session.auth_sessions
  ADD COLUMN IF NOT EXISTS active_org_id uuid,
  ADD COLUMN IF NOT EXISTS active_workspace_id uuid,
  ADD COLUMN IF NOT EXISTS context_version bigint NOT NULL DEFAULT 0;

-- Customer-only bindings survive Redis eviction and central revocation.
CREATE TABLE IF NOT EXISTS session.oidc_session_clients (
  sid varchar(64) NOT NULL REFERENCES session.auth_sessions(sid),
  client_id varchar(64) NOT NULL,
  release_channel varchar(16) NOT NULL CHECK (release_channel IN ('stable','beta','canary')),
  logout_uri varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sid, client_id)
);

-- The same immutable logical event is signed afresh for each delivery attempt.
CREATE TABLE IF NOT EXISTS session.logout_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  sid varchar(64) NOT NULL REFERENCES session.auth_sessions(sid),
  user_id uuid NOT NULL,
  client_id varchar(64) NOT NULL,
  release_channel varchar(16) NOT NULL CHECK (release_channel IN ('stable','beta','canary')),
  logout_uri varchar(512) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  retry_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  lease_id uuid,
  lease_until timestamptz,
  last_error varchar(48),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sid, client_id)
);
CREATE INDEX IF NOT EXISTS idx_logout_deliveries_pending
  ON session.logout_deliveries(available_at) WHERE status='pending';

-- Every revocation writer (including account security transactions) uses this
-- boundary. Notification is only a wake-up hint; the table is the durable queue.
CREATE OR REPLACE FUNCTION session.enqueue_customer_logout()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE logical_event uuid := gen_random_uuid();
BEGIN
  IF OLD.realm='customer' AND OLD.status<>'active' AND NEW.status='active' THEN
    RAISE EXCEPTION 'Ended customer sessions cannot be reactivated';
  END IF;
  IF NEW.realm = 'customer' AND OLD.status = 'active'
     AND NEW.status IN ('revoked','expired') THEN
    INSERT INTO session.logout_deliveries
      (event_id, sid, user_id, client_id, release_channel, logout_uri)
    SELECT logical_event, NEW.sid, NEW.user_id, b.client_id, b.release_channel, b.logout_uri
      FROM session.oidc_session_clients b
     WHERE b.sid=NEW.sid AND b.logout_uri IS NOT NULL
    ON CONFLICT (sid,client_id) DO NOTHING;
    PERFORM pg_notify('customer_session_logout', '');
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_customer_session_logout
  AFTER UPDATE OF status ON session.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION session.enqueue_customer_logout();

-- Refresh records prove a historic client binding; never revive session state.
-- Redis-only/code-only bindings require reauthorization during rollout.
INSERT INTO session.oidc_session_clients(sid,client_id,release_channel,logout_uri)
SELECT DISTINCT s.sid,c.client_id,c.release_channel,
       CASE WHEN c.slo_participation='back_channel' THEN c.back_channel_logout_uri END
  FROM session.auth_sessions s
  JOIN session.refresh_tokens r ON r.session_id::text=s.sid AND r.user_id=s.user_id
  JOIN appoidc.oidc_clients c ON c.client_id=r.client_id AND c.realm='customer'
 WHERE s.realm='customer' AND s.status='active' AND s.expires_at>now()
   AND c.status='active'
ON CONFLICT (sid,client_id) DO NOTHING;

-- Existing roles already have session DML; explicitly cover upgraded databases.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['platform_svc','svc_auth_bff','svc_console_bff','svc_admin_bff','svc_website_bff'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON session.oidc_session_clients,session.logout_deliveries TO %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_svc') THEN
    -- The shared role has column-level UPDATE grants; table additions do not
    -- inherit them. Context version remains governed by the change trigger.
    GRANT UPDATE(active_org_id,active_workspace_id,context_version)
      ON session.auth_sessions TO platform_svc;
  END IF;
END;
$$;

COMMIT;
