-- Install transactional customer-opener seat grants. Existing seats are unchanged.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-13
-- No historical backfill: verify original customer identity and capacity separately.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- BEGIN SUBSCRIPTION OPENER SEATS
CREATE OR REPLACE FUNCTION metering.grant_subscription_opener_seats(
  p_subscription_id uuid, p_require_member boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_subscription metering.subscriptions%ROWTYPE;
  v_product_id uuid;
  v_inserted integer;
  v_total integer := 0;
BEGIN
  SELECT * INTO v_subscription FROM metering.subscriptions
   WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.deleted_at IS NOT NULL
     OR v_subscription.status NOT IN ('active','trialing','expiring','overdue')
     OR v_subscription.created_by_type <> 'customer' THEN
    RETURN 0;
  END IF;

  -- An operator/system actor is never reinterpreted as an end user or tenant owner.
  IF v_subscription.created_by_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM account.users u
    JOIN tenancy.tenant_memberships tm ON tm.user_id = u.id
    JOIN tenancy.tenants t ON t.id = tm.tenant_id
    JOIN tenancy.workspaces w ON w.tenant_id = t.id
    JOIN tenancy.workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = u.id
    WHERE u.id = v_subscription.created_by_id AND u.status = 'active' AND u.deleted_at IS NULL
      AND tm.tenant_id = v_subscription.tenant_id AND tm.status = 'active'
      AND t.status = 'active' AND t.deleted_at IS NULL
      AND w.id = v_subscription.workspace_id AND w.status = 'active' AND w.deleted_at IS NULL
      AND wm.status = 'active'
  ) THEN
    IF p_require_member THEN
      RAISE EXCEPTION 'subscription opener must be an active member of its tenant and workspace'
        USING ERRCODE = 'VX403';
    END IF;
    -- A departed original purchaser must not prevent the organization's renewal.
    RETURN 0;
  END IF;

  -- Match the existing seat writer's component coverage and lock order.
  FOR v_product_id IN
    SELECT DISTINCT pc.product_id FROM product.plan_components pc
    JOIN product.products p ON p.id = pc.product_id AND p.deleted_at IS NULL
    WHERE pc.plan_version_id = v_subscription.plan_version_id ORDER BY pc.product_id
  LOOP
    -- Keep deliberate revocations; retries must not undo an administrator's decision.
    IF EXISTS (SELECT 1 FROM metering.product_seats
      WHERE workspace_id = v_subscription.workspace_id AND product_id = v_product_id
        AND user_id = v_subscription.created_by_id AND revoked_by IS NOT NULL
        AND subscription_id = v_subscription.id) THEN
      CONTINUE;
    END IF;
    INSERT INTO metering.product_seats
      (workspace_id, user_id, product_id, subscription_id, granted_by)
    VALUES (v_subscription.workspace_id, v_subscription.created_by_id,
            v_product_id, v_subscription.id, NULL)
    ON CONFLICT (workspace_id, product_id, user_id) WHERE revoked_at IS NULL DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total := v_total + v_inserted;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION metering.auto_grant_subscription_opener_seats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.plan_version_id IS NOT DISTINCT FROM NEW.plan_version_id
       AND OLD.status IN ('active','trialing','expiring','overdue') THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM metering.grant_subscription_opener_seats(NEW.id, TG_OP = 'INSERT');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_grant_opener_seats ON metering.subscriptions;
CREATE TRIGGER trg_subscriptions_grant_opener_seats
  AFTER INSERT OR UPDATE OF status, plan_version_id ON metering.subscriptions
  FOR EACH ROW EXECUTE FUNCTION metering.auto_grant_subscription_opener_seats();
-- END SUBSCRIPTION OPENER SEATS
COMMIT;

