import type { SubscriptionStatus } from "@vxture-platform/shared";

export type Capability = string;

export interface ConsoleUser {
  id: string;
  name: string;
  roleRank?: number;
  /** Own email verified state (TD-017 §③) — false ⇒ needs self-service re-verify. */
  emailVerified?: boolean;
  displayName?: string;
  email: string;
  roleLabel: string;
  roleI18nKey?: string;
  roleNameEn?: string;
  username?: string;
  phone?: string | null;
}

export interface ConsoleUserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
}

export interface ConsoleOrganizationProfile {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: "company" | "individual";
  status: "trial" | "active" | "suspended" | "cancelled";
  logoUrl: string | null;
  description: string | null;
  language: string;
  timeZone: string;
  companyName: string | null;
  unifiedSocialCreditCode: string | null;
  businessLicenseUrl: string | null;
  industry: string | null;
  scale: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  countryCode: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  postalCode: string | null;
  verifiedStatus: "unverified" | "pending" | "verified" | "rejected" | null;
  verifiedAt: string | null;
  rejectedReason: string | null;
  primaryDomain: string | null;
  updatedAt: string | null;
}

export interface BreadcrumbItem {
  href: string;
  label: string;
}

export interface SessionSnapshot {
  isAuthenticated: boolean;
  user: ConsoleUser | null;
  capabilities: Capability[];
}

export type PlatformGovernanceKind =
  | "admins"
  | "secrets"
  | "jobs"
  | "approvals";
export type PlatformGovernanceStatus =
  | "normal"
  | "warning"
  | "blocked"
  | "pending";

export interface PlatformGovernanceRecord {
  id: string;
  name: string;
  status: PlatformGovernanceStatus;
  scope: string;
  owner: string;
  policy: string;
  updatedAt: string;
  description: string;
  tags: string[];
}

export interface ModuleCardStat {
  label: string;
  value: string;
  hint: string;
}

export interface SummaryMetric {
  label: string;
  value: string;
  trend?: string;
  tone?: "default" | "positive" | "warning";
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

export interface TenantPermissionRecord {
  id: string;
  permissionCode: string;
  permissionName: string;
  permissionType: string | null;
  description: string | null;
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

export type DevServiceSource = "dev-tools" | "dev-panel";

export interface DevServiceHealthCheck {
  label: string;
  url: string;
  status: number | string | null;
  okStatuses: number[] | null;
  durationMs: number;
  ok: boolean;
}

export interface DevServiceSnapshot {
  id: string;
  name: string;
  port: number;
  priority: number;
  url: string;
  command: string;
  running: boolean;
  listening: boolean;
  healthy: boolean;
  health: DevServiceHealthCheck[];
  pid: number | null;
  startedAt: string | null;
  uptimeMs: number | null;
  uptime: string;
  stopping: boolean;
  logs: string[];
  source?: DevServiceSource;
}

export type ModelApplicationType =
  | "agent"
  | "workflow"
  | "api_client"
  | "internal_service";

export interface AiModelGrantRecord {
  id: string;
  modelId: string;
  tenantId: string;
  applicationId: string | null;
  applicationType: ModelApplicationType | null;
  agentId: string | null;
  priority: number;
  reason: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderRecord {
  id: string;
  providerCode: string;
  providerType: string;
  providerName: string;
  description: string | null;
  homepageUrl: string | null;
  consoleUrl: string | null;
  billingUrl: string | null;
  isActive: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPriceRuleRecord {
  id: string;
  modelId: string;
  billingMode: string;
  currency: string;
  unitTokens: number;
  inputUnitPrice: string;
  outputUnitPrice: string;
  requestUnitPrice: string;
  isActive: boolean;
  effectiveAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPolicyRecord {
  id: string;
  tenantId: string | null;
  modelId: string | null;
  policyCode: string;
  policyName: string;
  policyType: string;
  priority: number;
  dailyTokenLimit: string | null;
  monthlyTokenLimit: string | null;
  dailyRequestLimit: string | null;
  monthlyRequestLimit: string | null;
  allowFallback: boolean;
  fallbackModelCodes: string[];
  config: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantQuotaRecord {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  quotaCycle: string;
  periodStart: string | null;
  periodEnd: string | null;
  maxUsers: number | null;
  maxAgents: number | null;
  maxKnowledgeBases: number | null;
  maxStorageGb: number | null;
  periodTokens: string | null;
  usedTokens: string;
  allowedModelIds: string[];
  allowCustomModel: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUsageSummaryRecord {
  id: string;
  tenantId: string;
  applicationId: string | null;
  applicationType: ModelApplicationType | null;
  cycleMonth: string;
  statType: string;
  totalRequests: string;
  successRequests: string;
  failedRequests: string;
  totalInputTokens: string;
  totalOutputTokens: string;
  totalTokens: string;
  totalCostAmount: string;
  currency: string;
  updatedAt: string;
}

export interface ProductAgentRecord {
  id: string;
  agentCode: string;
  agentName: string;
  description: string;
  agentType: "chat" | "business";
  status: "active" | "inactive";
  visibility: "public" | "private" | "internal";
  defaultModelCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductModelPolicyRecord {
  id: string;
  subjectType: "tenant" | "platform";
  subjectId: string;
  subjectName: string;
  scopeType: "product" | "new_product_default" | "tenant_default";
  scopeCode: string;
  scopeName: string;
  isDefined: boolean;
  productCode: string;
  productName: string;
  productRegion: "domestic" | "international" | null;
  agentId: string | null;
  agentCode: string | null;
  agentName: string;
  modelCode: string | null;
  quotaTokens: number;
  isUnlimited: boolean;
  priority: number;
  isActive: boolean;
  cycle: "monthly";
  note: string | null;
}

export interface ProductReleasePrice {
  id: string;
  currency: string;
  price: number;
  originalPrice: number;
  periodType: "monthly" | "yearly";
  periodValue: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface ProductReleaseFeature {
  code: string;
  name: string;
  type: "quota" | "function";
  quotaValue: number | null;
  isUnlimited: boolean;
  config: Record<string, unknown> | null;
}

export interface ProductReleaseRecord {
  id: string;
  productCode: string;
  productName: string;
  productRegion: "domestic" | "international";
  productStatus: "active" | "draft" | "archived";
  releaseCode: string;
  releaseName: string;
  description: string;
  releaseType: "standard" | "custom";
  versionLabels: string[];
  isFree: boolean;
  isPublic: boolean;
  isActive: boolean;
  prices: ProductReleasePrice[];
  features: ProductReleaseFeature[];
  allowedAgents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductPlanPrice {
  id: string;
  currency: string;
  price: number;
  originalPrice: number;
  periodType: "monthly" | "yearly";
  periodValue: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface ProductPlanFeature {
  code: string;
  name: string;
  type: "quota" | "function";
  quotaValue: number | null;
  isUnlimited: boolean;
  config: Record<string, unknown> | null;
}

export interface ProductPlanAgent {
  id: string;
  agentCode: string;
  agentName: string;
  agentType: "chat" | "business";
  status: "active" | "inactive" | "draft";
}

export interface AuditLogRecord {
  id: string;
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  module: string;
  ip: string | null;
  result: "success" | "failure";
  errorMessage: string | null;
  createdAt: string;
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  type: "system" | "maintenance" | "marketing" | "security";
  severity: "info" | "warning" | "critical";
  status: "draft" | "published" | "archived";
  targetScope: "all" | "trial" | "active" | "custom";
  targetPlans: string[];
  targetTenantTypes: string[];
  publishAt: string;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── TD-021 governance records（镜像 bff-admin console.types）──────────────

export interface RiskRecordItem {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantNo: string | null;
  riskLevel: "normal" | "follow_up" | "high";
  riskScore: number | null;
  scope: string | null;
  reason: string;
  reviewerId: string | null;
  reviewerName: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceEventItem {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  eventType: string;
  status: "open" | "in_review" | "resolved" | "dismissed";
  regulationCode: string | null;
  evidenceUrl: string | null;
  handlerId: string | null;
  handlerName: string | null;
  detail: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagRecord {
  id: string;
  flagKey: string;
  category: string;
  environment: string;
  description: string | null;
  isGloballyEnabled: boolean;
  isArchived: boolean;
  rolloutPercentage: number;
  tenantOverrides: Record<string, boolean>;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSettingRecord {
  id: string;
  configGroup: string;
  configKey: string;
  valueType: "string" | "int" | "bool" | "json";
  configValue: string;
  isSensitive: boolean;
  isEncrypted: boolean;
  isReadonly: boolean;
  isMasked: boolean;
  isEditable: boolean;
  validationRule: string | null;
  description: string | null;
  updatedAt: string;
}

export interface NotificationLogRecord {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  accountId: string | null;
  channel: string;
  templateCode: string;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  recipient: string;
  subject: string | null;
  provider: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  retryCount: number;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

export interface SkillRecord {
  id: string;
  skillCode: string;
  skillName: string;
  description: string;
  category: string;
  endpointUrl: string | null;
  version: string;
  status: "active" | "disabled" | "draft";
  invocations: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPlanRecord {
  id: string;
  planCode: string;
  planName: string;
  description: string;
  planType: string;
  level: number;
  isFree: boolean;
  isPublic: boolean;
  isActive: boolean;
  subscriptionCount: number;
  prices: ProductPlanPrice[];
  features: ProductPlanFeature[];
  agents: ProductPlanAgent[];
  createdAt: string;
  updatedAt: string;
}

export type ProductCapabilityStatus = "active" | "draft" | "archived";
export type ProductCapabilityVisibility = "public" | "internal";
export type ProductCapabilityType =
  | "platform"
  | "agent"
  | "model"
  | "data"
  | "service";
export type ProductCapabilitySource = "self" | "partner";
export type ProductCapabilityRegion = "domestic" | "international" | "global";
export type ProductCapabilityIntegrationStatus =
  | "connected"
  | "config_required"
  | "testing"
  | "not_required";
export type ProductCapabilityHealthStatus = "normal" | "warning" | "disabled";

export interface ProductCapabilityRelatedSolution {
  solutionCode: string;
  solutionName: string;
  role: string;
  status: ProductCapabilityStatus;
  tierNames: string[];
}

export interface ProductCapabilityRelease {
  releaseCode: string;
  releaseName: string;
  status: ProductCapabilityStatus;
  isActive: boolean;
  versionLabels: string[];
}

export interface ProductCapabilityIntegration {
  providerName: string;
  providerType: ProductCapabilitySource;
  status: ProductCapabilityIntegrationStatus;
  endpoint: string | null;
  protocol: string;
  authMode: string;
  settlementMode: string | null;
  lastCheckedAt: string | null;
}

export interface ProductCapabilityMetricRule {
  metricCode: string;
  metricName: string;
  unit: string;
  cycle: string;
  quotaBase: string;
  billingMode: string;
}

export interface ProductCapabilityRecord {
  id: string;
  productCode: string;
  productName: string;
  description: string;
  productType: ProductCapabilityType;
  source: ProductCapabilitySource;
  status: ProductCapabilityStatus;
  visibility: ProductCapabilityVisibility;
  region: ProductCapabilityRegion;
  ownerTeam: string;
  capabilitySummary: string;
  accessModes: string[];
  tags: string[];
  meteringUnit: string;
  billingMode: string;
  healthStatus: ProductCapabilityHealthStatus;
  integration: ProductCapabilityIntegration;
  metrics: ProductCapabilityMetricRule[];
  relatedSolutions: ProductCapabilityRelatedSolution[];
  releases: ProductCapabilityRelease[];
  solutionCount: number;
  planCount: number;
  releaseCount: number;
  modelPolicyCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ProductSolutionStatus = ProductCapabilityStatus;
export type ProductSolutionVisibility = ProductCapabilityVisibility;
export type ProductSolutionCapabilityType = ProductCapabilityType;
export type ProductSolutionCapabilitySource = ProductCapabilitySource;
export type ProductSolutionTierCode = "free" | "pro" | "enterprise" | "custom";

export interface ProductSolutionCapability {
  id: string;
  productCode: string;
  productName: string;
  productType: ProductSolutionCapabilityType;
  source: ProductSolutionCapabilitySource;
  role: string;
  status: ProductSolutionStatus;
}

export interface ProductSolutionTier {
  tierCode: ProductSolutionTierCode;
  tierName: string;
  summary: string;
  status: ProductSolutionStatus;
  isPublic: boolean;
}

export interface ProductSolutionRecord {
  id: string;
  solutionCode: string;
  solutionName: string;
  description: string;
  industry: string;
  scenario: string;
  customerSegment: string;
  status: ProductSolutionStatus;
  visibility: ProductSolutionVisibility;
  ownerTeam: string;
  subscriptionCount: number;
  activeTenantCount: number;
  monthlyRevenue: number;
  tags: string[];
  products: ProductSolutionCapability[];
  tiers: ProductSolutionTier[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductSolutionServicePlanSummary {
  tierCode: ProductSolutionTierCode;
  tierName: string;
  summary: string;
  status: ProductSolutionStatus;
  isPublic: boolean;
  priceLabel: string;
}

export interface ProductSolutionDetailRecord extends ProductSolutionRecord {
  deliveryMode: string;
  deliveryBoundaries: string[];
  relatedServicePlans: ProductSolutionServicePlanSummary[];
}

export interface ProductServicePlanPrice {
  priceLabel: string;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  periodType: "monthly" | "yearly" | "contract";
  periodValue: number;
}

export interface ProductServicePlanEntitlement {
  productCode: string;
  productName: string;
  productType: ProductSolutionCapabilityType;
  source: ProductSolutionCapabilitySource;
  role: string;
  included: boolean;
  quotaSummary: string;
  note: string;
}

export interface ProductServicePlanDetailRecord {
  id: string;
  solutionCode: string;
  solutionName: string;
  industry: string;
  scenario: string;
  customerSegment: string;
  ownerTeam: string;
  tierCode: ProductSolutionTierCode;
  tierName: string;
  summary: string;
  status: ProductSolutionStatus;
  isPublic: boolean;
  price: ProductServicePlanPrice;
  subscriptionCount: number;
  activeTenantCount: number;
  deliveryMode: string;
  applicableScope: string[];
  salesNotes: string[];
  entitlements: ProductServicePlanEntitlement[];
  includedProductCount: number;
  excludedProductCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TenantOperationStatus =
  | "trial"
  | "active"
  | "suspended"
  | "cancelled";
export type TenantOperationType = "company" | "individual";
export type TenantVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";
export type TenantRiskLevel = "normal" | "follow_up" | "high";

export interface TenantOperationMember {
  id: string;
  accountCode?: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "invited" | "suspended";
  registeredAt?: string;
  activatedAt?: string | null;
  lastActiveAt: string;
  lastActiveIp?: string | null;
}

export interface TenantOperationSubscription {
  id: string;
  productName: string;
  releaseName: string;
  planName: string;
  status: "trial" | "active" | "past_due" | "cancelled";
  seats: number;
  monthlyRevenue: number;
  startedAt: string;
  renewsAt: string | null;
}

export interface TenantOperationUsageMetric {
  code: string;
  label: string;
  used: number;
  quota: number | null;
  unit: string;
  trend: string;
  status: "normal" | "warning" | "danger";
}

export interface TenantOperationModelPolicy {
  id: string;
  agentName: string;
  productName: string;
  modelCode: string;
  quotaTokens: number;
  usedTokens: number;
  state: "effective" | "limited" | "undefined" | "disabled";
  source: "product" | "tenant" | "default";
}

export interface TenantOperationAuditEvent {
  id: string;
  action: string;
  actor: string;
  at: string;
  result: "success" | "warning" | "danger";
}

export interface TenantOperationTicket {
  id: string;
  title: string;
  status: "open" | "processing" | "blocked" | "closed";
  priority: "p0" | "p1" | "p2" | "p3";
  updatedAt: string;
}

export interface SupportTicketRecord extends TenantOperationTicket {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  tenantStatus: TenantOperationStatus;
  tenantRiskLevel: TenantRiskLevel;
  region: string;
  industry: string;
  ownerName: string;
}

export interface TenantOperationRecord {
  id: string;
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: TenantOperationType;
  status: TenantOperationStatus;
  verifiedStatus: TenantVerificationStatus;
  verificationSubmittedAt?: string | null;
  verifiedAt?: string | null;
  riskLevel: TenantRiskLevel;
  region: string;
  industry: string;
  scale: string;
  ownerName: string;
  ownerEmail: string;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  lastActiveAt: string;
  memberCount: number;
  activeMemberCount: number;
  adminCount: number;
  subscriptionCount: number;
  productCount: number;
  monthlyRevenue: number;
  monthlyCost: number;
  grossMarginRate: number;
  tokenUsed: number;
  tokenQuota: number;
  ticketOpenCount: number;
  satisfaction: number;
  sla: string;
  tags: string[];
  notes: string;
  members: TenantOperationMember[];
  subscriptions: TenantOperationSubscription[];
  usage: TenantOperationUsageMetric[];
  modelPolicies: TenantOperationModelPolicy[];
  auditEvents: TenantOperationAuditEvent[];
  tickets: TenantOperationTicket[];
}

// 工单时间线事件（评论 / 指派 / 状态变更），append-only 事件流。
export interface TicketCommentRecord {
  id: string;
  ticketId: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// 租户成员（tenant_memberships join account.users + access.roles）。
export interface TenantMemberRecord {
  membershipId: string;
  userId: string;
  name: string;
  account: string;
  email: string;
  userStatus: string;
  roleId: string;
  roleScope: string;
  roleCode: string;
  roleName: string;
  status: string; // active | suspended | removed
  title: string | null;
  department: string | null;
  createdAt: string;
  updatedAt: string;
}

// 租户实名审核（kyc.tenant_verifications join tenancy.tenants）。
export interface TenantVerificationRecord {
  id: string;
  tenantId: string;
  tenantNo: string;
  tenantName: string;
  tenantType: string; // personal | organization
  tenantStatus: string; // active | suspended | deleted
  verificationType: string; // individual | enterprise
  businessLicenseNo: string | null;
  businessLicenseImageRef: string | null;
  legalPersonName: string | null;
  status: TenantVerificationStatus; // unverified | pending | verified | rejected
  reviewerId: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 订阅态直接采用 `@vxture-platform/shared` 的六值，**不再自建一份**。
 *
 * 自建那份与权威差两个词，而其中一个是错译：admin 把库里的 `expired`（权益已终止）
 * 映射成 `overdue`（欠费宽限、权益仍在），两者含义正好相反；库里真正的 `overdue`
 * 反而没有分支，落进 `default` 显示成"正常"。声明里还有个 `expiring`（即将到期），
 * 没有任何 router 产出过它——幻影值，配了颜色但永远不出现。
 *
 * 值域权威在 @shared，DDL 与它对齐由 guardrail 校验；产品侧对齐它，不反向迁就。
 */
export type SubscriptionOperationStatus = SubscriptionStatus;
export type SubscriptionOperationCycle = "monthly" | "yearly" | "once";
export type SubscriptionOperationQuotaRisk = "normal" | "warning" | "danger";
export type SubscriptionOperationAction =
  | "renew"
  | "suspend"
  | "resume"
  | "cancel";
export type SubscriptionSolutionAssociationSource =
  | "industry_rule"
  | "legacy_plan";

export interface SubscriptionOperationQuotaSnapshot {
  maxUsers: number;
  periodTokens: number;
  usedTokens: number;
  usageRate: number;
  quotaCycle: SubscriptionOperationCycle;
  allowedModelCount: number;
  allowCustomModel: boolean;
  risk: SubscriptionOperationQuotaRisk;
}

export interface SubscriptionSolutionAssociation {
  solutionCode: string | null;
  solutionName: string;
  tierCode: ProductSolutionTierCode;
  tierName: string;
  source: SubscriptionSolutionAssociationSource;
  note: string;
}

export interface SubscriptionEntitlementSnapshot {
  productCode: string;
  productName: string;
  productType: ProductSolutionCapabilityType;
  source: ProductSolutionCapabilitySource;
  included: boolean;
  quotaSummary: string;
  note: string;
}

export interface SubscriptionOperationEvent {
  id: string;
  title: string;
  description: string;
  actor: string;
  at: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

export interface SubscriptionOperationRecord {
  id: string;
  subscriptionCode: string;
  orderNo: string | null;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  tenantStatus: TenantOperationStatus;
  region: string;
  industry: string;
  solutionCode: string | null;
  solutionName: string;
  servicePlanCode: string;
  servicePlanName: string;
  /** 机器可读的等级码。`tierName` 是展示名（已本地化），做不了映射。 */
  tierCode: ProductSolutionTierCode;
  tierName: string;
  status: SubscriptionOperationStatus;
  rawStatus: string;
  cycleType: SubscriptionOperationCycle;
  autoRenew: boolean;
  currency: string;
  payAmount: number;
  monthlyRevenue: number;
  quota: SubscriptionOperationQuotaSnapshot;
  operatorName: string;
  operationHint: string;
  startAt: string;
  endAt: string | null;
  trialEndAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionOperationDetailRecord extends SubscriptionOperationRecord {
  solutionAssociation: SubscriptionSolutionAssociation;
  entitlementSnapshot: SubscriptionEntitlementSnapshot[];
  operationTimeline: SubscriptionOperationEvent[];
}

export type OrderOperationStatus =
  | "pending"
  | "pending_verify"
  | "confirmed"
  | "overdue"
  | "closed"
  | "abnormal"
  // product_321 §4.2 — non-terminal money states surfaced to operators:
  | "paid_unprovisioned"
  | "partial_pending";
export type OrderPaymentStatus =
  | "not_required"
  | "unpaid"
  | "pending"
  | "pending_verify"
  | "paid"
  | "partial"
  | "failed"
  | "closed"
  | "refunding";
export type OrderPaySource = "online" | "offline" | "voucher" | "none";
export type OrderOfflinePaymentType = "bank_transfer" | "cash" | "other";

export interface OrderInvoiceItemRecord {
  id: string;
  itemName: string;
  itemType: string;
  itemUnit: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  remark: string | null;
}

export interface OrderPaymentRecord {
  id: string;
  paymentNo: string;
  paySource: OrderPaySource;
  payMethod: string | null;
  offlinePayType: OrderOfflinePaymentType | null;
  offlinePayerName: string | null;
  paidAmount: number;
  currency: string;
  paymentStatus: OrderPaymentStatus;
  paidAt: string | null;
  operatorName: string;
  remark: string | null;
}

export interface OrderOperationEvent {
  id: string;
  title: string;
  description: string;
  actor: string;
  at: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

export interface OrderOperationRecord {
  id: string;
  orderNo: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  region: string;
  industry: string;
  solutionCode: string | null;
  solutionName: string;
  servicePlanCode: string;
  servicePlanName: string;
  tierName: string;
  subscriptionId: string;
  subscriptionStatus: SubscriptionOperationStatus;
  cycleType: SubscriptionOperationCycle;
  orderStatus: OrderOperationStatus;
  /** True when this cancelled/expired order was never activated and can be undone via restoreOrder. */
  restorable: boolean;
  paymentStatus: OrderPaymentStatus;
  paySource: OrderPaySource;
  payMethod: string | null;
  billId: string | null;
  billNo: string | null;
  billStatus: string | null;
  paymentId: string | null;
  paymentNo: string | null;
  amount: number;
  paidAmount: number;
  currency: string;
  operatorName: string;
  operationHint: string;
  /** Customer payment declaration on the in-flight leg (product_321 P1). */
  declaredPayment: {
    channel: string | null;
    payerName: string | null;
    transactionNo: string | null;
    remark: string | null;
    amount: number;
    declaredAt: string;
  } | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface OrderOperationDetailRecord extends OrderOperationRecord {
  invoiceItems: OrderInvoiceItemRecord[];
  paymentRecords: OrderPaymentRecord[];
  operationTimeline: OrderOperationEvent[];
}

export type PaymentReconciliationStatus =
  | "normal"
  | "pending_verify"
  | "partial"
  | "overpaid"
  | "bill_cancelled"
  | "failed"
  | "unlinked";

export interface PaymentOperationRecord {
  id: string;
  paymentNo: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  region: string;
  industry: string;
  billId: string | null;
  billNo: string | null;
  billStatus: BillingBillStatus | null;
  billType: BillingBillType | null;
  billPayableAmount: number;
  billPaidAmount: number;
  subscriptionId: string | null;
  orderNo: string | null;
  servicePlanName: string | null;
  tierName: string | null;
  paySource: OrderPaySource;
  payChannel: string | null;
  payMethod: string | null;
  offlinePayType: OrderOfflinePaymentType | null;
  offlinePayerName: string | null;
  totalAmount: number;
  paidAmount: number;
  currency: string;
  paymentStatus: OrderPaymentStatus;
  reconciliationStatus: PaymentReconciliationStatus;
  transactionId: string | null;
  channelOrderNo: string | null;
  channelTransactionNo: string | null;
  offlineEvidenceUrl: string | null;
  statusMessage: string | null;
  remark: string | null;
  operatorName: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UsageMeteringRisk = "normal" | "warning" | "danger" | "anomaly";

export interface UsageMeteringRecord {
  id: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  region: string;
  industry: string;
  subscriptionId: string | null;
  orderNo: string | null;
  servicePlanName: string | null;
  productCode: string;
  productName: string;
  productType: string;
  metricCode: string;
  metricName: string;
  metricUnit: string;
  cycleMonth: string;
  usedValue: number;
  quotaValue: number;
  usageRate: number;
  // C15: no source at the usage_summary_months grain — tier is not surfaced on the
  // subscription join, and per-request/token breakdown (requestCount/inputTokens/
  // outputTokens) has no summary column (would need model-runtime usage, out of scope).
  risk: UsageMeteringRisk;
  lastSyncedAt: string;
  updatedAt: string;
}

export type PromotionOperationStatus =
  | "active"
  | "scheduled"
  | "expired"
  | "paused";
export type PromotionOperationType = "discount" | "coupon" | "campaign";

export interface PromotionOperationRecord {
  id: string;
  promotionCode: string;
  promotionName: string;
  promotionType: PromotionOperationType;
  status: PromotionOperationStatus;
  scopeLabel: string;
  discountLabel: string;
  redemptionCount: number;
  tenantCount: number;
  startsAt: string;
  endsAt: string | null;
  ownerName: string;
  description: string;
  updatedAt: string;
  // C15 removed (no clean source): planCode/planName/tierName (voucher_batches has
  // no plan linkage); originalPrice/salePrice/discountAmount/usedAmount (amounts
  // live per-kind in effect JSONB, not a uniform batch price — a proper voucher-
  // amount surface needs an effect-schema-aware design; registered TD-030).
}

export interface PromotionRedemptionRecord {
  id: string;
  redemptionNo: string;
  promotionCode: string;
  promotionName: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  orderNo: string | null;
  billId: string;
  billNo: string;
  billStatus: BillingBillStatus;
  servicePlanName: string | null;
  currency: string;
  orderAmount: number;
  discountAmount: number;
  payableAmount: number;
  // Redemptions are always customer self-service (voucher_redemptions.user_id is a
  // customer, not an operator) — "客户自助" is an honest constant, not a 0-stub.
  operatorName: string;
  redeemedAt: string;
  remark: string | null;
  // C15 removed (no source): status (voucher_redemptions has no status column — a
  // redemption row IS a completed redemption; the applied/reversed states never
  // existed in schema); tierName (not surfaced on the subscription join).
}

export interface CommerceOverviewMetric {
  key: string;
  label: string;
  /** 笔数。给了 `amount` 时它是"多少笔"，卡面把金额当读数、笔数当标。 */
  value: number;
  /** 金额型指标的金额。给了它，`value` 必须是对应的笔数。 */
  amount?: number;
  currency?: string;
  tone: "blue" | "green" | "amber" | "rose";
  /** 口径说明（表名 + 条件），落到 `MetricCard.help` 的 `?`，不进标。 */
  hint: string;
}

export interface CommerceOverviewRiskItem {
  id: string;
  title: string;
  detail: string;
  tone: "green" | "amber" | "rose";
  href: string;
}

export interface CommerceOverviewPlanRevenue {
  planName: string;
  subscriptionCount: number;
  revenueAmount: number;
  currency: string;
  // C15 removed (no source): tierName (not grouped by tier); paidAmount (was a dup
  // of revenueAmount = Σ subscriptions.pay_amount, misleading as "actually paid" —
  // real paid would need a payments join keyed by subscription); discountAmount
  // (never computed — hardcoded 0).
}

export interface CommerceOverviewSnapshot {
  generatedAt: string;
  metrics: CommerceOverviewMetric[];
  risks: CommerceOverviewRiskItem[];
  planRevenue: CommerceOverviewPlanRevenue[];
}

export type BillingBillStatus =
  | "unpaid"
  | "paying"
  | "paid"
  | "partial"
  | "cancelled"
  | "overdue";
export type BillingBillType = "normal" | "adjust" | "supplement" | "prepaid";
export type BillingBillAction =
  | "cancel"
  | "discount"
  | "mark_overdue"
  | "create_adjustment"
  | "create_supplement";
export type BillingInvoiceStatus =
  | "none"
  | "applying"
  | "auditing"
  | "issued"
  | "sending"
  | "finished"
  | "rejected"
  | "red";
export type BillingInvoiceType =
  | "special_vat"
  | "normal_vat"
  | "electronic"
  | "paper"
  | "other";
export type BillingInvoiceTaxType =
  | "enterprise"
  | "individual"
  | "government"
  | "other";
export type BillingInvoiceReceiptAction = "update_shipping" | "finish" | "red";

export interface BillingInvoiceReceiptRecord {
  id: string;
  billId?: string;
  invoiceNo: string;
  invoiceType: BillingInvoiceType;
  invoiceTaxType: BillingInvoiceTaxType;
  invoiceTitle: string;
  taxNo: string | null;
  invoiceAmount: number;
  taxAmount: number;
  currency: string;
  invoiceStatus: BillingInvoiceStatus;
  statusRemark: string | null;
  invoiceCode: string | null;
  invoiceElectronicNo: string | null;
  invoiceFileUrl: string | null;
  issuedAt: string | null;
  expressCompany: string | null;
  expressNo: string | null;
  sendAt: string | null;
  auditorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoiceLedgerRecord extends BillingInvoiceReceiptRecord {
  billId: string;
  billNo: string;
  billStatus: BillingBillStatus;
  billType: BillingBillType;
  billPayableAmount: number;
  billPaidAmount: number;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  region: string;
  industry: string;
  subscriptionId: string | null;
  orderNo: string | null;
  servicePlanName: string | null;
  tierName: string | null;
  sourceLabel: "offline";
}

export interface BillingOperationEvent {
  id: string;
  title: string;
  description: string;
  actor: string;
  at: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

export interface BillingRecord {
  id: string;
  billNo: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  region: string;
  industry: string;
  subscriptionId: string | null;
  orderNo: string | null;
  servicePlanName: string | null;
  tierName: string | null;
  billCycle: string;
  cycleStartDate: string;
  cycleEndDate: string;
  billStatus: BillingBillStatus;
  billType: BillingBillType;
  invoiceStatus: BillingInvoiceStatus;
  invoiceNo: string | null;
  totalAmount: number;
  discountAmount: number;
  payableAmount: number;
  paidAmount: number;
  invoicedAmount: number;
  currency: string;
  paymentMethod: string | null;
  transactionNo: string | null;
  operationRemark: string | null;
  operatorName: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingDetailRecord extends BillingRecord {
  invoiceItems: OrderInvoiceItemRecord[];
  paymentRecords: OrderPaymentRecord[];
  invoiceReceipts: BillingInvoiceReceiptRecord[];
  operationTimeline: BillingOperationEvent[];
}

export type AccountOperationStatus =
  | "active"
  | "invited"
  | "locked"
  | "disabled";

export interface AccountTenantBinding {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  role: string;
  isPrimaryOwner: boolean;
}

export interface AccountOperationRecord {
  id: string;
  accountCode: string;
  displayName: string;
  email: string;
  phone: string | null;
  status: AccountOperationStatus;
  primaryTenantId: string;
  primaryTenantCode: string;
  primaryTenantName: string;
  primaryTenantType: TenantOperationType;
  role: string;
  tenantCount: number;
  registeredAt: string;
  activatedAt: string | null;
  lastActiveAt: string;
  lastActiveIp: string | null;
  lastActiveLocation: string;
  loginCount30d: number;
  tenantBindings: AccountTenantBinding[];
}

/**
 * platform_permissions.perm_type 的真实取值——**小写**，与接口返回一致
 * （`/api/admin-permissions` 实测 2026-08-06：55 条全是 "api"）。
 *
 * 此前声明为大写 MENU|BUTTON|API，前端据此建的查表全部落空，权限树整页崩在
 * `meta.className` 上。类型说的是契约，不是期望。
 */
export type PlatformPermissionType = "menu" | "button" | "api";

export interface PlatformRolePermissionRecord {
  id: string;
  parentId: string | null;
  permCode: string;
  permName: string;
  permType: PlatformPermissionType;
  status: boolean;
  description: string;
  routePath: string | null;
}

export interface PlatformAdminPermissionRecord extends PlatformRolePermissionRecord {
  icon: string | null;
  sort: number;
  component: string | null;
  roleCount: number;
  activeRoleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformRoleRecord {
  id: string;
  roleCode: string;
  /** Role security tier (TD-017). */
  rank: number;
  nameI18nKey: string;
  nameEn: string;
  descriptionI18nKey: string | null;
  description: string;
  isSystem: boolean;
  statusCode: "active" | "disabled" | "archived";
  status: boolean;
  sort: number;
  adminCount: number;
  activeAdminCount: number;
  permissionCount: number;
  menuPermissionCount: number;
  buttonPermissionCount: number;
  apiPermissionCount: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: PlatformRolePermissionRecord[];
}

export interface PlatformAdminRecord {
  id: string;
  sort: number;
  username: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleNameI18nKey: string;
  roleNameEn: string;
  /** Role security tier (TD-017 graded model). */
  roleRank: number;
  /** Server-computed: whether the current actor may manage this operator. */
  canManage?: boolean;
  roleStatusCode: "active" | "disabled" | "archived";
  roleStatus: boolean;
  statusCode: "active" | "disabled" | "locked" | "pending" | "suspended";
  status: boolean;
  isSystem: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}
