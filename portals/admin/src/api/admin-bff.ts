import type { ObjectState, TicketStatus } from "@vxture-platform/shared";
import type {
  AccountOperationDetailRecord,
  AccountOperationRecord,
  AnnouncementRecord,
  Capability,
  BillingBillAction,
  AiModelGrantRecord,
  AiModelRecord,
  BillingDetailRecord,
  BillingInvoiceLedgerRecord,
  BillingInvoiceReceiptAction,
  BillingInvoiceStatus,
  BillingInvoiceTaxType,
  BillingInvoiceType,
  BillingRecord,
  CommerceOverviewSnapshot,
  ConsoleUser,
  DevServiceSnapshot,
  NotificationLogRecord,
  OrderOfflinePaymentType,
  OrderOperationDetailRecord,
  OrderOperationRecord,
  PaymentOperationRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  PromotionOperationRecord,
  PromotionRedemptionRecord,
  ProductAgentRecord,
  ProductCapabilityRecord,
  ProductContentWriteInput,
  ProductPlanRecord,
  ProductReleaseRecord,
  ProductServicePlanDetailRecord,
  ProductSolutionDetailRecord,
  ProductSolutionPlanBindInput,
  ProductSolutionProductInput,
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionTierCode,
  ProductSolutionWriteInput,
  SessionSnapshot,
  RunosCapabilityDetailRecord,
  RunosCapabilityRecord,
  SupportTicketRecord,
  SubscriptionOperationAction,
  SubscriptionOperationDetailRecord,
  SubscriptionOperationRecord,
  TenantMemberRecord,
  TenantOperationDetailRecord,
  TenantOperationRecord,
  TenantQuotaRecord,
  TenantUsageSummaryPage,
  TenantVerificationRecord,
  TenantVerificationStatus,
  TicketCommentRecord,
  UsageMeteringRecord,
} from "@/entities/console";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

function normalizeOrigin(value: string | undefined): string {
  const normalized = trimTrailingSlashes(value?.trim() ?? "");
  if (!normalized) {
    return "http://localhost:3031";
  }
  return normalized;
}

const DEFAULT_BFF_URL = normalizeOrigin(
  process.env.NEXT_PUBLIC_ADMIN_BFF_URL ?? process.env.NEXT_PUBLIC_API_URL,
);
const ADMIN_API_PREFIX = resolveAdminApiPrefix();
const EMPTY_SESSION: SessionSnapshot = {
  isAuthenticated: false,
  user: null,
  capabilities: [],
};

function resolveAdminApiPrefix(): string {
  const explicitPrefix = process.env.NEXT_PUBLIC_ADMIN_API_PREFIX;
  if (explicitPrefix !== undefined) {
    return trimTrailingSlashes(explicitPrefix.trim());
  }

  // 默认直连 admin-bff；只有显式配置统一 API 网关时才保留 /admin-api 前缀。
  const usesDirectAdminBff =
    Boolean(process.env.NEXT_PUBLIC_ADMIN_BFF_URL?.trim()) ||
    !process.env.NEXT_PUBLIC_API_URL?.trim();
  return usesDirectAdminBff ? "" : "/admin-api";
}

export class AdminBffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /**
     * 服务端的语义码（错误体里的 `code`）。
     *
     * 此前只留 message 与 status，**码被丢掉了**——于是调用点想按「是哪一类错」
     * 分支时只能去匹配中文串。2026-09-22 发布门要按 `PUBLISH_CHECKLIST_PENDING`
     * 决定「要不要提示带理由跳过」，才发现这一层拿不到它。
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminBffError";
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(
      `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}${path}`,
      {
        credentials: "include",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function readJsonStrict<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}${path}`, {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new AdminBffError("Admin BFF is unavailable.", 503);
  }

  if (!response.ok) {
    throw new AdminBffError(
      await responseErrorMessage(response, `Admin BFF request failed: ${path}`),
      response.status,
    );
  }

  return (await response.json()) as T;
}

async function responseErrorMessage(response: Response, fallback: string) {
  return (await responseError(response, fallback)).message;
}

/** 错误体里的 message 与语义码；解析不出来就只回 fallback。 */
async function responseError(
  response: Response,
  fallback: string,
): Promise<{ message: string; code?: string }> {
  try {
    const body = (await response.clone().json()) as {
      message?: string | string[];
      code?: string;
    };
    const message = Array.isArray(body.message)
      ? (body.message[0] ?? fallback)
      : (body.message ?? fallback);
    return body.code ? { message, code: body.code } : { message };
  } catch {
    return { message: fallback };
  }
}

// 统一变更请求：raw fetch + credentials，失败抛 AdminBffError（复用 responseErrorMessage）。
async function mutateJson<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  fallbackMessage = "Admin BFF request failed",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new AdminBffError("Admin BFF is unavailable.", 503);
  }

  if (!response.ok) {
    const err = await responseError(response, fallbackMessage);
    throw new AdminBffError(err.message, response.status, err.code);
  }

  return (await response.json()) as T;
}

export async function fetchCurrentUser(): Promise<ConsoleUser | null> {
  return readJsonStrict<ConsoleUser | null>("/api/me");
}

export async function fetchCapabilities(): Promise<Capability[]> {
  return readJsonStrict<Capability[]>("/api/capabilities");
}

export async function fetchAiModels(
  includeInactive = true,
): Promise<AiModelRecord[]> {
  return readJsonStrict<AiModelRecord[]>(
    `/api/atlas/models?includeInactive=${includeInactive ? "true" : "false"}`,
  );
}

export async function fetchAiModelGrants(
  filters: {
    tenantId?: string;
    modelId?: string;
    applicationId?: string;
    applicationType?: "agent" | "workflow" | "api_client" | "internal_service";
  } = {},
): Promise<AiModelGrantRecord[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.modelId) params.set("modelId", filters.modelId);
  if (filters.applicationId) params.set("applicationId", filters.applicationId);
  if (filters.applicationType) {
    params.set("applicationType", filters.applicationType);
  }

  return readJsonStrict<AiModelGrantRecord[]>(
    `/api/atlas/grants${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function fetchModelProviders(
  includeInactive = true,
): Promise<ModelProviderRecord[]> {
  return readJsonStrict<ModelProviderRecord[]>(
    `/api/atlas/providers?includeInactive=${includeInactive ? "true" : "false"}`,
  );
}

export async function fetchModelPriceRules(
  filters: { modelId?: string; includeInactive?: boolean } = {},
): Promise<ModelPriceRuleRecord[]> {
  const params = new URLSearchParams();
  if (filters.modelId) params.set("modelId", filters.modelId);
  if (filters.includeInactive !== undefined) {
    params.set("includeInactive", filters.includeInactive ? "true" : "false");
  }

  return readJsonStrict<ModelPriceRuleRecord[]>(
    `/api/atlas/price-rules${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function fetchModelPolicies(
  filters: {
    tenantId?: string;
    modelId?: string;
    includeInactive?: boolean;
  } = {},
): Promise<ModelPolicyRecord[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.modelId) params.set("modelId", filters.modelId);
  if (filters.includeInactive !== undefined) {
    params.set("includeInactive", filters.includeInactive ? "true" : "false");
  }

  return readJsonStrict<ModelPolicyRecord[]>(
    `/api/atlas/policies${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function fetchTenantModelQuotas(
  filters: { tenantId?: string; includeExpired?: boolean } = {},
): Promise<TenantQuotaRecord[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.includeExpired !== undefined) {
    params.set("includeExpired", filters.includeExpired ? "true" : "false");
  }

  return readJsonStrict<TenantQuotaRecord[]>(
    `/api/atlas/quotas${params.size ? `?${params.toString()}` : ""}`,
  );
}

/**
 * `statType` 曾在这里被当成过滤器送上去——**atlas 的白名单里没有这个参数**，而它的
 * `rejectUnknownFilters` 是拒绝不是忽略，所以真送就是一个 400。换成 `groupBy`，
 * 那是这个端点真正支持的轴选择。
 *
 * 返回的是信封（product_251 A-4）：`groupBy` 由服务端兜底解析，轴必须回显。这里
 * **原样返回信封、不就地拆成数组**——拆掉等于把「你看的是哪根轴」这个事实丢掉，
 * 而那正是空结果时唯一还剩下的信息。
 */
export async function fetchTenantModelUsageSummaries(
  filters: {
    tenantId?: string;
    applicationId?: string;
    applicationType?: "agent" | "workflow" | "api_client" | "internal_service";
    cycleMonth?: string;
    groupBy?: "tenant" | "provider" | "model" | "endpoint" | "product";
  } = {},
): Promise<TenantUsageSummaryPage> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.applicationId) params.set("applicationId", filters.applicationId);
  if (filters.applicationType) {
    params.set("applicationType", filters.applicationType);
  }
  if (filters.cycleMonth) params.set("cycleMonth", filters.cycleMonth);
  if (filters.groupBy) params.set("groupBy", filters.groupBy);

  return readJsonStrict<TenantUsageSummaryPage>(
    `/api/atlas/usage-summaries${params.size ? `?${params.toString()}` : ""}`,
  );
}

export async function fetchProductPlans(): Promise<ProductPlanRecord[]> {
  return readJson<ProductPlanRecord[]>("/api/products/plans", []);
}

// ── plan version lifecycle (product_320): list · edit draft · publish ────────

export interface PlanVersionPrice {
  cycleUnit: string;
  price: string;
}

export interface PlanVersionSummary {
  id: string;
  versionNo: number;
  /**
   * 主版本号 V1/V2…——**人设定的商业代际**，不自增（owner 2026-09-22）。
   * 价格或档位结构变了才升；只改配额这类小改沿用当前主版本，于是同一 V1 下可以
   * 有多个日期修订。`versionNo` 仍是内部身份（唯一键、排序、详情路由都拄它）。
   */
  majorNo: number;
  status: string;
  isLocked: boolean;
  isCurrent: boolean;
  /** ISO timestamp — the date axis of the version timeline. */
  createdAt: string;
  /**
   * 发布（启用）那一刻；`null` = 还没发布，或发布于该列上线之前。
   * 「什么时间启用」只有这一刻能答——`createdAt` 是草稿何时开的。存量已发布版本
   * 没有这个时刻可考，显示「—」，**不拿 createdAt 冒充**。
   */
  publishedAt: string | null;
  prices: PlanVersionPrice[];
  /**
   * 还钉在**这一个版本**上的活订阅数（`deleted_at IS NULL`）。
   *
   * 版本史的四态呈现靠它与 `isCurrent` 两个一起判：
   * draft → 草稿；isCurrent → 当前在售；
   * published 且非 current 且 > 0 → 仍在服务；published 且非 current 且 0 → 已停用。
   * **库里只存 draft/published 两态**，后两格是现算出来的，不是新字段。
   */
  subscriptionCount: number;
}

/** One plan_components row: the primary product or a bundled backing component. */
export interface PlanVersionComponent {
  productCode: string;
  productName: string;
  componentRole: "primary" | "bundled" | string;
  /** Commercial tier — primary only; bundled rows carry null. */
  tier: string | null;
  quota: Record<string, unknown>;
  features: string[];
  priority: number;
}

export interface PlanVersionDetail extends PlanVersionSummary {
  planId: string;
  planCode: string;
  planName: string;
  /** product_code of the primary component; null when the version has none. */
  productCode: string | null;
  /** Primary component quota (flat, for the draft editor). */
  quota: Record<string, unknown>;
  /** Every component: primary first, then bundled in sort order. */
  components: PlanVersionComponent[];
}

/** PUT body item for the bundled component replace (quota is the whole grant). */
export interface PlanVersionBundledComponentInput {
  productCode: string;
  quota: Record<string, unknown>;
  features?: string[];
  priority?: number;
}

export async function fetchPlanVersions(
  planId: string,
): Promise<PlanVersionSummary[]> {
  return readJson<PlanVersionSummary[]>(
    `/api/products/plans/${encodeURIComponent(planId)}/versions`,
    [],
  );
}

export async function fetchPlanVersion(
  versionId: string,
): Promise<PlanVersionDetail | null> {
  return readJson<PlanVersionDetail | null>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}`,
    null,
  );
}

export async function updateDraftPlanVersion(
  versionId: string,
  body: {
    prices?: { cycleUnit: string; price: number }[];
    quota?: Record<string, unknown>;
  },
): Promise<PlanVersionDetail> {
  return mutateJson<PlanVersionDetail>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}`,
    "PATCH",
    body,
    "Failed to update draft version",
  );
}

/**
 * 发布一个草稿版本。step-up gated（`@RequireStepUp`）——调用点包 runWithStepUp。
 *
 * `overrideReason`：上架检查（`gate='publish'`）有未满足项时，带理由跳过。
 * 不带就会被 409 `PUBLISH_CHECKLIST_PENDING` 拦下并点名缺哪几项。
 * 理由进运营审计，与上线门那条同口径——问责台账归 audit_logs。
 */
export async function publishPlanVersion(
  versionId: string,
  overrideReason?: string,
): Promise<{ published: true; versionId: string }> {
  return mutateJson<{ published: true; versionId: string }>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}/publish`,
    "POST",
    overrideReason ? { override: { reason: overrideReason } } : undefined,
    "Failed to publish version",
  );
}

/** 上架检查未满足——调用点据此提示「带理由跳过」，而不是去匹配中文串。 */
export function publishChecklistPending(error: unknown): boolean {
  return (
    error instanceof AdminBffError && error.code === "PUBLISH_CHECKLIST_PENDING"
  );
}

// ── plan publishing desk (product × tier matrix; 90-plan-publishing.md) ─────

export interface PlanMatrixVersionRef {
  id: string;
  versionNo: number;
  /** 主版本号 V1/V2…（人设定的商业代际，不自增）。 */
  majorNo: number;
  /** 发布（启用）那一刻；null = 未发布，或发布于该列上线之前。 */
  publishedAt: string | null;
}

/** One plan laid on a product's tier ladder. */
export interface PlanMatrixPlan {
  planId: string;
  planCode: string;
  planName: string;
  planStatus: string;
  tier: string;
  currentVersion:
    | (PlanMatrixVersionRef & { prices: PlanVersionPrice[] })
    | null;
  draftVersion: PlanMatrixVersionRef | null;
  versionCount: number;
  /** 还钉在这个套餐**任一版本**上的活订阅数；一级列表的「在订阅」列用它。 */
  subscriptionCount: number;
  /**
   * 订阅方式：`true` = 公开订阅（客户自助下单），`false` = 邀请订阅
   * （不进客户的套餐阶梯，只有持邀请券的人看得见、买得到）。
   */
  isPublic: boolean;
  /** 套餐说明（客户可见）；可改。 */
  description: string;
  /** 展示轴：客户端显不显示。与 isPublic（能不能自助买）正交。 */
  isCustomerVisible: boolean;
  /** 展示轴：运营端显不显示。 */
  isWorkforceVisible: boolean;
}

/** One row of the publishing desk: a sellable product and its tier ladder. */
export interface PlanMatrixProduct {
  productCode: string;
  productName: string;
  productStatus: string;
  plans: PlanMatrixPlan[];
}

/**
 * 发布台读模型。
 *
 * `includeDeprecated` 默认 false：一级列表**默认收起已退役的套餐**。退役不是删除
 * ——老订阅仍钉在它的版本上照常解析，所以行还在、查得到，只是退出主视线。
 */
export async function fetchPlanMatrix(
  includeDeprecated = false,
): Promise<PlanMatrixProduct[]> {
  const query = includeDeprecated ? "?include=deprecated" : "";
  return readJson<PlanMatrixProduct[]>(`/api/products/plan-matrix${query}`, []);
}

/** 套餐可删性预检的结果（与 opera 的 `deletion-preview` 同形）。 */
export interface PlanDeletionImpact {
  deletable: boolean;
  /** 挡住删除的原因码；`deletable=false` 时非空。 */
  blockers: string[];
  /** 该套餐**全部版本**上钉过的订阅数（含已软删——卖过就是卖过）。 */
  subscriptions: number;
  /** 引用该套餐任一版本的订单数。 */
  orders: number;
  /** 绑定该套餐的服务方案档位数。 */
  solutionBindings: number;
}

/**
 * 可删性预检。**只读、不 gate step-up**，门户据此决定「删除」按钮出不出现，
 * 而不是让人点下去才吃一个 409。
 *
 * 用 strict 读：原因码是这个调用唯一有价值的产出，被 fallback 吞掉等于白查。
 */
export async function fetchPlanDeletable(
  planId: string,
): Promise<PlanDeletionImpact> {
  return readJsonStrict<PlanDeletionImpact>(
    `/api/products/plans/${encodeURIComponent(planId)}/deletable`,
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
/** 删除草稿版本。`plan_versions` 无 `deleted_at`，这是**物理删**。 */
export async function deletePlanVersion(
  versionId: string,
): Promise<{ deleted: true }> {
  return mutateJson<{ deleted: true }>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}`,
    "DELETE",
    undefined,
    "Failed to delete draft version",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
/** 软删套餐。`confirm` 是两步删除的第二步，漏了服务端会 400。 */
export async function deletePlan(planId: string): Promise<{ deleted: true }> {
  return mutateJson<{ deleted: true }>(
    `/api/products/plans/${encodeURIComponent(planId)}`,
    "DELETE",
    { confirm: true },
    "Failed to delete plan",
  );
}

/** 配额候选：平台登记的键与该产品自有的键，归一成一份带归属的清单。 */
export interface MetricOption {
  metricKey: string;
  /** platform = 跨产品共用一个池；product = 只进这个产品自己的池。 */
  scope: "platform" | "product";
  /** platform_metrics.kind（counter/gauge）；产品自有键为 null。 */
  kind: string | null;
  /** product_metrics.merge_strategy（max/union/pool/tiered）；平台键为 null。 */
  mergeStrategy: string | null;
  consumeMode: string | null;
  metricUnit: string | null;
  resetPeriod: string;
  /** 平台键已登记但尚不可用（status='reserved'）。照回但要标出来—— */
  /** 藏起来会让人以为键不存在，转去产品侧另造一个同名的，那会被触发器拒。 */
  reserved: boolean;
}

/**
 * 草稿编辑器那两列穿梭选择器的数据源。
 *
 * 服务端按 `scope ASC, metric_key ASC` 排序，所以「WS 共享」组天然排在
 * 「本产品」组之前，前端不必再排一次。
 *
 * 两组分开标不是界面习惯，是库强制的边界：
 * `trg_product_metrics_no_platform_shadow` 不许产品声明平台已有的键。
 */
export async function fetchMetricOptions(
  productCode: string,
): Promise<MetricOption[]> {
  return readJson<MetricOption[]>(
    `/api/products/products/${encodeURIComponent(productCode)}/metric-options`,
    [],
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
/** 退役套餐：可见的终态，老订阅照付，同时让开档位。 */
export async function deprecatePlan(
  planId: string,
): Promise<{ deprecated: true }> {
  return mutateJson<{ deprecated: true }>(
    `/api/products/plans/${encodeURIComponent(planId)}/deprecate`,
    "POST",
    undefined,
    "Failed to deprecate plan",
  );
}

/**
 * 调整产品在目录里的先后次序（owner 2026-09-22）。
 *
 * `anchorCode` 是**运营屏幕上的那个邻居**，up/down 必填：服务端按全集重排，但参照
 * 物得由看得见列表的这一方给。不给的话服务端只能取全集相邻行，而那一行可能被筛掉
 * 或在另一页——库里换了位、屏幕上没动，toast 却说「已调整」。
 * top/bottom 不需要：全集端点与视图端点重合。
 */
export async function moveProduct(
  productCode: string,
  direction: "up" | "down" | "top" | "bottom",
  anchorCode?: string,
): Promise<{ productCode: string; moved: boolean; position: number }> {
  return mutateJson<{
    productCode: string;
    moved: boolean;
    position: number;
  }>(
    `/api/products/capabilities/${encodeURIComponent(productCode)}/move`,
    "PATCH",
    anchorCode ? { direction, anchorCode } : { direction },
    "Failed to reorder product",
  );
}

/**
 * 改套餐的可改字段（owner 2026-09-22：A 类字段开放编辑）。
 *
 * 只送要改的键——`undefined` 的字段服务端不碰。名称/说明只换显示名（历史单据是
 * 下单时快照，不受影响）；两个可见性是展示轴。能不能自助买是另一根轴，走
 * `setPlanVisibility`。
 */
export async function updateProductPlan(
  planId: string,
  body: {
    planName?: string;
    description?: string;
    isCustomerVisible?: boolean;
    isWorkforceVisible?: boolean;
  },
): Promise<{ planCode: string; updated: string[] }> {
  return mutateJson<{ planCode: string; updated: string[] }>(
    `/api/products/plans/${encodeURIComponent(planId)}`,
    "PATCH",
    body,
    "Failed to update plan",
  );
}

/**
 * 订阅方式：公开订阅 ⇄ 邀请订阅（`plans.is_public`）。
 *
 * 回值带活订阅数，供确认后的提示把影响面说清楚——已有订阅与续订都不受影响，
 * 变的只是「新客户能不能自助买到」。
 */
export async function setPlanVisibility(
  planId: string,
  isPublic: boolean,
): Promise<{ planCode: string; isPublic: boolean; subscriptionCount: number }> {
  return mutateJson<{
    planCode: string;
    isPublic: boolean;
    subscriptionCount: number;
  }>(
    `/api/products/plans/${encodeURIComponent(planId)}/visibility`,
    "PATCH",
    { isPublic },
    "Failed to change plan visibility",
  );
}

/** Create a plan skeleton (plan + v1 draft + primary component) on a tier slot. */
export async function createProductPlan(body: {
  planCode: string;
  planName: string;
  description?: string;
  productCode: string;
  tier: string;
}): Promise<PlanVersionDetail> {
  return mutateJson<PlanVersionDetail>(
    "/api/products/plans",
    "POST",
    body,
    "Failed to create plan",
  );
}

/** Open the next draft version, cloned from the current published version. */
/**
 * 开一份新草稿（从当前版本克隆）。
 *
 * `majorNo` 不传 = 沿用源版本的主版本号（小改仍在同一商业代际里）；要升位就显式
 * 给 —— 升位是人的决定，服务端不自增，也不许比当前的低。
 */
export async function createPlanDraftVersion(
  planId: string,
  majorNo?: number,
): Promise<PlanVersionDetail> {
  return mutateJson<PlanVersionDetail>(
    `/api/products/plans/${encodeURIComponent(planId)}/versions`,
    "POST",
    majorNo === undefined ? undefined : { majorNo },
    "Failed to open a draft version",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// PUT = full replace: the list sent is the whole bundled set; [] clears it.
export async function replacePlanVersionBundledComponents(
  versionId: string,
  components: PlanVersionBundledComponentInput[],
): Promise<PlanVersionDetail> {
  return mutateJson<PlanVersionDetail>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}/bundled-components`,
    "PUT",
    { components },
    "Failed to save bundled components",
  );
}

export async function fetchProductCapabilities(): Promise<
  ProductCapabilityRecord[]
> {
  return readJson<ProductCapabilityRecord[]>("/api/products/capabilities", []);
}

export async function fetchProductCapability(
  productCode: string,
): Promise<ProductCapabilityRecord | null> {
  return readJson<ProductCapabilityRecord | null>(
    `/api/products/capabilities/${encodeURIComponent(productCode)}`,
    null,
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// 产品目录:更新营销内容 marketing / 成熟度 releaseStage / 上站 isCustomerVisible。
export async function updateProductContent(
  productCode: string,
  body: ProductContentWriteInput,
): Promise<ProductCapabilityRecord> {
  return mutateJson<ProductCapabilityRecord>(
    `/api/products/capabilities/${encodeURIComponent(productCode)}/content`,
    "PATCH",
    body,
    "Failed to update product content",
  );
}

export async function fetchProductReleases(): Promise<ProductReleaseRecord[]> {
  return readJson<ProductReleaseRecord[]>("/api/products/releases", []);
}

export async function fetchProductSolutions(): Promise<
  ProductSolutionRecord[]
> {
  return readJson<ProductSolutionRecord[]>("/api/products/solutions", []);
}

export async function fetchProductSolution(
  solutionCode: string,
): Promise<ProductSolutionDetailRecord | null> {
  return readJson<ProductSolutionDetailRecord | null>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}`,
    null,
  );
}

export async function fetchProductServicePlan(
  solutionCode: string,
  tierCode: string,
): Promise<ProductServicePlanDetailRecord | null> {
  return readJson<ProductServicePlanDetailRecord | null>(
    `/api/products/service-plans/${encodeURIComponent(solutionCode)}/${encodeURIComponent(tierCode)}`,
    null,
  );
}

export async function fetchProductAgents(): Promise<ProductAgentRecord[]> {
  return readJson<ProductAgentRecord[]>("/api/products/agents", []);
}

// ── 解决方案写路径（2026-08-31，TD-029 收口）：全部返回最新详情，页面直接替换本地态。
// `/api/products/model-policies` 已退役：模型策略是 Atlas 的，走上面的 fetchModelPolicies。

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function createProductSolution(
  payload: ProductSolutionWriteInput,
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    "/api/products/solutions",
    "POST",
    payload,
    "创建方案失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function updateProductSolution(
  solutionCode: string,
  payload: ProductSolutionWriteInput,
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}`,
    "PUT",
    payload,
    "保存方案失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function setProductSolutionState(
  solutionCode: string,
  state: ProductSolutionStatus,
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}/state`,
    "PATCH",
    { state },
    "方案状态更新失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function replaceProductSolutionProducts(
  solutionCode: string,
  products: ProductSolutionProductInput[],
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}/products`,
    "PUT",
    { products },
    "保存方案产品失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function bindProductSolutionPlan(
  solutionCode: string,
  tier: ProductSolutionTierCode,
  payload: ProductSolutionPlanBindInput,
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}/plans/${encodeURIComponent(tier)}`,
    "PUT",
    payload,
    "绑定套餐失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function unbindProductSolutionPlan(
  solutionCode: string,
  tier: ProductSolutionTierCode,
): Promise<ProductSolutionDetailRecord> {
  return mutateJson<ProductSolutionDetailRecord>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}/plans/${encodeURIComponent(tier)}`,
    "DELETE",
    undefined,
    "解绑套餐失败",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// 删除方案(软删):有生效订阅时后端 409,前端提示改走退役。
export async function deleteProductSolution(
  solutionCode: string,
): Promise<{ solutionCode: string; deleted: true }> {
  return mutateJson<{ solutionCode: string; deleted: true }>(
    `/api/products/solutions/${encodeURIComponent(solutionCode)}`,
    "DELETE",
    undefined,
    "删除方案失败",
  );
}

export type DashboardOverviewPeriod =
  | "recent30"
  | "total"
  | "year"
  | "quarter"
  | "month";

export interface DashboardOverviewRecord {
  period: DashboardOverviewPeriod;
  tenants: {
    total: number;
    active: number;
    newInPeriod: number;
    newInPrevPeriod: number;
  };
  users: { total: number; newInPeriod: number; newInPrevPeriod: number };
  subscriptions: {
    active: number;
    trialing: number;
    newInPeriod: number;
    newInPrevPeriod: number;
    trialConvertedInPeriod: number;
    renewalsDue: number;
    renewalsAtRisk: number;
  };
  revenue: {
    paidInPeriod: number;
    paidInPrevPeriod: number;
    paidTotal: number;
    outstandingAmount: number;
    outstandingCount: number;
    overdueCount: number;
  };
  tickets: {
    totalInPeriod: number;
    resolved: number;
    inProgress: number;
    pending: number;
    /** 告警中：建单已超 15 天且仍未了结。判据取 created_at，见 admin-bff。 */
    alerting: number;
    totalInPrevPeriod: number;
  };
  /**
   * 客户评价（support.product_reviews）。全周期口径，不随 period 变——评价来得
   * 稀疏，按周期切会让卡片在没有新评价的那一周直接空掉，看起来像坏了。
   *
   * 三项**各带各的分母**；`average` 为 `null` = 这一项还没人评，**不是 0 分**。
   */
  reviews: {
    productScore: { average: number | null; count: number };
    priceScore: { average: number | null; count: number };
    serviceScore: { average: number | null; count: number };
    reviewCount: number;
  };
}

/**
 * 读不到 / 还没读到时的空态。**导出**是因为首页也要它——此前首页另写了一份
 * `emptyDashboardOverview()`，同一份事实两处推导，加字段时必然漏掉一处
 * （加 reviews 时就漏了，type-check 才逮住）。
 */
export const EMPTY_DASHBOARD_OVERVIEW: Omit<DashboardOverviewRecord, "period"> =
  {
    tenants: { total: 0, active: 0, newInPeriod: 0, newInPrevPeriod: 0 },
    users: { total: 0, newInPeriod: 0, newInPrevPeriod: 0 },
    subscriptions: {
      active: 0,
      trialing: 0,
      newInPeriod: 0,
      newInPrevPeriod: 0,
      trialConvertedInPeriod: 0,
      renewalsDue: 0,
      renewalsAtRisk: 0,
    },
    revenue: {
      paidInPeriod: 0,
      paidInPrevPeriod: 0,
      paidTotal: 0,
      outstandingAmount: 0,
      outstandingCount: 0,
      overdueCount: 0,
    },
    tickets: {
      totalInPeriod: 0,
      resolved: 0,
      inProgress: 0,
      pending: 0,
      alerting: 0,
      totalInPrevPeriod: 0,
    },
    // 读不到时三项都是 null 而不是 0：卡片据此画「—」，不会把"没读到"画成 0 分。
    reviews: {
      productScore: { average: null, count: 0 },
      priceScore: { average: null, count: 0 },
      serviceScore: { average: null, count: 0 },
      reviewCount: 0,
    },
  };

// admin 首页真实聚合（TD-036）：替换首页 overviewSnapshots 等硬编码 mock 常量。
// 2026-09-08 路径自 /api/platform-admins/dashboard-overview 改为 /api/dashboard/overview
// ——那个路由是运营账号管理，已随治理平面 cutover（#121）整体迁去 arche；首页聚合
// 只是当年停在了它里面，与「平台管理员」无关。
export async function fetchDashboardOverview(
  period: DashboardOverviewPeriod,
): Promise<DashboardOverviewRecord> {
  return readJson<DashboardOverviewRecord>(
    `/api/dashboard/overview?period=${encodeURIComponent(period)}`,
    { period, ...EMPTY_DASHBOARD_OVERVIEW },
  );
}

export async function fetchTenantOperations(): Promise<
  TenantOperationRecord[]
> {
  return readJson<TenantOperationRecord[]>("/api/tenants", []);
}

export async function fetchTenantOperationsStrict(): Promise<
  TenantOperationRecord[]
> {
  return readJsonStrict<TenantOperationRecord[]>("/api/tenants");
}

export async function fetchSupportTicketsStrict(): Promise<
  SupportTicketRecord[]
> {
  return readJsonStrict<SupportTicketRecord[]>("/api/tickets");
}

export async function fetchSubscriptionOperations(): Promise<
  SubscriptionOperationRecord[]
> {
  // Strict: a BFF failure must not masquerade as an empty list (§0.3).
  return readJsonStrict<SubscriptionOperationRecord[]>("/api/subscriptions");
}

export async function fetchSubscriptionOperation(
  subscriptionId: string,
): Promise<SubscriptionOperationDetailRecord | null> {
  return readJson<SubscriptionOperationDetailRecord | null>(
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}`,
    null,
  );
}

export async function fetchOrderOperations(): Promise<OrderOperationRecord[]> {
  return readJsonStrict<OrderOperationRecord[]>("/api/orders");
}

export async function fetchOrderOperation(
  orderId: string,
): Promise<OrderOperationDetailRecord | null> {
  return readJson<OrderOperationDetailRecord | null>(
    `/api/orders/${encodeURIComponent(orderId)}`,
    null,
  );
}

export async function fetchPaymentOperations(): Promise<
  PaymentOperationRecord[]
> {
  return readJsonStrict<PaymentOperationRecord[]>("/api/payments");
}

export async function verifyPayment(
  paymentId: string,
  remark: string,
): Promise<PaymentOperationRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/payments/${encodeURIComponent(paymentId)}/verify`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remark }),
    },
  );

  if (!response.ok) {
    let message = "核销操作失败";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      /* ignore */
    }
    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as PaymentOperationRecord;
}

export async function rejectPayment(
  paymentId: string,
  remark: string,
): Promise<PaymentOperationRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/payments/${encodeURIComponent(paymentId)}/reject`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remark }),
    },
  );

  if (!response.ok) {
    let message = "驳回操作失败";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      /* ignore */
    }
    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as PaymentOperationRecord;
}

export async function fetchUsageMeteringRecords(): Promise<
  UsageMeteringRecord[]
> {
  return readJsonStrict<UsageMeteringRecord[]>(
    "/api/commercial/usage-metering",
  );
}

export async function fetchPromotionOperations(): Promise<
  PromotionOperationRecord[]
> {
  return readJsonStrict<PromotionOperationRecord[]>(
    "/api/commercial/promotions",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// Creates a voucher batch (product_321 §4.2; kinds discount / credit_voucher /
// invite; gate fields rejected server-side).
//
// `invite` 的 effect 只装 `{ planCode }`：它解锁的是「能买」，不改变「要付钱」。
// 服务端只接受真存在、且真非公开的套餐（公开套餐本来就能买，发了等于骗人）。
export async function createVoucherBatch(payload: {
  kind: "discount" | "credit_voucher" | "invite";
  name: string;
  codePrefix?: string;
  effect: Record<string, unknown>;
  totalCount: number;
  perUserLimit?: number;
  validFrom: string;
  validUntil: string;
  tenantId?: string;
}): Promise<{ batchId: string }> {
  return mutateJson<{ batchId: string }>(
    "/api/commercial/voucher-batches",
    "POST",
    payload,
    "Voucher batch creation failed",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// Assigns vouchers from a batch (codes generated on demand; issued_count
// seized atomically; per-user limit enforced for user targets).
export async function assignVouchers(payload: {
  batchId: string;
  count?: number;
  targetUserId?: string;
  targetWorkspaceId?: string;
}): Promise<{ codes: string[] }> {
  return mutateJson<{ codes: string[] }>(
    "/api/commercial/vouchers/assign",
    "POST",
    payload,
    "Voucher assignment failed",
  );
}

export async function fetchPromotionRedemptionRecords(): Promise<
  PromotionRedemptionRecord[]
> {
  return readJsonStrict<PromotionRedemptionRecord[]>(
    "/api/commercial/promotion-redemptions",
  );
}

export async function fetchCommerceOverview(): Promise<CommerceOverviewSnapshot | null> {
  return readJson<CommerceOverviewSnapshot | null>(
    "/api/commercial/overview",
    null,
  );
}

export async function confirmOrderOfflinePayment(
  orderId: string,
  payload: {
    paidAmount: number;
    offlinePayType: OrderOfflinePaymentType;
    payerName: string;
    paidAt: string;
    transactionNo?: string | null;
    evidenceUrl?: string | null;
    reason: string;
  },
): Promise<OrderOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/orders/${encodeURIComponent(orderId)}/offline-payment-confirm`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    let message = "Order offline payment confirmation failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as OrderOperationDetailRecord;
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// Rejects the customer's payment declaration (product_321 P9/P8b): cash leg
// → failed with the reason, vouchers released, invoice pricing restored,
// payment_rejected history (customer banner + TTL re-anchor).
export async function rejectOrderPaymentDeclaration(
  orderId: string,
  reason: string,
): Promise<OrderOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/orders/${encodeURIComponent(orderId)}/payment-reject`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );

  if (!response.ok) {
    let message = "Payment declaration reject failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as OrderOperationDetailRecord;
}

export async function restoreOrder(
  orderId: string,
  reason: string,
): Promise<OrderOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/orders/${encodeURIComponent(orderId)}/restore`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );

  if (!response.ok) {
    let message = "Order restore failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as OrderOperationDetailRecord;
}

export async function voidOrder(
  orderId: string,
  reason: string,
): Promise<OrderOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/orders/${encodeURIComponent(orderId)}/void`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );

  if (!response.ok) {
    let message = "Order void failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as OrderOperationDetailRecord;
}

/** 退款审核 / 执行（product_330 §5）：与 void/restore 同一 POST + reason 形状。 */
async function postOrderAction(
  orderId: string,
  action: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<OrderOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/orders/${encodeURIComponent(orderId)}/${action}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    let message = fallback;
    try {
      const parsed = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(parsed.message)
        ? (parsed.message[0] ?? message)
        : (parsed.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }
    throw new AdminBffError(message, response.status);
  }
  return (await response.json()) as OrderOperationDetailRecord;
}

export function auditOrderRefund(
  orderId: string,
  decision: "approved" | "rejected",
  remark: string,
): Promise<OrderOperationDetailRecord> {
  return postOrderAction(
    orderId,
    "refund-audit",
    { decision, remark },
    "Refund audit failed",
  );
}

export function executeOrderRefund(
  orderId: string,
  reason: string,
): Promise<OrderOperationDetailRecord> {
  return postOrderAction(
    orderId,
    "refund-execute",
    { reason },
    "Refund execution failed",
  );
}

/**
 * 退款执行**失败**（2026-09-25）：钱没打出去。与 executeOrderRefund 成对，同码同门
 * （commerce:payment.settle + step-up）。原因必填——它是发给客户那封通知的依据。
 */
export function failOrderRefund(
  orderId: string,
  reason: string,
): Promise<OrderOperationDetailRecord> {
  return postOrderAction(
    orderId,
    "refund-fail",
    { reason },
    "Marking the refund failed did not go through",
  );
}

/**
 * 运营发起退款（批 6）：自动资格判定的逃生口。金额留空 = 按已消耗配额折算的缺省值。
 * 同码同门（commerce:payment.settle + step-up），理由必填。
 */
export function createOrderRefund(
  orderId: string,
  reason: string,
  amount?: string,
): Promise<OrderOperationDetailRecord> {
  return postOrderAction(
    orderId,
    "refund-create",
    amount ? { reason, amount } : { reason },
    "Creating the refund did not go through",
  );
}

export async function fetchBillingRecords(): Promise<BillingRecord[]> {
  return readJsonStrict<BillingRecord[]>("/api/billing");
}

export async function fetchBillingRecord(
  billId: string,
): Promise<BillingDetailRecord | null> {
  return readJson<BillingDetailRecord | null>(
    `/api/billing/${encodeURIComponent(billId)}`,
    null,
  );
}

export async function fetchInvoiceLedgerRecords(): Promise<
  BillingInvoiceLedgerRecord[]
> {
  return readJsonStrict<BillingInvoiceLedgerRecord[]>("/api/invoices");
}

export async function syncOfflineInvoice(
  billId: string,
  payload: {
    invoiceNo: string;
    invoiceType: BillingInvoiceType;
    invoiceTaxType: BillingInvoiceTaxType;
    invoiceTitle: string;
    taxNo?: string | null;
    invoiceAmount: number;
    taxAmount?: number | null;
    invoiceStatus: Extract<
      BillingInvoiceStatus,
      "issued" | "sending" | "finished"
    >;
    statusRemark: string;
    invoiceCode?: string | null;
    invoiceElectronicNo?: string | null;
    invoiceFileUrl?: string | null;
    issuedAt: string;
    expressCompany?: string | null;
    expressNo?: string | null;
    sendAt?: string | null;
  },
): Promise<BillingDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/billing/${encodeURIComponent(billId)}/offline-invoice-sync`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    let message = "Offline invoice sync failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as BillingDetailRecord;
}

export async function submitBillingInvoiceReceiptAction(
  billId: string,
  receiptId: string,
  payload: {
    action: BillingInvoiceReceiptAction;
    statusRemark: string;
    expressCompany?: string | null;
    expressNo?: string | null;
    sendAt?: string | null;
  },
): Promise<BillingDetailRecord> {
  // TD-027: red (红冲/作废已出账发票) is a 危 write on a dedicated step-up endpoint.
  const isVoid = payload.action === "red";
  const base = `/api/billing/${encodeURIComponent(billId)}/invoice-receipts/${encodeURIComponent(receiptId)}`;
  const path = isVoid ? `${base}/void` : `${base}/actions`;
  const body = isVoid
    ? {
        statusRemark: payload.statusRemark,
        expressCompany: payload.expressCompany,
        expressNo: payload.expressNo,
        sendAt: payload.sendAt,
      }
    : payload;

  const response = await fetch(`${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = "Billing invoice receipt action failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as BillingDetailRecord;
}

export async function submitBillingBillAction(
  billId: string,
  payload: {
    action: BillingBillAction;
    reason: string;
    discountAmount?: number | null;
    amount?: number | null;
    itemName?: string | null;
    cycleStartDate?: string | null;
    cycleEndDate?: string | null;
  },
): Promise<BillingDetailRecord> {
  // TD-027: discount (减免应收) is a 危 write on a dedicated step-up endpoint.
  const isDiscount = payload.action === "discount";
  const path = isDiscount
    ? `/api/billing/${encodeURIComponent(billId)}/discount`
    : `/api/billing/${encodeURIComponent(billId)}/actions`;
  const body = isDiscount
    ? { reason: payload.reason, discountAmount: payload.discountAmount }
    : payload;

  const response = await fetch(`${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = "Billing bill action failed";

    try {
      const errorBody = (await response.json()) as {
        message?: string | string[];
      };
      message = Array.isArray(errorBody.message)
        ? (errorBody.message[0] ?? message)
        : (errorBody.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as BillingDetailRecord;
}

export async function submitSubscriptionOperation(
  subscriptionId: string,
  payload: {
    action: SubscriptionOperationAction;
    reason: string;
    /* 暂停必带（服务端强校验）：它决定恢复后要不要顺延服务期。其余动作不送。 */
    suspendReason?: string | null;
  },
): Promise<SubscriptionOperationDetailRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/subscriptions/${encodeURIComponent(subscriptionId)}/actions`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    let message = "Subscription operation failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Preserve a useful typed error even when a proxy returns non-JSON.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as SubscriptionOperationDetailRecord;
}

export async function fetchAccountOperations(): Promise<
  AccountOperationRecord[]
> {
  return readJsonStrict<AccountOperationRecord[]>("/api/accounts");
}

export async function fetchAccountOperation(
  accountId: string,
): Promise<AccountOperationDetailRecord> {
  return readJsonStrict<AccountOperationDetailRecord>(
    `/api/accounts/${encodeURIComponent(accountId)}`,
  );
}

/**
 * 主体标识的版本化 URL（按内容哈希）。
 *
 * `hash` 为空 = 没传过，**不要请求**（端点会 404），直接画 DS 的平台默认图。
 * 带 hash 的 URL 服务端发 immutable 长缓存，换图即换 URL。
 */
export function accountAvatarUrl(accountId: string, hash: string): string {
  return `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/accounts/${encodeURIComponent(
    accountId,
  )}/avatar?v=${encodeURIComponent(hash)}`;
}

export function tenantLogoUrl(tenantId: string, hash: string): string {
  return `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/tenants/${encodeURIComponent(
    tenantId,
  )}/logo?v=${encodeURIComponent(hash)}`;
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// 重置 = 删行回落平台默认，原图不留存、不可撤回——UI 处传 `{ danger: true }`。
export async function resetAccountAvatar(
  accountId: string,
): Promise<{ status: "ok"; removed: boolean }> {
  return mutateJson<{ status: "ok"; removed: boolean }>(
    `/api/accounts/${encodeURIComponent(accountId)}/avatar/reset`,
    "POST",
    undefined,
    "Account avatar reset failed",
  );
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function resetTenantLogo(
  tenantId: string,
): Promise<{ status: "ok"; removed: boolean }> {
  return mutateJson<{ status: "ok"; removed: boolean }>(
    `/api/tenants/${encodeURIComponent(tenantId)}/logo/reset`,
    "POST",
    undefined,
    "Tenant logo reset failed",
  );
}

// ── C12: admin-delegated customer account lifecycle (user:account.manage) ──

export async function disableAccount(
  accountId: string,
  reason?: string,
): Promise<{ ok: true; status: string; revoked: number }> {
  return mutateJson(
    `/api/accounts/${encodeURIComponent(accountId)}/disable`,
    "POST",
    reason ? { reason } : {},
    "Account disable failed",
  );
}

export async function enableAccount(
  accountId: string,
  reason?: string,
): Promise<{ ok: true; status: string }> {
  return mutateJson(
    `/api/accounts/${encodeURIComponent(accountId)}/enable`,
    "POST",
    reason ? { reason } : {},
    "Account enable failed",
  );
}

export async function forceLogoutAccount(
  accountId: string,
  reason?: string,
): Promise<{ ok: true; revoked: number }> {
  return mutateJson(
    `/api/accounts/${encodeURIComponent(accountId)}/force-logout`,
    "POST",
    reason ? { reason } : {},
    "Account force-logout failed",
  );
}

export async function fetchDevServices(
  signal?: AbortSignal,
): Promise<DevServiceSnapshot[]> {
  const requestInit: RequestInit = {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  };
  const response = await fetch(
    `/api/dev-services?ts=${Date.now()}`,
    requestInit,
  );

  if (!response.ok) {
    throw new AdminBffError("Dev services snapshot failed", response.status);
  }

  return (await response.json()) as DevServiceSnapshot[];
}

// AI 模型的创建/编辑/启停/删除已迁往 opera-bff 自己的 atlas.router.ts（2026-08-11,
// 两段裁决:opera 管技术供给,admin 管商业封装)。这里只留 fetchAiModels 只读——
// 本文件下面的 grants/price-rules/policies/quotas 写路径要用它做 model 下拉。

// tenant↔model 授权的**写口**(createAiModelGrant / updateAiModelGrant /
// setAiModelGrantActive)已退役(2026-09-02,owner 授权):/model-grants 管理页撤,admin 不再
// 创建/管理这条 legacy 轴。只留上方 fetchAiModelGrants 只读供运营总览观测存量。

// Model providers 的创建/编辑/启停/删除已迁往 opera-bff（2026-08-11，同上）。
// fetchModelProviders 只读留着给下面的商业写路径当 provider 上下文。

// ── Model price rules 写路径（B14）───────────────────────────────────────────
// 注：后端仅提供 create/update/activate/deactivate，没有 price-rule 的 delete 端点。

export interface ModelPriceRuleWriteInput {
  modelId: string;
  billingMode?: string;
  currency?: string;
  unitTokens?: number | null;
  inputUnitPrice?: string | number | null;
  outputUnitPrice?: string | number | null;
  requestUnitPrice?: string | number | null;
  /** 缺省 = 不声明缓存价（列留 null）。**不要为了"补齐"传 0** —— 那是在声称
   *  缓存输入免费，对每一家供应商都是假的。 */
  cachedInputUnitPrice?: string | number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  /** 仅 create 收；update 侧由 `Omit` 去掉（atlas 的 update body 不含状态）。 */
  state?: ObjectState;
}

export async function createModelPriceRule(
  payload: ModelPriceRuleWriteInput,
): Promise<ModelPriceRuleRecord> {
  return mutateJson<ModelPriceRuleRecord>(
    "/api/atlas/price-rules",
    "POST",
    payload,
    "Model price rule creation failed",
  );
}

export async function updateModelPriceRule(
  priceRuleId: string,
  payload: Partial<Omit<ModelPriceRuleWriteInput, "modelId" | "state">>,
): Promise<ModelPriceRuleRecord> {
  return mutateJson<ModelPriceRuleRecord>(
    `/api/atlas/price-rules/${encodeURIComponent(priceRuleId)}`,
    "PUT",
    payload,
    "Model price rule update failed",
  );
}

export async function activateModelPriceRule(
  priceRuleId: string,
): Promise<ModelPriceRuleRecord> {
  return mutateJson<ModelPriceRuleRecord>(
    `/api/atlas/price-rules/${encodeURIComponent(priceRuleId)}/activate`,
    "POST",
    undefined,
    "Model price rule activation failed",
  );
}

export async function deactivateModelPriceRule(
  priceRuleId: string,
): Promise<ModelPriceRuleRecord> {
  return mutateJson<ModelPriceRuleRecord>(
    `/api/atlas/price-rules/${encodeURIComponent(priceRuleId)}/deactivate`,
    "POST",
    undefined,
    "Model price rule deactivation failed",
  );
}

// ── Model policies 写路径 ───────────────────────────────────────────────────
//
// 与上面的计价规则是**相反的两种表**，别照着记：
//
//   计价规则  追加版本化。值列一律不授予 UPDATE，改价 = 新建一条 + 给旧的设失效。
//   策略      就地可改。除下面两个之外每个值列都授予 UPDATE，历史只在
//             `audit.change_records` 里（atlas TD-038 记着这个不对称，未决）。
//
// 两个例外由 atlas 的 `normalizeUpdatePolicy` 按名拒绝（出现即 400）：
//
//   tenantId    策略属于它被创建时针对的那个租户。改指向不是编辑，是另一条策略——
//               老租户正在跑的限流会静默失效，而一行改动说不出是谁的限额动了。
//   effectiveAt 何时开始固定在创建时。要结束用 expiresAt，要新窗口新建一条。
//
// 所以 update 的载荷类型不是 `Partial<Create>`：那会把这两个字段一起邀请进来。

export interface ModelPolicyWriteInput {
  modelId: string;
  /** 留空/null = 全局默认策略，对所有没有专属策略的租户生效。 */
  tenantId?: string | null;
  name?: string | null;
  priority?: number | null;
  /** 在途请求上限。**`null` = 不限，`0` = 全部拒绝**——两者不是一回事。 */
  maxConcurrent?: number | null;
  rateLimitRpm?: number | null;
  /** bigint 列，走字符串——JS number 到不了它的量级。 */
  rateLimitTpm?: string | number | null;
  rateLimitTpd?: string | number | null;
  maxContextTokens?: number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  /** 仅 create 收；update 侧不含（启停走具名动作，理由同计价规则）。 */
  state?: ObjectState;
}

/** update 收的全集——由此**排除**了 modelId / tenantId / effectiveAt / state。 */
export type ModelPolicyUpdateInput = Pick<
  ModelPolicyWriteInput,
  | "name"
  | "priority"
  | "maxConcurrent"
  | "rateLimitRpm"
  | "rateLimitTpm"
  | "rateLimitTpd"
  | "maxContextTokens"
  | "expiresAt"
>;

export async function createModelPolicy(
  payload: ModelPolicyWriteInput,
): Promise<ModelPolicyRecord> {
  return mutateJson<ModelPolicyRecord>(
    "/api/atlas/policies",
    "POST",
    payload,
    "Model policy creation failed",
  );
}

export async function updateModelPolicy(
  policyId: string,
  payload: ModelPolicyUpdateInput,
): Promise<ModelPolicyRecord> {
  return mutateJson<ModelPolicyRecord>(
    `/api/atlas/policies/${encodeURIComponent(policyId)}`,
    "PUT",
    payload,
    "Model policy update failed",
  );
}

export async function activateModelPolicy(
  policyId: string,
): Promise<ModelPolicyRecord> {
  return mutateJson<ModelPolicyRecord>(
    `/api/atlas/policies/${encodeURIComponent(policyId)}/activate`,
    "POST",
    undefined,
    "Model policy activation failed",
  );
}

export async function deactivateModelPolicy(
  policyId: string,
): Promise<ModelPolicyRecord> {
  return mutateJson<ModelPolicyRecord>(
    `/api/atlas/policies/${encodeURIComponent(policyId)}/deactivate`,
    "POST",
    undefined,
    "Model policy deactivation failed",
  );
}

type SessionProbe = "active" | "anonymous" | "unavailable";

/**
 * Probe the operator RP session at the BFF-root /auth/session (verified RP claims,
 * no ops.* DB hit) — lighter and with fewer failure modes than /api/auth/session.
 * Distinguish a definitive 401/403 (anonymous → route to login) from a transient
 * 5xx/network blip (unavailable → caller retries instead of treating as logged out).
 */
async function probeSession(): Promise<SessionProbe> {
  try {
    const response = await fetch(
      `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/auth/session`,
      {
        credentials: "include",
        cache: "no-store",
      },
    );

    if (response.ok) {
      return "active";
    }
    if (response.status === 401 || response.status === 403) {
      return "anonymous";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Probe with one retry on a transient blip (e.g. cold BFF right after the OIDC redirect). */
async function probeSessionWithRetry(): Promise<SessionProbe> {
  const first = await probeSession();
  if (first !== "unavailable") {
    return first;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return probeSession();
}

async function loadAuthenticatedSnapshot(): Promise<SessionSnapshot> {
  const [user, capabilities] = await Promise.all([
    fetchCurrentUser(),
    fetchCapabilities(),
  ]);

  return {
    isAuthenticated: Boolean(user),
    user,
    capabilities,
  };
}

export async function restoreSession(): Promise<SessionSnapshot> {
  const probe = await probeSessionWithRetry();
  if (probe !== "active") {
    // anonymous (no session) or persistently unavailable → treat as logged out.
    return EMPTY_SESSION;
  }

  // Session is active. Profile + capabilities go through the heavier /api/* path
  // (ops.* re-query); a single transient failure there must not drop an
  // authenticated operator back to the login screen — retry once before giving up.
  try {
    return await loadAuthenticatedSnapshot();
  } catch {
    try {
      return await loadAuthenticatedSnapshot();
    } catch {
      return EMPTY_SESSION;
    }
  }
}

/**
 * Absolute URL of the RP login entry on admin-bff. It 302s to the IdP authorize
 * endpoint and on to the central accounts login surface; on success the callback
 * sets the opaque RP session cookie and redirects to `returnTo`. Operator login
 * (and its Turnstile) happen at the IdP (accounts.vxture.com), not here — admin
 * is an OIDC RP. Lives at the BFF root (outside the legacy /api/auth/* seam).
 * See identity-platform-architecture.md §9.
 */
export function buildRpLoginUrl(
  returnTo?: string,
  opts?: { prompt?: string },
): string {
  const base = `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/auth/login`;
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (opts?.prompt) params.set("prompt", opts.prompt);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * 登出。返回 IdP 的 end_session 地址，**调用方必须顶层跳过去**——只清本地会话的话
 * 中央会话还在，下一次 authorize 静默 SSO 会立刻把人送回登录态。
 *
 * 返回 undefined 表示 BFF 没给出地址（不可达 / 老版本），调用方按登出失败处理。
 */
export async function logout(): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/auth/logout`,
      { method: "POST", credentials: "include", cache: "no-store" },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { endSessionUrl?: string };
    return body.endSessionUrl;
  } catch {
    // Keep local sign-out resilient even if the BFF is unavailable.
    return undefined;
  }
}

export async function fetchAnnouncements(): Promise<AnnouncementRecord[]> {
  return readJsonStrict<AnnouncementRecord[]>("/api/announcements");
}

// ── Runos 能力目录（技能市场，只读）───────────────────────────────────────────
// admin-bff `/api/runos/*` 透传 Runos `/capability/*`（2026-08-30 接入，替掉此前
// 返回字面量 `[]` 的 `/api/skills` 空桩）。走 readJsonStrict：上游契约漂移是 502、
// 无权限是 403，都该到页面上说出来，不能被 readJson 吞成空列表——空列表在这一页上
// 恰好长得和「目录里还没有能力」一模一样。

export interface RunosCapabilityFilters {
  /** 精确匹配。 */
  category?: string;
  /** 可重复，全部命中（AND）——透传时 append 不是 set。 */
  tags?: string[];
}

/**
 * 读完整个能力目录。目录页在浏览器里筛选与分页，要的是全量。
 *
 * 接口是游标信封（runos v0.26.0：`{items, nextCursor, prevCursor, total}`）。此前这里按
 * 裸数组读，拿到信封后 `.filter` / `.map` 落在对象上，技能目录页崩掉。按游标读到底；
 * 页数超限就抛，不交出半份目录。
 */
export async function fetchRunosCapabilities(
  filters: RunosCapabilityFilters = {},
): Promise<RunosCapabilityRecord[]> {
  const rows: RunosCapabilityRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const search = new URLSearchParams();
    if (filters.category) search.set("category", filters.category);
    for (const tag of filters.tags ?? []) {
      if (tag) search.append("tag", tag);
    }
    /* runos `MAX_PAGE_LIMIT`，今天的目录一页读完。 */
    search.set("limit", "1000");
    if (cursor) search.set("cursor", cursor);
    const data: { items: RunosCapabilityRecord[]; nextCursor: string | null } =
      await readJsonStrict<{
        items: RunosCapabilityRecord[];
        nextCursor: string | null;
      }>(`/api/runos/capabilities?${search.toString()}`);
    rows.push(...data.items);
    if (data.nextCursor === null) return rows;
    cursor = data.nextCursor;
  }
  throw new Error("CAPABILITY_CATALOG_TOO_LARGE (> 20000)");
}

export async function fetchRunosCapability(
  capabilityId: string,
): Promise<RunosCapabilityDetailRecord> {
  return readJsonStrict<RunosCapabilityDetailRecord>(
    `/api/runos/capabilities/${encodeURIComponent(capabilityId)}`,
  );
}

// ── Announcements 写路径（B8）─────────────────────────────────────────────

export interface AnnouncementWriteInput {
  announcementType: AnnouncementRecord["type"];
  severity?: "info" | "warning" | "critical";
  title: string;
  content: string;
  targetPlans?: string[];
  targetTenantTypes?: string[];
  publishAt: string;
  expiresAt?: string | null;
}

export async function createAnnouncement(
  payload: AnnouncementWriteInput,
): Promise<AnnouncementRecord> {
  return mutateJson<AnnouncementRecord>(
    "/api/announcements",
    "POST",
    payload,
    "Announcement creation failed",
  );
}

export async function updateAnnouncement(
  announcementId: string,
  payload: AnnouncementWriteInput,
): Promise<AnnouncementRecord> {
  return mutateJson<AnnouncementRecord>(
    `/api/announcements/${encodeURIComponent(announcementId)}`,
    "PUT",
    payload,
    "Announcement update failed",
  );
}

export async function publishAnnouncement(
  announcementId: string,
): Promise<AnnouncementRecord> {
  return mutateJson<AnnouncementRecord>(
    `/api/announcements/${encodeURIComponent(announcementId)}/publish`,
    "POST",
    undefined,
    "Announcement publish failed",
  );
}

export async function archiveAnnouncement(
  announcementId: string,
): Promise<AnnouncementRecord> {
  return mutateJson<AnnouncementRecord>(
    `/api/announcements/${encodeURIComponent(announcementId)}/archive`,
    "POST",
    undefined,
    "Announcement archive failed",
  );
}

export async function deleteAnnouncement(
  announcementId: string,
): Promise<{ id: string; status: "deleted"; deletedAt: string }> {
  return mutateJson<{ id: string; status: "deleted"; deletedAt: string }>(
    `/api/announcements/${encodeURIComponent(announcementId)}`,
    "DELETE",
    undefined,
    "Announcement deletion failed",
  );
}

// ── Tickets 详情 / 时间线 / 写路径（B8）───────────────────────────────────

/**
 * 写入面能设的状态 = **存储值域本身**（`chk_tickets_status`）。
 *
 * 原先这里手写了一份七值联合，与 DB CHECK 并行维护——两边一致是巧合，
 * 没有任何东西保证它。现在值域成文在 @shared 的 catalog-domains，并由
 * `lint:catalog-domains` 逐值对账，这里只做别名。
 */
export type TicketStatusInput = TicketStatus;

export async function fetchTicket(
  ticketId: string,
): Promise<SupportTicketRecord> {
  return readJsonStrict<SupportTicketRecord>(
    `/api/tickets/${encodeURIComponent(ticketId)}`,
  );
}

export async function fetchTicketComments(
  ticketId: string,
): Promise<TicketCommentRecord[]> {
  return readJsonStrict<TicketCommentRecord[]>(
    `/api/tickets/${encodeURIComponent(ticketId)}/comments`,
  );
}

export async function addTicketComment(
  ticketId: string,
  body: string,
): Promise<TicketCommentRecord> {
  return mutateJson<TicketCommentRecord>(
    `/api/tickets/${encodeURIComponent(ticketId)}/comments`,
    "POST",
    { body },
    "Ticket comment failed",
  );
}

export async function assignTicket(
  ticketId: string,
  payload: { assigneeId: string; assigneeName: string; note?: string },
): Promise<SupportTicketRecord> {
  return mutateJson<SupportTicketRecord>(
    `/api/tickets/${encodeURIComponent(ticketId)}/assign`,
    "POST",
    payload,
    "Ticket assignment failed",
  );
}

export async function changeTicketStatus(
  ticketId: string,
  payload: { status: TicketStatusInput; note?: string },
): Promise<SupportTicketRecord> {
  return mutateJson<SupportTicketRecord>(
    `/api/tickets/${encodeURIComponent(ticketId)}/status`,
    "POST",
    payload,
    "Ticket status change failed",
  );
}

// ── Tenants 治理 写/读聚合（B10）──────────────────────────────────────────

export interface UpdateTenantInput {
  /** 认证名（tenancy.tenants.name）。认证通过时后端会把它归位到申报的企业名。 */
  name?: string;
  /** 简称（tenancy.tenants.display_name，自由改）。与 name 是两列，别当成一个。 */
  displayName?: string;
  status?: TenantOperationRecord["status"];
  industry?: string;
  scale?: string;
  description?: string;
  website?: string;
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  contactPhone?: string;
  countryCode?: string;
  address?: string;
  postalCode?: string;
}

/**
 * 详情投影（列表投影 + 成员 / 订阅 / 用量 / 审计 / 工单五段明细）。
 * `tenantId` 收 id 或租户编码——BFF 两者都认。详情页此前拉整张列表再 find 一条，
 * 明细数组只有这条路由才带（2026-08-30）。与 fetchSubscriptionOperation 同一形态。
 */
export async function fetchTenantOperation(
  tenantId: string,
): Promise<TenantOperationDetailRecord | null> {
  return readJson<TenantOperationDetailRecord | null>(
    `/api/tenants/${encodeURIComponent(tenantId)}`,
    null,
  );
}

/**
 * 运营内部备注。空字符串是合法值（= 清空），所以不在这里拦空。
 * 每次保存后端写一条 tenant.operator_notes.update 审计（带 before/after）。
 */
export async function updateTenantOperatorNotes(
  tenantId: string,
  body: string,
): Promise<TenantOperationDetailRecord> {
  return mutateJson<TenantOperationDetailRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/operator-notes`,
    "PUT",
    { body },
    "Tenant operator notes update failed",
  );
}

export async function updateTenant(
  tenantId: string,
  payload: UpdateTenantInput,
): Promise<TenantOperationDetailRecord> {
  return mutateJson<TenantOperationDetailRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}`,
    "PUT",
    payload,
    "Tenant update failed",
  );
}

export async function suspendTenant(
  tenantId: string,
): Promise<TenantOperationDetailRecord> {
  return mutateJson<TenantOperationDetailRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/suspend`,
    "POST",
    undefined,
    "Tenant suspend failed",
  );
}

export async function resumeTenant(
  tenantId: string,
): Promise<TenantOperationDetailRecord> {
  return mutateJson<TenantOperationDetailRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/resume`,
    "POST",
    undefined,
    "Tenant resume failed",
  );
}

export async function fetchTenantMembers(
  tenantId: string,
): Promise<TenantMemberRecord[]> {
  return readJsonStrict<TenantMemberRecord[]>(
    `/api/tenants/${encodeURIComponent(tenantId)}/members`,
  );
}

export async function changeTenantMemberRole(
  tenantId: string,
  userId: string,
  roleId: string,
): Promise<TenantMemberRecord> {
  return mutateJson<TenantMemberRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/role`,
    "POST",
    { roleId },
    "Tenant member role change failed",
  );
}

export async function suspendTenantMember(
  tenantId: string,
  userId: string,
): Promise<TenantMemberRecord> {
  return mutateJson<TenantMemberRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/suspend`,
    "POST",
    undefined,
    "Tenant member suspend failed",
  );
}

export async function removeTenantMember(
  tenantId: string,
  userId: string,
): Promise<TenantMemberRecord> {
  return mutateJson<TenantMemberRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/remove`,
    "POST",
    undefined,
    "Tenant member removal failed",
  );
}

export async function fetchTenantVerifications(
  status?: TenantVerificationStatus,
): Promise<TenantVerificationRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return readJsonStrict<TenantVerificationRecord[]>(
    `/api/tenants/verifications${query}`,
  );
}

export async function approveTenantVerification(
  verificationId: string,
): Promise<TenantVerificationRecord> {
  return mutateJson<TenantVerificationRecord>(
    `/api/tenants/verifications/${encodeURIComponent(verificationId)}/approve`,
    "POST",
    undefined,
    "Tenant verification approval failed",
  );
}

export async function rejectTenantVerification(
  verificationId: string,
  reason: string,
): Promise<TenantVerificationRecord> {
  return mutateJson<TenantVerificationRecord>(
    `/api/tenants/verifications/${encodeURIComponent(verificationId)}/reject`,
    "POST",
    { reason },
    "Tenant verification rejection failed",
  );
}

// ── Operator RBAC 非凭据写路径（B9-P1a）──────────────────────────────────────
// 复用 mutateJson + AdminBffError；这些端点后端 step-up gated，未满足二次验证时
// 返回 HTTP 403 message "step_up_required"（见 isStepUpRequiredError）。

/**
 * True when a mutation was rejected by the operator step-up gate
 * (HTTP 403, message "step_up_required"). Pages surface a friendly prompt
 * instead of the raw backend message.
 */
export function isStepUpRequiredError(error: unknown): boolean {
  return (
    error instanceof AdminBffError &&
    error.status === 403 &&
    error.message.toLowerCase().includes("step_up")
  );
}

/**
 * Verify a TOTP code to satisfy the operator step-up gate. On success the BFF
 * sets a short-lived step-up cookie; the caller then retries the gated mutation.
 * Throws AdminBffError on an invalid/expired code or when the operator has no
 * TOTP factor registered at the IdP.
 */
export async function submitOperatorStepUpTotp(
  code: string,
): Promise<{ ok: true; expiresIn: number }> {
  return mutateJson<{ ok: true; expiresIn: number }>(
    "/api/operator/step-up/totp",
    "POST",
    { code },
    "二次验证失败",
  );
}

// 运营者本人自助改邮箱（原 startOperatorEmailChange / verifyOperatorEmailChange，
// 走 admin-bff /api/operator/contact/email/*）已随 Phase B.2 收敛到身份层 accounts
// 账户中心（auth-bff cookie 版 oidc/operator/self/email/*），admin 侧客户端方法退役。

// ── TD-021 governance（risk / compliance / maintenance）──────────────────────
// 设计权威 = docs/product/platform/admin/governance-write-paths.md §4/§5。

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ── Feature flags (admin.feature_flags, P2) ─────────────────────────────────

// ── Platform settings (admin.settings, P2) ──────────────────────────────────

// ── Notification delivery logs (support.notification_logs, P2, read-only) ───

export interface NotificationLogListFilters {
  channel?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
}

export async function fetchNotificationLogs(
  filters: NotificationLogListFilters = {},
): Promise<NotificationLogRecord[]> {
  return readJson<NotificationLogRecord[]>(
    `/api/notification-logs${queryString(filters)}`,
    [],
  );
}

// ── Global search (header ⌘K) ───────────────────────────────────────────────

export type AdminSearchKind = "tenant" | "order";

export interface AdminSearchItem {
  kind: AdminSearchKind;
  id: string;
  label: string;
  description?: string;
  meta?: string;
  /** 目标路径由 BFF 给出，前端不拼——路由形状变了只改一处。 */
  href: string;
}

export interface AdminSearchResponse {
  query: string;
  items: AdminSearchItem[];
  /** true = 查询串太短，后端没检索（跟"检索了但没命中"不是一回事）。 */
  skipped: boolean;
}

/**
 * 走裸 fetch 而不是 readJson/readJsonStrict：这两个都不接 AbortSignal，而搜索
 * 是连续输入触发的，必须能取消——否则慢的旧请求后到会盖掉新关键词的结果。
 */
export async function searchAdmin(
  query: string,
  signal?: AbortSignal,
): Promise<AdminSearchResponse> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/search?q=${encodeURIComponent(query)}`,
    {
      credentials: "include",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw new AdminBffError(
      `Request failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as AdminSearchResponse;
}

// ============================================================================
// Addon orders (加油包订单核销 — /api/addon-orders)
// ============================================================================

export interface AddonOrderOperationRecord {
  id: string;
  orderNo: string;
  billNo: string | null;
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  price: string;
  currency: string;
  status: string;
  /** true = 客户已申报转账,等待核销 */
  paymentDeclared: boolean;
  tenantId: string;
  createdAt: string;
  activatedAt: string | null;
}

export async function fetchAddonOrders(): Promise<AddonOrderOperationRecord[]> {
  return readJsonStrict<AddonOrderOperationRecord[]>("/api/addon-orders");
}

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
// Settles an addon order (加油包核销): flips/creates the paid leg, clears the
// one_off invoice, grants the WS-level quota pool, completes the purchase —
// one transaction on the BFF side. Re-driving an already-settled order
// returns { settled: false } (safe no-op).
export async function confirmAddonOrderPayment(
  purchaseId: string,
  remark?: string,
): Promise<{ settled: boolean; order: AddonOrderOperationRecord | null }> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/addon-orders/${encodeURIComponent(purchaseId)}/offline-payment-confirm`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remark ? { remark } : {}),
    },
  );
  if (!response.ok) {
    let message = "加油包收款确认失败";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Keep a typed error for non-JSON proxy responses.
    }
    throw new AdminBffError(message, response.status);
  }
  return (await response.json()) as {
    settled: boolean;
    order: AddonOrderOperationRecord | null;
  };
}

// ── 客户评价（support.product_reviews；运营总览「客户评价」区的下钻）─────────

export interface ReviewListItem {
  /** 可视码：租户号。**不返回也不展示 UUID**。 */
  tenantNo: string;
  tenantName: string;
  productName: string;
  /** null = 这一项没评，**不是 0 分**。 */
  productScore: number | null;
  priceScore: number | null;
  serviceScore: number | null;
  comment: string | null;
  createdAt: string;
}

/**
 * 评价列表。
 *
 * `withComment` 缺省为 true——运营点进来是为了看客户说了什么；纯分数在三张卡上
 * 已经汇总过了，逐条再列一遍只是噪声。
 */
export async function fetchReviewList(params: {
  limit?: number;
  offset?: number;
  withComment?: boolean;
}): Promise<{ items: ReviewListItem[]; total: number }> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.withComment === false) query.set("withComment", "false");
  return readJsonStrict<{ items: ReviewListItem[]; total: number }>(
    `/api/dashboard/reviews${query.size ? `?${query.toString()}` : ""}`,
  );
}

// ── 运营通告（admin.operator_notices；发布面在 opera，这边只读）───────────────

export interface OperatorNoticeItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  link: string | null;
  source: "manual" | "system";
  publishedAt: string;
  /** 本人读过的时刻；null = 未读。 */
  readAt: string | null;
  /** 发布人显示名；system 来源与已注销账号都回 null。 */
  createdByName: string | null;
}

/**
 * 运营通告列表。
 *
 * `scope` 缺省 `digest` —— owner 2026-09-20 定的摘要规则：**当天已读 + 所有未读**。
 * 二级页传 `all` 看全部。`unread` 是本平面可见的未读总数,不随 scope 变。
 */
export async function fetchOperatorNotices(params: {
  scope?: "digest" | "all";
  limit?: number;
  offset?: number;
}): Promise<{ items: OperatorNoticeItem[]; total: number; unread: number }> {
  const query = new URLSearchParams();
  if (params.scope) query.set("scope", params.scope);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  return readJsonStrict<{
    items: OperatorNoticeItem[];
    total: number;
    unread: number;
  }>(`/api/dashboard/notices${query.size ? `?${query.toString()}` : ""}`);
}

/** 标记本人已读。幂等——重复标记只刷新时间，不报错。 */
export async function markOperatorNoticeRead(
  noticeId: string,
): Promise<{ id: string; readAt: string }> {
  // 走本文件既有的 mutateJson,不另手搓一份 fetch:它统一了 credentials、
  // 断网时的 503 与错误文案提取。
  return mutateJson<{ id: string; readAt: string }>(
    `/api/dashboard/notices/${encodeURIComponent(noticeId)}/read`,
    "POST",
    undefined,
    "标记已读失败",
  );
}
