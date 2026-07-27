-- deploy/database/verify/test-delivery.sql — manual C3 test delivery (deploy/scripts/31-test-delivery.sh)
-- Inserts one version-less notification event into provisioning.webhook_deliveries for an
-- already-registered product, reusing an existing seeded account's default workspace as the
-- subject (never fabricates a tenant). Picked up by platform-api's real dispatch job — same
-- signing/HTTP path as a genuine business event, not a stubbed response.
SET vx.product_code = :'product_code';
SET vx.account = :'account';
SET vx.event = :'event';

WITH subject AS (
  SELECT t.id AS tenant_id, w.id AS workspace_id
    FROM account.users u
    JOIN tenancy.tenants t ON t.owner_user_id = u.id
    JOIN tenancy.workspaces w ON w.tenant_id = t.id AND w.is_default
   WHERE u.account = current_setting('vx.account')
   LIMIT 1
), target AS (
  SELECT id AS product_id FROM product.products WHERE product_code = current_setting('vx.product_code')
)
INSERT INTO provisioning.webhook_deliveries
  (id, idempotency_key, provisioning_id, provisioning_version,
   workspace_id, tenant_id, product_id, event_type, payload,
   status, attempts, next_retry_at, created_at)
SELECT gen_random_uuid(),
       'manual-test:' || current_setting('vx.product_code') || ':' || gen_random_uuid(),
       NULL, NULL,
       s.workspace_id, s.tenant_id, tg.product_id, current_setting('vx.event'),
       jsonb_build_object(
         'id', gen_random_uuid(),
         'type', current_setting('vx.event'),
         'occurred_at', extract(epoch from now())::bigint,
         'workspace_id', s.workspace_id,
         'tenant_id', s.tenant_id,
         'application', current_setting('vx.product_code'),
         'data', jsonb_build_object('note', 'db-init test-delivery')
       ),
       'pending', 0, now(), now()
  FROM subject s, target tg
 WHERE EXISTS (SELECT 1 FROM product.product_webhooks pw WHERE pw.product_id = tg.product_id)
RETURNING id;
