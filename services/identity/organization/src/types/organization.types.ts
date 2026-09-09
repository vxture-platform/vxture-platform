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
  /** 简称:日常展示名(侧栏 / 面板 / 身份卡);null 时退到 name。 */
  displayName?: string | null;
  type: OrgType;
  ownerUserId: string;
  status: string;
  /** Human-friendly tenant number (tenancy.tenants.tenant_no "可视码"), bigint as string. */
  tenantNo?: string;
  /** ISO timestamp of org creation (present on getOrgById reads). */
  createdAt?: string;
  /** Content hash of the tenant logo (tenancy.tenant_logos); null / absent = no logo. */
  logoHash?: string | null;
  /** tenancy.tenants.verification_status 反规范化快查(权威在 kyc.tenant_verifications)。 */
  verificationStatus?:
    | "unverified"
    | "pending"
    | "verified"
    | "rejected"
    | "superseded";
}

/** 组织实名认证申请行(kyc.tenant_verifications;审核在 admin 侧)。 */
/**
 * 认证方式(owner 2026-09-06)——与主体轴(individual / enterprise)正交的第二根轴。
 * 能力差异按方式派生:`lite` 可订阅但不可开票;`face` / `documents` 为完整认证。
 * 本期只开放 `lite`,另两种在页面上占位标「开发中」。
 */
export type TenantVerificationMethod = "lite" | "face" | "documents";

export interface TenantVerificationRecord {
  id: string;
  verificationType: "individual" | "enterprise";
  verificationMethod: TenantVerificationMethod;
  /** 申报的企业名称(方式一必填);历史行可能为 null。 */
  companyName: string | null;
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
  /**
   * 收件方式。`email` 时 `email` 字段有值；`user_no` 时它是空串，真正的目标在
   * `target` 里——两条通道判重时要**各比各的**，混着比会把「同一个人的两种邀请」
   * 误判成重复。
   */
  targetType: string;
  /** 原样的收件目标：邮箱地址，或平台用户号。 */
  target: string;
  email: string;
  roleCode: string;
  status: "pending" | "accepted" | "expired" | "revoked" | "declined";
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  inviterName: string | null;
}

export interface SubmitTenantVerificationInput {
  tenantId: string;
  /** 提交人(customer),写不进本表——审计走 support.audit_logs;这里仅做守卫上下文 */
  userId: string;
  /** 认证方式;本期调用方只会送 `lite`(另两种页面占位禁用)。 */
  method: TenantVerificationMethod;
  /** 申报的企业名称。 */
  companyName: string;
  businessLicenseNo: string;
  /**
   * 法定代表人姓名。简易认证不收(owner 2026-09-06:只留企业名称 + 统一社会信用代码),
   * 传 null;扫脸 / 提交资料方式落地时再按各自的资料要求收。
   */
  legalPersonName: string | null;
}

export interface WorkspaceView {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
}

/**
 * 工作空间的完整视图(管理页用)。`WorkspaceView` 是会话解析那条路上的最小形状,
 * 只带 id / name / isDefault;这里多的几项是管理页要显示与编辑的。
 *
 * `workspaceNo` 是**可视码**——地址栏与界面上只出现它,不出现 uuid(§11 v4 三号解耦)。
 */
export interface WorkspaceDetail extends WorkspaceView {
  workspaceNo: string;
  description: string | null;
  icon: string | null;
  status: "active" | "archived";
  memberCount: number;
  createdAt: Date;
  /**
   * 这是不是**我**的默认落点(`tenant_memberships.default_workspace_id`)。
   * 与 `isDefault`(租户级、影响所有人)是两件事。没给 viewer 时恒为 false。
   */
  isMyDefault: boolean;
}

export interface CreateWorkspaceInput {
  tenantId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  /** 建好后把创建者以这个角色挂进去(工作空间级角色码)。 */
  creatorUserId: string;
  creatorRoleCode: string;
}

export interface UpdateWorkspaceInput {
  name?: string | undefined;
  description?: string | null | undefined;
  icon?: string | null | undefined;
}

/**
 * 工作空间写动作的拒绝理由。与邀请那套同一条纪律:**理由是闭集**,
 * 由仓储判定、路由映射成 HTTP,不在两处各写一遍判据。
 */
export type WorkspaceRejection =
  | "not_found"
  | "name_taken"
  | "default_locked"
  | "last_active"
  /** 目标已停用:停用的不能设为默认(会把所有人登录后送进一个停用的空间)。 */
  | "archived"
  /**
   * 个人租户只能有一个工作空间(owner 2026-09-10)。
   * 与 `planned` 分开:这是**结构性**的,不会因为将来开放付费就变——
   * 个人租户只有你自己,第二个空间没有意义。
   */
  | "personal_single_workspace"
  /**
   * 组织租户可以有多个,但**这个功能还在规划中**(owner 2026-09-10:后续按付费开通)。
   * 与 `personal_single_workspace` 分开:这一条是**暂时**的,文案也不一样——
   * 「以后会有」和「这里不会有」不该说成同一句话。
   */
  | "planned"
  | "not_empty";

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
  /** 联系人关联的成员(tenant_contacts.user_id);关联时姓名 / 邮箱 / 电话取自成员资料。 */
  contactUserId: string | null;
  /** 性别(与 account.user_profiles.gender 同构);关联成员时由成员派生。 */
  contactGender: "male" | "female" | null;
  countryCode: string | null;
  address: string | null;
  /** 地址二(两段式,走查 2026-09-05)。 */
  address2: string | null;
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

/** 注销组织租户的结果(走查 2026-09-05)。 */
export type CloseTenantResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "tenant_not_found"
        | "not_owner"
        | "personal_tenant"
        | "active_members";
    };

export interface OrgProfileUpdateInput {
  description?: string | null;
  industry?: string | null;
  scale?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactUserId?: string | null;
  contactGender?: "male" | "female" | null;
  countryCode?: string | null;
  address?: string | null;
  address2?: string | null;
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
  /**
   * 用户登录后默认进入的租户(tenant_memberships.is_default;每用户至多一条,
   * 部分唯一索引兜底)。present on list-for-user reads.
   */
  isDefault?: boolean;
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
  /** 登录后默认进入的租户(账号信息页「设为默认」)。 */
  isDefault: boolean;
  /** 租户标识内容哈希;null = 无自定义标识,前端画类型图标。 */
  logoHash: string | null;
}

export interface CreateInvitationInput {
  scope: "org" | "workspace";
  organizationId: string | null;
  workspaceId?: string | null;
  /**
   * 邀请的收件方式。
   *
   * `email`   —— 发链接到邮箱，收件人凭邮箱身份接受（既有）。
   * `user_no` —— 目标是**平台已有账号**：填对方的用户号，站内直接送达，
   *               对方同意即加入（owner 2026-09-09）。不发邮件、不出链接。
   * `phone`   —— 预留，尚未接通。
   *
   * 每加一种，`rejectAcceptance` 的 switch 里必须同时加身份校验分支——
   * 那个 switch 的 default 是拒绝，漏了会在测试里显影而不是静默放行。
   */
  targetType: "email" | "phone" | "user_no";
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
  status: "pending" | "accepted" | "expired" | "revoked" | "declined";
  expiresAt: Date;
  inviterName: string | null;
}

/** 重发邀请:轮换 token 并顺延有效期后返回的新链接材料。 */
export interface RotatedInvitation {
  token: string;
  expiresAt: Date;
  /** 走的哪条通道——重发要照原样走：邮箱通道才发邮件。 */
  targetType: string;
  /** 原样的收件目标：邮箱地址，或平台用户号。 */
  target: string;
  /** 只在邮箱通道有值；用户号通道是空串。 */
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
  | "email_mismatch"
  /** 按平台用户号邀请，但接受的人不是那个号（owner 2026-09-09）。 */
  | "user_mismatch"
  /**
   * `target_type` 认不出来。库里这一列**没有 CHECK 约束**，脏数据或某个没接完的
   * 通道都可能落到这里——一律拒绝，不放行。
   */
  | "unknown_target";

/**
 * 定位一条待接受的邀请。
 *
 * `token`        邮件通道:链接里的一次性 token,**token 即凭证**。
 * `invitationId` 站内通道:按用户号邀请时不发链接,对方在收件箱里点「同意」——
 *                此时 ID 只是**地址**,凭证是当前登录身份,由 `rejectAcceptance`
 *                的 `user_no` 分支核对。知道 ID 不等于能接受。
 */
/**
 * 「谁在邀请我」的一条。给被邀请人看的视角,所以**不含 token、不含目标串**:
 * 目标就是本人,重复展示自己的邮箱/用户号没有信息量;token 属于邮件通道的凭证,
 * 不该经这条自视角的读路径流出去。
 */
export interface IncomingInvitation {
  id: string;
  /** 这条邀请是按哪条通道发来的(email / user_no)。 */
  targetType: string;
  roleCode: string;
  tenantId: string | null;
  tenantName: string | null;
  inviterName: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/** 拒绝邀请的产出。拒绝理由沿用接受那套矩阵——无权接受者亦无权拒绝。 */
export type DeclineInvitationResult =
  | { ok: true }
  | { ok: false; reason: AcceptInvitationRejection };

/**
 * 组织租户能不能建第二个工作空间(owner 2026-09-10)。
 *
 * 设计上允许多个,但**功能还在规划中**,后续按付费开通。开关放在这一处,
 * 两份仓储(pg / mock)共用——各写一份迟早会有一份先翻开,那时 mock 与真库
 * 的行为就分叉了,而分叉出来的症状是「测试全绿、线上不对」。
 *
 * 常量而不是环境变量:这不是部署差异,是产品阶段。用环境变量会让
 * 「哪个环境开着」变成一个要去查的问题。将来接付费只改这一行。
 */
export const ALLOW_MULTI_WORKSPACE = false;

export type InvitationLocator = { token: string } | { invitationId: string };

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
  /** 改简称(display_name):日常展示名,不碰认证。 */
  setTenantDisplayName(tenantId: string, displayName: string): Promise<boolean>;
  /**
   * 个人租户转组织(批 5c-2):一个事务里改类型 / 名称 / 认证状态,并立刻补建
   * 这个人的新个人租户。主体码 v4 之后不换号。不可回退。
   */
  convertPersonalToOrganization(
    tenantId: string,
    ownerUserId: string,
    name: string,
  ): Promise<ConvertPersonalResult>;
  /**
   * 注销组织租户(走查 2026-09-05):所有者、组织类型、除所有者外无活跃成员;
   * 一个事务里软删(status=deleted, deleted_at)并撤销待接受的邀请。
   */
  closeTenant(
    tenantId: string,
    ownerUserId: string,
  ): Promise<CloseTenantResult>;
  /** 除所有者外的活跃成员数(注销资格用)。 */
  countOtherActiveMembers(
    tenantId: string,
    ownerUserId: string,
  ): Promise<number>;
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
  /**
   * 把某个租户设为该用户登录后默认进入的租户(owner 2026-09-05 走查):同一用户
   * 其它成员关系的 is_default 清掉,目标置 true,一个事务。目标不是该用户的活跃
   * 成员关系(或租户已删)时返回 false、什么都不改。
   */
  setDefaultOrgForUser(userId: string, orgId: string): Promise<boolean>;
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
  /**
   * 接受邀请。
   *
   * `identity` 是**接受者的身份凭据**，不是展示数据：每一种 `target_type` 都要拿
   * 其中一项来核对「这个邀请确实是发给你的」。邮箱通道核 email，用户号通道核
   * userNo。少传一项，对应通道的邀请就永远接受不了（而不是放行）——
   * `rejectAcceptance` 的 default 是拒绝。
   */
  acceptInvitation(
    locator: InvitationLocator,
    userId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<AcceptInvitationResult>;
  /**
   * 「谁在邀请我」——按身份查待接受邀请,跨租户。与 `listInvitations` 互为两侧:
   * 那个要 `tenant.member.manage`,这个是自视角(此刻我还不是该租户成员)。
   */
  listInvitationsForIdentity(
    identity: { email: string | null; userNo: string | null },
    limit?: number,
  ): Promise<IncomingInvitation[]>;
  /** 被邀请人自己拒绝。判定沿用接受矩阵——无权接受者亦无权拒绝。 */
  declineInvitation(
    invitationId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<DeclineInvitationResult>;
  /**
   * 会话落到哪个工作空间——带提示的那一版。hint 站不住(不属于本租户 / 已停用 /
   * 我不是成员)就**退回默认**,不报错:提示过期是常态。
   */
  resolveWorkspaceForSession(
    orgId: string,
    userId: string,
    hint?: string | null,
  ): Promise<{
    workspace: WorkspaceView | null;
    membershipRole: string | null;
  }>;
  /** 我在这个租户里能进哪些工作空间(切换器用:只列我是活跃成员、且启用中的)。 */
  listWorkspacesForSwitch(
    orgId: string,
    userId: string,
  ): Promise<WorkspaceView[]>;
  /** 租户下每个人各在哪些工作空间里(成员管理的「所属工作空间」列)。 */
  listWorkspaceMembersByTenant(
    tenantId: string,
  ): Promise<
    Map<
      string,
      { id: string; name: string; isDefault: boolean; role: string }[]
    >
  >;
  /** 把人从某一个工作空间移除(不动租户成员关系);默认工作空间不许移除。 */
  removeWorkspaceMember(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }>;
  /** 我在**指定**工作空间里的角色(不是当前活跃的那个);门的作用域判定要用它。 */
  getWorkspaceRole(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ): Promise<string | null>;
  /**
   * 记住「我在这个租户下默认进哪个工作空间」。与 `setDefaultWorkspace` 是两件事:
   * 那个改租户级的 `workspaces.is_default`(影响所有人,要 workspace.manage);
   * 这个只改我自己那一行,是个人偏好,不需要任何管理权限。null = 清掉,跟随租户默认。
   */
  setMemberDefaultWorkspace(
    tenantId: string,
    userId: string,
    workspaceId: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }>;
  /** 列出租户下的工作空间(不含已删),含成员数。 */
  listWorkspaces(
    tenantId: string,
    viewerUserId?: string,
  ): Promise<WorkspaceDetail[]>;
  /** 建工作空间;创建者按给定的工作空间级角色码一并挂进去。 */
  createWorkspace(
    input: CreateWorkspaceInput,
  ): Promise<
    | { ok: true; workspace: WorkspaceDetail }
    | { ok: false; reason: WorkspaceRejection }
  >;
  /** 改名 / 说明 / 图标。说明与图标可显式清空。 */
  updateWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }>;
  /** 改默认工作空间(登录后的落点)。停用的设不成默认。 */
  setDefaultWorkspace(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }>;
  /** 停用(archived)。默认的停不掉;**不删**——35 张表挂着 workspace_id。 */
  archiveWorkspace(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ ok: true } | { ok: false; reason: WorkspaceRejection }>;
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
