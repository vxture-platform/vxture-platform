import type {
  AccountOperationRecord,
  AnnouncementRecord,
  AuditLogRecord,
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
  FeatureFlagRecord,
  NotificationLogRecord,
  PlatformSettingRecord,
  OrderOfflinePaymentType,
  OrderOperationDetailRecord,
  OrderOperationRecord,
  PaymentOperationRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  PlatformAdminPermissionRecord,
  PlatformAdminRecord,
  PlatformGovernanceKind,
  PlatformGovernanceRecord,
  PromotionOperationRecord,
  PromotionRedemptionRecord,
  ProductAgentRecord,
  ProductCapabilityRecord,
  ProductModelPolicyRecord,
  ProductPlanRecord,
  ProductReleaseRecord,
  ProductServicePlanDetailRecord,
  ProductSolutionDetailRecord,
  ProductSolutionRecord,
  ComplianceEventItem,
  PlatformRoleRecord,
  RiskRecordItem,
  SessionSnapshot,
  SkillRecord,
  SupportTicketRecord,
  SubscriptionOperationAction,
  SubscriptionOperationDetailRecord,
  SubscriptionOperationRecord,
  TenantMemberRecord,
  TenantOperationRecord,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
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

export interface CaptchaChallenge {
  token: string;
  targetRatio: number;
}

export class AdminBffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
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
  try {
    const body = (await response.clone().json()) as {
      message?: string | string[];
    };
    return Array.isArray(body.message)
      ? (body.message[0] ?? fallback)
      : (body.message ?? fallback);
  } catch {
    return fallback;
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
    throw new AdminBffError(
      await responseErrorMessage(response, fallbackMessage),
      response.status,
    );
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

export async function fetchTenantModelUsageSummaries(
  filters: {
    tenantId?: string;
    applicationId?: string;
    applicationType?: "agent" | "workflow" | "api_client" | "internal_service";
    cycleMonth?: string;
    statType?: string;
  } = {},
): Promise<TenantUsageSummaryRecord[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.applicationId) params.set("applicationId", filters.applicationId);
  if (filters.applicationType) {
    params.set("applicationType", filters.applicationType);
  }
  if (filters.cycleMonth) params.set("cycleMonth", filters.cycleMonth);
  if (filters.statType) params.set("statType", filters.statType);

  return readJsonStrict<TenantUsageSummaryRecord[]>(
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
  status: string;
  isLocked: boolean;
  isCurrent: boolean;
  prices: PlanVersionPrice[];
}

export interface PlanVersionDetail extends PlanVersionSummary {
  planId: string;
  planCode: string;
  planName: string;
  quota: Record<string, unknown>;
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

// step-up gated (@RequireStepUp) — wrap the call in runWithStepUp at the UI.
export async function publishPlanVersion(
  versionId: string,
): Promise<{ published: true; versionId: string }> {
  return mutateJson<{ published: true; versionId: string }>(
    `/api/products/plan-versions/${encodeURIComponent(versionId)}/publish`,
    "POST",
    undefined,
    "Failed to publish version",
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

export async function fetchProductModelPolicies(): Promise<
  ProductModelPolicyRecord[]
> {
  return readJson<ProductModelPolicyRecord[]>(
    "/api/products/model-policies",
    [],
  );
}

export async function fetchPlatformAdmins(): Promise<PlatformAdminRecord[]> {
  return readJsonStrict<PlatformAdminRecord[]>("/api/platform-admins");
}

export interface PlatformOverview {
  operatorCount: number;
  tenantCount: number;
  pendingVerifications: number;
  openRiskCount: number;
  activeSubscriptions: number;
  openTickets: number;
}

// 平台总览真实聚合（B15）：替换 PlatformAutonomyPage 的硬编码指标。
export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  return readJson<PlatformOverview>("/api/platform-admins/overview", {
    operatorCount: 0,
    tenantCount: 0,
    pendingVerifications: 0,
    openRiskCount: 0,
    activeSubscriptions: 0,
    openTickets: 0,
  });
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
    totalInPrevPeriod: number;
  };
}

const EMPTY_DASHBOARD_OVERVIEW: Omit<DashboardOverviewRecord, "period"> = {
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
    totalInPrevPeriod: 0,
  },
};

// admin 首页真实聚合（TD-036）：替换首页 overviewSnapshots 等硬编码 mock 常量。
export async function fetchDashboardOverview(
  period: DashboardOverviewPeriod,
): Promise<DashboardOverviewRecord> {
  return readJson<DashboardOverviewRecord>(
    `/api/platform-admins/dashboard-overview?period=${encodeURIComponent(period)}`,
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
// Creates a voucher batch (product_321 §4.2; V1 kinds discount /
// credit_voucher; gate fields rejected server-side).
export async function createVoucherBatch(payload: {
  kind: "discount" | "credit_voucher";
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

export async function fetchPlatformGovernanceRecords(
  kind: PlatformGovernanceKind,
): Promise<PlatformGovernanceRecord[]> {
  return readJsonStrict<PlatformGovernanceRecord[]>(
    `/api/platform-governance/${encodeURIComponent(kind)}`,
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
  payload: { action: SubscriptionOperationAction; reason: string },
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

export async function fetchPlatformRoles(): Promise<PlatformRoleRecord[]> {
  return readJsonStrict<PlatformRoleRecord[]>("/api/admin-roles");
}

export async function replacePlatformRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<PlatformRoleRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/admin-roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permissionIds }),
    },
  );

  if (!response.ok) {
    let message = "Role authorization update failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? (body.message[0] ?? message)
        : (body.message ?? message);
    } catch {
      // Preserve a typed error when the BFF returns a non-JSON response.
    }

    throw new AdminBffError(message, response.status);
  }

  return (await response.json()) as PlatformRoleRecord;
}

export async function fetchPlatformPermissions(): Promise<
  PlatformAdminPermissionRecord[]
> {
  return readJsonStrict<PlatformAdminPermissionRecord[]>(
    "/api/admin-permissions",
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

export async function createAiModelGrant(payload: {
  modelId: string;
  tenantId: string;
  applicationId?: string | null;
  applicationType?:
    | "agent"
    | "workflow"
    | "api_client"
    | "internal_service"
    | null;
  agentId?: string | null;
  priority?: number | null;
  reason?: string | null;
  expiresAt?: string | null;
  isActive?: boolean;
}): Promise<AiModelGrantRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/atlas/grants`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new AdminBffError("AI model grant creation failed", response.status);
  }

  return (await response.json()) as AiModelGrantRecord;
}

export async function updateAiModelGrant(
  grantId: string,
  payload: {
    agentId?: string | null;
    applicationId?: string | null;
    applicationType?:
      | "agent"
      | "workflow"
      | "api_client"
      | "internal_service"
      | null;
    priority?: number | null;
    reason?: string | null;
    expiresAt?: string | null;
    isActive?: boolean;
  },
): Promise<AiModelGrantRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/atlas/grants/${grantId}`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new AdminBffError("AI model grant update failed", response.status);
  }

  return (await response.json()) as AiModelGrantRecord;
}

export async function setAiModelGrantActive(
  grantId: string,
  active: boolean,
): Promise<AiModelGrantRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/atlas/grants/${grantId}${active ? "/activate" : ""}`,
    {
      method: active ? "POST" : "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new AdminBffError(
      "AI model grant state update failed",
      response.status,
    );
  }

  return (await response.json()) as AiModelGrantRecord;
}

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
  effectiveAt?: string | null;
  expiresAt?: string | null;
  isActive?: boolean;
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
  payload: Partial<Omit<ModelPriceRuleWriteInput, "modelId">>,
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

export async function getCaptchaChallenge(): Promise<CaptchaChallenge> {
  let response: Response;

  try {
    response = await fetch(
      `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/auth/captcha/challenge`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      },
    );
  } catch {
    throw new AdminBffError("Admin BFF is unavailable.", 503);
  }

  if (!response.ok) {
    throw new AdminBffError(
      "Failed to obtain captcha challenge.",
      response.status,
    );
  }

  return (await response.json()) as CaptchaChallenge;
}

export async function sendAdminPhoneCode(
  phone: string,
  turnstileToken?: string,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(
      `${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/auth/send-phone-code`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, turnstileToken }),
      },
    );
  } catch {
    throw new AdminBffError("Admin BFF is unavailable.", 503);
  }

  if (!response.ok) {
    throw new AdminBffError(
      await responseErrorMessage(response, "Failed to send phone code."),
      response.status,
    );
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

export async function logout() {
  try {
    await fetch(`${DEFAULT_BFF_URL}${ADMIN_API_PREFIX}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    // Keep local sign-out resilient even if the BFF is unavailable.
  }
}

export interface AuditLogFilters {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  module?: string;
  result?: "success" | "failure" | "denied";
}

// Server-side filters (BFF audit-logs.router). Date range is the key one: audit
// logs grow unboundedly, so without from/to only the most-recent 500 are visible.
// Strict read: errors propagate so the page can distinguish a failure from an
// empty result (avoids the silent readJson->[] swallow, §0.3 "错误不可观测").
export async function fetchAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogRecord[]> {
  return readJsonStrict<AuditLogRecord[]>(
    `/api/audit-logs${queryString(filters)}`,
  );
}

export async function fetchAnnouncements(): Promise<AnnouncementRecord[]> {
  return readJsonStrict<AnnouncementRecord[]>("/api/announcements");
}

export async function fetchSkills(): Promise<SkillRecord[]> {
  return readJson<SkillRecord[]>("/api/skills", []);
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

export type TicketStatusInput =
  | "open"
  | "pending"
  | "in_progress"
  | "resolved"
  | "closed"
  | "reopened"
  | "cancelled";

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
  name?: string;
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

export async function updateTenant(
  tenantId: string,
  payload: UpdateTenantInput,
): Promise<TenantOperationRecord> {
  return mutateJson<TenantOperationRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}`,
    "PUT",
    payload,
    "Tenant update failed",
  );
}

export async function suspendTenant(
  tenantId: string,
): Promise<TenantOperationRecord> {
  return mutateJson<TenantOperationRecord>(
    `/api/tenants/${encodeURIComponent(tenantId)}/suspend`,
    "POST",
    undefined,
    "Tenant suspend failed",
  );
}

export async function resumeTenant(
  tenantId: string,
): Promise<TenantOperationRecord> {
  return mutateJson<TenantOperationRecord>(
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

export interface OperatorRoleCreateInput {
  roleCode: string;
  nameEn: string;
  nameI18nKey?: string;
  description?: string;
  mfaMinLevel?: "disabled" | "optional" | "required";
  sort?: number;
}

export interface OperatorRoleUpdateInput {
  nameEn?: string;
  nameI18nKey?: string;
  description?: string;
  mfaMinLevel?: "disabled" | "optional" | "required";
  sort?: number;
}

export interface OperatorRoleCopyInput {
  roleCode: string;
  nameEn?: string;
  nameI18nKey?: string;
  description?: string;
}

export async function createOperatorRole(
  payload: OperatorRoleCreateInput,
): Promise<PlatformRoleRecord> {
  return mutateJson<PlatformRoleRecord>(
    "/api/admin-roles",
    "POST",
    payload,
    "Operator role creation failed",
  );
}

export async function updateOperatorRole(
  roleId: string,
  payload: OperatorRoleUpdateInput,
): Promise<PlatformRoleRecord> {
  return mutateJson<PlatformRoleRecord>(
    `/api/admin-roles/${encodeURIComponent(roleId)}`,
    "PUT",
    payload,
    "Operator role update failed",
  );
}

export async function copyOperatorRole(
  roleId: string,
  payload: OperatorRoleCopyInput,
): Promise<PlatformRoleRecord> {
  return mutateJson<PlatformRoleRecord>(
    `/api/admin-roles/${encodeURIComponent(roleId)}/copy`,
    "POST",
    payload,
    "Operator role copy failed",
  );
}

export async function toggleOperatorRoleStatus(
  roleId: string,
): Promise<PlatformRoleRecord> {
  return mutateJson<PlatformRoleRecord>(
    `/api/admin-roles/${encodeURIComponent(roleId)}/toggle-status`,
    "POST",
    undefined,
    "Operator role status toggle failed",
  );
}

export async function deleteOperatorRole(
  roleId: string,
): Promise<{ id: string; status: "deleted" }> {
  return mutateJson<{ id: string; status: "deleted" }>(
    `/api/admin-roles/${encodeURIComponent(roleId)}`,
    "DELETE",
    undefined,
    "Operator role deletion failed",
  );
}

export interface OperatorPermissionCreateInput {
  permCode: string;
  permType: string;
  permName: string;
  parentId?: string | null;
  routePath?: string | null;
  component?: string | null;
  icon?: string | null;
  description?: string;
  sort?: number;
}

export interface OperatorPermissionUpdateInput {
  permCode?: string;
  permType?: string;
  permName?: string;
  parentId?: string | null;
  routePath?: string | null;
  component?: string | null;
  icon?: string | null;
  description?: string;
  sort?: number;
}

export async function createOperatorPermission(
  payload: OperatorPermissionCreateInput,
): Promise<PlatformAdminPermissionRecord> {
  return mutateJson<PlatformAdminPermissionRecord>(
    "/api/admin-permissions",
    "POST",
    payload,
    "Operator permission creation failed",
  );
}

export async function updateOperatorPermission(
  permissionId: string,
  payload: OperatorPermissionUpdateInput,
): Promise<PlatformAdminPermissionRecord> {
  return mutateJson<PlatformAdminPermissionRecord>(
    `/api/admin-permissions/${encodeURIComponent(permissionId)}`,
    "PUT",
    payload,
    "Operator permission update failed",
  );
}

export async function toggleOperatorPermission(
  permissionId: string,
): Promise<PlatformAdminPermissionRecord> {
  return mutateJson<PlatformAdminPermissionRecord>(
    `/api/admin-permissions/${encodeURIComponent(permissionId)}/toggle`,
    "POST",
    undefined,
    "Operator permission toggle failed",
  );
}

export interface PlatformAdminMetadataInput {
  displayName?: string;
  email?: string;
  phone?: string;
  remark?: string;
  sort?: number;
}

export interface CreatePlatformAdminInput {
  username: string;
  displayName: string;
  email: string;
  phone?: string;
  roleId: string;
}

/**
 * Create a new operator (TD-017 §③⑤). No credential is handled client-side —
 * the IdP mails an out-of-band initial-setup link to the new operator's own
 * email; the response only carries a masked delivery confirmation.
 */
export async function createPlatformAdmin(
  input: CreatePlatformAdminInput,
): Promise<{ record: PlatformAdminRecord; deliveredTo: string }> {
  return mutateJson<{ record: PlatformAdminRecord; deliveredTo: string }>(
    "/api/platform-admins",
    "POST",
    input,
    "Platform admin creation failed",
  );
}

export async function changePlatformAdminRole(
  adminId: string,
  roleId: string,
): Promise<PlatformAdminRecord> {
  return mutateJson<PlatformAdminRecord>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/role`,
    "POST",
    { roleId },
    "Platform admin role change failed",
  );
}

export async function updatePlatformAdmin(
  adminId: string,
  payload: PlatformAdminMetadataInput,
): Promise<PlatformAdminRecord> {
  return mutateJson<PlatformAdminRecord>(
    `/api/platform-admins/${encodeURIComponent(adminId)}`,
    "PUT",
    payload,
    "Platform admin update failed",
  );
}

// B9-P1b-α：凭据/会话类动作经 IdP 委托（后端 admin-bff→auth-bff /internal/operator/*）。
export async function disablePlatformAdmin(
  adminId: string,
  reason?: string,
): Promise<PlatformAdminRecord> {
  return mutateJson<PlatformAdminRecord>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/disable`,
    "POST",
    reason ? { reason } : {},
    "Platform admin disable failed",
  );
}

export async function enablePlatformAdmin(
  adminId: string,
  reason?: string,
): Promise<PlatformAdminRecord> {
  return mutateJson<PlatformAdminRecord>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/enable`,
    "POST",
    reason ? { reason } : {},
    "Platform admin enable failed",
  );
}

export async function forcePlatformAdminLogout(
  adminId: string,
  reason?: string,
): Promise<{ ok: true; revoked: number }> {
  return mutateJson<{ ok: true; revoked: number }>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/force-logout`,
    "POST",
    reason ? { reason } : {},
    "Platform admin force-logout failed",
  );
}

export async function resetPlatformAdminMfa(
  adminId: string,
  reason?: string,
): Promise<{ ok: true; revoked: number }> {
  return mutateJson<{ ok: true; revoked: number }>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/mfa/reset`,
    "POST",
    reason ? { reason } : {},
    "Platform admin MFA reset failed",
  );
}

// B9-P1b-β：生成一次性重置链接（不下发明文）；运营复制交付用户，用户在公开重置页设新密码。
export async function resetPlatformAdminPassword(
  adminId: string,
  reason?: string,
): Promise<{ ok: true; deliveredTo: string; expiresIn: number }> {
  return mutateJson<{ ok: true; deliveredTo: string; expiresIn: number }>(
    `/api/platform-admins/${encodeURIComponent(adminId)}/reset-password`,
    "POST",
    reason ? { reason } : {},
    "Platform admin password reset failed",
  );
}

/** Operator self-service email change — step 1: send a code to the NEW email (TD-017 §③). */
export async function startOperatorEmailChange(
  newEmail: string,
): Promise<{ ok: true; sentTo: string }> {
  return mutateJson<{ ok: true; sentTo: string }>(
    "/api/operator/contact/email/start",
    "POST",
    { newEmail },
    "Failed to send verification code",
  );
}

/** Operator self-service email change — step 2: submit the code → new email + verified. */
export async function verifyOperatorEmailChange(
  code: string,
): Promise<{ ok: true; email: string }> {
  return mutateJson<{ ok: true; email: string }>(
    "/api/operator/contact/email/verify",
    "POST",
    { code },
    "Email verification failed",
  );
}

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

export interface RiskRecordListFilters {
  tenantId?: string;
  riskLevel?: string;
  reviewed?: "true" | "false";
  tag?: string;
}

export async function fetchRiskRecords(
  filters: RiskRecordListFilters = {},
): Promise<RiskRecordItem[]> {
  return readJsonStrict<RiskRecordItem[]>(
    `/api/risk-records${queryString(filters)}`,
  );
}

export interface RiskRecordWriteInput {
  tenantId?: string;
  riskLevel?: RiskRecordItem["riskLevel"];
  riskScore?: number | null;
  scope?: string | null;
  reason: string;
  tags?: string[];
}

export async function createRiskRecord(
  payload: RiskRecordWriteInput,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    "/api/risk-records",
    "POST",
    payload,
    "Risk record creation failed",
  );
}

export async function updateRiskRecord(
  recordId: string,
  payload: RiskRecordWriteInput,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    `/api/risk-records/${recordId}`,
    "PUT",
    payload,
    "Risk record update failed",
  );
}

export async function reviewRiskRecord(
  recordId: string,
): Promise<RiskRecordItem> {
  return mutateJson<RiskRecordItem>(
    `/api/risk-records/${recordId}/review`,
    "POST",
    undefined,
    "Risk record review failed",
  );
}

export async function deleteRiskRecord(
  recordId: string,
): Promise<{ id: string; status: "deleted" }> {
  return mutateJson<{ id: string; status: "deleted" }>(
    `/api/risk-records/${recordId}`,
    "DELETE",
    undefined,
    "Risk record deletion failed",
  );
}

export interface ComplianceEventListFilters {
  status?: string;
  tenantId?: string;
  eventType?: string;
  tag?: string;
}

export async function fetchComplianceEvents(
  filters: ComplianceEventListFilters = {},
): Promise<ComplianceEventItem[]> {
  return readJsonStrict<ComplianceEventItem[]>(
    `/api/compliance-events${queryString(filters)}`,
  );
}

export interface ComplianceEventWriteInput {
  tenantId?: string | null;
  eventType: string;
  regulationCode?: string | null;
  evidenceUrl?: string | null;
  detail?: Record<string, unknown> | null;
  tags?: string[];
}

export async function createComplianceEvent(
  payload: ComplianceEventWriteInput,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    "/api/compliance-events",
    "POST",
    payload,
    "Compliance event creation failed",
  );
}

export async function updateComplianceEvent(
  eventId: string,
  payload: ComplianceEventWriteInput,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}`,
    "PUT",
    payload,
    "Compliance event update failed",
  );
}

export async function assignComplianceEvent(
  eventId: string,
  handlerId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/assign`,
    "POST",
    { handlerId },
    "Compliance event assignment failed",
  );
}

export async function resolveComplianceEvent(
  eventId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/resolve`,
    "POST",
    undefined,
    "Compliance event resolution failed",
  );
}

export async function dismissComplianceEvent(
  eventId: string,
): Promise<ComplianceEventItem> {
  return mutateJson<ComplianceEventItem>(
    `/api/compliance-events/${eventId}/dismiss`,
    "POST",
    undefined,
    "Compliance event dismissal failed",
  );
}

export async function deleteComplianceEvent(
  eventId: string,
): Promise<{ id: string; status: "deleted" }> {
  return mutateJson<{ id: string; status: "deleted" }>(
    `/api/compliance-events/${eventId}`,
    "DELETE",
    undefined,
    "Compliance event deletion failed",
  );
}

// ── Feature flags (admin.feature_flags, P2) ─────────────────────────────────

export interface FeatureFlagListFilters {
  category?: string;
  environment?: string;
  archived?: "true" | "false" | "all";
}

export async function fetchFeatureFlags(
  filters: FeatureFlagListFilters = {},
): Promise<FeatureFlagRecord[]> {
  return readJson<FeatureFlagRecord[]>(
    `/api/feature-toggles${queryString(filters)}`,
    [],
  );
}

export interface FeatureFlagWriteInput {
  flagKey?: string;
  category?: string;
  environment?: string;
  description?: string | null;
  rolloutPercentage?: number;
  tenantOverrides?: Record<string, boolean>;
  expiresAt?: string | null;
}

export async function createFeatureFlag(
  payload: FeatureFlagWriteInput,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    "/api/feature-toggles",
    "POST",
    payload,
    "Feature flag creation failed",
  );
}

export async function updateFeatureFlag(
  flagId: string,
  payload: FeatureFlagWriteInput,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}`,
    "PUT",
    payload,
    "Feature flag update failed",
  );
}

export async function toggleFeatureFlag(
  flagId: string,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}/toggle`,
    "POST",
    undefined,
    "Feature flag toggle failed",
  );
}

export async function archiveFeatureFlag(
  flagId: string,
  archived: boolean,
): Promise<FeatureFlagRecord> {
  return mutateJson<FeatureFlagRecord>(
    `/api/feature-toggles/${flagId}/archive`,
    "POST",
    { archived },
    "Feature flag archive failed",
  );
}

// ── Platform settings (admin.settings, P2) ──────────────────────────────────

export interface PlatformSettingListFilters {
  group?: string;
  search?: string;
}

export async function fetchPlatformSettings(
  filters: PlatformSettingListFilters = {},
): Promise<PlatformSettingRecord[]> {
  return readJson<PlatformSettingRecord[]>(
    `/api/system-parameters${queryString(filters)}`,
    [],
  );
}

export async function updatePlatformSetting(
  settingId: string,
  configValue: string,
): Promise<PlatformSettingRecord> {
  return mutateJson<PlatformSettingRecord>(
    `/api/system-parameters/${settingId}`,
    "PUT",
    { configValue },
    "Platform setting update failed",
  );
}

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

export type AdminSearchKind = "tenant" | "order" | "operator";

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
