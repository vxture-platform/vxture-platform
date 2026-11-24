-- Explicit workforce and central Accounts event support.
BEGIN;
-- Explicit workforce facts with isolated subjects and client streams.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

-- ============================================================================
-- Existing customer rows retain their realm; no client is enabled automatically.
-- ============================================================================
ALTER TABLE session.identity_recovery_streams DROP CONSTRAINT IF EXISTS identity_recovery_streams_realm_check;
ALTER TABLE session.identity_recovery_streams ADD CONSTRAINT identity_recovery_streams_realm_check CHECK(realm IN ('customer','workforce'));
ALTER TABLE session.rp_revocation_receipts DROP CONSTRAINT IF EXISTS rp_revocation_receipts_realm_check;
ALTER TABLE session.rp_revocation_receipts ADD CONSTRAINT rp_revocation_receipts_realm_check CHECK(realm IN ('customer','workforce'));
ALTER TABLE session.rp_identity_inbox DROP CONSTRAINT IF EXISTS rp_identity_inbox_realm_check;
ALTER TABLE session.rp_identity_inbox ADD CONSTRAINT rp_identity_inbox_realm_check CHECK(realm IN ('customer','workforce'));
ALTER TABLE session.rp_identity_versions DROP CONSTRAINT IF EXISTS rp_identity_versions_realm_check;
ALTER TABLE session.rp_identity_versions ADD CONSTRAINT rp_identity_versions_realm_check CHECK(realm IN ('customer','workforce'));
ALTER TABLE session.identity_change_outbox ADD COLUMN IF NOT EXISTS realm varchar(16) NOT NULL DEFAULT 'customer' CHECK(realm IN ('customer','workforce'));
ALTER TABLE session.logout_deliveries ADD COLUMN IF NOT EXISTS realm varchar(16) NOT NULL DEFAULT 'customer' CHECK(realm IN ('customer','workforce'));
CREATE TABLE IF NOT EXISTS session.workforce_identity_versions (
  operator_id uuid PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0 CHECK(version>=0)
);

CREATE OR REPLACE FUNCTION session.enqueue_customer_logout()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE logical_event uuid := gen_random_uuid();
BEGIN
  IF OLD.status<>'active' AND NEW.status='active' THEN
    RAISE EXCEPTION 'Ended sessions cannot be reactivated';
  END IF;
  IF OLD.status='active' AND NEW.status IN ('revoked','expired') THEN
    INSERT INTO session.logout_deliveries(event_id,sid,user_id,client_id,release_channel,logout_uri,realm)
    SELECT logical_event,NEW.sid,NEW.user_id,b.client_id,b.release_channel,b.logout_uri,NEW.realm
    FROM session.oidc_session_clients b JOIN appoidc.oidc_clients c ON c.client_id=b.client_id AND c.realm=NEW.realm
    WHERE b.sid=NEW.sid AND b.logout_uri IS NOT NULL ON CONFLICT(sid,client_id) DO NOTHING;
    PERFORM pg_notify('customer_session_logout','');
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION session.append_logout_recovery()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stream session.identity_recovery_streams%ROWTYPE;
BEGIN
  UPDATE session.identity_recovery_streams SET last_sequence=last_sequence+1
  WHERE client_id=NEW.client_id AND realm=NEW.realm AND release_channel=NEW.release_channel AND logout_uri=NEW.logout_uri
  RETURNING * INTO stream;
  IF FOUND THEN
    INSERT INTO session.identity_recovery_events(stream_id,sequence,event_id,sid,sub,occurred_at)
    VALUES(stream.stream_id,stream.last_sequence,NEW.event_id,NEW.sid,
      (CASE WHEN NEW.realm='workforce' THEN 'opr_' ELSE 'usr_' END)||NEW.user_id,NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION session.route_identity_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target record; next_position bigint;
BEGIN
  -- Disabled streams retain changes too. Re-enable cannot silently skip facts.
  FOR target IN
    SELECT DISTINCT r.stream_id FROM session.identity_recovery_streams r
    JOIN session.identity_change_streams stream ON stream.stream_id=r.stream_id
    JOIN session.oidc_session_clients b ON b.client_id=r.client_id
      AND b.release_channel=r.release_channel AND b.logout_uri=r.logout_uri
    JOIN session.auth_sessions s ON s.sid=b.sid
    WHERE s.user_id=NEW.user_id AND s.realm=NEW.realm AND r.realm=NEW.realm AND s.status='active'
      AND s.expires_at>clock_timestamp() AND (NEW.sid IS NULL OR s.sid=NEW.sid)
    ORDER BY r.stream_id
  LOOP
    UPDATE session.identity_change_streams SET last_sequence=last_sequence+1
      WHERE stream_id=target.stream_id RETURNING last_sequence INTO next_position;
    INSERT INTO session.identity_change_events(stream_id,sequence,event_id)
      VALUES(target.stream_id,next_position,NEW.event_id);
  END LOOP;
  -- Delivery workers may use this hint later; the outbox is the durable fact.
  PERFORM pg_notify('identity_fact_changed',NEW.event_id::text);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION session.lock_identity_change_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner_id uuid; owner_realm text;
BEGIN
  SELECT user_id,realm INTO owner_id,owner_realm FROM session.auth_sessions WHERE sid=NEW.sid FOR UPDATE;
  IF owner_realm='customer' THEN
    INSERT INTO session.identity_subject_versions(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM session.identity_subject_versions WHERE user_id=owner_id FOR UPDATE;
  ELSIF owner_realm='workforce' THEN
    INSERT INTO session.workforce_identity_versions(operator_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM session.workforce_identity_versions WHERE operator_id=owner_id FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Workforce policy remains in its own facts; notifications never grant access.
-- ============================================================================
CREATE OR REPLACE FUNCTION session.capture_workforce_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
        new_row jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
        actor uuid; role_ids uuid[]; actors uuid[]; security_change boolean := false; next_version bigint;
BEGIN
  IF TG_TABLE_NAME='operator_account' THEN
    IF TG_OP='UPDATE' AND (old_row - ARRAY['last_login_at','last_login_ip','updated_at','sort','remark','updated_by'])
       IS NOT DISTINCT FROM (new_row - ARRAY['last_login_at','last_login_ip','updated_at','sort','remark','updated_by']) THEN RETURN NEW; END IF;
    actors := ARRAY[COALESCE(new_row->>'id',old_row->>'id')::uuid];
    security_change := TG_OP='DELETE' OR (old_row - ARRAY['display_name','last_login_at','last_login_ip','updated_at','sort','remark','updated_by'])
       IS DISTINCT FROM (new_row - ARRAY['display_name','last_login_at','last_login_ip','updated_at','sort','remark','updated_by']);
  ELSIF TG_TABLE_NAME IN ('operator_credential','operator_mfa','operator_webauthn_credential') THEN
    IF TG_TABLE_NAME='operator_credential' AND TG_OP='UPDATE' AND
      (old_row - ARRAY['failed_attempts','locked_until','updated_at']) IS NOT DISTINCT FROM
      (new_row - ARRAY['failed_attempts','locked_until','updated_at']) THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='operator_webauthn_credential' AND TG_OP='UPDATE' AND
      (old_row - ARRAY['sign_count','last_used_at','updated_at']) IS NOT DISTINCT FROM
      (new_row - ARRAY['sign_count','last_used_at','updated_at']) THEN RETURN NEW; END IF;
    IF old_row IS NOT DISTINCT FROM new_row THEN RETURN NEW; END IF;
    actors := ARRAY[COALESCE(new_row->>'operator_id',old_row->>'operator_id')::uuid];
    security_change := true;
  ELSE
    IF old_row IS NOT DISTINCT FROM new_row THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='operator_role' THEN
      role_ids := ARRAY[COALESCE(new_row->>'id',old_row->>'id')::uuid];
      security_change := true;
    ELSIF TG_TABLE_NAME='operator_role_permission' THEN
      role_ids := ARRAY[(new_row->>'role_id')::uuid,(old_row->>'role_id')::uuid];
    END IF;
    SELECT array_agg(id ORDER BY id) INTO actors FROM admin.operator_account WHERE role_ids IS NULL OR role_id=ANY(role_ids);
  END IF;
  FOREACH actor IN ARRAY COALESCE(actors,'{}'::uuid[]) LOOP
    -- Lock sessions before the subject version, matching authorization binding.
    PERFORM 1 FROM session.auth_sessions WHERE realm='workforce' AND user_id=actor ORDER BY sid FOR UPDATE;
    INSERT INTO session.workforce_identity_versions(operator_id,version) VALUES(actor,1)
      ON CONFLICT(operator_id) DO UPDATE SET version=session.workforce_identity_versions.version+1 RETURNING version INTO next_version;
    INSERT INTO session.identity_change_outbox(type,user_id,realm,version)
      VALUES('identity.access_changed',actor,'workforce',next_version);
    IF security_change THEN
      UPDATE session.auth_sessions SET status='revoked',revoked_at=now()
      WHERE realm='workforce' AND user_id=actor AND status='active';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_account
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_role
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_permission
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_role_permission
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_credential
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_mfa
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
CREATE OR REPLACE TRIGGER trg_workforce_identity AFTER INSERT OR UPDATE OR DELETE ON admin.operator_webauthn_credential
FOR EACH ROW EXECUTE FUNCTION session.capture_workforce_identity();
REVOKE ALL ON FUNCTION session.capture_workforce_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.route_identity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.lock_identity_change_binding() FROM PUBLIC;

-- Central Accounts reads use the same committed facts without an RP binding.
CREATE OR REPLACE FUNCTION session.notify_central_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='auth_sessions' THEN
    IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    PERFORM pg_notify('central_identity_changed',json_build_object('realm',NEW.realm,'sub',NEW.user_id,'sid',NEW.sid)::text);
  ELSE
    PERFORM pg_notify('central_identity_changed',json_build_object('realm',NEW.realm,'sub',NEW.user_id)::text);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_central_identity AFTER INSERT OR UPDATE OF status,active_org_id,active_workspace_id ON session.auth_sessions
FOR EACH ROW EXECUTE FUNCTION session.notify_central_identity();
CREATE OR REPLACE TRIGGER trg_central_identity AFTER INSERT ON session.identity_change_outbox
FOR EACH ROW EXECUTE FUNCTION session.notify_central_identity();
REVOKE ALL ON FUNCTION session.notify_central_identity() FROM PUBLIC;

-- A customer portal binding is access policy, including disabled or reassigned hosts.
CREATE OR REPLACE FUNCTION session.capture_portal_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE tenant uuid; actor uuid; previous jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
        current_row jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
BEGIN
  IF previous IS NOT DISTINCT FROM current_row THEN RETURN NEW; END IF;
  FOR tenant IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(previous->>'tenant_id',current_row->>'tenant_id')) WHERE value IS NOT NULL LOOP
    FOR actor IN SELECT DISTINCT user_id FROM tenancy.tenant_memberships WHERE tenant_id=tenant ORDER BY user_id LOOP
      PERFORM session.record_access_change(actor,tenant,NULL,NULL);
    END LOOP;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE OR REPLACE TRIGGER trg_portal_identity AFTER INSERT OR UPDATE OR DELETE ON tenancy.customer_portals
FOR EACH ROW EXECUTE FUNCTION session.capture_portal_identity();
REVOKE ALL ON FUNCTION session.capture_portal_identity() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_auth_bff') THEN
    GRANT SELECT,INSERT,UPDATE ON session.workforce_identity_versions TO svc_auth_bff;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_svc') THEN
    GRANT SELECT ON session.workforce_identity_versions TO platform_svc;
  END IF;
END $$;
-- Dedicated protocol persistence for independent RPs; no business-table writes.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_rp_identity') THEN
    CREATE ROLE svc_rp_identity LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA session TO svc_rp_identity;
GRANT SELECT,INSERT ON session.rp_revocation_receipts,session.rp_identity_inbox TO svc_rp_identity;
GRANT SELECT,INSERT,UPDATE ON session.rp_identity_versions TO svc_rp_identity;

COMMIT;
