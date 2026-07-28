import type { JwtAccessPayload } from "@vxture/core-auth";

export type Capability =
  | "platform.tenant.manage"
  | "platform.product.manage"
  | "platform.pricing.manage"
  | "platform.model.manage"
  | "tenant.user.manage"
  | "tenant.role.manage"
  | "tenant.subscription.read"
  | "tenant.billing.read"
  | "tenant.invoice.manage"
  | "tenant.payment.manage"
  | "tenant.quota.read";

export interface ConsoleUser {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
  roleLabel: string;
  username?: string;
  phone?: string | null;
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
  /** Account status: active | suspended. */
  accountStatus?: string | null;
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
  countryCode: string | null;
  address: string | null;
  postalCode: string | null;
  isBillingRecipient: boolean;
  // Localization (§3.6)
  timezone: string | null;
  language: string | null;
  currency: string | null;
  // Verification (KYC §3.4) — deferred; read-only summary, skeleton only.
  verifiedStatus: "unverified" | "pending" | "verified" | "rejected" | null;
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
  permissionType: string | null;
  description: string | null;
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

export type ModelApplicationType =
  | "agent"
  | "workflow"
  | "api_client"
  | "internal_service";

/**
 * Tenant-facing grant view (`GET /tenancy/grants`, atlas `vxture-atlas`#74).
 * Deliberately narrower than the operator view (`/capability/grants`) —
 * `reason` is an operator's internal justification and atlas does not
 * project it here; scope (which workspace) comes from the S2S token, not a
 * field on the record.
 */
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
