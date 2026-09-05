import type { JwtAccessPayload } from "@vxture/core-auth";
import type { GovernancePermissionCode } from "@vxture/core-utils";

/**
 * 能力 = 成员在当前租户的有效治理权限码(access.permissions),GovernanceService
 * 回查所得,原样下发前端;码表权威在 @vxture/core-utils(tenant-permissions)。
 * 2026-09-04 起不再有 BFF 私有的「capability 词汇」与手写映射表。
 */
export type Capability = GovernancePermissionCode;

export interface ConsoleUser {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
  roleLabel: string;
  username?: string;
  phone?: string | null;
  /** account.users.status: active | deleting(保留期)| … */
  accountStatus?: string;
  deletionRequestedAt?: string | null;
}

export interface ConsoleUserProfile {
  id: string;
  username: string;
  /** ISO timestamp when the username may next be changed; null = changeable now. */
  usernameChangeableAt: string | null;
  displayName: string | null;
  /** Platform avatar URL (versioned `/avatar/usr_<id>?v=<hash>`); null → default. */
  picture: string | null;
  /** @deprecated legacy paste-URL field; superseded by `picture` (always null). */
  avatarUrl: string | null;
  bio: string | null;
  email: string | null;
  /** Whether the email is verified. */
  emailVerified: boolean;
  phone: string | null;
  /** Whether the phone is verified (the mandatory anchor → normally true). */
  phoneVerified: boolean;
  /** Whether username+password login is disabled (other login paths unaffected). */
  accountLoginDisabled?: boolean;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
  /** Stable public user number (bigint as string), e.g. "1024". */
  userNo: string | null;
  /** ISO timestamp of account creation. */
  accountCreatedAt: string | null;
  /** Account status: active | deleting | suspended. */
  accountStatus?: string | null;
  /** ISO timestamp the user asked to delete the account (status='deleting'); null otherwise. */
  deletionRequestedAt?: string | null;
  /** Whether the user has a password credential set (false for phone/social-only registrants). */
  hasPassword: boolean;
}

export interface ConsoleOrganizationProfile {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: "personal" | "organization";
  status: "trial" | "active" | "suspended" | "cancelled";
  createdAt: string | null;
  /** Content hash of the stored logo; null = no custom logo. FE builds the URL. */
  logoHash: string | null;
  description: string | null;
  industry: string | null;
  scale: string | null;
  website: string | null;
  // Contact / admin (§3.3)
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** 联系人关联的成员;关联时姓名 / 邮箱 / 电话取自成员资料。 */
  contactUserId: string | null;
  /** 称呼:mr 先生 / ms 女士 / null 未设定。 */
  contactSalutation: "mr" | "ms" | null;
  countryCode: string | null;
  address: string | null;
  postalCode: string | null;
  isBillingRecipient: boolean;
  // Localization (§3.6)
  timezone: string | null;
  language: string | null;
  currency: string | null;
  // Verification (KYC §3.4) — deferred; read-only summary, skeleton only.
  verifiedStatus:
    | "unverified"
    | "pending"
    | "verified"
    | "rejected"
    | "superseded"
    | null;
  updatedAt: string | null;
}

export interface ConsoleTenantRole {
  id: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  status: "active" | "disabled";
  isSystem: boolean;
  permissions: ConsoleTenantPermission[];
}

export interface ConsoleTenantPermission {
  id: string;
  permissionCode: string;
  permissionName: string;
  /** menu = 板块/页面节点;api = 操作码。 */
  permissionType: "menu" | "api";
  description: string | null;
  /** 父节点码(板块 → 页面 → 操作);根节点 null。 */
  parentCode: string | null;
  /** 页面节点的路由;板块与操作码为 null。 */
  routePath: string | null;
  category: string | null;
  sort: number;
}

export interface MemberRecord {
  id: string;
  accountId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  email: string;
  phone: string | null;
  role: string;
  roleCode: string | null;
  roleId: string | null;
  status: "Active" | "Invited" | "Suspended";
  statusCode: "active" | "inactive" | "banned";
  lastActive: string;
  team: string;
  joinedAt: string;
  isPrimaryOwner: boolean;
  /** Invited 行:邀请到期时刻(ISO);在册成员为 null。 */
  invitationExpiresAt?: string | null;
}

export interface TenantContext {
  id: string;
  name: string;
  mode: "platform" | "tenant";
  workspace: string;
  tenantType?: "personal" | "organization";
  tenantCode?: string;
  /** Human-friendly tenant number (tenancy.tenants.tenant_no "可视码"), bigint as string; null when unavailable. */
  tenantNo?: string | null;
  /** Default workspace display name; null when unresolved. UUID 禁展示（owner 2026-08-20）——前端一律用这里的名称+可视码。 */
  workspaceName?: string | null;
  /** Workspace 可视码（tenancy.workspaces.workspace_no，15 位 = 租户号 12 位 + 序号 3 位），bigint as string；null when unavailable. */
  workspaceNo?: string | null;
  status?: string;
}

export interface RequestContext {
  auth?: JwtAccessPayload;
  user?: ConsoleUser;
  tenant?: TenantContext;
  capabilities?: Capability[];
}

/** A tenant/workspace the user belongs to (my-workspaces, §1.6/§4.1). */
export interface ConsoleWorkspaceItem {
  tenantId: string;
  tenantName: string;
  tenantType: "personal" | "organization";
  role: string;
  workspaceId: string | null;
  workspaceName: string | null;
  isCurrent: boolean;
  /** ISO timestamp the user joined this tenant (tenant_membership.created_at). */
  joinedAt: string | null;
}

export interface AiModelRecord {
  id: string;
  providerId: string | null;
  modelCode: string;
  modelName: string;
  provider: string;
  endpointUrl: string;
  protocol: string;
  capabilities: string[];
  keyReference: {
    source: "env";
    name: string;
    configured: boolean;
  } | null;
  isActive: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// 「模型授权」(tenant↔model)的租户视图随批 7 退役:那是 Atlas 自己标注为不应
// 存在的 legacy 轴,管理面已随 #129 删除,console 侧最后一个消费方(/atlas 的授权表)
// 改读产品权益(tenant↔product)。Atlas 上游端点仍在,只是本平台不再代理。

/**
 * Entitlement as the tenant sees it (`GET /tenancy/quotas`, atlas #74) —
 * read from the platform's own C2 envelope, not atlas's legacy
 * `tenant_subscription_quotas` stub (TD-005, always empty). `status`
 * distinguishes "resolved with no coverage" (atlas's plan catalog is still
 * an unpublished draft — expected today) from "could not ask the
 * platform" — the stub could express neither.
 */
export interface TenancyQuotaResponse {
  workspaceId: string;
  tier: string | null;
  bundled: boolean;
  limits: Record<string, number>;
  pools: Array<{
    metric: string;
    limit: number;
    remaining: number;
    priority: number;
  }>;
  status: "covered" | "uncovered" | "unavailable";
}

/**
 * Usage as the tenant sees it (`GET /tenancy/usage`, atlas #70) — sourced
 * from atlas's own request log (`reqlog`), not the platform's billing
 * ledger. Explicitly NOT a cost/billing figure; the billing basis is the
 * platform's `usage_events` summed over the subscription period.
 */
export interface TenancyUsageResponse {
  scope: "workspace" | "tenant";
  scopeId: string;
  from: string;
  to: string;
  rows: Array<{
    modelCode: string | null;
    providerCode: string | null;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    errors: number;
  }>;
  source: "atlas.reqlog";
}
