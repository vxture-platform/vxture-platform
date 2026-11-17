-- Enforce organization-wide recipient uniqueness across administrators and channels.
-- @package @vxture/repo
-- @layer Infrastructure
-- @category migration
-- @author AI-Generated
-- @date 2026-11-17
BEGIN;
LOCK TABLE tenancy.invitations IN SHARE ROW EXCLUSIVE MODE;
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
DO $$ BEGIN
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
END $$;
CREATE UNIQUE INDEX uq_invitations_pending_recipient
ON tenancy.invitations (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), recipient_user_id)
WHERE status = 'pending' AND recipient_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_invitations_pending_target
ON tenancy.invitations (tenant_id, scope, coalesce(CASE WHEN scope = 'workspace' THEN workspace_id END, '00000000-0000-0000-0000-000000000000'::uuid), target_type, lower(trim(target)))
WHERE status = 'pending';

-- Serializing the organization also covers previously unregistered addresses
-- whose owners registered after the original invitation was created.
CREATE FUNCTION tenancy.guard_invitation_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
CREATE TRIGGER guard_invitation_recipient BEFORE INSERT OR UPDATE ON tenancy.invitations
FOR EACH ROW EXECUTE FUNCTION tenancy.guard_invitation_recipient();
COMMIT;
