import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ORG_PG_POOL } from "../tokens";
import { deriveInvitationStatus, rejectAcceptance } from "./invitation-rules";
import type {
  AcceptInvitationResult,
  CloseTenantResult,
  CreateInvitationInput,
  CreateWorkspaceInput,
  DeclineInvitationResult,
  IncomingInvitation,
  InvitationListItem,
  InvitationLookup,
  InvitationView,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMemberStatus,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  OrganizationProfileView,
  OrganizationReadRepository,
  PermissionCatalogEntry,
  ProvisionedOrg,
  RotatedInvitation,
  SubmitTenantVerificationInput,
  TenantVerificationRecord,
  TransferOwnerResult,
  UpdateWorkspaceInput,
  WorkspaceDetail,
  WorkspaceMembershipView,
  WorkspaceRejection,
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
  contact_user_id?: string | null;
  contact_gender?: string | null;
  country_code: string | null;
  address: string | null;
  address2?: string | null;
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
    contactUserId: row.contact_user_id ?? null,
    contactGender:
      row.contact_gender === "male" || row.contact_gender === "female"
        ? row.contact_gender
        : null,
    address2: row.address2 ?? null,
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
  display_name?: string | null;
  type: string;
  owner_user_id: string;
  status: string;
  tenant_no?: string | null;
  created_at?: string | null;
  verification_status?: string | null;
  /** tenancy.tenant_logos.hash(kind='logo');只有 join 了标识表的读才带。 */
  logo_hash?: string | null;
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
/** 邀请 ID 的形状门。见 acceptInvitation 里的说明。 */
const ACCEPT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /**
   * 个人租户转为组织租户(批 5c-2,owner 2026-09-05)。**一个事务**:
   *   ① 锁租户行,核对是本人的、个人类型、未删
   *   ② type → organization、改名、认证状态回 unverified
   *   ③ 立刻补建这个人的新个人租户(+ 默认工作空间 + owner 两级成员关系)
   *
   * 主体码 v4「三号解耦」之后**不换号**:租户号与空间号都不含归属关系,转换只是
   * 两个字段的 UPDATE(v3 时代要换发租户号、整批改写空间号前缀,还得靠一个绕列锁的
   * SECURITY DEFINER 触发器——那些随 v4 一起没了)。新个人租户自取一个新的类别位 2 号。
   *
   * 不可回退(组织 → 个人在触发器层就没有定义)。钱、订阅、成员、工作空间全部
   * 原样跟着这一行租户,tenant id 不变,所以不需要清账前置。
   */
  async convertPersonalToOrganization(
    tenantId: string,
    ownerUserId: string,
    name: string,
  ): Promise<
    | {
        ok: true;
        tenantNo: string | null;
        newPersonalTenantId: string;
        newPersonalTenantNo: string | null;
      }
    | { ok: false; reason: "tenant_not_found" | "not_owner" | "not_personal" }
  > {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const t = await client.query<{
        type: string;
        owner_user_id: string;
        tenant_no: string;
      }>(
        `select type, owner_user_id, tenant_no::text as tenant_no
           from tenancy.tenants
          where id = $1 and deleted_at is null
          for update`,
        [tenantId],
      );
      const tenant = t.rows[0];
      if (!tenant) {
        await client.query("rollback");
        return { ok: false, reason: "tenant_not_found" };
      }
      // 权限门在这里,不在上层:任何授权都不该替代「你就是这个租户的所有者」这个事实
      // (同 transferOrgOwner 的判据)。
      if (tenant.owner_user_id !== ownerUserId) {
        await client.query("rollback");
        return { ok: false, reason: "not_owner" };
      }
      if (tenant.type !== "personal") {
        await client.query("rollback");
        return { ok: false, reason: "not_personal" };
      }

      await client.query(
        `update tenancy.tenants
            set type = 'organization',
                name = $2,
                display_name = $2,
                verification_status = 'unverified',
                updated_at = now()
          where id = $1`,
        [tenantId, name],
      );

      // 立刻补建新的个人租户(owner 2026-09-05:不靠下次登录的 onboarding 兜底)。
      // 与 provisionOrg 同样的四条写入,只是必须落在同一个事务里。
      const newTenantId = crypto.randomUUID();
      const newWorkspaceId = crypto.randomUUID();
      const named = await client.query<{ n: string | null }>(
        `select coalesce(nullif(p.display_name, ''), u.account, u.user_no::text) as n
           from account.users u
           left join account.user_profiles p on p.user_id = u.id
          where u.id = $1`,
        [ownerUserId],
      );
      await client.query(
        `insert into tenancy.tenants (id, name, display_name, type, owner_user_id, status, created_at, updated_at)
         values ($1, $2, $2, 'personal', $3, 'active', now(), now())`,
        [newTenantId, named.rows[0]?.n ?? "Personal", ownerUserId],
      );
      await client.query(
        `insert into tenancy.workspaces (id, tenant_id, name, is_default, created_at, updated_at)
         values ($1, $2, 'default workspace', true, now(), now())`,
        [newWorkspaceId, newTenantId],
      );
      await client.query(
        `insert into tenancy.tenant_memberships (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $2, r.id, 'tenant', 'active', now(), now()
           from access.roles r
          where r.scope = 'tenant' and r.role_code = 'owner'`,
        [newTenantId, ownerUserId],
      );
      await client.query(
        `insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $3, $2, r.id, 'workspace', 'active', now(), now()
           from access.roles r
          where r.scope = 'workspace' and r.role_code = 'owner'`,
        [newWorkspaceId, ownerUserId, newTenantId],
      );

      const created = await client.query<{ tenant_no: string }>(
        `select tenant_no::text as tenant_no from tenancy.tenants where id = $1`,
        [newTenantId],
      );

      // 提交前的不变量:两行租户号必须互不相同(v4 各自独立取号),且原租户已是组织。
      if (created.rows[0]?.tenant_no === tenant.tenant_no) {
        throw new Error("convert: 新个人租户与原租户撞号");
      }

      await client.query("commit");
      return {
        ok: true,
        tenantNo: tenant.tenant_no,
        newPersonalTenantId: newTenantId,
        newPersonalTenantNo: created.rows[0]?.tenant_no ?? null,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 改租户名(批 5c)。个人租户随便改;**组织租户改名即作废原企业认证**——名称与
   * 营业执照挂钩,规格 §3.4「关键信息变更需重新审核」。作废 = 当前认证记录置
   * `superseded`(备注记下改名前后),租户侧 verification_status 回 `unverified`;
   * 认证记录不删,历史时间线上留一条「作废」。
   *
   * 返回本次是否作废了认证,调用方据此提示用户。租户不存在 / 已删 → null。
   */
  async renameTenant(
    tenantId: string,
    name: string,
  ): Promise<{ verificationSuperseded: boolean } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const t = await client.query<{
        name: string;
        type: string;
        verification_status: string;
      }>(
        `select name, type, verification_status from tenancy.tenants
          where id = $1 and deleted_at is null for update`,
        [tenantId],
      );
      const tenant = t.rows[0];
      if (!tenant) {
        await client.query("rollback");
        return null;
      }
      const supersede =
        tenant.type === "organization" &&
        (tenant.verification_status === "verified" ||
          tenant.verification_status === "pending");

      await client.query(
        `update tenancy.tenants set name = $2, updated_at = now() where id = $1`,
        [tenantId, name],
      );
      if (supersede) {
        await client.query(
          `update kyc.tenant_verifications
              set status = 'superseded',
                  reject_reason = $2,
                  updated_at = now()
            where tenant_id = $1 and status in ('verified', 'pending')`,
          [tenantId, `名称变更:${tenant.name} → ${name}`],
        );
        await client.query(
          `update tenancy.tenants
              set verification_status = 'unverified', updated_at = now()
            where id = $1`,
          [tenantId],
        );
      }
      await client.query("commit");
      return { verificationSuperseded: supersede };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async countOtherActiveMembers(
    tenantId: string,
    ownerUserId: string,
  ): Promise<number> {
    const r = await this.pool.query<{ n: string }>(
      `select count(*)::text as n
         from tenancy.tenant_memberships
        where tenant_id = $1 and status = 'active' and user_id <> $2`,
      [tenantId, ownerUserId],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  /**
   * 注销组织租户(走查 2026-09-05)。一个事务:锁租户行 → 核对所有者 / 组织类型 /
   * 除所有者外无活跃成员 → 软删(status=deleted, deleted_at)→ 撤销待接受的邀请。
   * 钱的判据(未清账单 / 付费余额 / 在途退款收款 / 在途付费订单)在 BFF 聚合层用
   * TenantClosureReadService 判过才会走到这里;这里只守身份与成员两条硬条件。
   * 成员关系不动:所有读路径都按 tenants.deleted_at 过滤,会话解析会自动回落到个人租户。
   */
  async closeTenant(
    tenantId: string,
    ownerUserId: string,
  ): Promise<CloseTenantResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const t = await client.query<{ type: string; owner_user_id: string }>(
        `select type, owner_user_id
           from tenancy.tenants
          where id = $1 and deleted_at is null
          for update`,
        [tenantId],
      );
      const row = t.rows[0];
      if (!row) {
        await client.query("rollback");
        return { ok: false, reason: "tenant_not_found" };
      }
      if (row.owner_user_id !== ownerUserId) {
        await client.query("rollback");
        return { ok: false, reason: "not_owner" };
      }
      if (row.type !== "organization") {
        await client.query("rollback");
        return { ok: false, reason: "personal_tenant" };
      }
      const others = await client.query<{ n: string }>(
        `select count(*)::text as n
           from tenancy.tenant_memberships
          where tenant_id = $1 and status = 'active' and user_id <> $2`,
        [tenantId, ownerUserId],
      );
      if (Number(others.rows[0]?.n ?? 0) > 0) {
        await client.query("rollback");
        return { ok: false, reason: "active_members" };
      }
      await client.query(
        `update tenancy.tenants
            set status = 'deleted', deleted_at = now(), updated_at = now()
          where id = $1`,
        [tenantId],
      );
      await client.query(
        `update tenancy.invitations
            set status = 'revoked', updated_at = now()
          where tenant_id = $1 and status = 'pending'`,
        [tenantId],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 改简称(display_name)。日常展示名,不碰认证状态。 */
  async setTenantDisplayName(
    tenantId: string,
    displayName: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update tenancy.tenants set display_name = $2, updated_at = now()
        where id = $1 and deleted_at is null`,
      [tenantId, displayName],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async renamePersonalOrg(userId: string, name: string): Promise<boolean> {
    const result = await this.pool.query(
      `update tenancy.tenants set name = $2, display_name = $2, updated_at = now()
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
        `insert into tenancy.tenants (id, name, display_name, type, owner_user_id, status, created_at, updated_at)
         values ($1, $2, $2, $3, $4, 'active', now(), now())`,
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
    // 标识哈希一并带出:顶栏租户面板 / 会话上下文要画租户头像,免得再回查一次。
    const r = await this.pool.query<OrgRow>(
      `select o.id, o.name, o.display_name, o.type, o.owner_user_id, o.status,
              o.tenant_no::text as tenant_no,
              o.created_at::text as created_at,
              o.verification_status,
              tl.hash as logo_hash
         from tenancy.tenants o
         left join tenancy.tenant_logos tl on tl.tenant_id = o.id and tl.kind = 'logo'
        where o.id = $1 and o.deleted_at is null
        limit 1`,
      [orgId],
    );
    return mapOrg(r.rows[0]);
  }

  async searchOrgs(query: string, limit: number): Promise<OrgView[]> {
    const like = `%${query.trim().toLowerCase()}%`;
    const cap = Math.min(Math.max(limit, 1), 50);
    const r = await this.pool.query<OrgRow>(
      `select id, name, display_name, type, owner_user_id, status
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

  // ── 工作空间管理(owner 2026-09-09 定「把工作空间做成真轴」)──────────────
  //
  // 在此之前工作空间是个 1:1 的隐含物:每个租户建号时插一条 `default workspace`,
  // 之后再没有第二条,也没有任何建 / 改 / 停的入口。下面这几个方法是「真轴」的写侧。
  //
  // 三条不变式,全部在**库里**判,不靠调用方自觉:
  //   1. 同一租户下工作空间名不重(大小写与首尾空白归一后比)——两个同名工作空间
  //      在切换器里没法分辨。
  //   2. 默认工作空间不能停用:它是会话解析的落点(`getDefaultWorkspaceWithMembership`),
  //      停掉等于让所有人登录后无处可去。要停先把默认挪走。
  //   3. 最后一个 active 的不能停:同上,一个都不剩时登录后没有工作空间上下文。

  /**
   * 列出租户下的工作空间(不含已删)。成员数一并算出来,管理页要显示。
   *
   * `viewerUserId` 给了就顺带标出「哪个是**我的**默认落点」
   * (`tenant_memberships.default_workspace_id`)——它与 `isDefault`
   * (租户级 `workspaces.is_default`,影响所有人)是两件事,管理页要并排显示,
   * 不标出来的话那两个动作看起来像同一个。
   */
  async listWorkspaces(
    tenantId: string,
    viewerUserId?: string,
  ): Promise<WorkspaceDetail[]> {
    const r = await this.pool.query<
      WorkspaceRow & {
        workspace_no: string;
        description: string | null;
        icon: string | null;
        status: string;
        member_count: string;
        created_at: Date;
      }
    >(
      `select w.id, w.tenant_id, w.name, w.is_default,
              w.workspace_no::text as workspace_no,
              w.description, w.icon, w.status, w.created_at,
              (select count(*) from tenancy.workspace_memberships m
                where m.workspace_id = w.id and m.status = 'active') as member_count
         from tenancy.workspaces w
        where w.tenant_id = $1 and w.deleted_at is null
        order by w.is_default desc, w.created_at asc`,
      [tenantId],
    );
    /* 我的默认落点单独问一句:把它 join 进上面那条会让每一行都带一份同样的值,
       而它与行无关——是「我」这一个人的属性。 */
    let myDefault: string | null = null;
    if (viewerUserId) {
      const mine = await this.pool.query<{
        default_workspace_id: string | null;
      }>(
        `select default_workspace_id
           from tenancy.tenant_memberships
          where tenant_id = $1 and user_id = $2 and status = 'active'
          limit 1`,
        [tenantId, viewerUserId],
      );
      myDefault = mine.rows[0]?.default_workspace_id ?? null;
    }
    return r.rows.map((row) => ({
      id: row.id,
      organizationId: row.tenant_id,
      name: row.name,
      isDefault: row.is_default,
      workspaceNo: row.workspace_no,
      description: row.description,
      icon: row.icon,
      /* 库里 status 有三档(active/archived/deleted),但 deleted 那档与 deleted_at
         是同一件事、上面已经滤掉。对外只剩两档,不把一个永远取不到的值放进类型。 */
      status: row.status === "archived" ? "archived" : "active",
      memberCount: Number(row.member_count),
      createdAt: row.created_at,
      isMyDefault: myDefault !== null && row.id === myDefault,
    }));
  }

  /**
   * 建工作空间。`workspace_no` 由 `tenancy.assign_workspace_no` 触发器取号——
   * 不在应用层拼号,取号规则(类别位 + Luhn)只该有一处实现。
   *
   * 创建者立刻以指定角色挂进去:一个建好却进不去的工作空间没有意义。
   */
  async createWorkspace(
    input: CreateWorkspaceInput,
  ): Promise<
    | { ok: true; workspace: WorkspaceDetail }
    | { ok: false; reason: WorkspaceRejection }
  > {
    const name = input.name.trim();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      /* 锁住这个租户的工作空间集合再查重:两个人同时建同名的,后到的那个要撞上
         而不是两条都进去。锁 tenants 行(工作空间的父)比锁一堆子行更稳。 */
      await client.query(
        `select 1 from tenancy.tenants where id = $1 for update`,
        [input.tenantId],
      );
      const dup = await client.query(
        `select 1 from tenancy.workspaces
          where tenant_id = $1 and deleted_at is null
            and lower(btrim(name)) = lower(btrim($2))
          limit 1`,
        [input.tenantId, name],
      );
      if (dup.rowCount) {
        await client.query("rollback");
        return { ok: false, reason: "name_taken" };
      }
      const created = await client.query<{ id: string }>(
        `insert into tenancy.workspaces
           (tenant_id, name, description, icon, is_default, status, created_at, updated_at)
         values ($1, $2, $3, $4, false, 'active', now(), now())
         returning id`,
        [input.tenantId, name, input.description ?? null, input.icon ?? null],
      );
      const workspaceId = created.rows[0]!.id;
      await client.query(
        `insert into tenancy.workspace_memberships
           (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $2, $3, r.id, 'workspace', 'active', now(), now()
           from access.roles r
          where r.scope = 'workspace' and r.role_code = $4`,
        [
          workspaceId,
          input.tenantId,
          input.creatorUserId,
          input.creatorRoleCode,
        ],
      );
      await client.query("commit");
      const rows = await this.listWorkspaces(input.tenantId);
      const found = rows.find((w) => w.id === workspaceId);
      /* 刚提交的行必然读得到;读不到说明有并发把它删了,当 not_found 报,
         不返回一个拼出来的对象假装成功。 */
      return found
        ? { ok: true, workspace: found }
        : { ok: false, reason: "not_found" };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 改名 / 改说明 / 改图标。同租户下重名照样挡(与建同一条判据)。 */
  async updateWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query(
        `select 1 from tenancy.workspaces
          where id = $1 and tenant_id = $2 and deleted_at is null
          for update`,
        [workspaceId, tenantId],
      );
      if (!found.rowCount) {
        await client.query("rollback");
        return { ok: false, reason: "not_found" };
      }
      if (input.name !== undefined) {
        const dup = await client.query(
          `select 1 from tenancy.workspaces
            where tenant_id = $1 and id <> $2 and deleted_at is null
              and lower(btrim(name)) = lower(btrim($3))
            limit 1`,
          [tenantId, workspaceId, input.name],
        );
        if (dup.rowCount) {
          await client.query("rollback");
          return { ok: false, reason: "name_taken" };
        }
      }
      /* coalesce($n, 列) 只能表达「没给就不改」,表达不了「显式设为 null」。
         说明与图标都允许清空,所以各带一个「这次给没给」的布尔位。
         参数上的显式转型是给读的人看的,不是必需:PG 能从 else 分支的列推出类型
         (拆掉转型跑 itest 仍然全绿,验过)。 */
      await client.query(
        `update tenancy.workspaces
            set name        = coalesce($3::varchar, name),
                description = case when $4::boolean then $5::text else description end,
                icon        = case when $6::boolean then $7::varchar else icon end,
                updated_at  = now()
          where id = $1 and tenant_id = $2`,
        [
          workspaceId,
          tenantId,
          input.name === undefined ? null : input.name.trim(),
          input.description !== undefined,
          input.description ?? null,
          input.icon !== undefined,
          input.icon ?? null,
        ],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 改默认工作空间。默认是**会话解析的落点**:登录后进哪个工作空间由它决定。
   * 一租户只有一条 is_default,所以是「先清后置」的一次事务。
   */
  async setDefaultWorkspace(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<{ status: string }>(
        `select status from tenancy.workspaces
          where id = $1 and tenant_id = $2 and deleted_at is null
          for update`,
        [workspaceId, tenantId],
      );
      const row = found.rows[0];
      /* 停用的不能设为默认:那等于把所有人登录后送进一个已停用的空间。
         用 not_found 之外的码说清楚原因——「找不到」会让人以为是 ID 错了。 */
      if (!row) {
        await client.query("rollback");
        return { ok: false, reason: "not_found" };
      }
      if (row.status !== "active") {
        await client.query("rollback");
        return { ok: false, reason: "archived" };
      }
      await client.query(
        `update tenancy.workspaces set is_default = false, updated_at = now()
          where tenant_id = $1 and is_default = true and id <> $2`,
        [tenantId, workspaceId],
      );
      await client.query(
        `update tenancy.workspaces set is_default = true, updated_at = now()
          where id = $1 and tenant_id = $2`,
        [workspaceId, tenantId],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 停用工作空间(archived)。**不删**:订阅、订单、配额池、用量都挂在
   * `workspace_id` 上(35 张表引用它),硬删会把这些行的归属打断。
   *
   * 两条不变式在这里挡,但**分量不同**:
   *
   *   `default_locked` 是真正起作用的那条。默认永远是 active(停用的设不成默认),
   *      而默认停不掉 ⇒ 任何时候至少有一个 active。会话解析要落到一个 active 的
   *      工作空间上,没有就登录后无处可去。
   *   `last_active` 是**兜底**。经这几个方法走不到它(上面那条已经保证了下界);
   *      它防的是绕过这一层造出来的状态——手工 SQL 修数据、迁移写歪、
   *      或将来有人给默认加了「可停用」的口子。这类兜底要么真的挡得住、要么就别写,
   *      所以 itest 里用直接 SQL 造出那个状态,把它跑到。
   */
  async archiveWorkspace(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      /* 锁父行:并发停用两个时,两条各自看到「还有另一个 active」就会把最后一个
         也停掉。计数与写入必须在同一把锁下。 */
      await client.query(
        `select 1 from tenancy.tenants where id = $1 for update`,
        [tenantId],
      );
      const found = await client.query<{ is_default: boolean; status: string }>(
        `select is_default, status from tenancy.workspaces
          where id = $1 and tenant_id = $2 and deleted_at is null`,
        [workspaceId, tenantId],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("rollback");
        return { ok: false, reason: "not_found" };
      }
      if (row.is_default) {
        await client.query("rollback");
        return { ok: false, reason: "default_locked" };
      }
      const actives = await client.query<{ n: string }>(
        `select count(*) as n from tenancy.workspaces
          where tenant_id = $1 and deleted_at is null and status = 'active'`,
        [tenantId],
      );
      if (Number(actives.rows[0]?.n ?? 0) <= 1) {
        await client.query("rollback");
        return { ok: false, reason: "last_active" };
      }
      await client.query(
        `update tenancy.workspaces set status = 'archived', updated_at = now()
          where id = $1 and tenant_id = $2`,
        [workspaceId, tenantId],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

  /**
   * 会话要落到哪个工作空间——**带提示的那一版**(工作空间切换,owner 2026-09-09)。
   *
   * `getDefaultWorkspaceWithMembership` 永远给默认那一个;这个方法在给了 `hint`
   * 且它**站得住**时给 hint 指的那个,否则退回默认。
   *
   * 「站得住」是四条,全部在 SQL 的 where 里,一条都不能少:
   *   · 属于这个租户    —— 否则拿到别的租户的工作空间 id 就能横着进去。
   *   · 未删、状态 active —— 停用的空间不该成为任何人的落点。
   *   · 我是它的活跃成员 —— 我不在里面,就不该进去。
   *
   * 退回默认而不是报错:提示来自浏览器地址栏与 Redis 里的旧值,**过期是常态**
   * (工作空间被停用、我被移出)。那种时候人该落回默认,而不是登录失败。
   */
  async resolveWorkspaceForSession(
    orgId: string,
    userId: string,
    hint?: string | null,
  ): Promise<{
    workspace: WorkspaceView | null;
    membershipRole: string | null;
  }> {
    if (hint && ACCEPT_UUID_RE.test(hint)) {
      const r = await this.pool.query<WorkspaceRow & { ws_role: string }>(
        `select w.id, w.tenant_id, w.name, w.is_default, rr.role_code as ws_role
           from tenancy.workspaces w
           join tenancy.workspace_memberships m
             on m.workspace_id = w.id and m.user_id = $3 and m.status = 'active'
           join access.roles rr on rr.id = m.role_id
          where w.id = $2
            and w.tenant_id = $1
            and w.deleted_at is null
            and w.status = 'active'
          limit 1`,
        [orgId, hint, userId],
      );
      const row = r.rows[0];
      if (row) {
        return {
          workspace: mapWorkspace(row),
          membershipRole: row.ws_role,
        };
      }
    }
    /* 没给提示(或提示站不住)时的落点顺序:**我自己的 > 租户默认**
       (owner 2026-09-09)。

       `tenant_memberships.default_workspace_id` 是每个成员各自的落点,列、复合 FK
       (锁死「默认 ws 必属本 tenant」,NULL 自动放行)、索引、列锁 GRANT 都在,
       但此前**零个代码引用、零行有值**——设计好了没接的位子。
       `workspaces.is_default` 是**租户级**的那一个,兜底。

       我自己那个也要过同一套「站得住」判定:它可能指向一个已停用的、
       或我已被移出的空间。所以走一次递归而不是直接读——判据只写一遍。 */
    const mine = await this.pool.query<{ default_workspace_id: string | null }>(
      `select default_workspace_id
         from tenancy.tenant_memberships
        where tenant_id = $1 and user_id = $2 and status = 'active'
        limit 1`,
      [orgId, userId],
    );
    const personal = mine.rows[0]?.default_workspace_id ?? null;
    if (personal && personal !== hint) {
      return this.resolveWorkspaceForSession(orgId, userId, personal);
    }
    return this.getDefaultWorkspaceWithMembership(orgId, userId);
  }

  /**
   * 记住「我在这个租户下默认进哪个工作空间」。
   *
   * 与 `setDefaultWorkspace` 是两件事,别混:那个改 `workspaces.is_default`——
   * **租户级**、影响所有人、要 tenant.workspace.manage;这个只改我自己那一行,
   * 是个人偏好,不需要任何管理权限。
   *
   * 传 null = 清掉个人偏好,回到跟随租户默认。
   */
  async setMemberDefaultWorkspace(
    tenantId: string,
    userId: string,
    workspaceId: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }> {
    if (workspaceId !== null) {
      if (!ACCEPT_UUID_RE.test(workspaceId)) {
        return { ok: false, reason: "not_found" };
      }
      /* 只能设成**我进得去**的空间:属于本租户、启用中、我是活跃成员。
         复合 FK 只挡住「不属于本租户」那一条,另外两条得自己判——
         设成一个我进不去的空间,症状是下次登录静默退回租户默认,看起来像没保存上。 */
      const ok = await this.pool.query(
        `select 1
           from tenancy.workspaces w
           join tenancy.workspace_memberships m
             on m.workspace_id = w.id and m.user_id = $3 and m.status = 'active'
          where w.id = $2 and w.tenant_id = $1
            and w.deleted_at is null and w.status = 'active'
          limit 1`,
        [tenantId, workspaceId, userId],
      );
      if (!ok.rowCount) return { ok: false, reason: "not_found" };
    }
    const r = await this.pool.query(
      `update tenancy.tenant_memberships
          set default_workspace_id = $3, updated_at = now()
        where tenant_id = $1 and user_id = $2 and status = 'active'`,
      [tenantId, userId, workspaceId],
    );
    return r.rowCount === 0 ? { ok: false, reason: "not_found" } : { ok: true };
  }

  /**
   * 我在这个租户里能进哪些工作空间(切换器用)。
   *
   * 与 `listWorkspaces` 不同:那个是**管理视角**(租户下的全部,含停用的);
   * 这个是**我的视角**——只有我是活跃成员、且启用中的。切换器里列出一个我进不去
   * 的工作空间,点了只会失败。
   */
  async listWorkspacesForSwitch(
    orgId: string,
    userId: string,
  ): Promise<WorkspaceView[]> {
    const r = await this.pool.query<WorkspaceRow>(
      `select w.id, w.tenant_id, w.name, w.is_default
         from tenancy.workspaces w
         join tenancy.workspace_memberships m
           on m.workspace_id = w.id and m.user_id = $2 and m.status = 'active'
        where w.tenant_id = $1
          and w.deleted_at is null
          and w.status = 'active'
        order by w.is_default desc, w.created_at asc`,
      [orgId, userId],
    );
    return r.rows.map((row) => mapWorkspace(row)!);
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
  private readonly profileCols = `description, industry, scale, website, country_code, address, address2, postal_code,
     is_billing_recipient, timezone, language, currency`;

  // Primary-contact lateral join, shared by profile reads (first 'primary' row wins).
  // 关联了成员(user_id)时,姓名 / 邮箱 / 电话实时取自该成员的账号资料——联系人跟着
  // 人走,不用两头维护;未关联才用联系人行自己填的值(走查 2026-09-05)。
  private readonly primaryContactJoin = `
         left join lateral (
           select coalesce(nullif(up.display_name, ''), u.account, c.name) as name,
                  c.title,
                  coalesce(u.email, c.email) as email,
                  coalesce(u.phone, c.phone) as phone,
                  c.user_id,
                  case when c.user_id is not null then up.gender else c.gender end as gender
             from tenancy.tenant_contacts c
             left join account.users u on u.id = c.user_id and u.deleted_at is null
             left join account.user_profiles up on up.user_id = c.user_id
            where c.tenant_id = tp.tenant_id and c.contact_type = 'primary'
            order by c.created_at asc limit 1
         ) pc on true`;

  async getOrgProfile(orgId: string): Promise<OrganizationProfileView | null> {
    const r = await this.pool.query<OrgProfileRow>(
      `select ${this.profileCols},
              pc.name as contact_name, pc.title as contact_role,
              pc.email as contact_email, pc.phone as contact_phone,
              pc.user_id as contact_user_id,
              pc.gender as contact_gender,
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
            timezone, language, currency, address2, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $19, now(), now())
         on conflict (tenant_id) do update set
           description = excluded.description,
           industry = excluded.industry,
           scale = excluded.scale,
           website = excluded.website,
           country_code = excluded.country_code,
           address = excluded.address,
           address2 = excluded.address2,
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
            set name = $13, title = $14, email = $15, phone = $16, user_id = $17, gender = $18, updated_at = now()
           from cur
          where tc.id = cur.id
            and $13::varchar is not null and $15::varchar is not null
          returning tc.id
       ),
       insc as (
         insert into tenancy.tenant_contacts (tenant_id, contact_type, name, title, email, phone, user_id, gender)
         select $1, 'primary', $13, $14, $15, $16, $17, $18
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
        input.contactUserId ?? null,
        input.contactGender ?? null,
        input.address2 ?? null,
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
    // 顺序保持个人租户在前(列表展示的稳定顺序);「默认租户」不改顺序,由
    // ActiveContextService 在登录解析时按 is_default 挑选。
    const r = await this.pool.query(
      `select m.tenant_id, m.user_id, rr.role_code as role, m.status, m.created_at as joined_at,
              m.is_default,
              o.id as o_id, o.name as o_name, o.type as o_type,
              o.owner_user_id as o_owner, o.status as o_status,
              tl.hash as o_logo_hash
         from tenancy.tenant_memberships m
         join tenancy.tenants o on o.id = m.tenant_id and o.deleted_at is null
         join access.roles rr on rr.id = m.role_id
         left join tenancy.tenant_logos tl on tl.tenant_id = o.id and tl.kind = 'logo'
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
      isDefault: row.is_default === true,
      organization: {
        id: row.o_id,
        name: row.o_name,
        type: row.o_type,
        ownerUserId: row.o_owner,
        status: row.o_status,
        logoHash: row.o_logo_hash ?? null,
      },
    }));
  }

  async setDefaultOrgForUser(userId: string, orgId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `select 1
           from tenancy.tenant_memberships m
           join tenancy.tenants o on o.id = m.tenant_id and o.deleted_at is null
          where m.user_id = $1 and m.tenant_id = $2 and m.status = 'active'
          for update of m`,
        [userId, orgId],
      );
      if (target.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      // 先清后设:部分唯一索引(每用户一条 is_default)按语句检查,顺序反了会撞索引。
      await client.query(
        `update tenancy.tenant_memberships
            set is_default = false, updated_at = now()
          where user_id = $1 and is_default and tenant_id <> $2`,
        [userId, orgId],
      );
      await client.query(
        `update tenancy.tenant_memberships
            set is_default = true, updated_at = now()
          where user_id = $1 and tenant_id = $2 and not is_default`,
        [userId, orgId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // role code → role_id (scope 'tenant'); CTE resolves the code back for the view.
      const r = await client.query<OrgMembershipRow>(
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
      await upsertDefaultWorkspaceMembership(client, orgId, userId, role);
      await client.query("commit");
      return mapMembership(r.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateOrgMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // role code → role_id (scope 'tenant'); CTE resolves the code back for the view.
      const r = await client.query<OrgMembershipRow>(
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
      if (!r.rows[0]) {
        await client.query("rollback");
        return null;
      }
      /* 改租户角色**不动任何工作空间成员行**(owner 2026-09-09 指正)。
         `tenancy.workspace_memberships` 是真正的 N-N 关系表
         (uq_workspace_memberships_ws_user UNIQUE (workspace_id, user_id)),
         每一行自带 role_id——「他在这个空间里是什么角色」是那一行上的**独立事实**,
         不是租户角色的投影。

         旧实现把租户角色写进这张表(原注写着「只改租户级会留下『租户里是 manager、
         工作空间里还是 member』这种谁也解释不了的中间态」)。在 1:1 的年代那句话成立;
         有了真正的 N-N,那恰恰是这张表存在的意义:租户里是 manager、A 空间里是
         member、B 空间里是 owner,三件事各自为真。

         我先前把它从「所有空间」收窄到「默认空间」——**方向仍然是错的**,
         只是错得少一点:默认空间那一行同样是独立事实。整条摘掉。 */
      await client.query("commit");
      return mapMembership(r.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // 解除关联 = 两级 membership 一起删。只删租户级会留下孤儿 workspace 行,
      // 下次再被邀请时 upsert 会把它"复活"成旧角色。
      await client.query(
        `delete from tenancy.workspace_memberships where tenant_id = $1 and user_id = $2`,
        [orgId, userId],
      );
      const r = await client.query(
        `delete from tenancy.tenant_memberships where tenant_id = $1 and user_id = $2`,
        [orgId, userId],
      );
      await client.query("commit");
      return (r.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setOrgMemberStatus(
    orgId: string,
    userId: string,
    status: OrgMemberStatus,
  ): Promise<OrgMembershipView | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const r = await client.query<OrgMembershipRow>(
        `with updated as (
           update tenancy.tenant_memberships m
              set status = $3, updated_at = now()
            where m.tenant_id = $1 and m.user_id = $2
              and m.status in ('active', 'suspended')
           returning m.tenant_id, m.user_id, m.role_id, m.status
         )
         select up.tenant_id, up.user_id, rr.role_code as role, up.status
           from updated up join access.roles rr on rr.id = up.role_id`,
        [orgId, userId, status],
      );
      if (!r.rows[0]) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        `update tenancy.workspace_memberships
            set status = $3, updated_at = now()
          where tenant_id = $1 and user_id = $2
            and status in ('active', 'suspended')`,
        [orgId, userId, status],
      );
      await client.query("commit");
      return mapMembership(r.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async transferOrgOwner(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnerResult> {
    if (fromUserId === toUserId) return { ok: false, reason: "same_user" };

    const client = await this.pool.connect();
    try {
      await client.query("begin");

      // `for update` 锁住租户行:两个 owner 并发转让会各自读到自己仍是 owner,
      // 然后后写的那个赢——所有权最终归谁取决于调度顺序。锁掉即可串行化。
      const t = await client.query<{ type: string; owner_user_id: string }>(
        `select type, owner_user_id from tenancy.tenants
          where id = $1 and deleted_at is null
          for update`,
        [orgId],
      );
      const tenant = t.rows[0];
      if (!tenant) {
        await client.query("rollback");
        return { ok: false, reason: "tenant_not_found" };
      }
      if (tenant.type === "personal") {
        await client.query("rollback");
        return { ok: false, reason: "personal_tenant" };
      }
      // 权限门在这里,不在上层:所有权转让不该有任何权限授予能够替代
      // 「你就是当前 owner」这个事实(owner 2026-08-21 裁定)。
      if (tenant.owner_user_id !== fromUserId) {
        await client.query("rollback");
        return { ok: false, reason: "not_owner" };
      }

      // 目标必须是本租户的 active 成员——转给租户外的账号等于把租户交出去。
      const m = await client.query(
        `select 1 from tenancy.tenant_memberships
          where tenant_id = $1 and user_id = $2 and status = 'active'`,
        [orgId, toUserId],
      );
      if (m.rowCount === 0) {
        await client.query("rollback");
        return { ok: false, reason: "target_not_member" };
      }

      await client.query(
        `update tenancy.tenants
            set owner_user_id = $2, updated_at = now()
          where id = $1`,
        [orgId, toUserId],
      );

      // 租户级 membership:目标升 owner、原 owner 降 manager。
      await client.query(
        `update tenancy.tenant_memberships m
            set role_id = r.id, role_scope = 'tenant', updated_at = now()
           from access.roles r
          where m.tenant_id = $1 and m.user_id = $2
            and r.scope = 'tenant' and r.role_code = $3`,
        [orgId, toUserId, "owner"],
      );
      await client.query(
        `update tenancy.tenant_memberships m
            set role_id = r.id, role_scope = 'tenant', updated_at = now()
           from access.roles r
          where m.tenant_id = $1 and m.user_id = $2
            and r.scope = 'tenant' and r.role_code = $3`,
        [orgId, fromUserId, "manager"],
      );

      // 默认工作空间的 membership 同步。目标可能**根本没有** workspace 行
      // (成员只在租户级挂过),所以是 upsert 不是 update——只 update 的话
      // 新 owner 会拿到一个自己不是成员的工作空间,而配额与用量都按工作空间记账。
      const ws = await client.query<{ id: string }>(
        `select id from tenancy.workspaces
          where tenant_id = $1 and is_default and deleted_at is null
          limit 1`,
        [orgId],
      );
      const workspaceId = ws.rows[0]?.id;
      if (workspaceId) {
        await client.query(
          `insert into tenancy.workspace_memberships
             (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
           select $1, $2, $3, r.id, 'workspace', 'active', now(), now()
             from access.roles r
            where r.scope = 'workspace' and r.role_code = 'owner'
           on conflict (workspace_id, user_id) do update
              set role_id = excluded.role_id,
                  role_scope = 'workspace',
                  status = 'active',
                  updated_at = now()`,
          [workspaceId, orgId, toUserId],
        );
        await client.query(
          `update tenancy.workspace_memberships wm
              set role_id = r.id, role_scope = 'workspace', updated_at = now()
             from access.roles r
            where wm.workspace_id = $1 and wm.user_id = $2
              and r.scope = 'workspace' and r.role_code = 'manager'`,
          [workspaceId, fromUserId],
        );
      }

      await client.query("commit");
      return {
        ok: true,
        previousOwnerUserId: fromUserId,
        newOwnerUserId: toUserId,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
        where m.tenant_id = $1 and m.status in ('active', 'suspended')
        order by m.created_at asc`,
      [orgId],
    );
    return r.rows.map(mapMemberDetail);
  }

  /**
   * 租户下每个人各在哪些工作空间里(成员管理的「所属工作空间」列)。
   *
   * owner 2026-09-09:「关于用户，有两层，tenant 级、workspace 级，目前只展示了一次」。
   * 展示层此前只有租户那一层——不是漏画,是那之前两级逐行一致(三条写路径成对写),
   * 画第二遍就是同一批人的复印件。工作空间成了真轴之后它们才会不同。
   *
   * **一次查完整张表再在应用层归组**,不是每个成员查一次:成员管理页一屏几十行,
   * 逐行查会打出几十趟往返。
   *
   * 只列启用中的工作空间与活跃成员关系:停用的空间与已停用的成员关系不该出现在
   * 「他在哪儿」这个问题的答案里。
   */
  async listWorkspaceMembersByTenant(
    tenantId: string,
  ): Promise<
    Map<
      string,
      { id: string; name: string; isDefault: boolean; role: string }[]
    >
  > {
    const r = await this.pool.query<{
      user_id: string;
      workspace_id: string;
      name: string;
      is_default: boolean;
      role_code: string;
    }>(
      `select m.user_id, w.id as workspace_id, w.name, w.is_default,
              rr.role_code
         from tenancy.workspace_memberships m
         join tenancy.workspaces w
           on w.id = m.workspace_id
          and w.deleted_at is null
          and w.status = 'active'
         join access.roles rr on rr.id = m.role_id
        where m.tenant_id = $1 and m.status = 'active'
        order by w.is_default desc, w.created_at asc`,
      [tenantId],
    );
    const out = new Map<
      string,
      { id: string; name: string; isDefault: boolean; role: string }[]
    >();
    for (const row of r.rows) {
      const list = out.get(row.user_id) ?? [];
      list.push({
        id: row.workspace_id,
        name: row.name,
        isDefault: row.is_default,
        role: row.role_code,
      });
      out.set(row.user_id, list);
    }
    return out;
  }

  /**
   * 把人从**某一个**工作空间里移除(不动租户成员关系)。
   *
   * 与 `removeOrgMember` 的区别是方向:那个是「离开这个租户」,会连着所有工作空间
   * 一起删(工作空间成员 ⊂ 租户成员,库里的 FK 硬挡);这个只是「不在这个空间里了」,
   * 人还在租户里。
   *
   * 默认工作空间**不许移除**:会话解析要落到一个工作空间上,把人从默认空间踢出去
   * 会让他登录后没有工作空间上下文——症状是页面到处空白,而不是一句「你没权限」。
   */
  async removeWorkspaceMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }> {
    const found = await this.pool.query<{ is_default: boolean }>(
      `select is_default from tenancy.workspaces
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [workspaceId, tenantId],
    );
    const row = found.rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    if (row.is_default) return { ok: false, reason: "default_locked" };
    const del = await this.pool.query(
      `delete from tenancy.workspace_memberships
        where workspace_id = $1 and tenant_id = $2 and user_id = $3`,
      [workspaceId, tenantId, userId],
    );
    /* 本来就不在里面 = 已经是想要的状态。报 not_found 会让「重复点删除」变成报错,
       而那两次点击的意图完全一样。 */
    return del.rowCount === 0
      ? { ok: false, reason: "not_found" }
      : { ok: true };
  }

  /**
   * 我在**指定**工作空间里的角色(不是当前活跃的那个)。
   *
   * 门要用它:`workspace.member.manage` 在 `tenant:owner` 是全租户的,在
   * `workspace:manager/owner` 却**只来自当前活跃工作空间**。光挂能力门,
   * A 空间的管理员就能管 B 空间的人——能力有、作用域不对。
   */
  async getWorkspaceRole(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<string | null> {
    const r = await this.pool.query<{ role_code: string }>(
      `select rr.role_code
         from tenancy.workspace_memberships m
         join access.roles rr on rr.id = m.role_id
        where m.workspace_id = $1 and m.tenant_id = $2
          and m.user_id = $3 and m.status = 'active'
        limit 1`,
      [workspaceId, tenantId, userId],
    );
    return r.rows[0]?.role_code ?? null;
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
        where m.tenant_id = $1 and m.user_id = $2
          and m.status in ('active', 'suspended')
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

  async listPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
    const r = await this.pool.query<{
      code: string;
      name: string | null;
      type: string | null;
      parent_code: string | null;
      route_path: string | null;
      category: string | null;
      sort: number;
    }>(
      `select p.perm_code as code, p.perm_name as name, p.perm_type as type,
              parent.perm_code as parent_code, p.route_path, p.category, p.sort
         from access.permissions p
         left join access.permissions parent on parent.id = p.parent_id
        where p.is_active and p.is_customer_visible
          and (p.perm_code like 'tenant.%' or p.perm_code like 'workspace.%')
        order by p.sort, p.perm_code`,
    );
    return r.rows.map((row) => ({
      code: row.code,
      name: row.name ?? row.code,
      type: row.type === "menu" ? "menu" : "api",
      parentCode: row.parent_code,
      routePath: row.route_path,
      category: row.category,
      sort: row.sort,
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
           tenant_id, verification_type, verification_method, company_name,
           business_license_no, legal_person_name, status, created_at, updated_at
         ) values ($1, 'enterprise', $2, $3, $4, $5, 'pending', now(), now())
         returning id, verification_type, verification_method, company_name,
                   business_license_no, legal_person_name, status,
                   reject_reason, reviewed_at, created_at`,
        [
          input.tenantId,
          input.method,
          input.companyName,
          input.businessLicenseNo,
          input.legalPersonName,
        ],
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

  /**
   * 「谁在邀请我」——按**身份**查待接受的邀请,跨租户。
   *
   * 与 `listInvitations` 是相反的两侧:那个答「我这个租户发出去了哪些」(要
   * `tenant.member.manage`),这个答「有谁邀请我」(SelfScope,不需要任何租户权限——
   * 恰恰因为此刻我还不是那个租户的成员)。
   *
   * 只列 pending 且未过期的:已过期的邀请对被邀请人没有任何可做的事,列出来只会
   * 在收件箱里堆出点不动的条目。
   *
   * 两个通道各按各的规则匹配:邮箱大小写不敏感(与 `rejectAcceptance` 同口径),
   * 用户号是精确串。**身份为空的那一路不匹配任何行**——传 null 时写成
   * `lower($1)` 会让 `lower(target) = null` 恒为 unknown,不会误放行。
   */
  async listInvitationsForIdentity(
    identity: { email: string | null; userNo: string | null },
    limit = 50,
  ): Promise<IncomingInvitation[]> {
    const res = await this.pool.query<{
      id: string;
      target_type: string;
      role_code: string | null;
      expires_at: Date;
      created_at: Date;
      tenant_id: string | null;
      tenant_name: string | null;
      inviter_name: string | null;
    }>(
      `select i.id, i.target_type, r.role_code, i.expires_at, i.created_at,
              i.tenant_id, t.name as tenant_name,
              coalesce(up.display_name, u.account) as inviter_name
         from tenancy.invitations i
         left join access.roles r on r.id = i.role_id
         left join tenancy.tenants t on t.id = i.tenant_id
         left join account.users u on u.id = i.created_by
         left join account.user_profiles up on up.user_id = i.created_by
        where i.status = 'pending'
          and i.expires_at > now()
          and (
            (i.target_type = 'email'   and lower(i.target) = lower($1))
            or
            (i.target_type = 'user_no' and i.target = $2)
          )
        order by i.created_at desc
        limit $3`,
      [identity.email, identity.userNo, limit],
    );
    return res.rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      roleCode: row.role_code ?? "member",
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      inviterName: row.inviter_name,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * 拒绝邀请。判定用的是**与接受同一套**的 `rejectAcceptance`——一条我无权接受的
   * 邀请,也不该由我来拒绝(否则任何人都能替别人回绝掉邀请)。
   */
  async declineInvitation(
    invitationId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<DeclineInvitationResult> {
    if (!ACCEPT_UUID_RE.test(invitationId)) {
      return { ok: false, reason: "not_found" };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<{
        id: string;
        status: string;
        expires_at: Date;
        target_type: string;
        target: string;
      }>(
        `select id, status, expires_at, target_type, target
           from tenancy.invitations
          where id = $1
            for update`,
        [invitationId],
      );
      const row = found.rows[0];
      const rejection = row
        ? rejectAcceptance(
            {
              status: row.status,
              expiresAt: row.expires_at,
              targetType: row.target_type,
              target: row.target,
            },
            identity,
          )
        : "not_found";
      if (!row || rejection) {
        await client.query("rollback");
        return { ok: false, reason: rejection ?? "not_found" };
      }
      /* declined ≠ revoked:前者是被邀请人自己不来,后者是邀请人撤回。
         合成一个状态会让邀请台账把「对方不来」写成「我撤回了」。 */
      await client.query(
        `update tenancy.invitations
            set status = 'declined', updated_at = now()
          where id = $1`,
        [row.id],
      );
      await client.query("commit");
      return { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  // ── 邀请台账(P1;expired 读侧派生:pending ∧ expires_at 已过)────────────
  async listInvitations(
    tenantId: string,
    limit = 100,
  ): Promise<InvitationListItem[]> {
    const res = await this.pool.query<{
      id: string;
      target_type: string;
      target: string;
      role_code: string | null;
      status: string;
      expires_at: Date;
      accepted_at: Date | null;
      created_at: Date;
      inviter_name: string | null;
    }>(
      `select i.id, i.target_type, i.target, r.role_code, i.status, i.expires_at,
              i.accepted_at, i.created_at,
              coalesce(up.display_name, u.account) as inviter_name
         from tenancy.invitations i
         left join access.roles r on r.id = i.role_id
         left join account.users u on u.id = i.created_by
         left join account.user_profiles up on up.user_id = i.created_by
        where i.tenant_id = $1
        order by i.created_at desc
        limit $2`,
      [tenantId, limit],
    );
    const now = Date.now();
    return res.rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      target: row.target,
      /* `email` 只在邮箱通道有值。以前这里写的是 `email: row.target`——两条通道
         并存之后那就是在说谎:一条按用户号发的邀请会把号显示成邮箱地址。 */
      email: row.target_type === "email" ? row.target : "",
      roleCode: row.role_code ?? "member",
      status: deriveInvitationStatus(row.status, row.expires_at, now),
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
      inviterName: row.inviter_name,
    }));
  }

  async revokeInvitation(
    invitationId: string,
    tenantId: string,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `update tenancy.invitations
          set status = 'revoked', updated_at = now()
        where id = $1 and tenant_id = $2 and status = 'pending'`,
      [invitationId, tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async revokeInvitationsCreatedBy(userId: string): Promise<number> {
    const res = await this.pool.query(
      `update tenancy.invitations
          set status = 'revoked', updated_at = now()
        where created_by = $1 and status = 'pending'`,
      [userId],
    );
    return res.rowCount ?? 0;
  }

  async softDeletePersonalOrg(ownerUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      `update tenancy.tenants
          set status = 'deleted', deleted_at = now(), updated_at = now()
        where owner_user_id = $1 and type = 'personal' and deleted_at is null`,
      [ownerUserId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async rotateInvitationToken(
    invitationId: string,
    tenantId: string,
  ): Promise<RotatedInvitation | null> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const res = await this.pool.query<{
      expires_at: Date;
      target_type: string;
      target: string;
      role_code: string | null;
    }>(
      `with rotated as (
         update tenancy.invitations i
            set token_hash = $3,
                expires_at = now() + ($4 || ' seconds')::interval,
                updated_at = now()
          where i.id = $1 and i.tenant_id = $2 and i.status = 'pending'
          returning i.expires_at, i.target_type, i.target, i.role_id
       )
       select r.expires_at, r.target_type, r.target, rr.role_code
         from rotated r
         left join access.roles rr on rr.id = r.role_id`,
      [invitationId, tenantId, tokenHash, String(DEFAULT_INVITE_TTL_SECONDS)],
    );
    const row = res.rows[0];
    return row
      ? {
          token,
          expiresAt: row.expires_at,
          targetType: row.target_type,
          target: row.target,
          /* 只在邮箱通道有值:上层拿它决定重发时发不发邮件。 */
          email: row.target_type === "email" ? row.target : "",
          roleCode: row.role_code ?? "member",
        }
      : null;
  }

  async getInvitationByToken(token: string): Promise<InvitationLookup | null> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const res = await this.pool.query<{
      id: string;
      tenant_id: string | null;
      tenant_name: string | null;
      target: string;
      role_code: string | null;
      status: string;
      expires_at: Date;
      inviter_name: string | null;
    }>(
      `select i.id, i.tenant_id, t.name as tenant_name, i.target, rr.role_code,
              i.status, i.expires_at,
              coalesce(up.display_name, u.account) as inviter_name
         from tenancy.invitations i
         left join tenancy.tenants t on t.id = i.tenant_id
         left join access.roles rr on rr.id = i.role_id
         left join account.users u on u.id = i.created_by
         left join account.user_profiles up on up.user_id = i.created_by
        where i.token_hash = $1
        limit 1`,
      [tokenHash],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      email: row.target,
      roleCode: row.role_code ?? "member",
      status: deriveInvitationStatus(row.status, row.expires_at),
      expiresAt: row.expires_at,
      inviterName: row.inviter_name,
    };
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

  /**
   * 接受邀请。**定位方式有两种,判定与写入只有一份**:
   *
   *   `{ token }`        邮件通道——链接里的一次性 token。
   *   `{ invitationId }` 站内通道——按用户号邀请时不发链接,对方在自己的收件箱里
   *                      点「同意」,凭的是**身份**不是 token(owner 2026-09-09)。
   *
   * 两条路都过同一个 `rejectAcceptance`:按用户号发出的邀请,其 `target_type` 是
   * `user_no`,矩阵会核对当前账号的用户号。所以「知道了邀请 ID」本身不构成权限——
   * ID 不是凭证,身份才是。这也是为什么这里没有第二个事务、第二套 upsert:
   * 两份写入一定会有一份先漂。
   */
  async acceptInvitation(
    locator: { token: string } | { invitationId: string },
    userId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<AcceptInvitationResult> {
    const byToken = "token" in locator;
    /* 形状不对的 ID 要当「查不到」,不能让它撞到 PG:`i.id` 是 uuid 列,
       传一个非 uuid 文本会抛 22P02(invalid input syntax),那是 500 不是 404。
       版本位/变体位刻意不卡——校验器不该比存储层更严(与各 BFF 的 UUID_RE 同口径)。 */
    if (!byToken && !ACCEPT_UUID_RE.test(locator.invitationId)) {
      return { ok: false, reason: "not_found" };
    }
    const key = byToken
      ? createHash("sha256").update(locator.token).digest("hex")
      : locator.invitationId;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // 先锁行再判定:两个标签页同时点「接受」,后到的那个要看到 accepted 而不是
      // 各自都成功一次。拒绝矩阵在 invitation-rules.ts,与 mock 仓储共用。
      const found = await client.query<{
        id: string;
        scope: string;
        tenant_id: string | null;
        workspace_id: string | null;
        role_id: string;
        role_scope: string;
        status: string;
        expires_at: Date;
        target_type: string;
        target: string;
        tenant_name: string | null;
      }>(
        `select i.id, i.scope, i.tenant_id, i.workspace_id, i.role_id, i.role_scope,
                i.status, i.expires_at, i.target_type, i.target, t.name as tenant_name
           from tenancy.invitations i
           left join tenancy.tenants t on t.id = i.tenant_id
          where ${byToken ? "i.token_hash" : "i.id"} = $1
            for update of i`,
        [key],
      );
      const row = found.rows[0];
      const rejection = row
        ? rejectAcceptance(
            {
              status: row.status,
              expiresAt: row.expires_at,
              targetType: row.target_type,
              target: row.target,
            },
            identity,
          )
        : "not_found";
      if (!row || rejection) {
        await client.query("rollback");
        return { ok: false, reason: rejection ?? "not_found" };
      }
      await client.query(
        `update tenancy.invitations
            set status = 'accepted', accepted_at = now(), updated_at = now()
          where id = $1`,
        [row.id],
      );
      let membership: OrgMembershipView;
      if (row.scope === "org" && row.tenant_id) {
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
        // 邀请说明页承诺「接受后成为租户与默认工作空间成员」——两级一起挂。
        await upsertDefaultWorkspaceMembership(
          client,
          row.tenant_id,
          userId,
          membership.role,
        );
      } else {
        // workspace_memberships requires tenant_id: derive it from the workspace.
        const w = await client.query<{ tenant_id: string; role: string }>(
          `with upserted as (
             insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
             select w.id, w.tenant_id, $2, $3, $4, 'active', now(), now()
               from tenancy.workspaces w
              where w.id = $1
             on conflict (workspace_id, user_id) do update set role_id = excluded.role_id, status = 'active', updated_at = now()
             returning tenant_id, role_id
           )
           select up.tenant_id, rr.role_code as role
             from upserted up join access.roles rr on rr.id = up.role_id`,
          [row.workspace_id, userId, row.role_id, row.role_scope],
        );
        const ws = w.rows[0];
        if (!ws) {
          await client.query("rollback");
          return { ok: false, reason: "not_found" };
        }
        membership = {
          organizationId: ws.tenant_id,
          userId,
          role: ws.role,
          status: "active",
        };
      }
      await client.query("commit");
      return { ok: true, membership, tenantName: row.tenant_name };
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
  if (row.display_name != null) view.displayName = row.display_name;
  if (row.tenant_no != null) view.tenantNo = row.tenant_no;
  if (row.created_at != null) view.createdAt = row.created_at;
  if (row.logo_hash !== undefined) view.logoHash = row.logo_hash;
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
/**
 * 默认工作空间 membership 与租户级同步 upsert(同角色码的 workspace 域角色)。
 * 配额与用量按工作空间记账,只挂租户级会得到一个自己不是成员的工作空间——
 * transferOrgOwner 已为 owner 走过这条路,这里推广到加成员 / 接受邀请。
 * 找不到默认工作空间(理论上不存在:开租户时一并建)时静默跳过,不让加成员失败。
 */
async function upsertDefaultWorkspaceMembership(
  client: PoolClient,
  orgId: string,
  userId: string,
  roleCode: string,
): Promise<void> {
  await client.query(
    `insert into tenancy.workspace_memberships
       (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
     select w.id, w.tenant_id, $2, r.id, 'workspace', 'active', now(), now()
       from tenancy.workspaces w
       join access.roles r on r.scope = 'workspace' and r.role_code = $3
      where w.tenant_id = $1 and w.is_default and w.deleted_at is null
     on conflict (workspace_id, user_id) do update
        set role_id = excluded.role_id,
            role_scope = 'workspace',
            status = 'active',
            updated_at = now()`,
    [orgId, userId, roleCode],
  );
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
  /** 2026-09-20 迁移新增;老快照 / 未迁移库读回 undefined,映射时归 lite / null。 */
  verification_method?: string | null;
  company_name?: string | null;
}

const TENANT_VERIFICATION_SELECT = `
      select id, verification_type, verification_method, company_name,
             business_license_no, legal_person_name,
             status, reject_reason, reviewed_at, created_at
        from kyc.tenant_verifications`;

function mapTenantVerification(
  row: TenantVerificationRow,
): TenantVerificationRecord {
  return {
    id: row.id,
    verificationType:
      row.verification_type as TenantVerificationRecord["verificationType"],
    // 迁移前的历史行没有这一列;读侧按当时唯一存在的路径归为 lite。
    verificationMethod: (row.verification_method ??
      "lite") as TenantVerificationRecord["verificationMethod"],
    companyName: row.company_name ?? null,
    businessLicenseNo: row.business_license_no,
    legalPersonName: row.legal_person_name,
    status: row.status as TenantVerificationRecord["status"],
    rejectReason: row.reject_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}
