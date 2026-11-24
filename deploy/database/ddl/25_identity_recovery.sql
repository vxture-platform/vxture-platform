-- Customer logout recovery streams and RP durable revocation receipts.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

-- Scope is explicitly provisioned; no client is enabled by this migration.
CREATE TABLE IF NOT EXISTS session.identity_recovery_streams (
  client_id varchar(64) PRIMARY KEY,
  stream_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  issuer varchar(512) NOT NULL,
  realm varchar(16) NOT NULL DEFAULT 'customer' CHECK (realm='customer'),
  environment varchar(16) NOT NULL CHECK (environment IN ('prod','beta','dev')),
  release_channel varchar(16) NOT NULL CHECK (release_channel IN ('stable','beta','canary')),
  logout_uri varchar(512) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  cursor_key text NOT NULL DEFAULT (gen_random_uuid()::text || gen_random_uuid()::text),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allocation updates a locked row in the same transaction as the fact. A
-- PostgreSQL sequence alone would allow a lower position to commit after a snapshot.
CREATE TABLE IF NOT EXISTS session.identity_recovery_events (
  stream_id uuid NOT NULL REFERENCES session.identity_recovery_streams(stream_id),
  sequence bigint NOT NULL,
  event_id uuid NOT NULL,
  sid varchar(64) NOT NULL,
  sub varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (stream_id, sequence),
  UNIQUE (stream_id, event_id)
);

CREATE OR REPLACE FUNCTION session.append_logout_recovery()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stream session.identity_recovery_streams%ROWTYPE;
BEGIN
  -- Record while disabled too: disable/re-enable must never create silent gaps.
  UPDATE session.identity_recovery_streams SET last_sequence=last_sequence+1
   WHERE client_id=NEW.client_id AND release_channel=NEW.release_channel
     AND logout_uri=NEW.logout_uri RETURNING * INTO stream;
  IF FOUND THEN
    INSERT INTO session.identity_recovery_events(stream_id,sequence,event_id,sid,sub,occurred_at)
    VALUES(stream.stream_id,stream.last_sequence,NEW.event_id,NEW.sid,'usr_'||NEW.user_id,NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_logout_recovery
  AFTER INSERT ON session.logout_deliveries
  FOR EACH ROW EXECUTE FUNCTION session.append_logout_recovery();

CREATE OR REPLACE FUNCTION session.guard_recovery_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.client_id,OLD.stream_id,OLD.issuer,OLD.realm,OLD.environment,OLD.release_channel,OLD.logout_uri)
     IS DISTINCT FROM ROW(NEW.client_id,NEW.stream_id,NEW.issuer,NEW.realm,NEW.environment,NEW.release_channel,NEW.logout_uri) THEN
    RAISE EXCEPTION 'Recovery stream scope is immutable; provision a new client for a new scope';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_recovery_scope
  BEFORE UPDATE ON session.identity_recovery_streams
  FOR EACH ROW EXECUTE FUNCTION session.guard_recovery_scope();

-- Local RP authority. No access/refresh token or user profile is persisted here.
-- Standard logout has no logical event id: its irreversible sid is the receipt key.
CREATE TABLE IF NOT EXISTS session.rp_revocation_receipts (
  issuer varchar(512) NOT NULL,
  client_id varchar(64) NOT NULL,
  realm varchar(16) NOT NULL CHECK (realm='customer'),
  environment varchar(16) NOT NULL CHECK (environment IN ('prod','beta','dev')),
  sid varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer,client_id,realm,environment,sid)
);
