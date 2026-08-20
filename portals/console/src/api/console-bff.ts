import type {
  Capability,
  AiModelGrantRecord,
  AiModelRecord,
  AuthSessionRecord,
  ConsoleOrganizationProfile,
  ConsoleWorkspaceItem,
  ConsoleUser,
  ConsoleUserProfile,
  IdentityRecord,
  LastLoginInfo,
  LoginHistoryEntry,
  MemberRecord,
  OrganizationProfileUpdate,
  SessionSnapshot,
  TenancyQuotaResponse,
  TenancyUsageResponse,
  TenantContext,
  TenantPermissionRecord,
  TenantRoleRecord,
} from "@/entities/console";

// ── 订阅与账单 DTO（与 BFF 响应结构对齐）────────────────────────────────────

export interface ConsoleSubscription {
  id: string;
  tenantId: string;
  planId: string;
  planName: string;
  status: string;
  price: number;
  currency: string;
  cycle: string;
  /** null = perpetual/free subscription with no scheduled renewal. */
  nextBillingDate: string | null;
  autoRenew: boolean;
  isTrial: boolean;
}

/**
 * Frontend view-model for a billing record. This is deliberately decoupled from
 * the raw `InvoiceRecord` the BFF passes through (see `RawBillRecord` /
 * `toConsoleInvoice` below): the list endpoint returns bill headers only, with
 * no line items, so `lineItems` is always `[]` here. Consumers must keep
 * treating `lineItems` as possibly empty.
 */
export interface ConsoleInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  currency: string;
  dueDate: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

function normalizeOrigin(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "http://localhost:3021";
  }
  return normalized;
}

const DEFAULT_BFF_URL = normalizeOrigin(
  process.env.NEXT_PUBLIC_CONSOLE_BFF_URL ?? process.env.NEXT_PUBLIC_API_URL,
);
const CONSOLE_API_PREFIX = resolveConsoleApiPrefix();

function resolveConsoleApiPrefix(): string {
  const explicitPrefix = process.env.NEXT_PUBLIC_CONSOLE_API_PREFIX;
  if (explicitPrefix !== undefined) {
    return explicitPrefix.trim().replace(/\/+$/, "");
  }

  // 默认直连 console-bff；只有显式配置统一 API 网关时才保留 /console-api 前缀。
  const usesDirectConsoleBff =
    Boolean(process.env.NEXT_PUBLIC_CONSOLE_BFF_URL?.trim()) ||
    !process.env.NEXT_PUBLIC_API_URL?.trim();
  return usesDirectConsoleBff ? "" : "/console-api";
}

/**
 * Absolute URL of the RP login entry on console-bff. It 302s to the IdP
 * authorize endpoint and on to the central accounts login surface; on success
 * the callback sets the opaque RP session cookie and redirects to `returnTo`.
 * Lives at the BFF root (outside the legacy /api/auth/* seam). See
 * identity-platform-architecture.md §9.
 */
export function buildRpLoginUrl(
  returnTo?: string,
  opts?: { prompt?: string },
): string {
  const base = `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/auth/login`;
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (opts?.prompt) params.set("prompt", opts.prompt);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

const ANONYMOUS_SESSION: SessionSnapshot = {
  isAuthenticated: false,
  user: null,
  tenant: null,
  tenantOptions: [],
  capabilities: [],
};

export class ConsoleBffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ConsoleBffError";
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(
      `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${path}`,
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

/**
 * Strict counterpart to `readJson`: it THROWS instead of degrading to a
 * fallback. `readJson` turning every failure into an empty value is the right
 * default for decorative reads, but it makes "the backend is down" and "you
 * have no data" indistinguishable — which on some screens is actively
 * misleading (an outage on the security page reads as "you have no active
 * sessions", the reassuring answer, and the wrong one). Pages that must tell
 * the two apart use this and render their own error state.
 */
async function readJsonStrict<T>(path: string): Promise<T> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${path}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      `Request failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

function withTenant(path: string) {
  return path;
}

export async function fetchCurrentUser(): Promise<ConsoleUser | null> {
  return readJson<ConsoleUser | null>("/api/me", null);
}

export async function fetchTenantContext(): Promise<TenantContext | null> {
  return readJson<TenantContext | null>(
    withTenant("/api/tenant-context"),
    null,
  );
}

export async function fetchTenantOptions(): Promise<TenantContext[]> {
  return readJson<TenantContext[]>("/api/tenant-context/options", []);
}

export async function fetchCapabilities(): Promise<Capability[]> {
  return readJson<Capability[]>("/api/capabilities", []);
}

export async function fetchMembers(): Promise<MemberRecord[]> {
  return readJson<MemberRecord[]>(withTenant("/api/iam/members"), []);
}

export async function fetchMember(
  memberId: string,
): Promise<MemberRecord | null> {
  return readJson<MemberRecord | null>(
    withTenant(`/api/iam/members/${memberId}`),
    null,
  );
}

export async function fetchTenantRoles(): Promise<TenantRoleRecord[]> {
  return readJson<TenantRoleRecord[]>(withTenant("/api/iam/roles"), []);
}

export async function fetchTenantPermissions(): Promise<
  TenantPermissionRecord[]
> {
  return readJson<TenantPermissionRecord[]>(
    withTenant("/api/iam/permissions"),
    [],
  );
}

export async function fetchAiModels(): Promise<AiModelRecord[]> {
  return readJson<AiModelRecord[]>("/api/atlas/models", []);
}

/** `/tenancy/grants` scopes to this workspace's own token — no caller-supplied filters accepted. */
export async function fetchAiModelGrants(): Promise<AiModelGrantRecord[]> {
  return readJson<AiModelGrantRecord[]>("/api/atlas/grants", []);
}

/** Single entitlement envelope — see `status` for coverage vs unreachable. */
export async function fetchTenantModelQuotas(): Promise<TenancyQuotaResponse> {
  return readJson<TenancyQuotaResponse>("/api/atlas/quotas", {
    workspaceId: "",
    tier: null,
    bundled: false,
    limits: {},
    pools: [],
    status: "unavailable",
  });
}

/** Atlas's own request-log usage, not a billing figure. */
export async function fetchTenantModelUsage(
  filters: { scope?: "workspace" | "tenant"; days?: number } = {},
): Promise<TenancyUsageResponse> {
  const params = new URLSearchParams();
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.days) params.set("days", String(filters.days));

  return readJson<TenancyUsageResponse>(
    `/api/atlas/usage${params.size ? `?${params.toString()}` : ""}`,
    {
      scope: filters.scope ?? "workspace",
      scopeId: "",
      from: "",
      to: "",
      rows: [],
      source: "atlas.reqlog",
    },
  );
}

export async function createTenantRole(payload: {
  roleCode: string;
  roleName: string;
  description?: string | null;
  permissionIds?: string[];
}): Promise<TenantRoleRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant("/api/iam/roles")}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Role creation failed", response.status);
  }

  return (await response.json()) as TenantRoleRecord;
}

export async function updateTenantRole(
  roleId: string,
  payload: {
    roleName?: string | null;
    description?: string | null;
    status?: "active" | "disabled";
    permissionIds?: string[];
  },
): Promise<TenantRoleRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/roles/${roleId}`)}`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Role update failed", response.status);
  }

  return (await response.json()) as TenantRoleRecord;
}

export async function deleteTenantRole(roleId: string) {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/roles/${roleId}`)}`,
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Role delete failed", response.status);
  }
}

export async function createMember(payload: {
  email: string;
  nickname?: string | null;
  remark?: string | null;
  roleId?: string | null;
  roleCode?: string | null;
}): Promise<MemberRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant("/api/iam/members")}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member creation failed", response.status);
  }

  return (await response.json()) as MemberRecord;
}

export async function inviteMember(payload: {
  email: string;
  nickname?: string | null;
  remark?: string | null;
  roleId?: string | null;
  roleCode?: string | null;
}): Promise<MemberRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant("/api/iam/members/invite")}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member invite failed", response.status);
  }

  return (await response.json()) as MemberRecord;
}

export async function updateMember(
  memberId: string,
  payload: {
    nickname?: string | null;
    remark?: string | null;
    /** The backend only reads `roleCode`; `roleId` was silently dropped. The
     *  role catalog sets `id === roleCode` (toConsoleRole), so callers pass the
     *  same value under the name the backend actually reads. */
    roleCode?: string | null;
    roleId?: string | null;
    status?: "active" | "inactive" | "banned";
  },
): Promise<MemberRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}`)}`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member update failed", response.status);
  }

  return (await response.json()) as MemberRecord;
}

export async function disableMember(memberId: string): Promise<MemberRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}/disable`)}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member disable failed", response.status);
  }

  return (await response.json()) as MemberRecord;
}

export async function resetMemberPassword(
  memberId: string,
  payload: { nextPassword: string },
) {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}/reset-password`)}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member password reset failed", response.status);
  }
}

export async function unlinkMember(memberId: string) {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}`)}`,
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Member unlink failed", response.status);
  }
}

export interface AppEntry {
  id: string;
  icon: string;
  tone: string;
  target: string;
  openVela?: boolean;
}

export async function fetchMyApps(): Promise<AppEntry[]> {
  return readJson<AppEntry[]>(withTenant("/api/me/apps"), []);
}

export async function fetchMySubscriptions(): Promise<ConsoleSubscription[]> {
  return readJson<ConsoleSubscription[]>(
    withTenant("/api/subscription/my"),
    [],
  );
}

// ── /subscribe deep-link landing (product_200 §3.2) ────────────────────────

export interface SubscribePlanPrice {
  cycleUnit: string;
  cycleCount: number;
  price: string;
  currency: string;
}

export interface SubscribePlanOption {
  planId: string;
  planCode: string;
  planName: string;
  planVersionId: string;
  tier: string;
  prices: SubscribePlanPrice[];
  /** Primary component feature list (plan_components.features) — 权益 chips. */
  features: string[];
}

export interface SubscribeCurrent {
  subscriptionId: string;
  status: string;
  planCode: string;
  planVersionId: string;
  tier: string | null;
  endAt: string | null;
  trialEndAt: string | null;
  autoRenew: boolean;
}

export interface PendingOrderSummary {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  tier: string | null;
  cycleUnit: string;
  amount: string;
  currency: string;
  createdAt: string;
  /** 付款截止（P4）；已申报/有实收时 null。 */
  expireAt: string | null;
  /** 恢复现场用的六态（进付款页直达对应视图）。 */
  paymentState: OrderState;
}

export interface SubscribeContext {
  intent: "subscribe" | "upgrade" | "renew" | "addon" | null;
  product: { code: string; name: string } | null;
  targetTier: string | null;
  metric: string | null;
  current: SubscribeCurrent | null;
  pendingOrder: PendingOrderSummary | null;
  plans: SubscribePlanOption[];
}

export interface OfflinePaymentInstructions {
  method: "bank_transfer";
  accountName: string;
  bankName: string;
  accountNo: string;
  reference: string;
}

export interface CreateOrderResult {
  status: "pending_payment" | "active";
  orderId: string | null;
  orderNo: string | null;
  billNo: string | null;
  amount: string | null;
  currency: string;
  planCode: string;
  cycleUnit: string | null;
  paymentInstructions: OfflinePaymentInstructions | null;
  subscriptionId: string | null;
  expireAt: string | null;
}

/** Six-state order contract (product_321 P1). */
export type OrderState =
  | "activating"
  | "completed"
  | "paid_pending_verify"
  | "cancelled"
  | "expired"
  | "pending_payment";

export interface MyOrder {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  planName: string;
  tier: string | null;
  cycleUnit: string;
  amount: string;
  currency: string;
  orderStatus: OrderState;
  orderType: "subscription";
  expireAt: string | null;
  paidAmount: string;
  voucherOff: string;
  createdAt: string;
  confirmedAt: string | null;
  // ── 订单表重构（product_330）展示投影：全部可视码/名称，无 UUID ──
  productCode: string | null;
  productName: string | null;
  tenantName: string | null;
  workspaceName: string | null;
  workspaceNo: string | null;
  subscriberName: string | null;
  subscriberRole: "owner" | null;
  /** 原价（折前，元字符串）。 */
  listPrice: string;
  startAt: string | null;
  endAt: string | null;
  declaredAt: string | null;
  /** 服务开通时刻（completed 单；订阅周期起算锚点）。 */
  activatedAt: string | null;
}

// ── 产品订阅总览（「我的订阅」卡 + 「新品推荐」卡，product_330）─────────────

export interface SubscribedProduct {
  subscriptionId: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  productNick: string | null;
  releaseVersion: string | null;
  planName: string;
  tier: string | null;
  seats: number | null;
  kind: string;
  cycleUnit: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  autoRenew: boolean;
  favorite: boolean;
}

export interface RecommendedProduct {
  productId: string;
  productCode: string;
  productName: string;
  productNick: string | null;
  description: string | null;
  releaseVersion: string | null;
  iconUrl: string | null;
  tags: string[];
  minPrice: string;
  currency: string;
  favorite: boolean;
}

// ── payment page (product_321 §4.1) ─────────────────────────────────────────

export interface PaymentChannelInfo {
  channel: "alipay" | "wechat" | "bank_transfer";
  enabled: boolean;
  qrAsset?: string;
  account?: {
    accountName: string;
    bankName: string;
    accountNo: string;
    reference: string;
  };
}

export interface OrderVoucherOption {
  voucherId: string;
  code: string;
  kind: "discount" | "credit_voucher";
  batchName: string;
  discountType?: "percent" | "fixed";
  discountValue?: number;
  maxOff?: string | null;
  amount?: string;
  expiresAt: string;
}

export interface OrderPaymentLeg {
  paymentId: string;
  kind: "cash" | "voucher" | "other";
  status: string;
  amount: string;
  channel: string | null;
  createdAt: string;
}

export interface OrderDetail {
  orderId: string;
  orderNo: string;
  billNo: string | null;
  planCode: string;
  planName: string;
  tier: string | null;
  cycleUnit: string;
  currency: string;
  orderState: OrderState;
  orderType: "subscription";
  createdAt: string;
  expireAt: string | null;
  listPrice: string;
  paidAmount: string;
  rejectReason: string | null;
  vouchers: OrderVoucherOption[];
  legs: OrderPaymentLeg[];
  paymentChannels: PaymentChannelInfo[];
}

export interface OrderQuote {
  listPrice: string;
  discountOff: string;
  payable: string;
  paidAmount: string;
  voucherOff: string;
  balanceOff: string;
  cashDue: string;
  discountApplicable: boolean;
}

export interface DeclareResult {
  outcome:
    | "declared"
    | "already_declared"
    | "activated"
    | "activating"
    | "already_settled";
  cashDue: string;
  paymentId: string | null;
}

export async function fetchOrderDetail(
  orderId: string,
): Promise<OrderDetail | null> {
  return readJson<OrderDetail | null>(
    `/api/subscription/orders/${encodeURIComponent(orderId)}`,
    null,
  );
}

export async function quoteOrder(
  orderId: string,
  body: { discountVoucherId?: string; creditVoucherId?: string },
): Promise<OrderQuote> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/orders/${encodeURIComponent(orderId)}/quote`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, "试算失败"),
      response.status,
    );
  }
  return (await response.json()) as OrderQuote;
}

export async function declareOrderPayment(
  orderId: string,
  body: {
    payChannel: "alipay" | "bank_transfer";
    discountVoucherId?: string;
    creditVoucherId?: string;
    payerName?: string;
    transactionNo?: string;
    remark?: string;
  },
): Promise<DeclareResult> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/orders/${encodeURIComponent(orderId)}/payment-declare`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, "付款申报失败"),
      response.status,
    );
  }
  return (await response.json()) as DeclareResult;
}

export async function fetchCredits(): Promise<{
  balance: string;
  currency: string;
}> {
  return readJson<{ balance: string; currency: string }>(
    "/api/subscription/credits",
    { balance: "0.00", currency: "CNY" },
  );
}

/**
 * Subscription lifecycle actions (`POST /api/subscription/actions`).
 *
 * `upgrade` is deliberately not exposed here: it requires a `planId`, and
 * picking a plan is the whole job of the /subscribe ladder — routing there is
 * both simpler and the flow the product already has. This helper covers the
 * three actions that need no plan choice. The server also emails a
 * confirmation; failures there do not block the action.
 */
export type SubscriptionLifecycleAction = "pause" | "resume" | "cancel";

export async function executeSubscriptionAction(payload: {
  subscriptionId: string;
  action: SubscriptionLifecycleAction;
  reason?: string;
}): Promise<ConsoleSubscription> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant("/api/subscription/actions")}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* keep the status-based message */
    }
    throw new ConsoleBffError(message, response.status);
  }
  return (await response.json()) as ConsoleSubscription;
}

export interface ConsoleQuotaMetric {
  used: number;
  limit: number;
}

export interface ConsoleQuotaUsage {
  storage: ConsoleQuotaMetric;
  aiCredit: ConsoleQuotaMetric;
}

const EMPTY_QUOTA_METRIC: ConsoleQuotaMetric = { used: 0, limit: 0 };

export async function fetchQuotaUsage(): Promise<ConsoleQuotaUsage> {
  return readJson<ConsoleQuotaUsage>("/api/subscription/quota-usage", {
    storage: EMPTY_QUOTA_METRIC,
    aiCredit: EMPTY_QUOTA_METRIC,
  });
}

/**
 * Per-product commercial entitlement view (product_220 §3 C2 envelope, TD-042
 * remediation). `tier`/`status` are `null` when the workspace has never
 * subscribed to that product (§11.4 no-coverage fallback) — never a status
 * value, per the platform's null-vs-lapsed distinction.
 */
export interface WorkspaceEntitlement {
  productCode: string;
  tier: string | null;
  status: string | null;
  bundled: boolean;
  limits: Record<string, number>;
}

export async function fetchEntitlements(): Promise<WorkspaceEntitlement[]> {
  return readJson<WorkspaceEntitlement[]>("/api/subscription/entitlements", []);
}

export async function fetchSubscribeContext(params: {
  product?: string | undefined;
  intent?: string | undefined;
  targetTier?: string | undefined;
  metric?: string | undefined;
}): Promise<SubscribeContext | null> {
  const qs = new URLSearchParams();
  if (params.product) qs.set("product", params.product);
  if (params.intent) qs.set("intent", params.intent);
  if (params.targetTier) qs.set("target_tier", params.targetTier);
  if (params.metric) qs.set("metric", params.metric);
  const ctx = await readJson<SubscribeContext | null>(
    `/api/subscription/subscribe-context?${qs.toString()}`,
    null,
  );
  if (ctx) {
    // 部署偏斜防护：门户先于 BFF 发布时旧响应没有 features 字段。
    for (const plan of ctx.plans) {
      plan.features = (plan as { features?: string[] }).features ?? [];
    }
  }
  return ctx;
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const b = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(b.message)) return b.message[0] ?? fallback;
    if (typeof b.message === "string") return b.message;
  } catch {
    /* non-JSON */
  }
  return fallback;
}

/**
 * Create a subscription order (product_320). Free tier activates instantly
 * (status="active"); paid tiers create a pending offline order (status=
 * "pending_payment") returning the order no + bank-transfer instructions.
 */
export async function createSubscriptionOrder(body: {
  productCode: string;
  planVersionId: string;
  cycleUnit: "month" | "year";
  intent: "new" | "renew" | "upgrade";
  upgradeOfSubscriptionId?: string;
}): Promise<CreateOrderResult> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/orders`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, "下单失败"),
      response.status,
    );
  }
  return (await response.json()) as CreateOrderResult;
}

export async function fetchMyOrders(): Promise<MyOrder[]> {
  return readJson<MyOrder[]>("/api/subscription/orders", []);
}

export async function fetchSubscribedProducts(): Promise<SubscribedProduct[]> {
  return readJson<SubscribedProduct[]>(
    "/api/subscription/subscribed-products",
    [],
  );
}

export async function fetchRecommendedProducts(): Promise<
  RecommendedProduct[]
> {
  return readJson<RecommendedProduct[]>(
    "/api/subscription/recommended-products",
    [],
  );
}

/** 收藏开关（★，幂等）。favorite=true 收藏 / false 取消。 */
export async function setProductFavorite(
  productCode: string,
  favorite: boolean,
): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/favorites/${encodeURIComponent(productCode)}`,
    {
      method: favorite ? "POST" : "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, "收藏操作失败"),
      response.status,
    );
  }
}

export async function cancelSubscriptionOrder(
  orderId: string,
  reason?: string,
): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, "取消订单失败"),
      response.status,
    );
  }
}

/**
 * Raw bill header as returned by the BFF `/api/billing/invoices` passthrough
 * (upstream `InvoiceRecord`). Fields are optional/loosely typed on purpose so a
 * missing or renamed field degrades gracefully instead of throwing at render.
 */
interface RawBillRecord {
  id?: string;
  billNo?: string;
  billStatus?: string;
  totalAmount?: string | number;
  payableAmount?: string | number;
  currency?: string;
  billCycle?: string;
  cycleEndDate?: string;
  createdAt?: string;
}

function toConsoleInvoice(raw: RawBillRecord): ConsoleInvoice {
  const amount = Number(raw.totalAmount);
  return {
    id: raw.id ?? "",
    invoiceNumber: raw.billNo ?? raw.id ?? "",
    status: raw.billStatus ?? "",
    totalAmount: Number.isFinite(amount) ? amount : 0,
    currency: raw.currency ?? "CNY",
    // Bill issue date — cycleEndDate can be a full year out on annual plans, so
    // createdAt is the meaningful "invoice date" for the list view.
    dueDate: raw.createdAt ?? raw.cycleEndDate ?? "",
    // The list endpoint returns bill headers only; line items live on the
    // per-invoice detail endpoint, so there is nothing to populate here.
    lineItems: [],
  };
}

export async function fetchBillingInvoices(
  limit = 20,
): Promise<ConsoleInvoice[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const raw = await readJson<RawBillRecord[]>(
    `/api/billing/invoices?${params.toString()}`,
    [],
  );
  return Array.isArray(raw) ? raw.map(toConsoleInvoice) : [];
}

// ── 账单管理页（product_331）：BFF 重写后的一手视图，不再需要 wire 适配 ──

export interface ConsoleBillingSummary {
  total: number;
  paid: number;
  /** 待收款合集：unpaid + paying + partial。 */
  unpaid: number;
  overdue: number;
  cancelled: number;
  /** 累计实收（元字符串）。 */
  paidTotal: string;
  currency: string;
}

/** 账单行：可视码 + 账期 + 金额三段 + 状态（日期 ISO）。 */
export interface ConsoleBill {
  id: string;
  billNo: string;
  billCycle: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  billType: string | null;
  totalAmount: string;
  discountAmount: string;
  payableAmount: string;
  paidAmount: string;
  currency: string;
  billStatus: string;
  paidAt: string | null;
  createdAt: string;
}

export async function fetchBillingSummary(): Promise<ConsoleBillingSummary | null> {
  return readJson<ConsoleBillingSummary | null>(
    withTenant("/api/billing/overview"),
    null,
  );
}

export async function fetchBills(limit = 100): Promise<ConsoleBill[]> {
  return readJson<ConsoleBill[]>(
    withTenant(`/api/billing/bills?limit=${limit}`),
    [],
  );
}

export async function fetchUserProfile(): Promise<ConsoleUserProfile | null> {
  return readJson<ConsoleUserProfile | null>("/api/me/profile", null);
}

export async function fetchUserIdentities(): Promise<IdentityRecord[]> {
  return readJson<IdentityRecord[]>("/api/me/identities", []);
}

/** Unbind a federated identity (by provider) from the current user. */
export async function unbindIdentity(provider: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/identities/${provider}`,
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Identity unbind failed", response.status);
  }
}

export async function fetchLastLogin(): Promise<LastLoginInfo | null> {
  return readJson<LastLoginInfo | null>("/api/me/last-login", null);
}

/* Strict on purpose — see readJsonStrict. On the security screen an outage
 * must not render as "no sign-in history" / "no active sessions". */
export async function fetchLoginHistory(): Promise<LoginHistoryEntry[]> {
  return readJsonStrict<LoginHistoryEntry[]>("/api/me/login-history");
}

export async function fetchSessions(): Promise<AuthSessionRecord[]> {
  return readJsonStrict<AuthSessionRecord[]>("/api/me/sessions");
}

export async function fetchMyWorkspaces(): Promise<ConsoleWorkspaceItem[]> {
  return readJson<ConsoleWorkspaceItem[]>("/api/me/workspaces", []);
}

/** Remote-logout a session by sid. */
export async function revokeSession(sid: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/sessions/${encodeURIComponent(
      sid,
    )}`,
    { method: "DELETE", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Session revoke failed", response.status);
  }
}

export async function fetchOrganizationProfile(): Promise<ConsoleOrganizationProfile | null> {
  return readJson<ConsoleOrganizationProfile | null>(
    withTenant("/api/me/organization"),
    null,
  );
}

/** Create/update the active tenant's profile; returns the merged view. */
export async function updateOrganization(
  payload: OrganizationProfileUpdate,
): Promise<ConsoleOrganizationProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/organization`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Organization update failed", response.status);
  }
  return (await response.json()) as ConsoleOrganizationProfile;
}

/** Upload the tenant logo (raw image bytes); returns the new content hash. */
export async function uploadOrgLogo(file: Blob): Promise<{ logoHash: string }> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/organization/logo`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Logo upload failed", response.status);
  }
  return (await response.json()) as { logoHash: string };
}

/** Remove the tenant logo. */
export async function deleteOrgLogo(): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/organization/logo`,
    { method: "DELETE", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Logo delete failed", response.status);
  }
}

/** Versioned URL for the active tenant's logo (cache-busted by content hash). */
export function orgLogoUrl(logoHash: string): string {
  return `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/organization/logo?v=${encodeURIComponent(
    logoHash,
  )}`;
}

export async function updateUserProfile(payload: {
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
  language?: string | null;
}): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/profile`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Profile update failed", response.status);
  }

  return (await response.json()) as ConsoleUserProfile;
}

/** Change the username; throws ConsoleBffError (409 taken / 400 cooldown). */
export async function updateUsername(
  username: string,
): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/username`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Username update failed", response.status);
  }

  return (await response.json()) as ConsoleUserProfile;
}

export async function changeUserPassword(payload: {
  currentPassword: string;
  nextPassword: string;
}) {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/password`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Password update failed", response.status);
  }
}

/** Self-service initial password setup (no old password to verify). */
export async function setInitialUserPassword(payload: {
  nextPassword: string;
}) {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/password/initial`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Password setup failed", response.status);
  }
}

/** Upload a custom avatar (raw image bytes); returns the new versioned picture URL. */
export async function uploadUserAvatar(
  file: Blob,
): Promise<{ picture: string }> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/avatar`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Avatar upload failed", response.status);
  }

  return (await response.json()) as { picture: string };
}

// ── Phone change flow ─────────────────────────────────────────────────────────

/** Send OTP to the user's current phone for identity verification (step 1). */
export async function sendOldPhoneOtp(): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone/send-old-otp`,
    { method: "POST", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Failed to send OTP", response.status);
  }
}

/** Send OTP to the user's verified email for identity verification (step 1 fallback).
 *  Returns the emailVerifyToken needed for verifyPhoneChangeIdentity. */
export async function sendEmailOtpForPhoneChange(): Promise<{
  emailVerifyToken: string;
  maskedEmail: string;
}> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone/send-email-otp`,
    { method: "POST", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Failed to send email OTP", response.status);
  }
  return (await response.json()) as {
    emailVerifyToken: string;
    maskedEmail: string;
  };
}

/** Send OTP to the candidate new phone number (step 2). */
export async function sendNewPhoneOtp(phone: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone/send-new-otp`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Failed to send new phone OTP", response.status);
  }
}

/** Verify the identity step (old phone OTP or email OTP).
 *  Returns a short-lived identityToken for use in confirmPhoneChange. */
export async function verifyPhoneChangeIdentity(payload: {
  method: "phone" | "email";
  code: string;
  emailVerifyToken?: string;
}): Promise<{ identityToken: string }> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone/verify-identity`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Identity verification failed", response.status);
  }
  return (await response.json()) as { identityToken: string };
}

/** Atomically change the phone (all-or-nothing).
 *  identityToken proves step-1 completed; newPhoneCode proves new phone ownership. */
export async function confirmPhoneChange(payload: {
  identityToken: string;
  newPhone: string;
  newPhoneCode: string;
}): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Phone change failed", response.status);
  }
  return (await response.json()) as ConsoleUserProfile;
}

/** Verify the current phone with an OTP → marks the phone verified. */
export async function verifyCurrentPhone(
  code: string,
): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/phone/verify-current`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Phone verification failed", response.status);
  }
  return (await response.json()) as ConsoleUserProfile;
}

// ── Email verify-current + change flow ────────────────────────────────────────

/** Send an OTP to the current email to verify ownership. */
export async function sendCurrentEmailOtp(): Promise<{
  emailVerifyToken: string;
  maskedEmail: string;
}> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/email/send-current-otp`,
    { method: "POST", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Failed to send email OTP", response.status);
  }
  return (await response.json()) as {
    emailVerifyToken: string;
    maskedEmail: string;
  };
}

/** Confirm the current-email OTP → marks the email verified. */
export async function verifyCurrentEmail(payload: {
  emailVerifyToken: string;
  code: string;
}): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/email/verify-current`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Email verification failed", response.status);
  }
  return (await response.json()) as ConsoleUserProfile;
}

/** Send an OTP to a candidate new email address (change flow). */
export async function sendNewEmailOtp(
  email: string,
): Promise<{ emailVerifyToken: string }> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/email/send-new-otp`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Failed to send new email OTP", response.status);
  }
  return (await response.json()) as { emailVerifyToken: string };
}

/** Atomically change the email (proves control of the new address by OTP). */
export async function confirmEmailChange(payload: {
  emailVerifyToken: string;
  newEmail: string;
  code: string;
}): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/email`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Email change failed", response.status);
  }
  return (await response.json()) as ConsoleUserProfile;
}

/** Enable/disable username+password login (other login paths unaffected). */
export async function setAccountLogin(
  enabled: boolean,
): Promise<ConsoleUserProfile> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/account-login`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Account login toggle failed", response.status);
  }
  return (await response.json()) as ConsoleUserProfile;
}

/** Remove the custom avatar (falls back to the default silhouette). */
export async function deleteUserAvatar(): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/avatar`,
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ConsoleBffError("Avatar delete failed", response.status);
  }
}

async function hasActiveSession(): Promise<boolean | null> {
  try {
    // RP session probe: /auth/session lives at the BFF root (outside /api/*),
    // returns 200 with verified claims when the OIDC-RP session is active, 401
    // otherwise. See identity-platform-architecture.md §9.
    const response = await fetch(
      `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/auth/session`,
      {
        credentials: "include",
        cache: "no-store",
      },
    );

    return response.ok;
  } catch {
    return null;
  }
}

export async function restoreSession(): Promise<SessionSnapshot> {
  const active = await hasActiveSession();
  if (active === null) {
    throw new ConsoleBffError("Console BFF is unavailable.", 503);
  }

  if (!active) {
    return ANONYMOUS_SESSION;
  }

  const [user, tenant, tenantOptions, capabilities] = await Promise.all([
    fetchCurrentUser(),
    fetchTenantContext(),
    fetchTenantOptions(),
    fetchCapabilities(),
  ]);

  const snapshot = {
    isAuthenticated: Boolean(user),
    user,
    tenant,
    tenantOptions,
    capabilities,
  };

  return snapshot;
}

// NOTE: legacy active-org switch seam. It still targets the retired
// /api/auth/tenant/switch proxy (removed in Batch 11.3); the OIDC-RP-based
// active-org switch is deferred to Batch 14 (frontend active-org UI). See
// docs/design/identity-platform-implementation.md.
export async function switchTenantSession(
  tenantId: string,
): Promise<SessionSnapshot> {
  let response: Response;

  try {
    response = await fetch(
      `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/auth/tenant/switch`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId }),
      },
    );
  } catch {
    throw new ConsoleBffError("Console BFF is unavailable.", 503);
  }

  if (!response.ok) {
    let message = "Tenant switch failed";

    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        message = body.message[0] ?? message;
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore malformed error body and fall back to generic message.
    }

    throw new ConsoleBffError(message, response.status);
  }

  const snapshot = await restoreSession();
  if (!snapshot.isAuthenticated) {
    throw new ConsoleBffError(
      "Authenticated session could not be restored after tenant switch.",
      500,
    );
  }

  return snapshot;
}

/**
 * Absolute URL of the RP logout entry on console-bff (top-level GET). It drops
 * the local RP session, then redirects to the IdP end_session (single-logout) →
 * unified accounts post-logout page with mode=signout. For console clients the
 * post-logout page routes the user to the website home. The browser must
 * top-level-navigate here (not fetch) so vx_sid reaches the IdP.
 * See identity-platform-access-topology.md §5.
 */
export function buildLogoutUrl(): string {
  return `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/auth/logout`;
}

/**
 * Absolute URL of the RP switch-user entry on console-bff (top-level GET). Same
 * session teardown as /auth/logout but signals mode=switch to the accounts
 * post-logout page, which immediately redirects to this RP's /auth/login so the
 * user can sign in as a different account.
 */
export function buildSwitchUrl(): string {
  return `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/auth/switch`;
}

/* ── 全局搜索（header ⌘K）───────────────────────────────────────────────── */

export type SearchResultKind = "member" | "invoice";

export interface GlobalSearchItem {
  kind: SearchResultKind;
  id: string;
  label: string;
  description?: string;
  meta?: string;
  /** 目标路径由 BFF 给出，前端不拼——路由形状变了只改一处。 */
  href: string;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchItem[];
  /** true = 查询串太短，后端没检索（跟"检索了但没命中"不是一回事）。 */
  skipped: boolean;
}

/**
 * 走 `readJsonStrict` 而非 `readJson`：搜索面板要能区分"后端挂了"和"没搜到"。
 * 降级成空数组会让服务不可用长得跟无结果一模一样，用户以为数据不存在。
 * 调用方负责 catch 并渲染自己的错误态。
 */
export async function searchConsole(
  query: string,
  signal?: AbortSignal,
): Promise<GlobalSearchResponse> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/search?q=${encodeURIComponent(query)}`,
    {
      credentials: "include",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      `Request failed: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as GlobalSearchResponse;
}

// ============================================================================
// Quota overview (配额管理页 /quotas — GET /api/quota/overview)
// ============================================================================

export interface ConsoleQuotaPool {
  metric: string;
  /** subscription / manual_override / ws_base / addon_purchase */
  source: string;
  productCode: string | null;
  productName: string | null;
  limit: number;
  used: number;
  remaining: number;
  resetPeriod: string;
  expiresAt: string | null;
}

export interface ConsoleStorageSlice {
  productCode: string;
  productName: string;
  usedBytes: number;
  observedAt: string;
}

export interface ConsoleProductQuota {
  productCode: string;
  productName: string;
  metrics: {
    metric: string;
    limit: number;
    used: number;
    remaining: number;
    resetPeriod: string;
  }[];
  storageUsedBytes: number | null;
}

export interface ConsoleQuotaOverview {
  storage: {
    limitBytes: number;
    usedBytes: number;
    /** 不钳制:负值 = 超冲(产品侧准入自愈,展示要能表达) */
    remainingBytes: number;
    sources: ConsoleQuotaPool[];
    slices: ConsoleStorageSlice[];
  };
  aiCredit: {
    limit: number;
    used: number;
    remaining: number;
    pools: ConsoleQuotaPool[];
    sharingProducts: { productCode: string; productName: string }[];
  };
  products: ConsoleProductQuota[];
}

const EMPTY_QUOTA_OVERVIEW: ConsoleQuotaOverview = {
  storage: {
    limitBytes: 0,
    usedBytes: 0,
    remainingBytes: 0,
    sources: [],
    slices: [],
  },
  aiCredit: { limit: 0, used: 0, remaining: 0, pools: [], sharingProducts: [] },
  products: [],
};

export async function fetchQuotaOverview(): Promise<ConsoleQuotaOverview> {
  return readJson<ConsoleQuotaOverview>(
    "/api/quota/overview",
    EMPTY_QUOTA_OVERVIEW,
  );
}

// ============================================================================
// Usage analytics (用量分析页 /usage — GET /api/usage/*)
// ============================================================================

export interface ConsoleUsageTrendBucket {
  period: string;
  total: number;
  byProduct: { productCode: string; productName: string; total: number }[];
}

export interface ConsoleUsageTrend {
  metric: string;
  granularity: string;
  buckets: ConsoleUsageTrendBucket[];
}

export interface ConsoleUsageEvent {
  at: string;
  productCode: string;
  productName: string;
  metric: string;
  amount: number;
  /** null = 产品未归集用户(容错桶) */
  userName: string | null;
  requestId: string | null;
}

export interface ConsoleUsageMember {
  /** null = 未归集桶 */
  userName: string | null;
  total: number;
  eventCount: number;
  lastAt: string;
}

export async function fetchUsageTrend(
  granularity: string,
  span?: number,
): Promise<ConsoleUsageTrend> {
  const spanQ = span ? `&span=${span}` : "";
  return readJson<ConsoleUsageTrend>(
    `/api/usage/trend?granularity=${encodeURIComponent(granularity)}${spanQ}`,
    { metric: "ai.credit", granularity, buckets: [] },
  );
}

export async function fetchUsageEvents(): Promise<ConsoleUsageEvent[]> {
  return readJson<ConsoleUsageEvent[]>("/api/usage/events", []);
}

export async function fetchUsageMembers(
  days = 30,
): Promise<ConsoleUsageMember[]> {
  return readJson<ConsoleUsageMember[]>(`/api/usage/members?days=${days}`, []);
}
