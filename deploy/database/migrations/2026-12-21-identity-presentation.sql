BEGIN;

-- Session-view fields must invalidate before clients retire periodic refresh.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category database
-- @author AI-Generated
-- @date 2026-11-24

CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON account.users FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('status,deleted_at,deletion_requested_at,account,email,phone');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER UPDATE OR DELETE ON tenancy.tenants FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('status,deleted_at,owner_user_id,type,name,display_name,tenant_no');
CREATE OR REPLACE TRIGGER trg_identity_access
  AFTER INSERT OR UPDATE OR DELETE ON tenancy.workspaces FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_access('tenant_id,status,deleted_at,is_default,name,workspace_no');

-- Project only view metadata: never serialize avatar/logo bytes into an event.
CREATE OR REPLACE FUNCTION session.capture_identity_presentation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous jsonb; current_row jsonb; item jsonb; affected record;
BEGIN
  IF TG_TABLE_SCHEMA='account' THEN
    IF TG_OP<>'INSERT' THEN
      previous:=jsonb_build_object('user_id',OLD.user_id,'name',OLD.display_name,'avatar',OLD.avatar_hash);
    END IF;
    IF TG_OP<>'DELETE' THEN
      current_row:=jsonb_build_object('user_id',NEW.user_id,'name',NEW.display_name,'avatar',NEW.avatar_hash);
    END IF;
  ELSE
    IF TG_OP<>'INSERT' AND OLD.kind='logo' THEN
      previous:=jsonb_build_object('tenant_id',OLD.tenant_id,'hash',OLD.hash);
    END IF;
    IF TG_OP<>'DELETE' AND NEW.kind='logo' THEN
      current_row:=jsonb_build_object('tenant_id',NEW.tenant_id,'hash',NEW.hash);
    END IF;
  END IF;
  IF previous IS NOT DISTINCT FROM current_row THEN RETURN COALESCE(NEW,OLD); END IF;
  FOR item IN
    SELECT DISTINCT jsonb_build_object('user_id',value->'user_id','tenant_id',value->'tenant_id')
    FROM jsonb_array_elements(jsonb_build_array(previous,current_row)) WHERE value<>'null'::jsonb
  LOOP
    IF item->>'user_id' IS NOT NULL THEN
      PERFORM session.record_access_change((item->>'user_id')::uuid,NULL,NULL,NULL);
    ELSE
      FOR affected IN
        SELECT user_id FROM tenancy.tenant_memberships
        WHERE tenant_id=(item->>'tenant_id')::uuid ORDER BY user_id
      LOOP
        PERFORM session.record_access_change(affected.user_id,(item->>'tenant_id')::uuid,NULL,NULL);
      END LOOP;
    END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION session.capture_identity_presentation() FROM PUBLIC;
CREATE OR REPLACE TRIGGER trg_identity_presentation
  AFTER INSERT OR UPDATE OR DELETE ON account.user_profiles FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_presentation();
CREATE OR REPLACE TRIGGER trg_identity_presentation
  AFTER INSERT OR UPDATE OR DELETE ON tenancy.tenant_logos FOR EACH ROW
  EXECUTE FUNCTION session.capture_identity_presentation();

COMMIT;
