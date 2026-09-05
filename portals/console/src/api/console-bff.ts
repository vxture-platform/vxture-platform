import type {
  AccountDeletionState,
  Capability,
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
  TenantClosureState,
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
  return readJsonStrict<MemberRecord[]>(withTenant("/api/iam/members"));
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
  return readJsonStrict<TenantRoleRecord[]>(withTenant("/api/iam/roles"));
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

/**
 * 成员线的错误要带**原因码**回页面:BFF 把 owner 保护 / 账号不存在 / 已是成员 /
 * 邀请待接受 这些拒绝原因放在 message 里,页面按码给文案。合并成一句
 * "操作失败"等于让用户猜(与 transferTenantOwner 同一条理由)。
 */
async function throwMemberError(
  response: Response,
  fallback: string,
): Promise<never> {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body?.message)
      ? body.message[0]
      : body?.message;
    if (message) detail = message;
  } catch {
    /* 非 JSON 响应(网关层错误):保留兜底文案 */
  }
  throw new ConsoleBffError(detail || fallback, response.status);
}

/** 成员线拒绝原因码(BFF message);页面据此选文案,未知码回落成通用失败。 */
export const MEMBER_ERROR_CODES = [
  "owner_protected",
  "self_protected",
  "owner_role_locked",
  "account_not_found",
  "already_member",
  "invitation_pending",
  "invalid_email",
] as const;
export type MemberErrorCode = (typeof MEMBER_ERROR_CODES)[number];

export function memberErrorCode(error: unknown): MemberErrorCode | null {
  if (!(error instanceof ConsoleBffError)) return null;
  return (MEMBER_ERROR_CODES as readonly string[]).includes(error.message)
    ? (error.message as MemberErrorCode)
    : null;
}

/** 邀请 / 重发的产出:待接受记录 + 一次性链接 + 邮件是否发出。 */
export interface InviteMemberResult {
  member: MemberRecord;
  invitationId: string;
  email: string;
  roleCode: string;
  inviteLink: string;
  emailSent: boolean;
  expiresAt: string;
}

/** 「新增成员」= 把已有账号按邮箱加进租户;账号不存在 → 404 account_not_found。 */
export async function createMember(payload: {
  email: string;
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
    await throwMemberError(response, "");
  }

  return (await response.json()) as MemberRecord;
}

export async function inviteMember(payload: {
  email: string;
  roleCode?: string | null;
}): Promise<InviteMemberResult> {
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
    await throwMemberError(response, "");
  }

  return (await response.json()) as InviteMemberResult;
}

export async function updateMember(
  memberId: string,
  payload: {
    /** The backend only reads `roleCode`; the role catalog sets `id === roleCode`. */
    roleCode?: string | null;
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
    await throwMemberError(response, "");
  }

  return (await response.json()) as MemberRecord;
}

/** 通知偏好矩阵:主题 → 渠道开关。主题与渠道由服务端定义,这里不重复白名单。 */
export type NotificationPreferences = Record<string, Record<string, boolean>>;

/**
 * 读取通知偏好(owner 2026-08-21 裁定决策 1 选项 A)。
 * 服务端返回**补齐后的完整矩阵**,前端不带默认值——两份默认值早晚漂移。
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/notification-preferences`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("", response.status);
  }
  return (await response.json()) as NotificationPreferences;
}

/** 覆盖写通知偏好;返回规整后的实际存量(锁定通道会被服务端强制打开)。 */
export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/notification-preferences`,
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError("", response.status);
  }
  return (await response.json()) as NotificationPreferences;
}

/** 站内消息（product_330 P2-g）：收件人视角的一条通知。 */
export interface InboxMessage {
  id: string;
  templateCode: string;
  title: string;
  body: string;
  /** console 内相对路径；null = 无跳转。 */
  link: string | null;
  referenceType: string;
  referenceId: string;
  readAt: string | null;
  createdAt: string;
}

export interface InboxPage {
  items: InboxMessage[];
  /** 下一页游标（上一页最后一条的 createdAt）；null = 没有更多。 */
  nextBefore: string | null;
  unreadCount: number;
}

const INBOX_URL = `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/inbox`;

/** 收件箱一页；错误文案由调用方用 t() 补，这里只带状态码。 */
export async function fetchInbox(
  params: {
    limit?: number;
    before?: string | null;
  } = {},
): Promise<InboxPage> {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.before) q.set("before", params.before);
  const suffix = q.size ? `?${q.toString()}` : "";
  const response = await fetch(`${INBOX_URL}${suffix}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new ConsoleBffError("", response.status);
  return (await response.json()) as InboxPage;
}

export async function fetchInboxUnreadCount(): Promise<number> {
  const response = await fetch(`${INBOX_URL}/unread-count`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new ConsoleBffError("", response.status);
  const body = (await response.json()) as { unreadCount: number };
  return body.unreadCount;
}

export async function markInboxRead(id: string): Promise<void> {
  const response = await fetch(`${INBOX_URL}/${encodeURIComponent(id)}/read`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new ConsoleBffError("", response.status);
}

export async function markInboxAllRead(): Promise<number> {
  const response = await fetch(`${INBOX_URL}/read-all`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new ConsoleBffError("", response.status);
  const body = (await response.json()) as { updated: number };
  return body.updated;
}

/**
 * 转让租户所有权(owner 2026-08-21 裁定,决策 3 批一)。
 *
 * 失败时把后端的具体原因带出来而不是吞成一句"操作失败"——五种拒绝各自对应
 * 一个用户能自己解决的问题(对方不是成员 / 自己已不是 owner / 个人租户…),
 * 合并成通用文案等于让用户猜。
 */
export async function transferTenantOwner(memberId: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}/transfer-owner`)}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      /* 非 JSON 响应(网关层错误):保留默认文案 */
    }
    throw new ConsoleBffError(detail, response.status);
  }
}

async function postMemberStatus(
  memberId: string,
  action: "disable" | "enable",
): Promise<MemberRecord> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${withTenant(`/api/iam/members/${memberId}/${action}`)}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    await throwMemberError(response, "");
  }

  return (await response.json()) as MemberRecord;
}

/** 停用 = 打标不删行(批 2 起 BFF 真停用);恢复走 enableMember。 */
export function disableMember(memberId: string): Promise<MemberRecord> {
  return postMemberStatus(memberId, "disable");
}

export function enableMember(memberId: string): Promise<MemberRecord> {
  return postMemberStatus(memberId, "enable");
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
    await throwMemberError(response, "");
  }
}

/**
 * 应用中心磁贴：当前工作空间实际持有的产品（BFF `GET /api/me/apps`）。
 * 2026-08-30 起不再是写死的目录——控制台自己的板块入口归 config/navigation.ts。
 */
export interface ProductAppTile {
  /** product_code——磁贴身份，产品改名不变。 */
  code: string;
  name: string;
  nick: string | null;
  iconUrl: string | null;
  /** 产品主页（product_webhooks.home_url）；未登记为 null，此时落到 /subscription。 */
  homeUrl: string | null;
  status: "active" | "trialing";
  planName: string;
  tier: string | null;
}

/* strict：应用中心要分得清「没订阅任何产品」（空态）和「后端挂了」（故障），
 * 两者给用户的动作完全不同；回落成空数组会把故障演成干净的空态。 */
export async function fetchMyApps(): Promise<ProductAppTile[]> {
  return readJsonStrict<ProductAppTile[]>(withTenant("/api/me/apps"));
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
  planName: string;
  productCode: string | null;
  productName: string | null;
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
  /** 履约后挂上的订阅 id；未履约 null。订单菜单「退订」对它落锤。 */
  subscriptionId: string | null;
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
  productCode: string | null;
  productName: string | null;
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
  /** 退款单（product_330 §5）：最近一张；null = 没申请过。部署偏斜下可能缺字段。 */
  refund?: OrderRefundView | null;
}

/** 客户可见的退款单投影（product_330 §5）。 */
export interface OrderRefundView {
  refundNo: string;
  amount: string;
  currency: string;
  reason: string | null;
  stage: "requested" | "approved" | "rejected" | "refunded";
  auditRemark: string | null;
  requestedAt: string;
  auditedAt: string | null;
  refundedAt: string | null;
}

export interface RefundEligibility {
  eligible: boolean;
  reasons: string[];
  amount: string;
  currency: string;
  windowEndsAt: string | null;
  usageRatio: number;
  windowHours: number;
  maxUsageRatio: number;
}

export async function fetchRefundEligibility(
  orderId: string,
): Promise<RefundEligibility | null> {
  return readJson<RefundEligibility | null>(
    `/api/subscription/orders/${encodeURIComponent(orderId)}/refund-eligibility`,
    null,
  );
}

export async function requestOrderRefund(
  orderId: string,
  reason: string,
): Promise<OrderRefundView> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/orders/${encodeURIComponent(orderId)}/refund-request`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
  return (await response.json()) as OrderRefundView;
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

/** strict(批 1):400/404 由页面画「订单不存在」,其余错误画「读取失败 + 重试」。 */
export async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
  return readJsonStrict<OrderDetail>(
    `/api/subscription/orders/${encodeURIComponent(orderId)}`,
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
      await extractErrorMessage(response, ""),
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
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
  return (await response.json()) as DeclareResult;
}

export async function fetchCredits(): Promise<{
  balance: string;
  currency: string;
}> {
  return readJsonStrict<{ balance: string; currency: string }>(
    "/api/subscription/credits",
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

/* strict（2026-08-30）：原先失败回落 used:0/limit:0，在工作台与头部面板上会
 * 渲染成一个像真的「0 / 0」，把「读不到」伪装成「没有额度」。消费方
 * （DashboardPage / ConsoleAppShell → TenantPanel）各自呈现不可用态。 */
export async function fetchQuotaUsage(): Promise<ConsoleQuotaUsage> {
  return readJsonStrict<ConsoleQuotaUsage>("/api/subscription/quota-usage");
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
}): Promise<SubscribeContext> {
  const qs = new URLSearchParams();
  if (params.product) qs.set("product", params.product);
  if (params.intent) qs.set("intent", params.intent);
  if (params.targetTier) qs.set("target_tier", params.targetTier);
  if (params.metric) qs.set("metric", params.metric);
  // strict(批 1c):读失败抛 ConsoleBffError,页面画「读取失败 + 重试」;此前一律回 null,
  // 与「未知产品 / 意图」一样被静默跳回订阅总览,用户看不到任何理由。
  const ctx = await readJsonStrict<SubscribeContext>(
    `/api/subscription/subscribe-context?${qs.toString()}`,
  );
  // 部署偏斜防护：门户先于 BFF 发布时旧响应没有 features 字段。
  for (const plan of ctx.plans) {
    plan.features = (plan as { features?: string[] }).features ?? [];
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
/** 升级折抵报价（product_330 §4.1）：金额两位小数字符串。 */
export interface UpgradeQuote {
  listPrice: string;
  credit: string;
  creditTime: string;
  creditUsage: string;
  payable: string;
  leftover: string;
  currency: string;
  daysLeft: number;
  daysTotal: number;
  /** 剩余消耗性配额比 [0,1] */
  usageRemainingRatio: number;
  consumableShare: number;
}

/** 零副作用：确认页展示折抵；下单时服务端用同一函数再算一次落库。strict(批 1c):
 *  失败抛出,确认页要把「没算出来」说出来,不能静默按原价显示成「没折抵」。 */
export async function fetchUpgradeQuote(params: {
  subscriptionId: string;
  planVersionId: string;
  cycleUnit: "month" | "year";
}): Promise<UpgradeQuote> {
  const qs = new URLSearchParams(params);
  return readJsonStrict<UpgradeQuote>(
    `/api/subscription/upgrade-quote?${qs.toString()}`,
  );
}

export async function createSubscriptionOrder(body: {
  productCode: string;
  planVersionId: string;
  cycleUnit: "month" | "year";
  intent: "new" | "renew" | "upgrade";
  upgradeOfSubscriptionId?: string;
  /** 自动续费 opt-in（owner 2026-09-03）：确认页开关，默认关。 */
  autoRenew: boolean;
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
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
  return (await response.json()) as CreateOrderResult;
}

export async function fetchMyOrders(): Promise<MyOrder[]> {
  return readJsonStrict<MyOrder[]>("/api/subscription/orders");
}

export async function fetchSubscribedProducts(): Promise<SubscribedProduct[]> {
  return readJsonStrict<SubscribedProduct[]>(
    "/api/subscription/subscribed-products",
  );
}

export async function fetchRecommendedProducts(): Promise<
  RecommendedProduct[]
> {
  return readJsonStrict<RecommendedProduct[]>(
    "/api/subscription/recommended-products",
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
      await extractErrorMessage(response, ""),
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
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
}

// ── 账单管理页（product_331）：BFF 重写后的一手视图，不再需要 wire 适配 ──
// 批 4:首页「最近发票」改读同一份 /api/billing/bills,旧的 /api/billing/invoices
// 透传适配(RawBillRecord → ConsoleInvoice)随之退役;BFF 端点保留(X8)。

export interface ConsoleBillingSummary {
  total: number;
  paid: number;
  /** 待收款合集：unpaid + paying + partial。 */
  unpaid: number;
  overdue: number;
  cancelled: number;
  /** 累计实收（元字符串）。 */
  paidTotal: string;
  /** 本自然月实付（元字符串）；收付实现制，年付后的月份为 0 是对的。 */
  paidThisMonth: string;
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

/* 批 0b:账单 / 配额 / 用量 / 订阅四页的读全部改 strict——失败要显影成 Error 态,
 * 不能再回落成空数组或零值对象让页面画出「0 B / 0 B」这种像真的假零。 */
export async function fetchBillingSummary(): Promise<ConsoleBillingSummary> {
  return readJsonStrict<ConsoleBillingSummary>(
    withTenant("/api/billing/overview"),
  );
}

/** 账单分页(批 3:服务端分页,total 由库数;此前一次拉 100 条页面里翻)。 */
export interface ConsoleBillPage {
  items: ConsoleBill[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchBills(
  page = 1,
  pageSize = 10,
): Promise<ConsoleBillPage> {
  return readJsonStrict<ConsoleBillPage>(
    withTenant(`/api/billing/bills?page=${page}&pageSize=${pageSize}`),
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

/** 账号信息页「设为默认」:每次登录后默认进入的租户(目标须是本人所在租户)。 */
export async function setDefaultTenant(tenantId: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/tenants/${encodeURIComponent(tenantId)}/default`,
    { method: "PUT", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ConsoleBffError("Set default tenant failed", response.status);
  }
}

// ── 删除账号(批 5b):资格快照 / 申请 / 撤销。保留期内 BFF 只放行这几条与会话恢复读。

export async function fetchAccountDeletion(): Promise<AccountDeletionState> {
  return readJsonStrict<AccountDeletionState>("/api/me/deletion");
}

export async function requestAccountDeletion(): Promise<AccountDeletionState> {
  return writeJson<AccountDeletionState>("/api/me/deletion", "POST", {
    acknowledged: true,
  });
}

export async function cancelAccountDeletion(): Promise<AccountDeletionState> {
  return writeJson<AccountDeletionState>("/api/me/deletion/cancel", "POST");
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
/** 个人租户转为组织租户(批 5c-2);不可回退。 */
export async function convertTenantToOrganization(name: string): Promise<{
  tenantId: string;
  name: string;
  tenantNo: string | null;
  newPersonalTenantId: string;
  newPersonalTenantNo: string | null;
}> {
  return writeJson("/api/me/organization/convert", "POST", {
    name,
    acknowledged: true,
  });
}

/** 注销资格快照(阻断 / 确认 / 连带动作)。strict:读失败要显影。 */
export async function fetchTenantClosure(): Promise<TenantClosureState> {
  return readJsonStrict<TenantClosureState>("/api/me/organization/closure");
}

/** 注销组织租户;不可回退。会话随后回落到个人租户。 */
export async function requestTenantClosure(
  confirmName: string,
): Promise<TenantClosureState> {
  return writeJson<TenantClosureState>("/api/me/organization/closure", "POST", {
    acknowledged: true,
    confirmName,
  });
}

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

/**
 * 本人所在任一租户的标识 URL(按内容哈希版本化)——账号信息页所在租户列表、
 * 顶栏租户面板画头像用;非成员 404。当前租户的另有 `orgLogoUrl`(租户信息页)。
 */
export function tenantLogoUrl(tenantId: string, logoHash: string): string {
  return `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/me/tenants/${encodeURIComponent(tenantId)}/logo?v=${encodeURIComponent(logoHash)}`;
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
  /** male / female;空串 = 清除。 */
  gender?: "male" | "female" | "" | null;
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

/**
 * 切换活跃租户的入口 URL(identity/080 §2.8)。这是一次**顶层导航**而不是 fetch:
 * console-bff 预检成员关系 → 302 IdP 静默重授权(prompt=none + tenant_hint)→
 * /auth/callback 建新 RP 会话(新 active_org)→ 回到 returnTo,页面整体重载到新租户。
 * IdP 必须收到中央会话 cookie 才能静默发码,所以不能走 XHR。
 * 此前这里 POST 到一个早已退役的 /api/auth/tenant/switch,切换从未生效。
 */
export function buildTenantSwitchUrl(
  tenantId: string,
  returnTo: string,
): string {
  const params = new URLSearchParams({ tenantId, returnTo });
  return `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/auth/switch-tenant?${params.toString()}`;
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

/* strict(批 0b):此前失败回落成全零总览,配额页画出「0 B / 0 B」这种像真的假零。 */
export async function fetchQuotaOverview(): Promise<ConsoleQuotaOverview> {
  return readJsonStrict<ConsoleQuotaOverview>("/api/quota/overview");
}

// ============================================================================
// Usage analytics (用量分析页 /usage — GET /api/usage/*)
// ============================================================================

export interface ConsoleUsageTrendBucket {
  /**
   * UTC 桶键:hour `YYYY-MM-DD HH:00` / day、week(ISO 周一)`YYYY-MM-DD` /
   * month `YYYYMM` / year `YYYY`。窗口内每个周期都有一桶(无数据补零)。
   */
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
  return readJsonStrict<ConsoleUsageTrend>(
    `/api/usage/trend?granularity=${encodeURIComponent(granularity)}${spanQ}`,
  );
}

/** 调用记录 + 硬顶说明(批 3):满额即可能被截断,页面据此提示而不是装作全量。 */
export interface ConsoleUsageEvents {
  items: ConsoleUsageEvent[];
  days: number;
  limit: number;
  truncated: boolean;
}

export async function fetchUsageEvents(): Promise<ConsoleUsageEvents> {
  return readJsonStrict<ConsoleUsageEvents>("/api/usage/events");
}

export async function fetchUsageMembers(
  days = 30,
): Promise<ConsoleUsageMember[]> {
  return readJsonStrict<ConsoleUsageMember[]>(
    `/api/usage/members?days=${days}`,
  );
}

// ============================================================================
// Addon packs (加油包/扩展包 — /api/quota/addon-*)
// ============================================================================

export interface ConsoleAddonPack {
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  validityDays: number;
  price: string;
  currency: string;
}

export interface ConsoleAddonOrder {
  orderNo: string;
  billNo: string | null;
  packCode: string;
  packName: string;
  metricKey: string;
  amount: number;
  price: string;
  currency: string;
  status: "pending_payment" | "completed" | "cancelled";
  validityDays: number;
  paymentDeclared: boolean;
  /** 未申报待支付单的付款截止(ISO);其余为 null */
  expireAt: string | null;
  activatedAt: string | null;
  validUntil: string | null;
  createdAt: string;
}

export async function fetchAddonPacks(): Promise<ConsoleAddonPack[]> {
  return readJsonStrict<ConsoleAddonPack[]>("/api/quota/addon-packs");
}

export async function fetchAddonOrders(): Promise<ConsoleAddonOrder[]> {
  return readJsonStrict<ConsoleAddonOrder[]>("/api/quota/addon-orders");
}

/** 下单失败要把 409(已有待支付单)等报文透给用户 → strict,调用方 catch。 */
export async function createAddonOrder(packCode: string): Promise<{
  order: ConsoleAddonOrder;
  paymentChannels: PaymentChannelInfo[];
}> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/quota/addon-orders`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packCode }),
    },
  );
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* keep the status message */
    }
    throw new ConsoleBffError(message, response.status);
  }
  return (await response.json()) as {
    order: ConsoleAddonOrder;
    paymentChannels: PaymentChannelInfo[];
  };
}

export async function fetchAddonPaymentChannels(
  orderNo: string,
): Promise<PaymentChannelInfo[]> {
  return readJson<PaymentChannelInfo[]>(
    `/api/quota/addon-orders/${encodeURIComponent(orderNo)}/payment-channels`,
    [],
  );
}

export async function declareAddonPayment(
  orderNo: string,
  input: { payerName?: string; transactionNo?: string; remark?: string },
): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/quota/addon-orders/${encodeURIComponent(orderNo)}/payment-declare`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
}

/** 取消加油包订单;失败抛 ConsoleBffError(报文透传)。 */
export async function cancelAddonOrder(orderNo: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/quota/addon-orders/${encodeURIComponent(orderNo)}/cancel`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    throw new ConsoleBffError(
      await extractErrorMessage(response, ""),
      response.status,
    );
  }
}

// ============================================================================
// Invoicing (发票 — /api/billing/addresses + /api/billing/receipts)
// ============================================================================

export interface ConsoleBillingAddress {
  id: string;
  invoiceTaxType: "general" | "special";
  title: string;
  taxNo: string | null;
  phone: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  isDefault: boolean;
}

export interface ConsoleInvoiceReceipt {
  id: string;
  invoiceNo: string;
  billId: string;
  billNo: string | null;
  invoiceType: string;
  invoiceTaxType: string;
  invoiceTitle: string;
  invoiceAmount: string;
  currency: string;
  invoiceStatus: string;
  statusRemark: string | null;
  invoiceFileUrl: string | null;
  expressCompany: string | null;
  expressNo: string | null;
  issuedAt: string | null;
  sendAt: string | null;
  createdAt: string;
}

export interface ConsoleBillingAddressInput {
  invoiceTaxType: "general" | "special";
  title: string;
  taxNo?: string;
  phone?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  isDefault?: boolean;
}

export async function fetchBillingAddresses(): Promise<
  ConsoleBillingAddress[]
> {
  return readJsonStrict<ConsoleBillingAddress[]>("/api/billing/addresses");
}

export async function fetchInvoiceReceipts(): Promise<ConsoleInvoiceReceipt[]> {
  return readJsonStrict<ConsoleInvoiceReceipt[]>("/api/billing/receipts");
}

/** 写路径共用:非 2xx 时把 BFF 报文透给用户(校验/冲突信息可读)。 */
async function writeJson<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}${path}`,
    {
      method,
      credentials: "include",
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const parsed = (await response.json()) as { message?: string };
      if (parsed?.message) message = parsed.message;
    } catch {
      /* keep the status message */
    }
    throw new ConsoleBffError(message, response.status);
  }
  return (await response.json()) as T;
}

export async function createBillingAddress(
  input: ConsoleBillingAddressInput,
): Promise<ConsoleBillingAddress> {
  return writeJson<ConsoleBillingAddress>(
    "/api/billing/addresses",
    "POST",
    input,
  );
}

export async function updateBillingAddress(
  id: string,
  input: ConsoleBillingAddressInput,
): Promise<ConsoleBillingAddress> {
  return writeJson<ConsoleBillingAddress>(
    `/api/billing/addresses/${encodeURIComponent(id)}`,
    "PATCH",
    input,
  );
}

export async function setDefaultBillingAddress(id: string): Promise<void> {
  await writeJson<{ ok: true }>(
    `/api/billing/addresses/${encodeURIComponent(id)}/default`,
    "POST",
  );
}

export async function deleteBillingAddress(id: string): Promise<void> {
  await writeJson<{ ok: true }>(
    `/api/billing/addresses/${encodeURIComponent(id)}`,
    "DELETE",
  );
}

export async function applyInvoiceReceipt(input: {
  billId: string;
  addressId: string;
  invoiceType: string;
}): Promise<ConsoleInvoiceReceipt> {
  return writeJson<ConsoleInvoiceReceipt>(
    "/api/billing/receipts",
    "POST",
    input,
  );
}

/** 加油包订单详情(支付页数据源);strict(批 1):400/404 = 不存在,其余 = 读取失败。 */
export async function fetchAddonOrderDetail(orderNo: string): Promise<{
  order: ConsoleAddonOrder;
  paymentChannels: PaymentChannelInfo[];
}> {
  return readJsonStrict<{
    order: ConsoleAddonOrder;
    paymentChannels: PaymentChannelInfo[];
  }>(`/api/quota/addon-orders/${encodeURIComponent(orderNo)}`);
}

/** 到期不续 / 恢复续费(P0 订阅自助);失败抛 ConsoleBffError(报文透传)。 */
export async function setSubscriptionAutoRenew(
  subscriptionId: string,
  enabled: boolean,
): Promise<boolean> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/subscription/subscriptions/${encodeURIComponent(subscriptionId)}/auto-renew`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* keep status message */
    }
    throw new ConsoleBffError(message, response.status);
  }
  return true;
}

// ============================================================================
// Vouchers (我的卡券 — GET /api/promotion/vouchers)
// ============================================================================

export interface ConsoleVoucher {
  id: string;
  code: string;
  kind: string;
  batchName: string;
  discountType?: "percent" | "fixed";
  discountValue?: number;
  maxOff?: string | null;
  amount?: string;
  status: "available" | "reserved" | "redeemed" | "expired" | "revoked";
  usedCount: number;
  maxUses: number;
  expiresAt: string;
  redeemedAt: string | null;
  redemptionNo: string | null;
}

export async function fetchVouchers(): Promise<ConsoleVoucher[]> {
  return readJsonStrict<ConsoleVoucher[]>("/api/promotion/vouchers");
}

// ============================================================================
// Tenant verification (组织企业认证 — /api/verification/tenant)
// ============================================================================

export interface ConsoleVerification {
  id: string;
  verificationType: string;
  businessLicenseNo: string | null;
  legalPersonName: string | null;
  status: "unverified" | "pending" | "verified" | "rejected" | "superseded";
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ConsoleTenantVerificationState {
  status: "unverified" | "pending" | "verified" | "rejected" | "superseded";
  latest: ConsoleVerification | null;
  history: ConsoleVerification[];
}

/* strict（2026-08-30）：原先失败回落成 "unverified"，认证页会照常放开表单、
 * 徽章写「未认证」——把一次故障演成一个可以重新提交的干净状态。 */
export async function fetchTenantVerification(): Promise<ConsoleTenantVerificationState> {
  return readJsonStrict<ConsoleTenantVerificationState>(
    "/api/verification/tenant",
  );
}

/** 提交企业认证;409(审核中)/403(无权限)/400(校验)报文透传。 */
export async function submitTenantVerification(input: {
  businessLicenseNo: string;
  legalPersonName: string;
}): Promise<ConsoleVerification> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/verification/tenant`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* keep status message */
    }
    throw new ConsoleBffError(message, response.status);
  }
  return (await response.json()) as ConsoleVerification;
}

// ============================================================================
// Audit logs (审计日志 — GET /api/audit/logs)
// ============================================================================

export interface ConsoleAuditLog {
  id: string;
  at: string;
  actorName: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "success" | "failure" | "denied";
  ipAddress: string | null;
}

/** 服务端分页的一页(批 6;与账单页同一形状)。 */
export interface ConsoleAuditLogPage {
  items: ConsoleAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 审计日志(批 6:服务端分页 + 筛选)。**strict**:审计页读失败必须显影,
 * 此前走 readJson 回退空数组——一次故障看起来就像「暂无操作记录」。
 */
export async function fetchAuditLogs(params: {
  result?: "success" | "failure";
  action?: string;
  days?: number;
  page?: number;
  pageSize?: number;
}): Promise<ConsoleAuditLogPage> {
  const q = new URLSearchParams();
  if (params.result) q.set("result", params.result);
  if (params.action) q.set("action", params.action);
  if (params.days) q.set("days", String(params.days));
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  const suffix = q.size > 0 ? `?${q.toString()}` : "";
  return readJsonStrict<ConsoleAuditLogPage>(`/api/audit/logs${suffix}`);
}

// ============================================================================
// Invitations (邀请管理 — /api/iam/invitations)
// ============================================================================

export interface ConsoleInvitation {
  id: string;
  email: string;
  roleCode: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviterName: string | null;
}

export async function fetchInvitations(): Promise<ConsoleInvitation[]> {
  return readJsonStrict<ConsoleInvitation[]>("/api/iam/invitations");
}

/** 撤销失败抛错(不再回 false):确认件按 Promise 是否 rejected 决定关不关框。 */
export async function revokeInvitation(id: string): Promise<void> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/iam/invitations/${encodeURIComponent(id)}/revoke`,
    { method: "POST", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    await throwMemberError(response, "");
  }
}

/** 重发 = 换链接 + 顺延有效期 + 再发一封邮件;旧链接立即失效。 */
export async function resendInvitation(
  id: string,
): Promise<InviteMemberResult> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/iam/invitations/${encodeURIComponent(id)}/resend`,
    { method: "POST", credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    await throwMemberError(response, "");
  }
  return (await response.json()) as InviteMemberResult;
}

// ── 接受邀请(只认登录态,租户由 token 决定;不带 X-Tenant)────────────────

export interface InvitationLookup {
  id: string;
  tenantName: string | null;
  email: string;
  roleCode: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  inviterName: string | null;
}

export const ACCEPT_INVITATION_REASONS = [
  "not_found",
  "expired",
  "revoked",
  "already_accepted",
  "email_mismatch",
] as const;
export type AcceptInvitationReason = (typeof ACCEPT_INVITATION_REASONS)[number];

export function acceptInvitationReason(
  error: unknown,
): AcceptInvitationReason | null {
  if (!(error instanceof ConsoleBffError)) return null;
  return (ACCEPT_INVITATION_REASONS as readonly string[]).includes(
    error.message,
  )
    ? (error.message as AcceptInvitationReason)
    : null;
}

export async function lookupInvitation(
  token: string,
): Promise<InvitationLookup> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/iam/invitations/lookup?token=${encodeURIComponent(token)}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    await throwMemberError(response, "");
  }
  return (await response.json()) as InvitationLookup;
}

export interface AcceptedInvitation {
  tenantId: string;
  tenantName: string | null;
  role: string;
}

export async function acceptInvitation(
  token: string,
): Promise<AcceptedInvitation> {
  const response = await fetch(
    `${DEFAULT_BFF_URL}${CONSOLE_API_PREFIX}/api/iam/invitations/accept`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  if (!response.ok) {
    await throwMemberError(response, "");
  }
  return (await response.json()) as AcceptedInvitation;
}
