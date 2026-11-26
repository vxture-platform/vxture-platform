-- deploy/database/verify/test-delivery.sql — manual C3 test delivery (deploy/scripts/31-test-delivery.sh)
-- Enqueues one version-less notification for the platform-api dispatcher. Resolve
-- the specified workspace under the test account, or require a unique default.
\if :{?workspace_id}
\else
\set workspace_id ''
\endif
SET vx.product_code = :'product_code';
SET vx.account = :'account';
SET vx.event = :'event';
SET vx.workspace_id = :'workspace_id';

WITH subject AS (
  SELECT t.id AS tenant_id, w.id AS workspace_id
    FROM account.users u
    JOIN tenancy.tenants t ON t.owner_user_id = u.id
    JOIN tenancy.workspaces w ON w.tenant_id = t.id
   WHERE u.account = current_setting('vx.account')
     AND u.status = 'active' AND u.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
     AND w.status = 'active' AND w.deleted_at IS NULL
     AND CASE WHEN current_setting('vx.workspace_id') = '' THEN w.is_default
              ELSE w.id::text = lower(current_setting('vx.workspace_id'))
         END
), target AS (
  SELECT p.id AS product_id
    FROM product.products p
    JOIN product.product_webhooks hook ON hook.product_id = p.id
   WHERE p.product_code = current_setting('vx.product_code') AND p.deleted_at IS NULL
     AND nullif(btrim(hook.webhook_url), '') IS NOT NULL
     AND (nullif(btrim(hook.webhook_secret_enc), '') IS NOT NULL
          OR nullif(btrim(hook.webhook_secret_ref), '') IS NOT NULL)
), delivery AS (
  SELECT gen_random_uuid() AS id
)
INSERT INTO provisioning.webhook_deliveries
  (id, idempotency_key, provisioning_id, provisioning_version,
   workspace_id, tenant_id, product_id, event_type, payload,
   status, attempts, next_retry_at, created_at)
SELECT d.id,
       'manual-test:' || s.workspace_id || ':' || d.id,
       NULL, NULL,
       s.workspace_id, s.tenant_id, tg.product_id, current_setting('vx.event'),
       jsonb_build_object(
         'id', d.id,
         'type', current_setting('vx.event'),
         'occurred_at', extract(epoch from now())::bigint,
         'workspace_id', s.workspace_id,
         'tenant_id', s.tenant_id,
         'application', current_setting('vx.product_code'),
         'data', jsonb_build_object('note', 'db-init test-delivery')
       ),
       'pending', 0, now(), now()
  FROM subject s CROSS JOIN target tg CROSS JOIN delivery d
 WHERE (SELECT count(*) FROM subject) = 1
RETURNING id;
