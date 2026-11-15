/**
 * Customer portal bindings, published snapshots and scoped raster assets.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category migration
 * @author AI-Generated
 * @date 2026-11-15
 */
BEGIN;

CREATE TABLE IF NOT EXISTS tenancy.customer_portals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL UNIQUE,
    hostname varchar(74) NOT NULL UNIQUE CHECK (hostname ~ '^(a|[a-z][a-z0-9]{2,7})\.ruyin\.work$'),
    workspace_id uuid NOT NULL,
    self_service boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
    published_version_id uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL,
    updated_surface text NOT NULL CHECK (updated_surface IN ('admin', 'console')),
    FOREIGN KEY (workspace_id, tenant_id) REFERENCES tenancy.workspaces (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS tenancy.customer_portal_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id uuid NOT NULL REFERENCES tenancy.customer_portals (id),
    version integer NOT NULL CHECK (version > 0),
    configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    note text NOT NULL,
    submitted_by uuid NOT NULL,
    submitted_surface text NOT NULL CHECK (submitted_surface IN ('admin', 'console')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    review_note text,
    reviewed_by uuid,
    reviewed_at timestamptz,
    UNIQUE (portal_id, version),
    UNIQUE (portal_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_pending_version ON tenancy.customer_portal_versions (portal_id) WHERE status = 'pending';
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_constraint WHERE conrelid='tenancy.customer_portals'::regclass
        AND conname='customer_portal_published_binding'
    ) THEN
        ALTER TABLE tenancy.customer_portals ADD CONSTRAINT customer_portal_published_binding
            FOREIGN KEY (id, published_version_id) REFERENCES tenancy.customer_portal_versions (portal_id, id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenancy.customer_portal_assets (
    portal_id uuid NOT NULL REFERENCES tenancy.customer_portals (id),
    hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
    mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
    bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 12 AND 2097152),
    PRIMARY KEY (portal_id, hash)
);
CREATE TABLE IF NOT EXISTS tenancy.customer_portal_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id uuid NOT NULL REFERENCES tenancy.customer_portals (id),
    actor_id uuid NOT NULL,
    surface text NOT NULL CHECK (surface IN ('admin', 'console')),
    action text NOT NULL,
    version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (portal_id, version_id) REFERENCES tenancy.customer_portal_versions (portal_id, id)
);

-- ===========================================================================
-- Read-only runtime role and immutable snapshot data
-- ===========================================================================
CREATE OR REPLACE FUNCTION tenancy.guard_customer_portal_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_TABLE_NAME <> 'customer_portal_versions' THEN
        RAISE EXCEPTION 'Customer portal records are append-only';
    END IF;
    IF OLD.status <> 'pending' OR NEW.status = 'pending' OR
       (to_jsonb(OLD) - ARRAY['status','review_note','reviewed_by','reviewed_at']) IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY['status','review_note','reviewed_by','reviewed_at']) THEN
        RAISE EXCEPTION 'Submitted customer portal snapshots cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;
DO $$
DECLARE entry record;
BEGIN
    FOR entry IN SELECT * FROM (VALUES
        ('customer_portal_versions', 'customer_portal_versions_immutable'),
        ('customer_portal_assets', 'customer_portal_assets_immutable'),
        ('customer_portal_events', 'customer_portal_events_immutable')
    ) AS entries(table_name, trigger_name) LOOP
        IF NOT EXISTS (
            SELECT FROM pg_trigger WHERE tgrelid=format('tenancy.%I', entry.table_name)::regclass
            AND tgname=entry.trigger_name AND NOT tgisinternal
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenancy.%I FOR EACH ROW EXECUTE FUNCTION tenancy.guard_customer_portal_snapshot()',
                entry.trigger_name, entry.table_name
            );
        END IF;
    END LOOP;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_customer_portal') THEN
        CREATE ROLE svc_customer_portal LOGIN;
    END IF;
END $$;
GRANT USAGE ON SCHEMA tenancy, account, metering, product TO svc_customer_portal;
GRANT SELECT (id, tenant_id, workspace_id, hostname, enabled, published_version_id)
    ON tenancy.customer_portals TO svc_customer_portal;
GRANT SELECT (id, portal_id, configuration, status) ON tenancy.customer_portal_versions TO svc_customer_portal;
GRANT SELECT (portal_id, hash, mime, bytes) ON tenancy.customer_portal_assets TO svc_customer_portal;
GRANT SELECT (id, type, status, deleted_at) ON tenancy.tenants TO svc_customer_portal;
GRANT SELECT (id, tenant_id, name, status, deleted_at) ON tenancy.workspaces TO svc_customer_portal;
GRANT SELECT (tenant_id, user_id, status) ON tenancy.tenant_memberships TO svc_customer_portal;
GRANT SELECT (workspace_id, tenant_id, user_id, status) ON tenancy.workspace_memberships TO svc_customer_portal;
GRANT SELECT (id, account, status, deleted_at) ON account.users TO svc_customer_portal;
GRANT SELECT (user_id, display_name) ON account.user_profiles TO svc_customer_portal;
GRANT SELECT (workspace_id, tenant_id, plan_version_id, deleted_at, status, start_at, end_at, trial_end_at)
    ON metering.subscriptions TO svc_customer_portal;
GRANT SELECT (plan_version_id, component_role, product_id) ON product.plan_components TO svc_customer_portal;
GRANT SELECT (id, product_code, product_name, description, deleted_at, is_customer_visible, status) ON product.products TO svc_customer_portal;
GRANT SELECT (product_id, home_url) ON product.product_webhooks TO svc_customer_portal;

COMMIT;
