-- Align only the reviewed legacy monthly partitions with the UTC DDL boundaries.
-- @package vxture-platform
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-21
-- Requires the real migration channel and a separately approved stopped-write window.
-- Logical audit/usage rows are immutable: maintenance may change only physical routing.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

-- ===========================================================================
-- Refuse standalone execution, stale evidence and unreviewed dependencies.
-- ===========================================================================
DO $repair$
DECLARE
  spec record;
  child record;
  parent_id oid;
  parent_trigger oid;
  month_start date;
  child_name text;
  actual_bound text;
  utc_bound text;
  legacy_bound text;
  changed integer := 0;
  before_count bigint;
  after_count bigint;
  before_hash text;
  after_hash text;
  moved bigint;
  total_moved bigint := 0;
  fk_definition text;
  fk_id oid;
  target text;
  age_seconds numeric;
BEGIN
  target := encode(sha256(convert_to(current_database() || E'\n' ||
    coalesce(inet_server_addr()::text,'local') || E'\n' ||
    coalesce(inet_server_port()::text,'local') || E'\n' || current_user,'UTF8')),'hex');
  IF current_setting('vx.migrate_target',true) IS DISTINCT FROM target
    OR NOT EXISTS (SELECT FROM pg_locks WHERE locktype='advisory'
      AND pid=pg_backend_pid() AND classid=742138660 AND objid=1
      AND objsubid=2 AND granted AND mode='ExclusiveLock') THEN
    RAISE EXCEPTION 'PARTITION_REPAIR_MIGRATION_CHANNEL_REQUIRED';
  END IF;
  age_seconds := extract(epoch FROM clock_timestamp()) -
    nullif(current_setting('vx.migrate_quiesced_at',true),'')::bigint;
  IF age_seconds IS NULL OR age_seconds < 0 OR age_seconds > 3600 THEN
    RAISE EXCEPTION 'PARTITION_REPAIR_CUTOVER_EVIDENCE_EXPIRED';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    AND NOT pg_has_role(current_user,'pg_read_all_stats','USAGE') THEN
    RAISE EXCEPTION 'PARTITION_REPAIR_ACTIVITY_VISIBILITY_REQUIRED';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND backend_type='client backend'
      AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL))
    OR EXISTS (SELECT FROM pg_prepared_xacts WHERE database=current_database()) THEN
    RAISE EXCEPTION 'PARTITION_REPAIR_TRANSACTIONS_NOT_DRAINED';
  END IF;

  LOCK TABLE metering.usage_events, metering.usage_event_pools,
    support.audit_logs IN ACCESS EXCLUSIVE MODE;

  CREATE TEMP TABLE vx_partition_repair_parents (
    schema_name text, table_name text, key_name text, trigger_name text,
    guard_name text, parent_id oid, before_count bigint, before_hash text
  ) ON COMMIT DROP;
  CREATE TEMP TABLE vx_partition_repair_children (
    parent_id oid, child_id oid, schema_name text, child_name text,
    from_date date, is_default boolean
  ) ON COMMIT DROP;

  FOR spec IN SELECT * FROM (VALUES
    ('metering','usage_events','created_at','trg_usage_events_append_only','metering.forbid_mutation()'),
    ('metering','usage_event_pools','event_created_at','trg_usage_event_pools_append_only','metering.forbid_mutation()'),
    ('support','audit_logs','created_at','trg_audit_logs_append_only','support.forbid_mutation()')
  ) AS v(schema_name,table_name,key_name,trigger_name,guard_name) LOOP
    parent_id := to_regclass(format('%I.%I',spec.schema_name,spec.table_name));
    IF parent_id IS NULL OR NOT EXISTS (SELECT FROM pg_class c WHERE c.oid=parent_id
        AND c.relkind='p' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
        AND pg_get_partkeydef(c.oid)=format('RANGE (%I)',spec.key_name))
      OR EXISTS (SELECT FROM pg_attribute WHERE attrelid=parent_id AND attnum>0
        AND NOT attisdropped AND (attgenerated<>'' OR attidentity<>'')) THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_PARENT_DRIFT: %.%',spec.schema_name,spec.table_name;
    END IF;
    SELECT oid INTO parent_trigger FROM pg_trigger WHERE tgrelid=parent_id
      AND tgname=spec.trigger_name AND NOT tgisinternal AND tgtype=27
      AND tgenabled='O' AND tgfoid=to_regprocedure(spec.guard_name)
      AND tgqual IS NULL AND tgnargs=0;
    IF parent_trigger IS NULL OR (SELECT count(*) FROM pg_trigger
        WHERE tgrelid=parent_id AND NOT tgisinternal)<>1 THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_TRIGGER_DRIFT';
    END IF;
    IF (SELECT count(*) FROM pg_inherits WHERE inhparent=parent_id)<>20 THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_WINDOW_DRIFT';
    END IF;
    month_start := date '2026-07-01';
    WHILE month_start < date '2028-02-01' LOOP
      child_name := spec.table_name || '_y' || to_char(month_start,'YYYY') || 'm' || to_char(month_start,'MM');
      SELECT pg_get_expr(c.relpartbound,c.oid) INTO actual_bound FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid=c.oid
        WHERE i.inhparent=parent_id AND c.oid=to_regclass(format('%I.%I',spec.schema_name,child_name))
          AND c.relkind='r' AND c.relispartition;
      utc_bound := format('FOR VALUES FROM (%L) TO (%L)',
        month_start::timestamptz,(month_start+interval '1 month')::timestamptz);
      legacy_bound := format('FOR VALUES FROM (%L) TO (%L)',
        month_start::timestamp AT TIME ZONE 'Asia/Shanghai',
        (month_start+interval '1 month') AT TIME ZONE 'Asia/Shanghai');
      IF actual_bound IS NULL OR (actual_bound<>utc_bound
          AND (month_start>=date '2027-02-01' OR actual_bound<>legacy_bound)) THEN
        RAISE EXCEPTION 'PARTITION_REPAIR_BOUND_DRIFT: %.%',spec.schema_name,child_name;
      END IF;
      IF actual_bound<>utc_bound THEN changed := changed+1; END IF;
      IF month_start<date '2027-02-01' THEN
        INSERT INTO vx_partition_repair_children VALUES
          (parent_id,to_regclass(format('%I.%I',spec.schema_name,child_name)),spec.schema_name,child_name,month_start,false);
      END IF;
      month_start := (month_start+interval '1 month')::date;
    END LOOP;
    child_name := spec.table_name || '_default';
    IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_inherits i ON i.inhrelid=c.oid
      WHERE i.inhparent=parent_id AND c.oid=to_regclass(format('%I.%I',spec.schema_name,child_name))
        AND c.relkind='r' AND pg_get_expr(c.relpartbound,c.oid)='DEFAULT') THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_DEFAULT_DRIFT';
    END IF;
    INSERT INTO vx_partition_repair_children VALUES
      (parent_id,to_regclass(format('%I.%I',spec.schema_name,child_name)),spec.schema_name,child_name,NULL,true);
    IF EXISTS (SELECT FROM pg_inherits i WHERE i.inhparent=parent_id
      AND ((SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=i.inhrelid AND NOT t.tgisinternal)<>1
        OR NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid=i.inhrelid
          AND t.tgparentid=parent_trigger AND t.tgenabled='O' AND t.tgtype=27)))
      OR EXISTS (SELECT FROM pg_index ix WHERE ix.indrelid IN
        (SELECT inhrelid FROM pg_inherits WHERE inhparent=parent_id)
        AND (NOT ix.indisvalid OR NOT ix.indisready)) THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_CHILD_GUARD_DRIFT';
    END IF;
    EXECUTE format($q$SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex')
      FROM %I.%I t$q$,spec.schema_name,spec.table_name) INTO before_count,before_hash;
    INSERT INTO vx_partition_repair_parents VALUES
      (spec.schema_name,spec.table_name,spec.key_name,spec.trigger_name,spec.guard_name,parent_id,before_count,before_hash);
  END LOOP;

  SELECT oid,pg_get_constraintdef(oid) INTO fk_id,fk_definition FROM pg_constraint
    WHERE conrelid='metering.usage_event_pools'::regclass
      AND conname='fk_usage_event_pools_event' AND contype='f' AND conparentid=0
      AND confrelid='metering.usage_events'::regclass AND convalidated
      AND NOT condeferrable AND NOT condeferred AND confdeltype='a' AND confupdtype='a'
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='metering.usage_event_pools'::regclass AND attname='event_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='metering.usage_event_pools'::regclass AND attname='event_created_at')]::smallint[]
      AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='metering.usage_events'::regclass AND attname='id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='metering.usage_events'::regclass AND attname='created_at')]::smallint[];
  IF fk_id IS NULL OR EXISTS (SELECT FROM pg_constraint c WHERE c.contype='f'
      AND c.conparentid=0 AND (c.confrelid IN (SELECT p.parent_id FROM vx_partition_repair_parents p)
        OR c.confrelid IN (SELECT ch.child_id FROM vx_partition_repair_children ch))
      AND c.oid<>fk_id)
    OR EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_rewrite'::regclass
      AND d.refclassid='pg_class'::regclass
      AND d.refobjid IN (SELECT ch.child_id FROM vx_partition_repair_children ch)) THEN
    RAISE EXCEPTION 'PARTITION_REPAIR_DEPENDENCY_DRIFT';
  END IF;
  IF changed=0 THEN
    RAISE NOTICE 'PARTITION_REPAIR_ALREADY_UTC';
    RETURN;
  END IF;

  -- ========================================================================
  -- Detachment removes only inherited trigger clones. Parent guards stay on.
  -- Buffer and relocate exact row images under exclusive locks in one transaction.
  -- ========================================================================
  ALTER TABLE metering.usage_event_pools DROP CONSTRAINT fk_usage_event_pools_event;
  FOR spec IN SELECT * FROM vx_partition_repair_parents ORDER BY table_name LOOP
    EXECUTE format('CREATE TEMP TABLE %I (LIKE %I.%I) ON COMMIT DROP',
      'vx_partition_rows_'||spec.table_name,spec.schema_name,spec.table_name);
    FOR child IN SELECT * FROM vx_partition_repair_children ch
      WHERE ch.parent_id=spec.parent_id ORDER BY is_default DESC,from_date LOOP
      EXECUTE format('ALTER TABLE %I.%I DETACH PARTITION %I.%I',
        spec.schema_name,spec.table_name,child.schema_name,child.child_name);
      IF EXISTS (SELECT FROM pg_trigger WHERE tgrelid=child.child_id AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'PARTITION_REPAIR_DETACHED_GUARD_DRIFT';
      END IF;
      IF child.is_default THEN
        EXECUTE format($q$WITH moved AS (DELETE FROM %I.%I WHERE %I>=%L::timestamptz
          AND %I<%L::timestamptz RETURNING *) INSERT INTO pg_temp.%I SELECT * FROM moved$q$,
          child.schema_name,child.child_name,spec.key_name,date '2026-07-01',
          spec.key_name,date '2027-02-01','vx_partition_rows_'||spec.table_name);
      ELSE
        EXECUTE format($q$WITH moved AS (DELETE FROM %I.%I WHERE %I<%L::timestamptz
          OR %I>=%L::timestamptz RETURNING *) INSERT INTO pg_temp.%I SELECT * FROM moved$q$,
          child.schema_name,child.child_name,spec.key_name,child.from_date,
          spec.key_name,child.from_date+interval '1 month','vx_partition_rows_'||spec.table_name);
      END IF;
      GET DIAGNOSTICS moved=ROW_COUNT;
      total_moved := total_moved+moved;
    END LOOP;
    FOR child IN SELECT * FROM vx_partition_repair_children ch
      WHERE ch.parent_id=spec.parent_id AND NOT is_default ORDER BY from_date LOOP
      EXECUTE format('ALTER TABLE %I.%I ATTACH PARTITION %I.%I FOR VALUES FROM (%L) TO (%L)',
        spec.schema_name,spec.table_name,child.schema_name,child.child_name,
        child.from_date::timestamptz,(child.from_date+interval '1 month')::timestamptz);
    END LOOP;
    EXECUTE format('ALTER TABLE %I.%I ATTACH PARTITION %I.%I DEFAULT',
      spec.schema_name,spec.table_name,spec.schema_name,spec.table_name||'_default');
    EXECUTE format('INSERT INTO %I.%I SELECT * FROM pg_temp.%I',
      spec.schema_name,spec.table_name,'vx_partition_rows_'||spec.table_name);
  END LOOP;
  EXECUTE 'ALTER TABLE metering.usage_event_pools ADD CONSTRAINT fk_usage_event_pools_event '||fk_definition;

  -- PARTITION_REPAIR_BEFORE_VERIFY
  -- Hashes include duplicate row multiplicity, every column and full timestamp precision.
  FOR spec IN SELECT * FROM vx_partition_repair_parents LOOP
    EXECUTE format($q$SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),''),'UTF8')),'hex')
      FROM %I.%I t$q$,spec.schema_name,spec.table_name) INTO after_count,after_hash;
    IF after_count<>spec.before_count OR after_hash<>spec.before_hash THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_ROW_IMAGE_CHANGED';
    END IF;
    IF EXISTS (SELECT FROM vx_partition_repair_children ch JOIN pg_class c ON c.oid=ch.child_id
      WHERE ch.parent_id=spec.parent_id AND (NOT EXISTS
        (SELECT FROM pg_inherits i WHERE i.inhparent=spec.parent_id AND i.inhrelid=ch.child_id)
        OR pg_get_expr(c.relpartbound,c.oid)<>CASE WHEN ch.is_default THEN 'DEFAULT'
          ELSE format('FOR VALUES FROM (%L) TO (%L)',ch.from_date::timestamptz,
            (ch.from_date+interval '1 month')::timestamptz) END))
      OR EXISTS (SELECT FROM pg_inherits i WHERE i.inhparent=spec.parent_id
        AND NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_trigger p ON p.oid=t.tgparentid
          WHERE t.tgrelid=i.inhrelid AND p.tgrelid=spec.parent_id AND p.tgname=spec.trigger_name
            AND t.tgenabled='O' AND t.tgtype=27 AND t.tgfoid=to_regprocedure(spec.guard_name))) THEN
      RAISE EXCEPTION 'PARTITION_REPAIR_POSTCONDITION_FAILED';
    END IF;
  END LOOP;
  RAISE NOTICE 'PARTITION_REPAIR_COMPLETE: % bounds, % physical row relocations',changed,total_moved;
END
$repair$;
COMMIT;
