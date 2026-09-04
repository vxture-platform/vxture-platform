/**
 * organization.types.ts — service contracts for @vxture/service-organization.
 * Identity core: Organization + Workspace + Membership.
 * docs/design/platform-data-architecture-schema.md §4 identity (tenant / workspaces / memberships).
 *
 * Governance role codes referenced here (tenant_memberships.role_id / workspace_memberships.role_id)
 * map to access.roles by (id) / (scope,code); enforcement (effective permissions) is Task 3.2.
 */

export type OrgType = "personal" | "organization";
export type OrgRole = "owner" | "manager" | "member" | "readonly" | "guest";

/**
 * 所有权转让的拒绝原因。每一条对应一句不同的用户可读解释,所以是枚举而非布尔。
 * `personal_tenant`:个人租户的 owner 即本人,转让无意义(且 DDL 的
 * `uq_tenants_one_personal_per_owner` 保证每人至多一个个人租户)。
 */
export type TransferOwnerRejection =
  | "tenant_not_found"
  | "personal_tenant"
  | "not_owner"
  | "same_user"
  | "target_not_member";

export type TransferOwnerResult =
  | { ok: true; previousOwnerUserId: string; newOwnerUserId: string }
  | { ok: false; reason: TransferOwnerRejection };

export interface OrgView {
  id: string;
  name: string;
  type: OrgType;
  ownerUserId: string;
  status: string;
  /** Human-friendly tenant number (tenancy.tenants.tenant_no "可视码"), bigint as string. */
  tenantNo?: string;
  /** ISO timestamp of org creation (present on getOrgById reads). */
  createdAt?: string;
  /** tenancy.tenants.verification_status 反规范化快查(权威在 kyc.tenant_verifications)。 */
  verificationStatus?:
    | "unverified"
    | "pending"
    | "verified"
    | "rejected"
    | "superseded";
}

/** 组织实名认证申请行(kyc.tenant_verifications;审核在 admin 侧)。 */
export interface TenantVerificationRecord {
  id: string;
  verificationType: "individual" | "enterprise";
  businessLicenseNo: string | null;
  legalPersonName: string | null;
  status: "unverified" | "pending" | "verified" | "rejected" | "superseded";
  rejectReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** 邀请台账行(tenancy.invitations;expired 为读侧派生,库内可能仍是 pending)。 */
export interface InvitationListItem {
  id: string;
  email: string;
  roleCode: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  inviterName: string | null;
}

export interface SubmitTenantVerificationInput {
  tenantId: string;
  /** 提交人(customer),写不进本表——审计走 support.audit_logs;这里仅做守卫上下文 */
  userId: string;
  businessLicenseNo: string;
  legalPersonName: string;
}

export interface WorkspaceView {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
}

/** Tenant (organization) profile — display/contact/localization (§3.2/3.3/3.6). */
export interface OrganizationProfileView {
  description: string | null;
  industry: string | null;
  scale: string | null;
  website: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  address: string | null;
  postalCode: string | null;
  isBillingRecipient: boolean;
  timezone: string | null;
  language: string | null;
  currency: string | null;
  /** Content hash of the stored logo; null = no custom logo. */
  logoHash: string | null;
  updatedAt: string | null;
}

/** Editable subset of the org profile (no logo bytes, no timestamps). */
export type ConvertPersonalResult =
  | {
      ok: true;
      tenantNo: string | null;
      newPersonalTenantId: string;
      newPersonalTenantNo: string | null;
    }
  | { ok: false; reason: "tenant_not_found" | "not_owner" | "not_personal" };

export interface OrgProfileUpdateInput {
  description?: string | null;
  industry?: string | null;
  scale?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  countryCode?: string | null;
  address?: string | null;
  postalCode?: string | null;
  isBillingRecipient?: boolean;
  timezone?: string | null;
  language?: string | null;
  currency?: string | null;
}

/** Stored org logo bytes (tenancy.tenant_logos: data / content_type / hash). */
export interface OrgLogoRecord {
  data: Buffer;
  contentType: string;
  hash: string;
}

export interface OrgMembershipView {
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  /** Membership join time (tenant_membership.created_at); present on list-for-user reads. */
  joinedAt?: Date;
  /** Joined organization snapshot (present on list-for-user reads). */
  organization?: OrgView;
}

export interface WorkspaceMembershipView {
  workspaceId: string;
  userId: string;
  role: string;
  status: string;
}

/** Result of provisioning an organization (personal or team) with its default workspace. */
export interface ProvisionedOrg {
  org: OrgView;
  workspace: WorkspaceView;
}

/**
 * Active-org context shaping the access-token claims (platform-data-architecture.md §8 — active-org claims):
 * `sub + active_org + active_workspace + roles`. NO business entitlement.
 * `roles` are scope-prefixed governance role codes, e.g. ["org:owner","workspace:owner"].
 *
 * Display context (`activeOrgType`/`activeOrgName`/`activeWorkspaceName`) is
 * carried for cross-domain RPs (e.g. ruyin) that read identity straight from the
 * access_token and cannot reach the IdP DB: org type is the personal-vs-team
 * discriminator (every account has a personal org, so `activeOrg` alone cannot
 * tell them apart), and the names spare the RP a back-query just to label a panel.
 */
export interface ActiveOrgContext {
  activeOrg: string;
  /** "personal" | "organization" — the only reliable personal-vs-team discriminator. */
  activeOrgType: OrgType;
  /** Active organization display name (null if the join did not carry it). */
  activeOrgName: string | null;
  activeWorkspace: string | null;
  /** Active (default) workspace display name (null if no workspace). */
  activeWorkspaceName: string | null;
  roles: string[];
}

/** An org the user can switch into (active-org switch, §13.5). */
export interface OrgSwitchOption {
  orgId: string;
  name: string;
  type: OrgType;
  role: string;
}

export interface CreateInvitationInput {
  scope: "org" | "workspace";
  organizationId: string | null;
  workspaceId?: string | null;
  targetType: "email" | "phone";
  target: string;
  role: string;
  createdBy: string;
  /** Time-to-live in seconds (default applied by service). */
  ttlSeconds?: number;
}

export interface InvitationView {
  id: string;
  scope: "org" | "workspace";
  organizationId: string | null;
  workspaceId: string | null;
  targetType: string;
  target: string;
  role: string;
  status: string;
  expiresAt: Date;
}

/**
 * 成员在租户内的可写状态(tenant_memberships.status)。`removed` 是 DDL 允许值但
 * 读写两侧都不用——解除关联是删行,不是打标(批 2 裁定:留一行 removed 只会让
 * 「同一邮箱再邀请」撞唯一键)。
 */
export type OrgMemberStatus = "active" | "suspended";

/** 按原始 token 查到的邀请(接受页预览用);status 含读侧派生的 expired。 */
export interface InvitationLookup {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  email: string;
  roleCode: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: Date;
  inviterName: string | null;
}

/** 重发邀请:轮换 token 并顺延有效期后返回的新链接材料。 */
export interface RotatedInvitation {
  token: string;
  expiresAt: Date;
  email: string;
  roleCode: string;
}

/**
 * 接受邀请的拒绝原因。每一条对应接受页上一句不同的解释,所以是枚举不是布尔:
 * 「链接失效」与「你登录的不是受邀邮箱」是两件用户要做不同事的事。
 */
export type AcceptInvitationRejection =
  | "not_found"
  | "expired"
  | "revoked"
  | "already_accepted"
  | "email_mismatch";

export type AcceptInvitationResult =
  | { ok: true; membership: OrgMembershipView; tenantName: string | null }
  | { ok: false; reason: AcceptInvitationRejection };

/** Data access contract for identity-core organizations (raw SQL impl + mock impl). */
export interface OrganizationReadRepository {
  /** Provision a personal org + default workspace + owner membership at both levels (§13.1). */
  createPersonalOrg(
    userId: string,
    name?: string | null,
  ): Promise<ProvisionedOrg>;
  /**
   * Rename the user's personal org (type='personal') to `name`. No-op (resolves
   * false) if the user has no personal org — should not happen in practice since
   * every account gets one at onboarding, but the caller must not assume it does.
   * Never touches team/organization-type tenants.
   */
  renamePersonalOrg(userId: string, name: string): Promise<boolean>;
  /**
   * 改租户名(批 5c)。组织租户改名即作废原企业认证(规格 §3.4);返回是否作废,
   * 租户不存在 / 已删返回 null。
   */
  renameTenant(
    tenantId: string,
    name: string,
  ): Promise<{ verificationSuperseded: boolean } | null>;
  /**
   * 个人租户转组织(批 5c-2):一个事务里改类型 / 名称 / 认证状态,并立刻补建
   * 这个人的新个人租户。主体码 v4 之后不换号。不可回退。
   */
  convertPersonalToOrganization(
    tenantId: string,
    ownerUserId: string,
    name: string,
  ): Promise<ConvertPersonalResult>;
  /** Provision a team org + default workspace + owner membership at both levels. */
  createTeamOrg(ownerUserId: string, name: string): Promise<ProvisionedOrg>;
  getOrgById(orgId: string): Promise<OrgView | null>;
  /** Admin search across organizations by id or name (case-insensitive, capped). */
  searchOrgs(query: string, limit: number): Promise<OrgView[]>;
  getDefaultWorkspace(orgId: string): Promise<WorkspaceView | null>;
  /**
   * Default workspace for an org plus the caller's active membership role in it,
   * in a single round-trip. `membershipRole` is null when the user has no active
   * workspace membership (the workspace itself is still returned). Used by
   * active-context resolution on the session hot path to fold what were two
   * sequential reads (getDefaultWorkspace + getWorkspaceMembership) into one.
   */
  getDefaultWorkspaceWithMembership(
    orgId: string,
    userId: string,
  ): Promise<{
    workspace: WorkspaceView | null;
    membershipRole: string | null;
  }>;

  // ── Org profile (§3.2/3.3/3.6): display/contact/localization + logo bytes ──
  /** The org's profile row; null when none has been created yet. */
  getOrgProfile(orgId: string): Promise<OrganizationProfileView | null>;
  /** Create or update the org profile (fill-supplied-fields); returns the new view. */
  upsertOrgProfile(
    orgId: string,
    input: OrgProfileUpdateInput,
  ): Promise<OrganizationProfileView>;
  /** Load the org's logo bytes; null when none. */
  getOrgLogo(orgId: string): Promise<OrgLogoRecord | null>;
  /** Store/replace the org's logo bytes (mirrors logo_hash on the profile row). */
  setOrgLogo(orgId: string, logo: OrgLogoRecord): Promise<void>;
  /** Remove the org's logo bytes (clears logo_hash). */
  deleteOrgLogo(orgId: string): Promise<void>;
  listOrgMembershipsForUser(userId: string): Promise<OrgMembershipView[]>;
  listOrgMembers(orgId: string): Promise<OrgMembershipView[]>;
  addOrgMember(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView>;
  updateOrgMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView | null>;
  removeOrgMember(orgId: string, userId: string): Promise<boolean>;
  /**
   * 转让组织租户所有权(owner 2026-08-21 裁定,决策 3 批一)。
   *
   * 单事务完成四件事:改 `tenants.owner_user_id`、目标升 owner、原 owner 降
   * **manager**(不是 member——转让是职责交接不是离场)、默认工作空间的
   * workspace_membership 同步。四件事分开做会留下「租户 owner 是 A、
   * membership owner 还是 B」这种没人能修的中间态。
   *
   * 拒绝原因用**判别式返回**而不是抛错:调用方要按原因给不同的文案,
   * 靠 message 字符串匹配是脆的。
   */
  transferOrgOwner(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnerResult>;
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: OrgRole,
  ): Promise<WorkspaceMembershipView>;
  /** Create an invitation; returns the view plus the raw token (shown once). */
  createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitation: InvitationView; token: string }>;
  /**
   * 接受邀请:按原始 token 找到 pending 且未过期的邀请,校验受邀邮箱与接受人一致
   * (邮箱邀请只能由该邮箱对应的账号接受——链接被转发给别人不该等于把租户交出去),
   * 然后建租户级 + 默认工作空间两级 membership。拒绝原因判别式返回,不抛。
   */
  acceptInvitation(
    token: string,
    userId: string,
    userEmail: string | null,
  ): Promise<AcceptInvitationResult>;
  /** 按原始 token 查邀请(接受页先看清楚再点);查不到返回 null。 */
  getInvitationByToken(token: string): Promise<InvitationLookup | null>;
  /**
   * 重发邀请 = 轮换 token 并把有效期顺延到「现在 + 默认 TTL」。只作用于 pending
   * 行(含已过期的 pending:过期是读侧派生,行仍是 pending);已撤销 / 已接受返回 null。
   * 旧链接立即失效——同一封邀请永远只有一个活的链接。
   */
  rotateInvitationToken(
    invitationId: string,
    tenantId: string,
  ): Promise<RotatedInvitation | null>;
  /**
   * 停用 / 恢复成员:租户级 membership 与本租户下全部 workspace membership 同步
   * 改 status。停用不是删除——成员的订单、用量、审计足迹都还在,恢复即回到原角色。
   * 非本租户成员返回 null。
   */
  setOrgMemberStatus(
    orgId: string,
    userId: string,
    status: OrgMemberStatus,
  ): Promise<OrgMembershipView | null>;

  // ── Governance RBAC (Task 3.2): effective permission codes via the global catalog ──
  /** Permission codes granted by the user's org-scope role in this org (∅ if not a member). */
  getEffectiveOrgPermissions(userId: string, orgId: string): Promise<string[]>;
  /** Permission codes granted by the user's workspace-scope role in this workspace. */
  getEffectiveWorkspacePermissions(
    userId: string,
    workspaceId: string,
  ): Promise<string[]>;

  /** The user's active workspace membership (for the active-org role claim); null if none. */
  getWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipView | null>;

  // ── Console reads (members joined with user, + the global role catalog) ──
  /** Org members joined with their user record(active + suspended;停用的人还在目录里,只是状态不同)。 */
  listOrgMembersWithUser(orgId: string): Promise<OrgMemberDetail[]>;
  /** A single org member joined with their user record(active + suspended); null if not a member. */
  getOrgMemberDetail(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDetail | null>;
  /** The global org-scope role catalog (owner/manager/member) with permission codes. */
  getOrgRolesCatalog(): Promise<OrgRoleCatalogEntry[]>;
  /** 客户可见的 tenant 治理权限目录(菜单节点 + 操作码),按 sort 升序。 */
  listPermissionCatalog(): Promise<PermissionCatalogEntry[]>;
  // ── 组织实名认证(kyc.tenant_verifications,owner 2026-08-21 P0)──────────
  getLatestTenantVerification(
    tenantId: string,
  ): Promise<TenantVerificationRecord | null>;
  listTenantVerifications(
    tenantId: string,
    limit?: number,
  ): Promise<TenantVerificationRecord[]>;
  submitTenantVerification(
    input: SubmitTenantVerificationInput,
  ): Promise<TenantVerificationRecord>;
  // ── 邀请台账(P1 /invitations 落地,owner 2026-08-21)────────────────────
  listInvitations(
    tenantId: string,
    limit?: number,
  ): Promise<InvitationListItem[]>;
  /** 撤销 pending 邀请;非 pending / 不属本租户返回 false。 */
  revokeInvitation(invitationId: string, tenantId: string): Promise<boolean>;
  /** Revoke every pending invitation the user sent (account deletion); returns the count. */
  revokeInvitationsCreatedBy(userId: string): Promise<number>;
  /**
   * Soft-delete the user's personal tenant (status='deleted', deleted_at=now())
   * when the account is purged after its retention window (050-account §7).
   * Idempotent; true when a row changed.
   */
  softDeletePersonalOrg(ownerUserId: string): Promise<boolean>;
}

/** Org membership joined with the member's user record (for management UIs). */
export interface OrgMemberDetail {
  userId: string;
  account: string;
  email: string | null;
  phone: string;
  name: string | null;
  role: string;
  status: string;
  joinedAt: Date;
}

/** A global org-scope role + the permission codes it grants. */
export interface OrgRoleCatalogEntry {
  code: string;
  name: string;
  permissions: string[];
}

/**
 * 权限目录一行(access.permissions,控制台菜单树模式):菜单节点与操作码同表,
 * 靠 type 区分,parentCode 表达层级。console 角色页按它画「板块 → 页面 → 操作」。
 */
export interface PermissionCatalogEntry {
  code: string;
  name: string;
  /** menu / api(历史行为 null 的按 api 处理)。 */
  type: "menu" | "api";
  parentCode: string | null;
  routePath: string | null;
  category: string | null;
  sort: number;
}
