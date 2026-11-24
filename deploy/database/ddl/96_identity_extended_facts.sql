-- Commerce configuration and scheduled time boundaries emit identity invalidations.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category schema
-- @author AI-Generated
-- @date 2026-11-24

-- ============================================================================
-- Broad workspace invalidation includes primary and bundled entitlements.
-- ============================================================================
CREATE OR REPLACE FUNCTION session.record_workspace_access(affected_org uuid, affected_workspace uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE member record;
BEGIN
  FOR member IN
    SELECT user_id FROM tenancy.tenant_memberships WHERE tenant_id=affected_org
    UNION SELECT user_id FROM tenancy.workspace_memberships WHERE workspace_id=affected_workspace
    UNION SELECT user_id FROM metering.product_seats WHERE workspace_id=affected_workspace
    ORDER BY user_id
  LOOP
    PERFORM session.record_access_change(member.user_id,affected_org,affected_workspace,NULL);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION session.capture_commerce_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  old_projection jsonb; new_projection jsonb; affected record; ids uuid[];
BEGIN
  IF TG_OP='UPDATE' THEN
    SELECT jsonb_object_agg(k,previous->k),jsonb_object_agg(k,current_row->k)
      INTO old_projection,new_projection FROM unnest(string_to_array(TG_ARGV[0],',')) k;
    IF old_projection IS NOT DISTINCT FROM new_projection THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='subscription_entitlement_overrides' THEN
    ids:=ARRAY[(previous->>'subscription_id')::uuid,(current_row->>'subscription_id')::uuid];
  ELSE
    ids:=ARRAY[(previous->>'id')::uuid,(current_row->>'id')::uuid];
  END IF;
  FOR affected IN
    SELECT DISTINCT s.tenant_id,s.workspace_id FROM metering.subscriptions s
    WHERE (TG_TABLE_NAME='subscription_entitlement_overrides' AND s.id=ANY(ids))
      OR (TG_TABLE_NAME='products' AND (s.product_id=ANY(ids) OR EXISTS(
        SELECT 1 FROM product.plan_components p WHERE p.plan_version_id=s.plan_version_id AND p.product_id=ANY(ids))))
      OR (TG_TABLE_NAME='plan_versions' AND s.plan_version_id=ANY(ids))
      OR (TG_TABLE_NAME='plans' AND s.plan_version_id IN (SELECT id FROM product.plan_versions WHERE plan_id=ANY(ids)))
      OR (TG_TABLE_NAME='plan_components' AND s.plan_version_id IN ((previous->>'plan_version_id')::uuid,(current_row->>'plan_version_id')::uuid))
    ORDER BY s.tenant_id,s.workspace_id
  LOOP
    PERFORM session.record_workspace_access(affected.tenant_id,affected.workspace_id);
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_commerce AFTER INSERT OR UPDATE OR DELETE ON metering.subscription_entitlement_overrides
  FOR EACH ROW EXECUTE FUNCTION session.capture_commerce_identity('subscription_id,product_id,override_tier_code,expires_at');
CREATE OR REPLACE TRIGGER trg_identity_commerce AFTER UPDATE OR DELETE ON product.products
  FOR EACH ROW EXECUTE FUNCTION session.capture_commerce_identity('status,deleted_at,capability_keys,config,is_customer_visible,maintenance_window_id,maintenance_until,integration_mode');
CREATE OR REPLACE TRIGGER trg_identity_commerce AFTER UPDATE OR DELETE ON product.plans
  FOR EACH ROW EXECUTE FUNCTION session.capture_commerce_identity('status,deleted_at,current_version_id,is_customer_visible');
CREATE OR REPLACE TRIGGER trg_identity_commerce AFTER UPDATE OR DELETE ON product.plan_versions
  FOR EACH ROW EXECUTE FUNCTION session.capture_commerce_identity('plan_id,status,is_locked');
CREATE OR REPLACE TRIGGER trg_identity_commerce AFTER INSERT OR UPDATE OR DELETE ON product.plan_components
  FOR EACH ROW EXECUTE FUNCTION session.capture_commerce_identity('plan_version_id,product_id,tier,component_role,features,quota,priority');

-- ============================================================================
-- A durable due queue handles time passage without clients polling identity.
-- It emits hints, never changes subscription status or grants entitlement.
-- ============================================================================
CREATE TABLE IF NOT EXISTS session.identity_time_boundaries (
  source varchar(16) NOT NULL CHECK(source IN ('subscription','override')),
  source_id uuid NOT NULL,
  edge varchar(16) NOT NULL,
  due_at timestamptz NOT NULL,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  emitted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(source,source_id,edge)
);
CREATE INDEX IF NOT EXISTS idx_identity_time_due ON session.identity_time_boundaries(due_at) WHERE NOT emitted;
CREATE OR REPLACE FUNCTION session.schedule_identity_boundaries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source_name text := CASE WHEN TG_TABLE_NAME='subscriptions' THEN 'subscription' ELSE 'override' END;
  row_data jsonb; edge_name text; due timestamptz; org uuid; workspace uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM session.identity_time_boundaries WHERE source=source_name AND source_id=OLD.id;
    RETURN OLD;
  END IF;
  row_data:=to_jsonb(NEW);
  IF source_name='subscription' THEN
    org:=NEW.tenant_id; workspace:=NEW.workspace_id;
  ELSE
    SELECT tenant_id,workspace_id INTO org,workspace FROM metering.subscriptions WHERE id=NEW.subscription_id;
  END IF;
  FOREACH edge_name IN ARRAY CASE WHEN source_name='subscription' THEN ARRAY['start_at','end_at','trial_end_at'] ELSE ARRAY['expires_at'] END LOOP
    due:=(row_data->>edge_name)::timestamptz;
    IF due IS NULL OR org IS NULL THEN
      DELETE FROM session.identity_time_boundaries WHERE source=source_name AND source_id=NEW.id AND edge=edge_name;
    ELSE
      INSERT INTO session.identity_time_boundaries(source,source_id,edge,due_at,tenant_id,workspace_id)
        VALUES(source_name,NEW.id,edge_name,due,org,workspace)
      ON CONFLICT(source,source_id,edge) DO UPDATE SET due_at=excluded.due_at,tenant_id=excluded.tenant_id,
        workspace_id=excluded.workspace_id,emitted=false
      WHERE ROW(session.identity_time_boundaries.due_at,session.identity_time_boundaries.tenant_id,session.identity_time_boundaries.workspace_id)
        IS DISTINCT FROM ROW(excluded.due_at,excluded.tenant_id,excluded.workspace_id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_identity_schedule AFTER INSERT OR UPDATE OR DELETE ON metering.subscriptions
  FOR EACH ROW EXECUTE FUNCTION session.schedule_identity_boundaries();
CREATE OR REPLACE TRIGGER trg_identity_schedule AFTER INSERT OR UPDATE OR DELETE ON metering.subscription_entitlement_overrides
  FOR EACH ROW EXECUTE FUNCTION session.schedule_identity_boundaries();

CREATE OR REPLACE FUNCTION session.emit_due_identity_boundaries()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE boundary record; total integer:=0;
BEGIN
  FOR boundary IN SELECT * FROM session.identity_time_boundaries WHERE NOT emitted AND due_at<=clock_timestamp()
    ORDER BY due_at,source,source_id,edge FOR UPDATE SKIP LOCKED LIMIT 100
  LOOP
    PERFORM session.record_workspace_access(boundary.tenant_id,boundary.workspace_id);
    UPDATE session.identity_time_boundaries SET emitted=true WHERE source=boundary.source AND source_id=boundary.source_id AND edge=boundary.edge;
    total:=total+1;
  END LOOP;
  RETURN total;
END;
$$;

-- Backfill future boundaries only; already elapsed facts are read by snapshots.
INSERT INTO session.identity_time_boundaries(source,source_id,edge,due_at,tenant_id,workspace_id)
SELECT 'subscription',s.id,e.edge,e.due_at,s.tenant_id,s.workspace_id FROM metering.subscriptions s
CROSS JOIN LATERAL (VALUES ('start_at',s.start_at),('end_at',s.end_at),('trial_end_at',s.trial_end_at)) e(edge,due_at)
WHERE e.due_at>now() ON CONFLICT DO NOTHING;
INSERT INTO session.identity_time_boundaries(source,source_id,edge,due_at,tenant_id,workspace_id)
SELECT 'override',o.id,'expires_at',o.expires_at,s.tenant_id,s.workspace_id
FROM metering.subscription_entitlement_overrides o JOIN metering.subscriptions s ON s.id=o.subscription_id
WHERE o.expires_at>now() ON CONFLICT DO NOTHING;

REVOKE ALL ON FUNCTION session.record_workspace_access(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session.capture_commerce_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.schedule_identity_boundaries() FROM PUBLIC;
REVOKE ALL ON FUNCTION session.emit_due_identity_boundaries() FROM PUBLIC;
