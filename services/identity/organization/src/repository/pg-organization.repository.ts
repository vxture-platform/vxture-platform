import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { ORG_PG_POOL } from "../tokens";
import type {
  CreateInvitationInput,
  InvitationView,
  OrganizationProfileView,
  OrganizationReadRepository,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  ProvisionedOrg,
  SubmitTenantVerificationInput,
  TenantVerificationRecord,
  WorkspaceMembershipView,
  WorkspaceView,
} from "../types/organization.types";

interface OrgProfileRow {
  description: string | null;
  industry: string | null;
  scale: string | null;
  website: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country_code: string | null;
  address: string | null;
  postal_code: string | null;
  is_billing_recipient: boolean;
  timezone: string | null;
  language: string | null;
  currency: string | null;
  logo_hash: string | null;
  updated_at: string | null;
}

function mapOrgProfile(row: OrgProfileRow): OrganizationProfileView {
  return {
    description: row.description,
    industry: row.industry,
    scale: row.scale,
    website: row.website,
    contactName: row.contact_name,
    contactRole: row.contact_role,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    countryCode: row.country_code,
    address: row.address,
    postalCode: row.postal_code,
    isBillingRecipient: row.is_billing_recipient,
    timezone: row.timezone,
    language: row.language,
    currency: row.currency,
    logoHash: row.logo_hash,
    updatedAt: row.updated_at,
  };
}

interface OrgMemberDetailRow {
  user_id: string;
  account: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  joined_at: Date;
}

function mapMemberDetail(row: OrgMemberDetailRow): OrgMemberDetail {
  return {
    userId: row.user_id,
    account: row.account,
    email: row.email,
    phone: row.phone,
    name: row.name,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
  };
}

interface OrgRow {
  id: string;
  name: string;
  type: string;
  owner_user_id: string;
  status: string;
  tenant_no?: string | null;
  created_at?: string | null;
  verification_status?: string | null;
}
interface WorkspaceRow {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
}
interface OrgMembershipRow {
  tenant_id: string;
  user_id: string;
  role: string;
  status: string;
}

const DEFAULT_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Raw-SQL repository for identity-core organizations over the tenancy schema
 * (tenancy.tenants / workspaces / tenant_memberships / workspace_memberships /
 * invitations), with governance RBAC via access.roles/permissions and member
 * joins to account.users. Mirrors the @vxture/service-account pg-repository convention.
 */
@Injectable()
export class PgOrganizationRepository implements OrganizationReadRepository {
  constructor(@Inject(ORG_PG_POOL) private readonly pool: Pool) {}

  createPersonalOrg(
    userId: string,
    name?: string | null,
  ): Promise<ProvisionedOrg> {
    // Naming rule (owner 2026-07-06): explicit name wins; otherwise provisionOrg
    // resolves display_name > account(username) > user_no from the DB in-txn.
    return this.provisionOrg(userId, "personal", name?.trim() || null);
  }

  createTeamOrg(ownerUserId: string, name: string): Promise<ProvisionedOrg> {
    return this.provisionOrg(ownerUserId, "organization", name.trim());
  }

  async renamePersonalOrg(userId: string, name: string): Promise<boolean> {
    const result = await this.pool.query(
      `update tenancy.tenants set name = $2, updated_at = now()
        where owner_user_id = $1 and type = 'personal'`,
      [userId, name],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Transactionally create org + default workspace + owner membership at both levels. */
  private async provisionOrg(
    ownerUserId: string,
    type: "personal" | "organization",
    name: string | null,
  ): Promise<ProvisionedOrg> {
    const orgId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (!name) {
        // Personal auto-provision naming chain (owner 2026-07-06):
        // display_name > account(username) > user_no. account is NOT NULL in
        // practice (defaulted to `_{user_no}`), so the chain always resolves;
        // 'Personal' remains only as a defensive last resort.
        const named = await client.query<{ n: string | null }>(
          `select coalesce(nullif(p.display_name, ''), u.account, u.user_no::text) as n
             from account.users u
             left join account.user_profiles p on p.user_id = u.id
            where u.id = $1`,
          [ownerUserId],
        );
        name = named.rows[0]?.n ?? "Personal";
      }
      await client.query(
        `insert into tenancy.tenants (id, name, type, owner_user_id, status, created_at, updated_at)
         values ($1, $2, $3, $4, 'active', now(), now())`,
        [orgId, name, type, ownerUserId],
      );
      // Default workspace name 'default workspace' + is_default marker (owner 2026-08-19;
      // prefilled at creation, user-renamable afterwards).
      await client.query(
        `insert into tenancy.workspaces (id, tenant_id, name, is_default, created_at, updated_at)
         values ($1, $2, 'default workspace', true, now(), now())`,
        [workspaceId, orgId],
      );
      // role → role_id + role_scope: resolve the seeded 'owner' role by (scope,code).
      await client.query(
        `insert into tenancy.tenant_memberships (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $2, r.id, 'tenant', 'active', now(), now()
           from access.roles r
          where r.scope = 'tenant' and r.role_code = 'owner'`,
        [orgId, ownerUserId],
      );
      await client.query(
        `insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $3, $2, r.id, 'workspace', 'active', now(), now()
           from access.roles r
          where r.scope = 'workspace' and r.role_code = 'owner'`,
        [workspaceId, ownerUserId, orgId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return {
      org: { id: orgId, name, type, ownerUserId, status: "active" },
      workspace: {
        id: workspaceId,
        organizationId: orgId,
        name: "default workspace",
        isDefault: true,
      },
    };
  }

  async getOrgById(orgId: string): Promise<OrgView | null> {
    const r = await this.pool.query<OrgRow>(
      `select id, name, type, owner_user_id, status,
              tenant_no::text as tenant_no,
              created_at::text as created_at,
              verification_status
         from tenancy.tenants
        where id = $1 and deleted_at is null
        limit 1`,
      [orgId],
    );
    return mapOrg(r.rows[0]);
  }

  async searchOrgs(query: string, limit: number): Promise<OrgView[]> {
    const like = `%${query.trim().toLowerCase()}%`;
    const cap = Math.min(Math.max(limit, 1), 50);
    const r = await this.pool.query<OrgRow>(
      `select id, name, type, owner_user_id, status
         from tenancy.tenants
        where deleted_at is null
          and (lower(name) like $1 or lower(id::text) like $1)
        order by name
        limit $2`,
      [like, cap],
    );
    return r.rows
      .map((row) => mapOrg(row))
      .filter((o): o is OrgView => o !== null);
  }

  async getDefaultWorkspace(orgId: string): Promise<WorkspaceView | null> {
    const r = await this.pool.query<WorkspaceRow>(
      `select id, tenant_id, name, is_default
         from tenancy.workspaces
        where tenant_id = $1 and is_default = true and deleted_at is null
        limit 1`,
      [orgId],
    );
    return mapWorkspace(r.rows[0]);
  }

  async getDefaultWorkspaceWithMembership(
    orgId: string,
    userId: string,
  ): Promise<{
    workspace: WorkspaceView | null;
    membershipRole: string | null;
  }> {
    // Default workspace + this user's active workspace role in one round-trip.
    // LEFT JOIN LATERAL keeps the workspace row even when the user has no active
    // membership (ws_role is then null) — matching the old getDefaultWorkspace +
    // getWorkspaceMembership pair where a missing membership skipped the role.
    const r = await this.pool.query<WorkspaceRow & { ws_role: string | null }>(
      `select w.id, w.tenant_id, w.name, w.is_default,
              wm.role_code as ws_role
         from tenancy.workspaces w
         left join lateral (
           select rr.role_code
             from tenancy.workspace_memberships m
             join access.roles rr on rr.id = m.role_id
            where m.workspace_id = w.id and m.user_id = $2 and m.status = 'active'
            limit 1
         ) wm on true
        where w.tenant_id = $1 and w.is_default = true and w.deleted_at is null
        limit 1`,
      [orgId, userId],
    );
    const row = r.rows[0];
    return {
      workspace: mapWorkspace(row),
      membershipRole: row?.ws_role ?? null,
    };
  }

  // Profile base columns (tenancy.tenant_profiles). logo_hash no longer lives here:
  // logo bytes/hash moved to tenancy.tenant_logos (per 20_tenancy.sql), joined in below.
  // Contacts moved to tenancy.tenant_contacts 1:N (data_identity_200 §5.8); the API-facing
  // contactName/Role/Email/Phone map to the tenant's 'primary' contact row (role→title).
  private readonly profileCols = `description, industry, scale, website, country_code, address, postal_code,
     is_billing_recipient, timezone, language, currency`;

  // Primary-contact lateral join, shared by profile reads (first 'primary' row wins).
  private readonly primaryContactJoin = `
         left join lateral (
           select c.name, c.title, c.email, c.phone
             from tenancy.tenant_contacts c
            where c.tenant_id = tp.tenant_id and c.contact_type = 'primary'
            order by c.created_at asc limit 1
         ) pc on true`;

  async getOrgProfile(orgId: string): Promise<OrganizationProfileView | null> {
    const r = await this.pool.query<OrgProfileRow>(
      `select ${this.profileCols},
              pc.name as contact_name, pc.title as contact_role,
              pc.email as contact_email, pc.phone as contact_phone,
              tl.hash as logo_hash, tp.updated_at::text as updated_at
         from tenancy.tenant_profiles tp
         left join tenancy.tenant_logos tl on tl.tenant_id = tp.tenant_id and tl.kind = 'logo'${this.primaryContactJoin}
        where tp.tenant_id = $1 limit 1`,
      [orgId],
    );
    return r.rows[0] ? mapOrgProfile(r.rows[0]) : null;
  }

  async upsertOrgProfile(
    orgId: string,
    input: OrgProfileUpdateInput,
  ): Promise<OrganizationProfileView> {
    // Overwrite semantics: the editor submits the complete desired state, so an
    // omitted field clears (null); is_billing_recipient defaults to false.
    // Primary contact (tenancy.tenant_contacts, type='primary') follows the same
    // semantics: name+email present -> upsert the single primary row; otherwise
    // clear it (name/email are NOT NULL on the 1:N table, partials cannot persist).
    const r = await this.pool.query<OrgProfileRow>(
      `with up as (
         insert into tenancy.tenant_profiles
           (tenant_id, description, industry, scale, website,
            country_code, address, postal_code, is_billing_recipient,
            timezone, language, currency, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
         on conflict (tenant_id) do update set
           description = excluded.description,
           industry = excluded.industry,
           scale = excluded.scale,
           website = excluded.website,
           country_code = excluded.country_code,
           address = excluded.address,
           postal_code = excluded.postal_code,
           is_billing_recipient = excluded.is_billing_recipient,
           timezone = excluded.timezone,
           language = excluded.language,
           currency = excluded.currency,
           updated_at = now()
         returning tenant_id, ${this.profileCols}, updated_at
       ),
       cur as (
         select id from tenancy.tenant_contacts
          where tenant_id = $1 and contact_type = 'primary'
          order by created_at asc limit 1
       ),
       delc as (
         delete from tenancy.tenant_contacts tc
          where tc.tenant_id = $1 and tc.contact_type = 'primary'
            and ($13::varchar is null or $15::varchar is null)
       ),
       updc as (
         update tenancy.tenant_contacts tc
            set name = $13, title = $14, email = $15, phone = $16, updated_at = now()
           from cur
          where tc.id = cur.id
            and $13::varchar is not null and $15::varchar is not null
          returning tc.id
       ),
       insc as (
         insert into tenancy.tenant_contacts (tenant_id, contact_type, name, title, email, phone)
         select $1, 'primary', $13, $14, $15, $16
          where $13::varchar is not null and $15::varchar is not null
            and not exists (select 1 from cur)
         returning id
       )
       select ${this.profileCols},
              case when $13::varchar is not null and $15::varchar is not null then $13::varchar end as contact_name,
              case when $13::varchar is not null and $15::varchar is not null then $14::varchar end as contact_role,
              case when $13::varchar is not null and $15::varchar is not null then $15::varchar end as contact_email,
              case when $13::varchar is not null and $15::varchar is not null then $16::varchar end as contact_phone,
              tl.hash as logo_hash, up.updated_at::text as updated_at
         from up left join tenancy.tenant_logos tl on tl.tenant_id = up.tenant_id and tl.kind = 'logo'`,
      [
        orgId,
        input.description ?? null,
        input.industry ?? null,
        input.scale ?? null,
        input.website ?? null,
        input.countryCode ?? null,
        input.address ?? null,
        input.postalCode ?? null,
        input.isBillingRecipient ?? false,
        input.timezone ?? null,
        input.language ?? null,
        input.currency ?? null,
        input.contactName ?? null,
        input.contactRole ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
      ],
    );
    return mapOrgProfile(r.rows[0]!);
  }

  async getOrgLogo(orgId: string): Promise<OrgLogoRecord | null> {
    const r = await this.pool.query<{
      logo_data: Buffer | null;
      logo_content_type: string | null;
      logo_hash: string | null;
    }>(
      `select data as logo_data, content_type as logo_content_type, hash as logo_hash
         from tenancy.tenant_logos where tenant_id = $1 and kind = 'logo' limit 1`,
      [orgId],
    );
    const row = r.rows[0];
    return row && row.logo_data && row.logo_content_type && row.logo_hash
      ? {
          data: row.logo_data,
          contentType: row.logo_content_type,
          hash: row.logo_hash,
        }
      : null;
  }

  async setOrgLogo(orgId: string, logo: OrgLogoRecord): Promise<void> {
    // tenant_logos.source is NOT NULL and OrgLogoRecord carries no source; default
    // to 'upload' (console upload flow), mirroring account.user_avatars.source.
    // tenant_logos is multi-variant since 2026-07-05 (PK tenant_id+kind); this
    // console flow manages the primary 'logo' variant only.
    await this.pool.query(
      `insert into tenancy.tenant_logos
         (tenant_id, kind, data, content_type, hash, source, updated_at)
       values ($1, 'logo', $2, $3, $4, 'upload', now())
       on conflict (tenant_id, kind) do update set
         data = excluded.data,
         content_type = excluded.content_type,
         hash = excluded.hash,
         source = excluded.source,
         updated_at = now()`,
      [orgId, logo.data, logo.contentType, logo.hash],
    );
  }

  async deleteOrgLogo(orgId: string): Promise<void> {
    // Logo now lives in its own table; clearing = deleting the row (was: null the
    // logo_* columns on the profile row). Scoped to the 'logo' variant.
    await this.pool.query(
      `delete from tenancy.tenant_logos where tenant_id = $1 and kind = 'logo'`,
      [orgId],
    );
  }

  async listOrgMembershipsForUser(
    userId: string,
  ): Promise<OrgMembershipView[]> {
    const r = await this.pool.query(
      `select m.tenant_id, m.user_id, rr.role_code as role, m.status, m.created_at as joined_at,
              o.id as o_id, o.name as o_name, o.type as o_type,
              o.owner_user_id as o_owner, o.status as o_status
         from tenancy.tenant_memberships m
         join tenancy.tenants o on o.id = m.tenant_id and o.deleted_at is null
         join access.roles rr on rr.id = m.role_id
        where m.user_id = $1 and m.status = 'active'
        order by (o.type = 'personal') desc, o.created_at asc`,
      [userId],
    );
    return r.rows.map((row) => ({
      organizationId: row.tenant_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
      joinedAt: row.joined_at,
      organization: {
        id: row.o_id,
        name: row.o_name,
        type: row.o_type,
        ownerUserId: row.o_owner,
        status: row.o_status,
      },
    }));
  }

  async listOrgMembers(orgId: string): Promise<OrgMembershipView[]> {
    const r = await this.pool.query<OrgMembershipRow>(
      `select m.tenant_id, m.user_id, rr.role_code as role, m.status
         from tenancy.tenant_memberships m
         join access.roles rr on rr.id = m.role_id
        where m.tenant_id = $1 and m.status = 'active'
        order by m.created_at asc`,
      [orgId],
    );
    return r.rows.map(mapMembership);
  }

  async addOrgMember(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView> {
    // role code → role_id (scope 'tenant'); CTE resolves the code back for the view.
    const r = await this.pool.query<OrgMembershipRow>(
      `with upserted as (
         insert into tenancy.tenant_memberships (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $2, r.id, 'tenant', 'active', now(), now()
           from access.roles r
          where r.scope = 'tenant' and r.role_code = $3
         on conflict (tenant_id, user_id) do update set
           role_id = excluded.role_id, status = 'active', updated_at = now()
         returning tenant_id, user_id, role_id, status
       )
       select up.tenant_id, up.user_id, rr.role_code as role, up.status
         from upserted up join access.roles rr on rr.id = up.role_id`,
      [orgId, userId, role],
    );
    return mapMembership(r.rows[0]!);
  }

  async updateOrgMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView | null> {
    // role code → role_id (scope 'tenant'); CTE resolves the code back for the view.
    const r = await this.pool.query<OrgMembershipRow>(
      `with updated as (
         update tenancy.tenant_memberships m
            set role_id = r.id, updated_at = now()
           from access.roles r
          where m.tenant_id = $1 and m.user_id = $2
            and r.scope = 'tenant' and r.role_code = $3
         returning m.tenant_id, m.user_id, m.role_id, m.status
       )
       select up.tenant_id, up.user_id, rr.role_code as role, up.status
         from updated up join access.roles rr on rr.id = up.role_id`,
      [orgId, userId, role],
    );
    return r.rows[0] ? mapMembership(r.rows[0]) : null;
  }

  async removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    const r = await this.pool.query(
      `delete from tenancy.tenant_memberships where tenant_id = $1 and user_id = $2`,
      [orgId, userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: OrgRole,
  ): Promise<WorkspaceMembershipView> {
    const r = await this.pool.query<{
      workspace_id: string;
      user_id: string;
      role: string;
      status: string;
    }>(
      // workspace_memberships now carries tenant_id (derived from the workspace) and
      // role_id + role_scope; CTE resolves the role code back for the view.
      `with upserted as (
         insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select w.id, w.tenant_id, $2, r.id, 'workspace', 'active', now(), now()
           from tenancy.workspaces w
           cross join access.roles r
          where w.id = $1 and r.scope = 'workspace' and r.role_code = $3
         on conflict (workspace_id, user_id) do update set
           role_id = excluded.role_id, status = 'active', updated_at = now()
         returning workspace_id, user_id, role_id, status
       )
       select up.workspace_id, up.user_id, rr.role_code as role, up.status
         from upserted up join access.roles rr on rr.id = up.role_id`,
      [workspaceId, userId, role],
    );
    const row = r.rows[0]!;
    return {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
    };
  }

  async createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitation: InvitationView; token: string }> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const ttl = input.ttlSeconds ?? DEFAULT_INVITE_TTL_SECONDS;
    // role code → role_id + role_scope. Invitation scope 'org' maps to role scope
    // 'tenant'; 'workspace' maps to 'workspace'. CTE resolves the code back for the view.
    const r = await this.pool.query(
      `with ins as (
         insert into tenancy.invitations
           (scope, tenant_id, workspace_id, target_type, target, role_id, role_scope, status,
            token_hash, expires_at, created_by, created_at, updated_at)
         select $1::text,$2,$3,$4,$5, r.id, r.scope, 'pending',$7, now() + ($8 || ' seconds')::interval, $9, now(), now()
           from access.roles r
          where r.role_code = $6
            and r.scope = case when $1::text = 'org' then 'tenant' else 'workspace' end
         returning id, scope, tenant_id, workspace_id, target_type, target, role_id, status, expires_at
       )
       select i.id, i.scope, i.tenant_id, i.workspace_id, i.target_type, i.target,
              rr.role_code as role, i.status, i.expires_at
         from ins i join access.roles rr on rr.id = i.role_id`,
      [
        input.scope,
        input.organizationId,
        input.workspaceId ?? null,
        input.targetType,
        input.target,
        input.role,
        tokenHash,
        String(ttl),
        input.createdBy,
      ],
    );
    return { invitation: mapInvitation(r.rows[0]), token };
  }

  async getWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipView | null> {
    const r = await this.pool.query<{
      workspace_id: string;
      user_id: string;
      role: string;
      status: string;
    }>(
      `select m.workspace_id, m.user_id, rr.role_code as role, m.status
         from tenancy.workspace_memberships m
         join access.roles rr on rr.id = m.role_id
        where m.workspace_id = $1 and m.user_id = $2 and m.status = 'active'
        limit 1`,
      [workspaceId, userId],
    );
    const row = r.rows[0];
    return row
      ? {
          workspaceId: row.workspace_id,
          userId: row.user_id,
          role: row.role,
          status: row.status,
        }
      : null;
  }

  async listOrgMembersWithUser(orgId: string): Promise<OrgMemberDetail[]> {
    const r = await this.pool.query<OrgMemberDetailRow>(
      `select u.id as user_id, u.account, u.email, u.phone, p.display_name as name,
              rr.role_code as role, m.status, m.created_at as joined_at
         from tenancy.tenant_memberships m
         join account.users u on u.id = m.user_id and u.deleted_at is null
         left join account.user_profiles p on p.user_id = u.id
         join access.roles rr on rr.id = m.role_id
        where m.tenant_id = $1 and m.status = 'active'
        order by m.created_at asc`,
      [orgId],
    );
    return r.rows.map(mapMemberDetail);
  }

  async getOrgMemberDetail(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDetail | null> {
    const r = await this.pool.query<OrgMemberDetailRow>(
      `select u.id as user_id, u.account, u.email, u.phone, p.display_name as name,
              rr.role_code as role, m.status, m.created_at as joined_at
         from tenancy.tenant_memberships m
         join account.users u on u.id = m.user_id and u.deleted_at is null
         left join account.user_profiles p on p.user_id = u.id
         join access.roles rr on rr.id = m.role_id
        where m.tenant_id = $1 and m.user_id = $2 and m.status = 'active'
        limit 1`,
      [orgId, userId],
    );
    return r.rows[0] ? mapMemberDetail(r.rows[0]) : null;
  }

  async getOrgRolesCatalog(): Promise<OrgRoleCatalogEntry[]> {
    const r = await this.pool.query<{
      code: string;
      name: string;
      permissions: string[];
    }>(
      `select r.role_code as code, r.role_name as name,
              coalesce(array_agg(p.perm_code) filter (where p.perm_code is not null), '{}') as permissions
         from access.roles r
         left join access.role_permissions rp on rp.role_id = r.id
         left join access.permissions p on p.id = rp.permission_id
        where r.scope = 'tenant' and r.is_customer_visible = true
        group by r.role_code, r.role_name
        order by r.role_code`,
    );
    return r.rows.map((row) => ({
      code: row.code,
      name: row.name,
      permissions: row.permissions ?? [],
    }));
  }

  // ── 组织实名认证(kyc.tenant_verifications;owner 2026-08-21 P0)──────────
  // 权威在本表,tenancy.tenants.verification_status 为反规范化快查(与 admin
  // 审核写路径同一约定)。提交 = 追加一行 pending + 同步快查列;pending 期间
  // 拒绝重复提交;verified 后再提交 = 变更重审(spec §3.4 裁定)。

  async getLatestTenantVerification(
    tenantId: string,
  ): Promise<TenantVerificationRecord | null> {
    const r = await this.pool.query<TenantVerificationRow>(
      `${TENANT_VERIFICATION_SELECT}
        where tenant_id = $1
        order by created_at desc
        limit 1`,
      [tenantId],
    );
    return r.rows[0] ? mapTenantVerification(r.rows[0]) : null;
  }

  async listTenantVerifications(
    tenantId: string,
    limit = 20,
  ): Promise<TenantVerificationRecord[]> {
    const r = await this.pool.query<TenantVerificationRow>(
      `${TENANT_VERIFICATION_SELECT}
        where tenant_id = $1
        order by created_at desc
        limit $2`,
      [tenantId, limit],
    );
    return r.rows.map(mapTenantVerification);
  }

  async submitTenantVerification(
    input: SubmitTenantVerificationInput,
  ): Promise<TenantVerificationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const latest = await client.query<{ status: string }>(
        `select status from kyc.tenant_verifications
          where tenant_id = $1
          order by created_at desc
          limit 1
          for update`,
        [input.tenantId],
      );
      if (latest.rows[0]?.status === "pending") {
        throw new Error("verification_already_pending");
      }
      const inserted = await client.query<TenantVerificationRow>(
        `insert into kyc.tenant_verifications (
           tenant_id, verification_type, business_license_no,
           legal_person_name, status, created_at, updated_at
         ) values ($1, 'enterprise', $2, $3, 'pending', now(), now())
         returning id, verification_type, business_license_no,
                   legal_person_name, status, reject_reason, reviewed_at,
                   created_at`,
        [input.tenantId, input.businessLicenseNo, input.legalPersonName],
      );
      await client.query(
        `update tenancy.tenants
            set verification_status = 'pending', updated_at = now()
          where id = $1`,
        [input.tenantId],
      );
      await client.query("commit");
      return mapTenantVerification(inserted.rows[0]!);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async getEffectiveOrgPermissions(
    userId: string,
    orgId: string,
  ): Promise<string[]> {
    const r = await this.pool.query<{ code: string }>(
      `select distinct p.perm_code as code
         from tenancy.tenant_memberships m
         join access.roles r on r.id = m.role_id
         join access.role_permissions rp on rp.role_id = r.id
         join access.permissions p on p.id = rp.permission_id
        where m.tenant_id = $1 and m.user_id = $2 and m.status = 'active'`,
      [orgId, userId],
    );
    return r.rows.map((row) => row.code);
  }

  async getEffectiveWorkspacePermissions(
    userId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const r = await this.pool.query<{ code: string }>(
      `select distinct p.perm_code as code
         from tenancy.workspace_memberships m
         join access.roles r on r.id = m.role_id
         join access.role_permissions rp on rp.role_id = r.id
         join access.permissions p on p.id = rp.permission_id
        where m.workspace_id = $1 and m.user_id = $2 and m.status = 'active'`,
      [workspaceId, userId],
    );
    return r.rows.map((row) => row.code);
  }

  async acceptInvitation(
    token: string,
    userId: string,
  ): Promise<OrgMembershipView | null> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inv = await client.query(
        `update tenancy.invitations
            set status = 'accepted', accepted_at = now(), updated_at = now()
          where token_hash = $1 and status = 'pending' and expires_at > now()
          returning scope, tenant_id, workspace_id, role_id, role_scope`,
        [tokenHash],
      );
      const row = inv.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      let membership: OrgMembershipView | null = null;
      if (row.scope === "org") {
        // Carry the invitation's resolved role_id + role_scope onto the membership.
        const m = await client.query<OrgMembershipRow>(
          `with upserted as (
             insert into tenancy.tenant_memberships (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
             values ($1, $2, $3, $4, 'active', now(), now())
             on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, status = 'active', updated_at = now()
             returning tenant_id, user_id, role_id, status
           )
           select up.tenant_id, up.user_id, rr.role_code as role, up.status
             from upserted up join access.roles rr on rr.id = up.role_id`,
          [row.tenant_id, userId, row.role_id, row.role_scope],
        );
        membership = mapMembership(m.rows[0]!);
      } else {
        // workspace_memberships requires tenant_id: derive it from the workspace.
        await client.query(
          `insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
           select w.id, w.tenant_id, $2, $3, $4, 'active', now(), now()
             from tenancy.workspaces w
            where w.id = $1
           on conflict (workspace_id, user_id) do update set role_id = excluded.role_id, status = 'active', updated_at = now()`,
          [row.workspace_id, userId, row.role_id, row.role_scope],
        );
      }
      await client.query("commit");
      return membership;
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error))
        throw new ConflictException("membership conflict");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapOrg(row?: OrgRow): OrgView | null {
  if (!row) return null;
  const view: OrgView = {
    id: row.id,
    name: row.name,
    type: row.type as OrgView["type"],
    ownerUserId: row.owner_user_id,
    status: row.status,
  };
  if (row.tenant_no != null) view.tenantNo = row.tenant_no;
  if (row.created_at != null) view.createdAt = row.created_at;
  if (
    row.verification_status === "unverified" ||
    row.verification_status === "pending" ||
    row.verification_status === "verified" ||
    row.verification_status === "rejected"
  ) {
    view.verificationStatus = row.verification_status;
  }
  return view;
}
function mapWorkspace(row?: WorkspaceRow): WorkspaceView | null {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.tenant_id,
    name: row.name,
    isDefault: row.is_default,
  };
}
function mapMembership(row: OrgMembershipRow): OrgMembershipView {
  return {
    organizationId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
  };
}
function mapInvitation(row: {
  id: string;
  scope: string;
  tenant_id: string | null;
  workspace_id: string | null;
  target_type: string;
  target: string;
  role: string;
  status: string;
  expires_at: Date;
}): InvitationView {
  return {
    id: row.id,
    scope: row.scope as InvitationView["scope"],
    organizationId: row.tenant_id,
    workspaceId: row.workspace_id,
    targetType: row.target_type,
    target: row.target,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
  };
}
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

interface TenantVerificationRow {
  id: string;
  verification_type: string;
  business_license_no: string | null;
  legal_person_name: string | null;
  status: string;
  reject_reason: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

const TENANT_VERIFICATION_SELECT = `
      select id, verification_type, business_license_no, legal_person_name,
             status, reject_reason, reviewed_at, created_at
        from kyc.tenant_verifications`;

function mapTenantVerification(
  row: TenantVerificationRow,
): TenantVerificationRecord {
  return {
    id: row.id,
    verificationType:
      row.verification_type as TenantVerificationRecord["verificationType"],
    businessLicenseNo: row.business_license_no,
    legalPersonName: row.legal_person_name,
    status: row.status as TenantVerificationRecord["status"],
    rejectReason: row.reject_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}
