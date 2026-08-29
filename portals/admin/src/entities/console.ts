import type {
  ModelState,
  ObjectState,
  PlanVersionStatus,
  SubscriptionStatus,
  Tier,
} from "@vxture-platform/shared";

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

// PlatformGovernance*（审批中心 / 平台密钥）2026-08-31 随页面一起退役：
// admin.governance_record 从未建表，那两页永远为空。

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
  /** 由哪一层契约服务：chat / embedding / rerank / parse。 */
  modelType: string;
  capabilities: string[];
  keyReference: {
    source: "env";
    name: string;
    configured: boolean;
  } | null;
  /**
   * **三值**。`deprecated` 仍可解析、只是不再推荐——admin 这侧尤其要小心：
   * 模型下拉喂的是价格规则与策略，**弃用模型必须还能选到**，它还在服务、还在计费。
   * 用 `isServing` 过滤，不要用 `isEnabled`。
   */
  state: ModelState;
  deprecatedAt: string | null;
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
  taskProfile: string | null;
  priority: number;
  reason: string | null;
  expiresAt: string | null;
  state: ObjectState;
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
  /** 两值。此前声明的 `isActive` atlas 早已不发（product_251 M-B3）。 */
  state: ObjectState;
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
  /** atlas v0.3.0（TD-047）。缓存命中那部分输入 token 的单价 —— DeepSeek 上是未
   *  命中价的 1/30。**`null` 不是「免费」，是「没声明」**：算成本时回退到
   *  `inputUnitPrice`，只会高估不会低估。 */
  cachedInputUnitPrice: string | null;
  state: ObjectState;
  effectiveAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 限流策略。**整个形状换过一遍**——此前这里声明的是
 * `policyCode`/`policyName`/`policyType`/`dailyTokenLimit`/`monthlyTokenLimit`/
 * `dailyRequestLimit`/`monthlyRequestLimit`/`allowFallback`/`fallbackModelCodes`/
 * `config`，**atlas 一个都不发**。它现在给的是下面这些：速率维度（rpm/tpm/tpd）、
 * 并发上限、上下文上限，外加一个生效窗口。
 */
export interface ModelPolicyRecord {
  id: string;
  modelId: string;
  tenantId: string | null;
  name: string | null;
  priority: number;
  maxConcurrent: number | null;
  rateLimitRpm: number | null;
  /** decimal，字符串——不走 JS number 免得丢精度。 */
  rateLimitTpm: string | null;
  rateLimitTpd: string | null;
  maxContextTokens: number | null;
  state: ObjectState;
  effectiveAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 租户配额。**整个形状换过一遍**，而且有一处语义变化要特别记住：
 * **atlas 的配额没有 `state` 也没有 `isActive`** —— 它生不生效完全由
 * `effectiveAt`/`expiresAt` 这个窗口决定，且是**读时判定**（没有定时清扫任务，
 * 因为定时改写会改掉它本该保全的记录）。所以问「有多少条生效中」要用
 * `isInForce()` 算窗口，不能去读一个上游从来没有过的布尔。
 *
 * 此前这里声明的 `periodStart`/`periodEnd`/`maxAgents`/`maxKnowledgeBases`/
 * `maxStorageGb`/`usedTokens`/`allowedModelIds`/`isActive`/`createdAt`/`updatedAt`
 * 全部不存在。
 */
export interface TenantQuotaRecord {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  maxUsers: number;
  maxApiKeys: number;
  maxWorkflows: number;
  maxConcurrent: number;
  rateLimitPerMinute: number;
  periodTokens: string;
  quotaCycle: string;
  allowedModels: string[];
  allowCustomModel: boolean;
  effectiveAt: string;
  expiresAt: string | null;
}

/**
 * 逐字段照 atlas `TenantUsageSummaryAdminRecord`（经 admin-bff 透传）。
 *
 * 2026-08-24 重写：此前这份声明整体是陈旧的——`id` / `statType` / `totalRequests` /
 * `successRequests` / `failedRequests` / `totalCostAmount` / `currency` / `updatedAt`
 * **上游一个都不发**。页面只读了 `totalTokens`（它恰好还在），所以没炸；换句话说
 * 这份类型早已不是契约，只是一段没人核对过的记忆。
 *
 * 聚合轴不在行上，在 `TenantUsageSummaryPage.dimension` 上（product_251 A-4）。
 */
export interface TenantUsageSummaryRecord {
  cycleMonth: string;
  tenantId: string | null;
  workspaceId: string | null;
  applicationId: string | null;
  applicationType: ModelApplicationType | null;
  providerCode: string | null;
  modelCode: string | null;
  endpointCode: string | null;
  productCode: string | null;
  requests: string;
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
  errors: string;
}

/** `/api/atlas/usage-summaries` 的信封（product_251 A-4）：轴由服务端解析，必须回显。 */
export interface TenantUsageSummaryPage {
  dimension: string;
  items: TenantUsageSummaryRecord[];
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

/**
 * 产品发布 = 「某产品的一次已发布套餐版本」（2026-08-31 去 mock 后的定义）。
 *
 * `product` schema 里没有 release 表，也不该有：能对客户"发布"出去的东西只有
 * `product.plan_versions` 里 `status='published'` 的那一行——它冻结了组件、配额与
 * 每周期价格。所以这里一条记录 = 一个已发布 plan_version，产品取该版本 `primary`
 * 组件所指的产品。原 mock 里的 `productRegion`（无此轴）与 `allowedAgents`（无来源）
 * 已删，不再返回。
 */
export type ProductReleasePeriodType =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "perpetual";

export interface ProductReleasePrice {
  id: string;
  currency: string;
  price: number;
  /** plan_prices 没有划线价一列；保留字段形状，恒为 null。 */
  originalPrice: number | null;
  periodType: ProductReleasePeriodType;
  /** plan_prices.cycle_count（季付 = monthly × 3）。 */
  periodValue: number;
  /** 与 `/plans` 端点同一取法：月付优先，其次周期数最小的一条。 */
  isDefault: boolean;
  /** 已发布版本的价格即在售价；版本未发布不会出现在 releases 里。 */
  isActive: boolean;
}

export interface ProductReleaseFeature {
  /** 组件所指产品的 product_code。 */
  code: string;
  name: string;
  /** quota JSON 里有数值 → quota；否则是纯功能开关。 */
  type: "quota" | "function";
  /** quota 本身是单个数值时取它；对象形态（常态）为 null，明细看 `config`。 */
  quotaValue: number | null;
  /** quota 里任一值为 -1（无限哨兵，product_220 §2）。 */
  isUnlimited: boolean;
  /** 组件的 quota JSON 原样。 */
  config: Record<string, unknown> | null;
}

export interface ProductReleaseRecord {
  /** plan_version id（内部句柄，不展示）。 */
  id: string;
  productCode: string;
  productName: string;
  productStatus: ProductCapabilityStatus;
  /** `${plan_code}@v${version_no}`——人读的版本可视码。 */
  releaseCode: string;
  /** plan_name。 */
  releaseName: string;
  description: string;
  /** custom ⇔ products.origin = 'third_party'（三方接入），其余 standard。 */
  releaseType: "standard" | "custom";
  /** 该版本 primary 组件的档位（五档码）。 */
  versionLabels: string[];
  /** 有价格行且全部为 0。无价格行 = 不可售，不算免费。 */
  isFree: boolean;
  isPublic: boolean;
  /** 版本已发布 且 plan.status = 'active'。 */
  isActive: boolean;
  /** 是 plans.current_version_id 指向的那一版（被更新的旧发布版为 false）。 */
  isCurrent: boolean;
  prices: ProductReleasePrice[];
  features: ProductReleaseFeature[];
  /** 版本创建时间。 */
  createdAt: string;
  /** plan.updated_at——发布动作会推它。 */
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

// ── 解决方案（product.solutions / solution_products / solution_plans）────────
// 设计：docs/20-specs/000-platform/admin/70-product-solutions.md（2026-08-31，TD-029 收口）。

/**
 * 与 products / plans 同一套生命周期值域，状态机同 product.products：
 * draft → active ⇄ inactive，任一 → deprecated（终态）。
 * 此前的 active/draft/archived 三态是 mock 口径，随去 mock 废止。
 */
export type ProductSolutionStatus =
  | "draft"
  | "active"
  | "inactive"
  | "deprecated";
/** 由 solutions.is_public 投影：public = 对外售卖开放，internal = 仅内部。 */
export type ProductSolutionVisibility = ProductCapabilityVisibility;
export type ProductSolutionCapabilityType = ProductCapabilityType;
export type ProductSolutionCapabilitySource = ProductCapabilitySource;
/**
 * 方案档位 = 五档商业阶梯本身（@vxture-platform/shared `TIERS`，product_220 §1）。
 *
 * 2026-07-08 曾裁定方案档位（free/pro/enterprise/custom）与商业阶梯是两个概念、不得
 * 合并——那是 mock 时代的展示轴。2026-08-30 owner 定案：服务套餐 = 既有 plan 绑到方案
 * 的一个档位，`product.solution_plans.tier` 的 CHECK 与 `plan_components.tier` 同源，
 * 两者就是同一个东西了。
 */
export type ProductSolutionTierCode = Tier;

export interface ProductSolutionCapability {
  /** product id（内部句柄，仅作 key，不展示）。 */
  id: string;
  productCode: string;
  productName: string;
  productType: ProductSolutionCapabilityType;
  source: ProductSolutionCapabilitySource;
  /** 该产品在方案里扮演的角色（solution_products.role，展示文案）。 */
  role: string;
  status: ProductCapabilityStatus;
  sort: number;
}

/** 方案的一个档位 = 绑在该档上的既有 plan 的投影。 */
export interface ProductSolutionTier {
  tierCode: ProductSolutionTierCode;
  /** plan_name。 */
  tierName: string;
  /** plan.description。 */
  summary: string;
  /** plan.status。 */
  status: ProductSolutionStatus;
  /** plan.is_public。 */
  isPublic: boolean;
  /** 绑定的 plan id（重绑时回送，不展示）。 */
  planId: string;
  planCode: string;
  /** 当前版本月付价的展示串；无价格行 → 「合同报价」。 */
  priceLabel: string;
  /** free = 价格为 0；contract = 无价格行；其余 paid。筛选用，不要拿 priceLabel 去匹配。 */
  priceKind: "free" | "paid" | "contract";
}

export interface ProductSolutionRecord {
  /** solution id（内部句柄，不展示；地址栏走 solutionCode）。 */
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
  /** 绑定 plan 的 active/trialing 订阅数（metering.subscriptions）。 */
  subscriptionCount: number;
  /** 上述订阅去重后的租户数。 */
  activeTenantCount: number;
  /** MRR，定义见 products.router `MRR_MONTHLY_EXPR` 注释。 */
  monthlyRevenue: number;
  tags: string[];
  products: ProductSolutionCapability[];
  tiers: ProductSolutionTier[];
  createdAt: string;
  updatedAt: string;
}

export type ProductSolutionServicePlanSummary = ProductSolutionTier;

export interface ProductSolutionDetailRecord extends ProductSolutionRecord {
  deliveryMode: string;
  deliveryBoundaries: string[];
  relatedServicePlans: ProductSolutionServicePlanSummary[];
}

/** POST /solutions（solutionCode 必填）与 PUT /solutions/:code（改字段）共用。 */
export interface ProductSolutionWriteInput {
  solutionCode?: string;
  solutionName?: string;
  description?: string | null;
  industry?: string | null;
  scenario?: string | null;
  customerSegment?: string | null;
  ownerTeam?: string | null;
  tags?: string[];
  deliveryMode?: string | null;
  deliveryBoundaries?: string[];
  isPublic?: boolean;
}

/** PUT /solutions/:code/products 的一项：productCode 或 productId 二选一。 */
export interface ProductSolutionProductInput {
  productId?: string;
  productCode?: string;
  role?: string | null;
  sort?: number;
}

/** PUT /solutions/:code/plans/:tier：planId 或 planCode 二选一。 */
export interface ProductSolutionPlanBindInput {
  planId?: string;
  planCode?: string;
}

export interface ProductServicePlanPrice {
  priceLabel: string;
  price: number | null;
  /** plan_prices 无划线价；恒 null。 */
  originalPrice: number | null;
  currency: string;
  /** cycle_unit month → monthly，year → yearly；其余周期或无价格行 → contract。 */
  periodType: ProductReleasePeriodType | "contract";
  periodValue: number;
}

export interface ProductServicePlanEntitlement {
  productCode: string;
  productName: string;
  productType: ProductSolutionCapabilityType;
  source: ProductSolutionCapabilitySource;
  /** 方案里的角色；不在方案产品清单里的组件用 component_role。 */
  role: string;
  /** true = 是该 plan 当前版本的组件；false = 在方案里但该套餐不含。 */
  included: boolean;
  /** 组件 quota JSON 的紧凑渲染（`key value` 以 · 连接；-1 → 不限）。 */
  quotaSummary: string;
  /** 组件开放的功能键（features）以 、 连接；不含时为空。 */
  note: string;
}

export interface ProductServicePlanDetailRecord {
  /** `${solutionCode}:${tierCode}`（合成键，不展示）。 */
  id: string;
  solutionCode: string;
  solutionName: string;
  industry: string;
  scenario: string;
  customerSegment: string;
  ownerTeam: string;
  tierCode: ProductSolutionTierCode;
  tierName: string;
  planCode: string;
  summary: string;
  status: ProductSolutionStatus;
  isPublic: boolean;
  /** 取价与权益所用的版本：优先 plans.current_version_id，否则最新版。 */
  versionNo: number | null;
  versionStatus: PlanVersionStatus | null;
  price: ProductServicePlanPrice;
  subscriptionCount: number;
  activeTenantCount: number;
  monthlyRevenue: number;
  deliveryMode: string;
  entitlements: ProductServicePlanEntitlement[];
  includedProductCount: number;
  excludedProductCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 订阅记录上的档位：绑在方案上的 plan 用五档码；plan 组件没有可识别档位
 * （bundled 组件、越梯的 override）时为 custom——它是"谈出来的"，不在价目表上。
 */
export type SubscriptionTierCode = ProductSolutionTierCode | "custom";

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
  tierCode: SubscriptionTierCode;
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
  tierCode: SubscriptionTierCode;
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
  /** 平台预置（seed 灌入）还是运营自建。此前前端拿不到这一列，只能从
   *  permCode 的命名空间猜；59 个三段操作码因此全被误标成「自定义」。 */
  isSystem: boolean;
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
