-- Workbench application favorites, recency and rolling thirty-day launch counts.
-- @package @vxture/bff-workbench
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-10
-- Provision the role password separately and set WORKBENCH_ACTIVITY_DATABASE_URL.
BEGIN;

-- Portal activity uses server timestamps and deduplicates retried launch requests.
CREATE TABLE IF NOT EXISTS account.user_app_launches (
    user_id uuid NOT NULL REFERENCES account.users(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    product_id uuid NOT NULL,
    event_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_app_launches PRIMARY KEY (user_id, tenant_id, workspace_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_user_app_launches_scope_product_time
    ON account.user_app_launches (user_id, tenant_id, workspace_id, product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS account.user_app_views (
    user_id uuid NOT NULL REFERENCES account.users(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    view varchar(16) NOT NULL DEFAULT 'favorites',
    CONSTRAINT pk_user_app_views PRIMARY KEY (user_id, tenant_id, workspace_id),
    CONSTRAINT chk_user_app_views_view CHECK (view IN ('favorites', 'recent', 'frequent'))
);


-- Account activity cross-schema ownership anchors.
DO $$ BEGIN
ALTER TABLE account.user_app_launches ADD CONSTRAINT fk_user_app_launches_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE account.user_app_launches ADD CONSTRAINT fk_user_app_launches_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE account.user_app_launches ADD CONSTRAINT fk_user_app_launches_product
    FOREIGN KEY (product_id) REFERENCES product.products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE account.user_app_views ADD CONSTRAINT fk_user_app_views_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE account.user_app_views ADD CONSTRAINT fk_user_app_views_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Portal favorites/activity writer; deliberately independent of the inbox role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_workbench_activity') THEN
    CREATE ROLE svc_workbench_activity LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_workbench_activity'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
    OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'svc_workbench_activity') THEN
    RAISE EXCEPTION 'svc_workbench_activity must be an isolated unprivileged role';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA account TO svc_workbench_activity;
GRANT SELECT, INSERT, DELETE ON account.user_product_favorites TO svc_workbench_activity;
GRANT SELECT ON account.user_app_launches, account.user_app_views TO svc_workbench_activity;
GRANT INSERT (user_id, tenant_id, workspace_id, product_id, event_id)
    ON account.user_app_launches TO svc_workbench_activity;
GRANT INSERT (user_id, tenant_id, workspace_id, view), UPDATE (view)
    ON account.user_app_views TO svc_workbench_activity;

-- Match baseline column locks without widening the portal writer permissions.
REVOKE UPDATE ON account.user_app_launches FROM platform_svc;
GRANT UPDATE (product_id, occurred_at) ON account.user_app_launches TO platform_svc;
REVOKE UPDATE ON account.user_app_views FROM platform_svc;
GRANT UPDATE (view) ON account.user_app_views TO platform_svc;

COMMIT;
