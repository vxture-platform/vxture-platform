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
  verificationStatus?: "unverified" | "pending" | "verified" | "rejected";
}

/** 组织实名认证申请行(kyc.tenant_verifications;审核在 admin 侧)。 */
export interface TenantVerificationRecord {
  id: string;
  verificationType: "individual" | "enterprise";
  businessLicenseNo: string | null;
  legalPersonName: string | null;
  status: "unverified" | "pending" | "verified" | "rejected";
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
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: OrgRole,
  ): Promise<WorkspaceMembershipView>;
  /** Create an invitation; returns the view plus the raw token (shown once). */
  createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitation: InvitationView; token: string }>;
  /** Accept an invitation by raw token for a user; creates the membership. Returns null if invalid/expired. */
  acceptInvitation(
    token: string,
    userId: string,
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
  /** Org members joined with their user record. */
  listOrgMembersWithUser(orgId: string): Promise<OrgMemberDetail[]>;
  /** A single org member joined with their user record; null if not a member. */
  getOrgMemberDetail(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDetail | null>;
  /** The global org-scope role catalog (owner/manager/member) with permission codes. */
  getOrgRolesCatalog(): Promise<OrgRoleCatalogEntry[]>;
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
