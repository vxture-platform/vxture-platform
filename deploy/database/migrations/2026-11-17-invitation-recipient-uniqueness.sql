-- Enforce organization-wide recipient uniqueness across administrators and channels.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-17
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE tenancy.invitations IN SHARE ROW EXCLUSIVE MODE;

-- ===========================================================================
-- Preserve installed security rules and historical invitation delivery times.
-- ===========================================================================
DO $migration$
DECLARE
 installed integer;
 index_name text;
 actual_shape jsonb;
 expected_shape jsonb;
 guard_body constant text := $guard$
DECLARE recipient uuid;
BEGIN
 IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
 IF NEW.target_type NOT IN ('email','phone','user_no') OR NEW.scope NOT IN ('org','workspace') THEN RAISE EXCEPTION 'invitation_channel_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invitation:' || NEW.tenant_id::text, 0));
 IF NEW.tenant_id IS NULL THEN RAISE EXCEPTION 'tenant_required'; END IF;
 NEW.target := CASE WHEN NEW.target_type = 'email' THEN lower(trim(NEW.target)) ELSE trim(NEW.target) END;
 IF TG_OP = 'UPDATE' THEN
  IF (NEW.tenant_id, NEW.scope, NEW.workspace_id, NEW.target_type, NEW.target, NEW.role_id)
     IS DISTINCT FROM (OLD.tenant_id, OLD.scope, OLD.workspace_id, OLD.target_type, OLD.target, OLD.role_id)
  THEN RAISE EXCEPTION 'invitation_target_immutable'; END IF;
 END IF;
 SELECT u.id INTO recipient FROM account.users u WHERE u.deleted_at IS NULL AND u.status = 'active' AND (
  (NEW.target_type = 'user_no' AND u.user_no::text = NEW.target) OR
  (NEW.target_type = 'email' AND u.email_verified_at IS NOT NULL AND lower(u.email) = NEW.target) OR
  (NEW.target_type = 'phone' AND u.phone_verified_at IS NOT NULL AND u.phone = NEW.target)
 );
 IF NEW.recipient_user_id IS NOT NULL AND recipient IS DISTINCT FROM NEW.recipient_user_id THEN
  RAISE EXCEPTION 'invitation_identity_changed';
 END IF;
 NEW.recipient_user_id := recipient;
 IF NEW.target_type IN ('user_no', 'phone') AND recipient IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
 IF recipient IS NOT NULL AND EXISTS (
   SELECT 1 FROM tenancy.tenant_memberships WHERE tenant_id = NEW.tenant_id AND user_id = recipient AND status IN ('active', 'suspended')
 ) AND NEW.scope = 'org' THEN RAISE EXCEPTION 'already_member'; END IF;
 IF NOT EXISTS (SELECT 1 FROM tenancy.workspaces w WHERE w.id = NEW.workspace_id AND w.tenant_id = NEW.tenant_id AND w.deleted_at IS NULL AND w.status = 'active')
 THEN RAISE EXCEPTION 'workspace_unavailable'; END IF;
 IF EXISTS (
  SELECT 1 FROM tenancy.invitations i
  LEFT JOIN account.users u ON u.id = recipient AND u.deleted_at IS NULL
  WHERE i.tenant_id = NEW.tenant_id AND i.id <> NEW.id AND i.scope = NEW.scope
   AND (NEW.scope = 'org' OR i.workspace_id = NEW.workspace_id)
   AND i.status = 'pending' AND i.expires_at > now()
   AND ((i.target_type = NEW.target_type AND lower(trim(i.target)) = lower(NEW.target)) OR
    (recipient IS NOT NULL AND (i.recipient_user_id = recipient OR
      (i.recipient_user_id IS NULL AND (
       (i.target_type = 'user_no' AND i.target = u.user_no::text) OR
       (i.target_type = 'email' AND u.email_verified_at IS NOT NULL AND lower(trim(i.target)) = lower(u.email)) OR
       (i.target_type = 'phone' AND u.phone_verified_at IS NOT NULL AND i.target = u.phone)
      )))))
 ) THEN RAISE EXCEPTION 'invitation_pending'; END IF;
 IF TG_OP = 'UPDATE' AND NEW.token_hash IS DISTINCT FROM OLD.token_hash AND OLD.last_sent_at > now() - interval '60 seconds'
 THEN RAISE EXCEPTION 'invitation_resend_cooldown'; END IF;
 IF TG_OP = 'INSERT' OR NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN NEW.last_sent_at := now(); END IF;
 -- Release expired uniqueness slots only for this recipient. History is retained.
 UPDATE tenancy.invitations i SET status = 'expired', updated_at = now()
 WHERE i.tenant_id = NEW.tenant_id AND i.scope = NEW.scope AND i.id <> NEW.id
  AND (NEW.scope = 'org' OR i.workspace_id = NEW.workspace_id)
  AND i.status = 'pending' AND i.expires_at <= now()
  AND ((i.target_type = NEW.target_type AND lower(trim(i.target)) = lower(NEW.target)) OR
       (recipient IS NOT NULL AND i.recipient_user_id = recipient));
 RETURN NEW;
END $guard$;
BEGIN
 SELECT
  (SELECT count(*) FROM pg_attribute WHERE attrelid = 'tenancy.invitations'::regclass
    AND attname IN ('recipient_user_id', 'last_sent_at') AND attnum > 0 AND NOT attisdropped)
  + (to_regclass('tenancy.uq_invitations_pending_recipient') IS NOT NULL)::integer
  + (to_regclass('tenancy.uq_invitations_pending_target') IS NOT NULL)::integer
  + (to_regprocedure('tenancy.guard_invitation_recipient()') IS NOT NULL)::integer
  + (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'tenancy.invitations'::regclass
      AND tgname = 'guard_invitation_recipient')
 INTO installed;

 IF installed NOT IN (0, 6) THEN
  RAISE EXCEPTION 'invitation_migration_partial_state';
 END IF;

 IF installed = 0 THEN
  -- The whole first upgrade rolls back if historical recipients conflict.
ALTER TABLE tenancy.invitations ADD COLUMN recipient_user_id uuid REFERENCES account.users(id);
ALTER TABLE tenancy.invitations ADD COLUMN last_sent_at timestamptz NOT NULL DEFAULT now();
UPDATE tenancy.invitations SET last_sent_at = updated_at;

-- Only verified contact ownership may bind an invitation to an account.
UPDATE tenancy.invitations i SET recipient_user_id = u.id
FROM account.users u
WHERE u.deleted_at IS NULL AND (
 (i.target_type = 'user_no' AND i.target = u.user_no::text) OR
 (i.target_type = 'email' AND u.email_verified_at IS NOT NULL AND lower(trim(i.target)) = lower(u.email)) OR
 (i.target_type = 'phone' AND u.phone_verified_at IS NOT NULL AND i.target = u.phone)
);

UPDATE tenancy.invitations SET target = CASE WHEN target_type = 'email' THEN lower(trim(target)) ELSE trim(target) END;

-- Stop for conflicting historical data; never silently choose a role or workspace.
 IF EXISTS (
  SELECT 1 FROM tenancy.invitations WHERE status = 'pending'
  GROUP BY tenant_id, scope, CASE WHEN scope = 'workspace' THEN workspace_id END,
   coalesce('user:' || recipient_user_id::text, target_type || ':' || lower(trim(target)))
  HAVING count(*) > 1
  UNION ALL
  SELECT 1 FROM tenancy.invitations WHERE status = 'pending'
  GROUP BY tenant_id, scope, CASE WHEN scope = 'workspace' THEN workspace_id END, target_type, lower(trim(target))
  HAVING count(*) > 1
 ) THEN RAISE EXCEPTION 'invitation_duplicates_require_review'; END IF;
CREATE UNIQUE INDEX uq_invitations_pending_recipient
ON tenancy.invitations (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), recipient_user_id)
WHERE status = 'pending' AND recipient_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_invitations_pending_target
ON tenancy.invitations (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), target_type, lower(trim(target)))
WHERE status = 'pending';


  EXECUTE 'CREATE FUNCTION tenancy.guard_invitation_recipient() RETURNS trigger LANGUAGE plpgsql AS '
    || quote_literal(guard_body);
  CREATE TRIGGER guard_invitation_recipient BEFORE INSERT OR UPDATE ON tenancy.invitations
  FOR EACH ROW EXECUTE FUNCTION tenancy.guard_invitation_recipient();
 END IF;

 -- ========================================================================
 -- Fail closed on drift; replay must never replace a newer or broken guard.
 -- ========================================================================
 IF NOT EXISTS (
  SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'tenancy.invitations'::regclass
   AND a.attname = 'recipient_user_id' AND NOT a.attisdropped
   AND a.atttypid = 'uuid'::regtype AND a.atttypmod = -1 AND NOT a.attnotnull
   AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'tenancy.invitations'::regclass AND a.attname = 'last_sent_at' AND NOT a.attisdropped
   AND a.atttypid = 'timestamptz'::regtype AND a.atttypmod = -1 AND a.attnotnull
   AND a.attidentity = '' AND a.attgenerated = '' AND pg_get_expr(d.adbin, d.adrelid) = 'now()'
 ) THEN RAISE EXCEPTION 'invitation_migration_column_drift'; END IF;

 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint c
  WHERE c.conrelid = 'tenancy.invitations'::regclass AND c.contype = 'f'
   AND c.confrelid = 'account.users'::regclass
   AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'recipient_user_id')]::smallint[]
   AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[]
   AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
   AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's'
 ) THEN RAISE EXCEPTION 'invitation_migration_recipient_fk_drift'; END IF;

 -- Compare deparsed keys instead of physical attribute numbers: upgraded tables
 -- can have dropped columns. The proof objects exist only in this transaction.
 CREATE TEMP TABLE s07_invitation_shape (LIKE tenancy.invitations) ON COMMIT DROP;
CREATE UNIQUE INDEX s07_expected_pending_recipient
ON s07_invitation_shape (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), recipient_user_id)
WHERE status = 'pending' AND recipient_user_id IS NOT NULL;
CREATE UNIQUE INDEX s07_expected_pending_target
ON s07_invitation_shape (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), target_type, lower(trim(target)))
WHERE status = 'pending';


 FOREACH index_name IN ARRAY ARRAY['recipient', 'target'] LOOP
  SELECT jsonb_build_object(
   'method', cl.relam, 'unique', i.indisunique, 'valid', i.indisvalid,
   'ready', i.indisready, 'live', i.indislive, 'immediate', i.indimmediate,
   'exclusion', i.indisexclusion, 'nulls', i.indnullsnotdistinct,
   'keys', i.indnkeyatts, 'attributes', i.indnatts,
   'expressions', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, n, true) ORDER BY n)
     FROM generate_series(1, i.indnatts) n),
   'predicate', pg_get_expr(i.indpred, i.indrelid, true),
   'opclasses', i.indclass::text, 'collations', i.indcollation::text, 'options', i.indoption::text)
  INTO expected_shape FROM pg_index i JOIN pg_class cl ON cl.oid = i.indexrelid
  WHERE i.indexrelid = to_regclass('pg_temp.s07_expected_pending_' || index_name);
  SELECT jsonb_build_object(
   'method', cl.relam, 'unique', i.indisunique, 'valid', i.indisvalid,
   'ready', i.indisready, 'live', i.indislive, 'immediate', i.indimmediate,
   'exclusion', i.indisexclusion, 'nulls', i.indnullsnotdistinct,
   'keys', i.indnkeyatts, 'attributes', i.indnatts,
   'expressions', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, n, true) ORDER BY n)
     FROM generate_series(1, i.indnatts) n),
   'predicate', pg_get_expr(i.indpred, i.indrelid, true),
   'opclasses', i.indclass::text, 'collations', i.indcollation::text, 'options', i.indoption::text)
  INTO actual_shape FROM pg_index i JOIN pg_class cl ON cl.oid = i.indexrelid
  WHERE i.indexrelid = to_regclass('tenancy.uq_invitations_pending_' || index_name)
   AND i.indrelid = 'tenancy.invitations'::regclass;
  IF actual_shape IS DISTINCT FROM expected_shape OR expected_shape IS NULL THEN
   RAISE EXCEPTION 'invitation_migration_index_drift: %', index_name;
  END IF;
 END LOOP;

 IF NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'tenancy.guard_invitation_recipient()'::regprocedure
   AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f' AND l.lanname = 'plpgsql'
   AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
   AND p.provolatile = 'v' AND p.proparallel = 'u' AND p.proconfig IS NULL
   AND btrim(replace(p.prosrc, E'\r\n', E'\n')) = btrim(guard_body)
 ) THEN RAISE EXCEPTION 'invitation_migration_guard_drift'; END IF;

 IF NOT EXISTS (
  SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'tenancy.invitations'::regclass
   AND t.tgname = 'guard_invitation_recipient' AND NOT t.tgisinternal
   AND t.tgfoid = 'tenancy.guard_invitation_recipient()'::regprocedure
   AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0
   AND t.tgqual IS NULL AND t.tgattr::text = ''
 ) THEN RAISE EXCEPTION 'invitation_migration_trigger_drift'; END IF;
END $migration$;
COMMIT;
