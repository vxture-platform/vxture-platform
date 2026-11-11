-- CoSpace seat capacity correction; production execution requires separate approval.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-11
--
-- Preserve the published Pro/Business capacities (1/5) under the canonical key.
-- Enterprise is contract-only and must not acquire an invented online capacity.
-- This narrowly scoped correction touches locked versions: the guard is disabled
-- only inside this transaction, under a table lock, and restored before commit.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Acquire the same lock required by ALTER TABLE before validating the snapshot.
LOCK TABLE product.plan_components IN ACCESS EXCLUSIVE MODE;
LOCK TABLE product.product_metrics IN SHARE ROW EXCLUSIVE MODE;

-- ============================================================================
-- Preconditions: stop on catalog drift instead of overwriting newer decisions.
-- ============================================================================

DO $$
DECLARE
  matched integer;
  guard "char";
BEGIN
  SELECT tgenabled INTO guard FROM pg_trigger
   WHERE tgrelid = 'product.plan_components'::regclass
     AND tgname = 'trg_plan_component_guard_lock';
  IF guard IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION '[cospace-seat-max] component lock guard is not enabled';
  END IF;

  SELECT count(*) INTO matched
    FROM product.plan_components pc
    JOIN product.products prod ON prod.id = pc.product_id
    JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
    JOIN product.plans pl ON pl.id = pv.plan_id
   WHERE prod.product_code = 'cospace' AND prod.deleted_at IS NULL
     AND pc.component_role = 'primary' AND pv.version_no = 1
     AND ((pl.plan_code = 'cospace-pro' AND pc.tier = 'pro'
           AND coalesce(pc.quota->>'seat.max', pc.quota->>'member.max') = '1')
       OR (pl.plan_code = 'cospace-business' AND pc.tier = 'business'
           AND coalesce(pc.quota->>'seat.max', pc.quota->>'member.max') = '5'))
     AND (NOT (pc.quota ? 'member.max') OR NOT (pc.quota ? 'seat.max')
          OR pc.quota->>'member.max' = pc.quota->>'seat.max');
  IF matched <> 2 THEN
    RAISE EXCEPTION '[cospace-seat-max] expected two known v1 capacities, found %', matched;
  END IF;

  IF EXISTS (
    SELECT 1 FROM product.product_metrics m
    JOIN product.products prod ON prod.id = m.product_id
    WHERE prod.product_code = 'cospace'
      AND m.metric_key IN ('member.max', 'seat.max')
      AND (m.merge_strategy <> 'max' OR m.consume_mode IS NOT NULL
           OR m.reset_period <> 'none' OR m.cost_class IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '[cospace-seat-max] unexpected seat metric configuration';
  END IF;
END $$;

-- ============================================================================
-- Correct only the two verified versions; retain every other quota and feature.
-- ============================================================================

ALTER TABLE product.plan_components DISABLE TRIGGER trg_plan_component_guard_lock;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT pc.id, pl.plan_code, pc.quota->>'member.max' AS old_value
      FROM product.plan_components pc
      JOIN product.products prod ON prod.id = pc.product_id
      JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
      JOIN product.plans pl ON pl.id = pv.plan_id
     WHERE prod.product_code = 'cospace' AND prod.deleted_at IS NULL
       AND pc.component_role = 'primary' AND pv.version_no = 1
       AND pl.plan_code IN ('cospace-pro', 'cospace-business')
       AND pc.quota ? 'member.max'
  LOOP
    RAISE NOTICE '[cospace-seat-max] % component %: member.max=% -> seat.max',
      item.plan_code, item.id, item.old_value;
    UPDATE product.plan_components
       SET quota = (quota - 'member.max')
                   || jsonb_build_object('seat.max', (item.old_value)::integer)
     WHERE id = item.id;
  END LOOP;
END $$;

ALTER TABLE product.plan_components ENABLE TRIGGER trg_plan_component_guard_lock;

INSERT INTO product.product_metrics
  (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period)
SELECT id, 'seat.max', 'max', NULL, 'seats', 'none'
  FROM product.products WHERE product_code = 'cospace' AND deleted_at IS NULL
ON CONFLICT (product_id, metric_key) DO NOTHING;

DELETE FROM product.product_metrics m USING product.products prod
 WHERE m.product_id = prod.id AND prod.product_code = 'cospace'
   AND prod.deleted_at IS NULL AND m.metric_key = 'member.max';

-- ============================================================================
-- Postconditions: no legacy residue; restore the published-version guard.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM product.plan_components pc
    JOIN product.products prod ON prod.id = pc.product_id
    WHERE prod.product_code = 'cospace' AND pc.quota ? 'member.max'
  ) THEN
    RAISE EXCEPTION '[cospace-seat-max] unexpected legacy component remains';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM product.product_metrics m
    JOIN product.products prod ON prod.id = m.product_id
    WHERE prod.product_code = 'cospace' AND m.metric_key = 'seat.max'
      AND m.metric_unit = 'seats' AND m.merge_strategy = 'max'
  ) THEN
    RAISE EXCEPTION '[cospace-seat-max] canonical metric is missing or invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'product.plan_components'::regclass
      AND tgname = 'trg_plan_component_guard_lock' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION '[cospace-seat-max] component lock guard was not restored';
  END IF;
END $$;

COMMIT;
