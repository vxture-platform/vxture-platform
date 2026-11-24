-- Customer context/access change capture; provision no clients automatically.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-24
BEGIN;

-- Customer context/access facts, commit-ordered recovery and durable outbox.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

-- ============================================================================
-- Facts are retained even without recipients; zero is the initial version.
-- ============================================================================
CREATE TABLE IF NOT EXISTS session.identity_subject_versions (
  user_id uuid PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE IF NOT EXISTS session.identity_change_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(40) NOT NULL CHECK (type IN ('session.context_changed','identity.access_changed')),
  user_id uuid NOT NULL,
  sid varchar(64),
  version bigint NOT NULL CHECK (version > 0),
  org_id uuid,
  workspace_id uuid,
  product_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((type='session.context_changed' AND sid IS NOT NULL) OR
         (type='identity.access_changed' AND sid IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_identity_change_subject ON session.identity_change_outbox(user_id,version);
-- Explicitly provisioned platform-BFF capability; this does not enable product delivery.
CREATE TABLE IF NOT EXISTS session.identity_change_streams (
  stream_id uuid PRIMARY KEY REFERENCES session.identity_recovery_streams(stream_id),
  enabled boolean NOT NULL DEFAULT false,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);
CREATE TABLE IF NOT EXISTS session.identity_change_events (
  stream_id uuid NOT NULL REFERENCES session.identity_change_streams(stream_id),
  sequence bigint NOT NULL,
  event_id uuid NOT NULL REFERENCES session.identity_change_outbox(event_id),
  PRIMARY KEY(stream_id,sequence),
  UNIQUE(stream_id,event_id)
);

-- ============================================================================
-- Binding and mutations share subject/session locks, closing the first-login gap.
-- ============================================================================
CREATE OR REPLACE FUNCTION session.lock_identity_change_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM session.auth_sessions
   WHERE sid=NEW.sid AND realm='customer' FOR UPDATE;
  IF FOUND THEN
    INSERT INTO session.identity_subject_versions(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM session.identity_subject_versions WHERE user_id=owner_id FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_change_binding
  BEFORE INSERT OR UPDATE ON session.oidc_session_clients
  FOR EACH ROW EXECUTE FUNCTION session.lock_identity_change_binding();

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
    WHERE s.user_id=NEW.user_id AND s.realm='customer' AND s.status='active'
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
CREATE OR REPLACE TRIGGER trg_identity_change_route
  AFTER INSERT ON session.identity_change_outbox
  FOR EACH ROW EXECUTE FUNCTION session.route_identity_change();

CREATE OR REPLACE FUNCTION session.record_access_change(
  affected_user uuid, affected_org uuid, affected_workspace uuid, affected_product uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE next_version bigint;
BEGIN
  INSERT INTO session.identity_subject_versions(user_id,version) VALUES(affected_user,1)
    ON CONFLICT(user_id) DO UPDATE SET version=session.identity_subject_versions.version+1
    RETURNING version INTO next_version;
  INSERT INTO session.identity_change_outbox(type,user_id,version,org_id,workspace_id,product_id)
    VALUES('identity.access_changed',affected_user,next_version,affected_org,affected_workspace,affected_product);
END;
$$;

-- ============================================================================
-- Current context is a pair. Rewriting identical state never advances a version.
-- ============================================================================
CREATE OR REPLACE FUNCTION session.version_identity_context()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.realm='customer' THEN
    IF NEW.active_org_id IS NULL AND NEW.active_workspace_id IS NOT NULL THEN
      RAISE EXCEPTION 'A workspace requires an organization context';
    END IF;
    NEW.context_version := OLD.context_version + CASE WHEN
      ROW(OLD.active_org_id,OLD.active_workspace_id)
      IS DISTINCT FROM ROW(NEW.active_org_id,NEW.active_workspace_id) THEN 1 ELSE 0 END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_context_version
  BEFORE UPDATE OF active_org_id,active_workspace_id,context_version ON session.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION session.version_identity_context();
CREATE OR REPLACE FUNCTION session.record_context_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.realm='customer' AND NEW.status='active' AND NEW.expires_at>clock_timestamp()
     AND NEW.context_version<>OLD.context_version THEN
    INSERT INTO session.identity_change_outbox(type,user_id,sid,version)
      VALUES('session.context_changed',NEW.user_id,NEW.sid,NEW.context_version);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_context_change
  AFTER UPDATE OF active_org_id,active_workspace_id,context_version ON session.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION session.record_context_change();

-- ============================================================================
-- One table boundary covers service, administrator, cascade and direct SQL writes.
-- ============================================================================
CREATE OR REPLACE FUNCTION session.capture_identity_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
        current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
        item jsonb; affected record; old_projection jsonb; new_projection jsonb;
        role_ids uuid[]; target_id uuid; target_org uuid; target_ws uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    SELECT jsonb_object_agg(k,previous->k),jsonb_object_agg(k,current_row->k)
      INTO old_projection,new_projection FROM unnest(string_to_array(TG_ARGV[0],',')) k;
    IF old_projection IS NOT DISTINCT FROM new_projection THEN RETURN NEW; END IF;
  END IF;
  -- Both identities/scopes are invalidated when a row is reassigned.
  FOR item IN SELECT DISTINCT value FROM jsonb_array_elements(jsonb_build_array(previous,current_row))
    WHERE value<>'null'::jsonb
  LOOP
    target_id := (item->>'id')::uuid;
    target_org := (item->>'tenant_id')::uuid;
    target_ws := (item->>'workspace_id')::uuid;
    IF TG_TABLE_NAME IN ('tenant_memberships','workspace_memberships','product_seats') THEN
      PERFORM session.record_access_change((item->>'user_id')::uuid,target_org,target_ws,(item->>'product_id')::uuid);
    ELSIF TG_TABLE_SCHEMA='account' THEN
      PERFORM session.record_access_change(target_id,NULL,NULL,NULL);
    ELSIF TG_TABLE_NAME IN ('roles','role_permissions','permissions') THEN
      IF TG_TABLE_NAME='roles' THEN role_ids:=ARRAY[target_id];
      ELSIF TG_TABLE_NAME='role_permissions' THEN role_ids:=ARRAY[(item->>'role_id')::uuid];
      ELSE SELECT array_agg(role_id) INTO role_ids FROM access.role_permissions WHERE permission_id=target_id;
      END IF;
      FOR affected IN
        SELECT user_id FROM tenancy.tenant_memberships WHERE role_id=ANY(role_ids)
        UNION SELECT user_id FROM tenancy.workspace_memberships WHERE role_id=ANY(role_ids)
        ORDER BY user_id
      LOOP
        PERFORM session.record_access_change(affected.user_id,NULL,NULL,NULL);
      END LOOP;
    ELSE
      IF TG_TABLE_NAME='tenants' THEN target_org:=target_id;
      ELSIF TG_TABLE_NAME='workspaces' THEN target_ws:=target_id;
      END IF;
      FOR affected IN
        SELECT user_id FROM tenancy.tenant_memberships WHERE tenant_id=target_org
        UNION SELECT user_id FROM tenancy.workspace_memberships WHERE workspace_id=target_ws
        UNION SELECT user_id FROM metering.product_seats WHERE workspace_id=target_ws
        ORDER BY user_id
      LOOP
        -- Broad invalidation includes bundled products and changed default contexts.
        PERFORM session.record_access_change(affected.user_id,target_org,target_ws,NULL);
      END LOOP;
    END IF;
    -- Ordinary updates keep their identity/scope: one event suffices, even if data differs.
    IF TG_OP='UPDATE' AND
ROW(previous->>'id',previous->>'user_id',previous->>'tenant_id',previous->>'workspace_id',previous->>'product_id')
       IS NOT DISTINCT FROM
       ROW(current_row->>'id',current_row->>'user_id',current_row->>'tenant_id',current_row->>'workspace_id',current_row->>'product_id')
       AND (TG_TABLE_NAME<>'role_permissions' OR
            ROW(previous->>'role_id',previous->>'permission_id') IS NOT DISTINCT FROM
            ROW(current_row->>'role_id',current_row->>'permission_id')) THEN EXIT;
    END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON tenancy.tenant_memberships FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('user_id,tenant_id,role_id,role_scope,status,is_default,default_workspace_id');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON tenancy.workspace_memberships FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('user_id,tenant_id,workspace_id,role_id,role_scope,status');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON metering.product_seats FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('user_id,workspace_id,product_id,subscription_id,revoked_at');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON account.users FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('status,deleted_at,deletion_requested_at');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON tenancy.tenants FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('status,deleted_at,owner_user_id,type');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON tenancy.workspaces FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('tenant_id,status,deleted_at,is_default');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON access.roles FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('status,role_code,scope');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON access.role_permissions FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('role_id,permission_id');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON access.permissions FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('is_active,perm_code,is_customer_visible');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON metering.subscriptions FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('tenant_id,workspace_id,product_id,plan_version_id,status,deleted_at,start_at,end_at,trial_end_at,subscription_kind');

-- Runtime writers invoke triggers, never this privileged mutation API directly.
REVOKE ALL ON FUNCTION session.record_access_change(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session.capture_identity_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.route_identity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.record_context_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.lock_identity_change_binding() FROM PUBLIC;

-- Existing schema access is required; only the auth reader needs these new tables.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['platform_svc','svc_auth_bff'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT ON session.identity_subject_versions,session.identity_change_outbox,session.identity_change_streams,session.identity_change_events TO %I',role_name);
    END IF;
  END LOOP;
END;
$$;
COMMIT;
