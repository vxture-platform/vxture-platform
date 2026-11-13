-- Repair missing customer-opener assignments after identity/capacity preflight.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-13
-- Save psql output as the before/after snapshot. Any full product rolls back all writes.
-- Operators/system actors, inactive memberships and explicit revocations are not inferred.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE metering.subscriptions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE metering.product_seats IN SHARE ROW EXCLUSIVE MODE;

-- ============================================================================
-- Preserve existing assignments as audit evidence before the idempotent repair.
-- ============================================================================
SELECT jsonb_build_object('phase', 'before', 'captured_at', now(),
  'seats', coalesce(jsonb_agg(to_jsonb(ps)), '[]'::jsonb))
FROM metering.product_seats ps
WHERE ps.subscription_id IN (
  SELECT id FROM metering.subscriptions
  WHERE created_by_type = 'customer' AND deleted_at IS NULL
    AND status IN ('active','trialing','expiring','overdue')
);

DO $$
DECLARE
  v_subscription_id uuid;
  v_inserted integer := 0;
BEGIN
  FOR v_subscription_id IN
    SELECT id FROM metering.subscriptions
    WHERE created_by_type = 'customer' AND deleted_at IS NULL
      AND status IN ('active','trialing','expiring','overdue')
    ORDER BY workspace_id, id
  LOOP
    v_inserted := v_inserted + metering.grant_subscription_opener_seats(v_subscription_id);
  END LOOP;
  RAISE NOTICE 'Customer opener seats inserted: %', v_inserted;
END;
$$;

SELECT jsonb_build_object('phase', 'after', 'captured_at', now(),
  'seats', coalesce(jsonb_agg(to_jsonb(ps)), '[]'::jsonb))
FROM metering.product_seats ps
WHERE ps.subscription_id IN (
  SELECT id FROM metering.subscriptions
  WHERE created_by_type = 'customer' AND deleted_at IS NULL
    AND status IN ('active','trialing','expiring','overdue')
);
COMMIT;
