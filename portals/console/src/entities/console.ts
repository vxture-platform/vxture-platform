import type { GovernancePermissionCode } from "@vxture/core-utils";

/**
 * 能力 = 成员在当前租户实际持有的治理权限码(access.permissions),由 console-bff
 * 回查下发;码表与蕴含规则的权威在 @vxture/core-utils(tenant-permissions),
 * 前端不再有自己的一套「capability 词汇」。
 */
export type Capability = GovernancePermissionCode;

export interface ConsoleUser {
  id: string;
  name: string;
  displayName?: string;
  email: string;
  roleLabel: string;
  username?: string;
  phone?: string | null;
  /** Platform avatar URL (versioned); null/absent → default silhouette. */
  picture?: string | null;
}

export interface ConsoleUserProfile {
  id: string;
  username: string;
  /** ISO timestamp when the username may next be changed; null = changeable now. */
  usernameChangeableAt?: string | null;
  displayName: string | null;
  /** Platform avatar URL (versioned `/avatar/usr_<id>?v=<hash>`); null → default. */
  picture: string | null;
  /** @deprecated legacy paste-URL field; superseded by `picture`. */
  avatarUrl: string | null;
  bio: string | null;
  email: string | null;
  /** Whether the email is verified. */
  emailVerified?: boolean;
  phone: string | null;
  /** Whether the phone is verified (the primary anchor → normally true). */
  phoneVerified?: boolean;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
  /** Public user number (e.g. "000042"). Returned by BFF when available. */
  userNo?: string | null;
  /** Account creation timestamp (ISO). Returned by BFF when available. */
  accountCreatedAt?: string | null;
  /** Account status: active | suspended. */
  accountStatus?: string | null;
  /** Whether username+password login is disabled (phone/email/social unaffected). */
  accountLoginDisabled?: boolean;
  /** Whether the user has a password credential set (false for phone/social-only registrants). */
  hasPassword?: boolean;
}

export interface IdentityRecord {
  provider: string;
  providerSubject: string;
  connectedAt: string;
}

export interface LastLoginInfo {
  loginAt: string;
  ipAddress: string;
  userAgent: string | null;
  countryCode: string | null;
}

export interface LoginHistoryEntry {
  loginAt: string;
  ipAddress: string;
  userAgent: string | null;
  countryCode: string | null;
  authMethod: string;
  result: string;
}

export interface AuthSessionRecord {
  sid: string;
  authMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
  expiresAt: string;
}

export interface ConsoleWorkspaceItem {
  tenantId: string;
  tenantName: string;
  tenantType: "personal" | "organization";
  role: string;
  workspaceId: string | null;
  workspaceName: string | null;
  isCurrent: boolean;
  /** ISO timestamp the user joined this tenant. */
  joinedAt?: string | null;
}

export interface ConsoleOrganizationProfile {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: "personal" | "organization";
  status: "trial" | "active" | "suspended" | "cancelled";
  createdAt: string | null;
  /** Content hash of the stored logo; null = no custom logo. */
  logoHash: string | null;
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
  /** KYC verification (§3.4) — deferred; read-only summary, skeleton only. */
  verifiedStatus: "unverified" | "pending" | "verified" | "rejected" | null;
  updatedAt: string | null;
}

/** Editable subset of the tenant profile (PUT /api/me/organization). */
export interface OrganizationProfileUpdate {
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

export interface TenantContext {
  id: string;
  name: string;
  mode: "platform" | "tenant";
  workspace: string;
  tenantType?: "personal" | "organization";
  tenantCode?: string;
  /** Human-friendly tenant number ("可视码"), bigint as string; null when unavailable. */
  tenantNo?: string | null;
  /** Default workspace 名称；null 表示 BFF 未解析（部署偏斜等）。UUID 禁展示。 */
  workspaceName?: string | null;
  /** Workspace 可视码（15 位 = 租户号 12 位 + 序号 3 位），bigint as string。 */
  workspaceNo?: string | null;
  status?: string;
}

export interface BreadcrumbItem {
  href: string;
  label: string;
}

export interface SessionSnapshot {
  isAuthenticated: boolean;
  user: ConsoleUser | null;
  tenant: TenantContext | null;
  tenantOptions?: TenantContext[];
  capabilities: Capability[];
}

export interface ModuleCardStat {
  label: string;
  value: string;
  hint: string;
}

export interface SummaryMetric {
  id: string;
  label: string;
  value: string;
  trend?: string;
  tone?: "neutral" | "success" | "warning";
}

export interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: string;
}

export interface MemberRecord {
  id: string;
  accountId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
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
}

export interface TenantRoleRecord {
  id: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  status: "active" | "disabled";
  isSystem: boolean;
  permissions: TenantPermissionRecord[];
}

/** 权限目录一行:菜单节点(板块/页面)与操作码同表,parentCode 表达层级。 */
export interface TenantPermissionRecord {
  id: string;
  permissionCode: string;
  permissionName: string;
  permissionType: "menu" | "api";
  description: string | null;
  parentCode: string | null;
  routePath: string | null;
  category: string | null;
  sort: number;
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

export type ModelApplicationType =
  | "agent"
  | "workflow"
  | "api_client"
  | "internal_service";

/** Tenant-facing grant view (`/api/atlas/grants` → atlas `/tenancy/grants`). */
export interface AiModelGrantRecord {
  id: string;
  modelId: string;
  applicationId: string | null;
  applicationType: ModelApplicationType | null;
  agentId: string | null;
  taskProfile: string | null;
  priority: number;
  expiresAt: string | null;
  isActive: boolean;
}

/**
 * Entitlement envelope (`/api/atlas/quotas` → atlas `/tenancy/quotas`,
 * itself reading the platform's own C2 entitlement) — a single object, not a
 * list. `status` distinguishes "resolved with no coverage" (no plan
 * published yet) from "could not reach the platform".
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
 * Usage envelope (`/api/atlas/usage` → atlas `/tenancy/usage`) —
 * sourced from atlas's own request log, NOT a billing figure. The billing
 * basis is the platform's `usage_events` summed over the subscription
 * period.
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
