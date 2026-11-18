/**
 * Same-origin, cookie-only HTTP adapters with validated response boundaries.
 * @package @vxture/workbench
 * @layer Presentation
 * @category api
 * @author AI-Generated
 * @date 2026-11-05
 */
import type {
  AppActivity,
  CatalogProduct,
  LoadResult,
  ProductEntry,
  ResourceUsage,
  ScopeOption,
  Subscription,
  WorkApp,
  WorkData,
  WorkspaceOption,
  WorkScope,
  WorkUser,
  WorkInbox,
} from "./contracts";

// ============================================================================
// Validation and request boundaries
// ============================================================================
class WorkApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new WorkApiError("服务返回的数据格式不正确", 502);
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function required(value: unknown): string {
  const text = string(value).trim();
  if (!text) throw new WorkApiError("服务返回的数据不完整", 502);
  return text;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new WorkApiError("服务返回的数据格式不正确", 502);
  return value;
}

/**
 * Accept only HTTP(S) destinations with no embedded credentials.
 * @param value - Untrusted URL from a product registry.
 * @returns A safe destination, or null.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new WorkApiError(
      response.status === 401
        ? "登录已过期，请重新登录"
        : response.status === 403
          ? "当前账号没有查看权限"
          : "服务暂时不可用，请稍后重试",
      response.status,
    );
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new WorkApiError("服务返回的数据格式不正确", 502);
  }
}
async function load<T>(
  path: string,
  parse: (input: unknown) => T,
  signal: AbortSignal,
): Promise<LoadResult<T>> {
  try {
    return { status: "ready", data: parse(await request(path, signal)) };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      status: "error",
      code: error instanceof WorkApiError ? error.code : 0,
      message:
        error instanceof WorkApiError
          ? error.message
          : "网络连接失败，请检查连接后重试",
    };
  }
}

// ============================================================================
// Existing platform response projections
// ============================================================================
function parseUser(input: unknown): WorkUser {
  const row = object(input);
  return {
    id: required(row.id),
    name: string(row.displayName) || required(row.name),
    email: string(row.email),
    phone: string(row.phone),
    picture: safeHttpUrl(row.picture),
  };
}
function parseScope(input: unknown): WorkScope {
  const row = object(input);
  return {
    id: required(row.id),
    name: required(row.name),
    workspace: required(row.workspace),
    workspaceName: string(row.workspaceName) || "default workspace",
    personal: row.tenantType === "personal",
    identifier: string(row.identifier) || undefined,
  };
}
function parseCatalog(input: unknown): CatalogProduct[] {
  return list(input).map((item) => {
    const row = object(item);
    return {
      code: required(row.productCode),
      name: required(row.productName),
      nick: string(row.productNick) || null,
      type: required(row.productType),
      description: string(row.description),
      version: string(row.releaseVersion) || null,
      stage: string(row.releaseStage),
      active: row.status === "active",
      maintenance: row.maintenance != null,
      icon: safeHttpUrl(row.iconUrl),
    };
  });
}
function parseSubscriptions(input: unknown): Subscription[] {
  return list(input).flatMap((item) => {
    const row = object(item);
    return typeof row.productCode === "string"
      ? [
          {
            code: row.productCode,
            status: required(row.status),
            tier: string(row.tier) || string(row.planName) || null,
            maintenance: row.maintenance != null,
            bundled: row.bundled === true,
            favorite: row.favorite === true,
            access:
              row.access === "allowed" || row.access === "denied"
                ? row.access
                : "unknown",
            startsAt:
              typeof row.startsAt === "string" &&
              Number.isFinite(Date.parse(row.startsAt))
                ? row.startsAt
                : null,
            expiresAt:
              typeof row.expiresAt === "string" &&
              Number.isFinite(Date.parse(row.expiresAt))
                ? row.expiresAt
                : null,
          },
        ]
      : [];
  });
}
function parseEntries(input: unknown): ProductEntry[] {
  return list(input).map((item) => {
    const row = object(item);
    return { code: required(row.code), href: safeHttpUrl(row.homeUrl) };
  });
}
function parseOptions(input: unknown): ScopeOption[] {
  return list(input).map((item) => {
    const row = object(item);
    return {
      id: required(row.id),
      name: required(row.name),
      personal: row.tenantType === "personal",
      identifier: string(row.identifier) || undefined,
      workspaces: Array.isArray(row.workspaces)
        ? parseWorkspaces(row.workspaces)
        : undefined,
    };
  });
}
function parseWorkspaces(input: unknown): WorkspaceOption[] {
  return list(input).map((item) => {
    const row = object(item);
    return {
      id: required(row.id),
      name: required(row.name),
      isDefault: row.isDefault === true,
    };
  });
}
function parseResources(input: unknown): ResourceUsage {
  const row = object(input);
  const metric = (value: unknown): { used: number; limit: number } => {
    const item = object(value);
    if (
      typeof item.used !== "number" ||
      typeof item.limit !== "number" ||
      !Number.isFinite(item.used) ||
      !Number.isFinite(item.limit) ||
      item.used < 0 ||
      item.limit < 0
    )
      throw new WorkApiError("资源用量暂不可用", 502);
    return { used: item.used, limit: item.limit };
  };
  return { storage: metric(row.storage), aiCredit: metric(row.aiCredit) };
}
function parseBalance(input: unknown): string {
  const row = object(input);
  if (
    typeof row.balance !== "string" ||
    !/^-?\d+(\.\d+)?$/.test(row.balance) ||
    !/^[A-Z]{3}$/.test(string(row.currency)) ||
    !Number.isFinite(Number(row.balance))
  )
    throw new WorkApiError("余额暂不可用", 502);
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: string(row.currency),
  }).format(Number(row.balance));
}

/**
 * Join independent catalog, active-workspace subscriptions and registered URLs.
 * @param catalog - Public product metadata.
 * @param subscriptions - Current-workspace subscriptions; errors remain unknown.
 * @param entries - Registered launch URLs, never a source of availability.
 * @returns Workspace-covered cards; member denial never hides a subscribed product.
 */
export function projectApps(
  catalog: readonly CatalogProduct[],
  subscriptions: LoadResult<Subscription[]>,
  entries: LoadResult<ProductEntry[]>,
): WorkApp[] {
  if (subscriptions.status === "error") return [];
  return catalog
    .filter(
      (product) =>
        /_(agent|platform)$/.test(product.type) &&
        subscriptions.data.some((item) => item.code === product.code),
    )
    .map((product) => {
      const coverage =
        subscriptions.status === "ready"
          ? subscriptions.data.filter((item) => item.code === product.code)
          : [];
      const live = (item: Subscription): boolean =>
        ["active", "trialing", "expiring", "overdue"].includes(item.status);
      const now = Date.now();
      const current = coverage.filter(
        (item) =>
          live(item) &&
          (!item.startsAt || Date.parse(item.startsAt) <= now) &&
          (item.status === "overdue" ||
            !item.expiresAt ||
            Date.parse(item.expiresAt) > now),
      );
      const subscribed =
        current.find((item) => !item.bundled) ?? current[0] ?? coverage[0];
      const active = current.some((item) => !item.maintenance);
      const access = current.some((item) => item.access === "allowed")
        ? "allowed"
        : current.some((item) => !item.access || item.access === "unknown")
          ? "unknown"
          : "denied";
      const href =
        entries.status === "ready"
          ? (entries.data.find((item) => item.code === product.code)?.href ??
            null)
          : null;
      const availabilityLabel = !product.active
        ? "即将上线"
        : product.maintenance
          ? "维护中"
          : !subscribed
            ? "未订阅"
            : !current.length
              ? ({
                  expired: "已到期",
                  suspended: "已暂停",
                  cancelled: "已取消",
                }[subscribed.status] ?? "暂不可用")
              : !active
                ? "维护中"
                : access === "unknown"
                  ? "暂无法确认权限"
                  : access !== "allowed"
                    ? "联系管理员授权"
                    : !href
                      ? "入口暂不可用"
                      : "可使用";
      // Extend only continuous coverage; a future purchase after a gap is not renewal.
      let horizon = Date.now();
      let connected = false;
      const windows = coverage
        .filter(live)
        .filter((item) => !item.maintenance)
        .toSorted(
          (a, b) =>
            (Date.parse(a.startsAt ?? "") || 0) -
            (Date.parse(b.startsAt ?? "") || 0),
        );
      for (const item of windows) {
        const start = Date.parse(item.startsAt ?? "") || 0;
        const end = item.expiresAt ? Date.parse(item.expiresAt) : Infinity;
        if (start <= horizon && end > horizon) {
          horizon = end;
          connected = true;
        }
      }
      return {
        code: product.code,
        name: product.name,
        brand: product.nick || "",
        description: product.description,
        category: product.type.endsWith("_agent") ? "agent" : "platform",
        version: product.version,
        stage: product.stage,
        tier: subscribed?.tier ?? null,
        icon: product.icon,
        href,
        available:
          product.active &&
          !product.maintenance &&
          active &&
          access === "allowed" &&
          Boolean(href),
        availabilityLabel,
        subscribed: coverage.length > 0,
        activeSubscription: current.length > 0,
        directActiveSubscription: current.some((item) => !item.bundled),
        expiresAt:
          connected && Number.isFinite(horizon)
            ? new Date(horizon).toISOString()
            : null,
        favorite: coverage.some((item) => item.favorite),
      };
    });
}

// ============================================================================
// Portal bootstrap; session failures never become empty application data
// ============================================================================
/**
 * Probe central login through this domain's RP without loading application data.
 * @param signal - Request cancellation signal.
 * @returns Active login or an explicit authentication/availability error.
 */
export async function loadWorkSession(
  signal: AbortSignal,
): Promise<LoadResult<boolean>> {
  return load(
    "/auth/session",
    (value) => {
      if (object(value).status !== "active")
        throw new WorkApiError("登录已过期，请重新登录", 401);
      return true;
    },
    signal,
  );
}

/**
 * Check the RP session and load independent data sources without hiding failures.
 * @param signal - Request lifecycle cancellation signal.
 * @param catalogConfigured - Whether a public catalog proxy is configured.
 * @returns Authenticated data or an explicit error including expired sessions.
 */
export async function loadWorkData(
  signal: AbortSignal,
  catalogConfigured: boolean,
): Promise<LoadResult<WorkData>> {
  const session = await loadWorkSession(signal);
  if (session.status === "error") return session;
  const [user, scope] = await Promise.all([
    load("/api/me", parseUser, signal),
    load("/api/tenant-context", parseScope, signal),
  ]);
  if (user.status === "error") return user;
  if (scope.status === "error") return scope;
  const [
    catalog,
    subscriptions,
    entries,
    scopeOptions,
    workspaces,
    resources,
    balance,
    monthlyBill,
  ] = await Promise.all([
    catalogConfigured
      ? load("/api/products/catalog", parseCatalog, signal)
      : Promise.resolve<LoadResult<CatalogProduct[]>>({
          status: "error",
          code: 503,
          message: "应用目录暂未连接",
        }),
    load("/api/subscription/subscribed-products", parseSubscriptions, signal),
    // Registered destinations never establish subscription eligibility.
    load("/api/me/apps", parseEntries, signal),
    load("/api/tenant-context/options", parseOptions, signal),
    load("/api/iam/workspaces/mine", parseWorkspaces, signal),
    load("/api/subscription/quota-usage", parseResources, signal),
    load("/api/subscription/credits", parseBalance, signal),
    load("/api/subscription/monthly-bill", parseBalance, signal),
  ]);
  const expired = [
    catalog,
    subscriptions,
    entries,
    scopeOptions,
    workspaces,
    resources,
    balance,
    monthlyBill,
  ].find((result) => result.status === "error" && result.code === 401);
  if (expired?.status === "error") return expired;
  return {
    status: "ready",
    data: {
      user: user.data,
      scope: scope.data,
      scopeOptions,
      workspaces,
      resources,
      balance,
      monthlyBill,
      catalog:
        catalog.status === "error"
          ? catalog
          : subscriptions.status === "error"
            ? subscriptions
            : {
                status: "ready",
                data: projectApps(catalog.data, subscriptions, entries),
              },
      availabilityIssue:
        subscriptions.status === "error"
          ? subscriptions.message
          : entries.status === "error"
            ? entries.message
            : subscriptions.status === "ready" &&
                subscriptions.data.some((item) => item.access === "unknown")
              ? "暂无法确认权限"
              : null,
    },
  };
}

// ============================================================================
// Notification reads and explicit read-state updates
// ============================================================================
/**
 * Load recent account-owned messages with strict boundary validation.
 * @param signal - Drawer request cancellation.
 * @returns Latest inbox projection or an explicit recoverable error.
 */
export function loadInbox(signal: AbortSignal): Promise<LoadResult<WorkInbox>> {
  return load(
    "/api/me/inbox",
    (input) => {
      const row = object(input);
      if (!Number.isSafeInteger(row.unreadCount) || Number(row.unreadCount) < 0)
        throw new WorkApiError("通知数据格式不正确", 502);
      return {
        unreadCount: Number(row.unreadCount),
        items: list(row.items).map((value) => {
          const item = object(value);
          const createdAt = required(item.createdAt);
          if (!Number.isFinite(Date.parse(createdAt)))
            throw new WorkApiError("通知时间格式不正确", 502);
          return {
            id: required(item.id),
            title: required(item.title),
            body: string(item.body),
            link: string(item.link) || null,
            readAt: string(item.readAt) || null,
            createdAt,
          };
        }),
      };
    },
    signal,
  );
}

/**
 * Mark one message, or all account messages, read only after an explicit action.
 * @param id - Message identifier, or null for all messages.
 * @param signal - Cancellation when scope or the mounted drawer changes.
 * @returns Nothing after the authenticated mutation succeeds.
 * @throws When the request fails; callers retain the previous unread state.
 */
export async function markNotificationsRead(
  id: string | null,
  signal: AbortSignal,
): Promise<void> {
  const path = id === null ? "read-all" : `${encodeURIComponent(id)}/read`;
  const response = await fetch(`/api/me/inbox/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-Workbench-Request": "1" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok)
    throw new WorkApiError("标记已读失败，请重试", response.status);
}

// ============================================================================
// Account favorites and scope-bound portal launch activity
// ============================================================================
/**
 * Load activity without treating service failures as an empty history.
 * @param signal - Scope lifecycle cancellation.
 * @returns Validated server-owned activity or an explicit error.
 */
export function loadAppActivity(
  signal: AbortSignal,
): Promise<LoadResult<AppActivity>> {
  return load(
    "/api/me/app-activity",
    (input) => {
      const row = object(input);
      if (!["favorites", "recent", "frequent"].includes(string(row.view)))
        throw new WorkApiError("应用记录格式不正确", 502);
      return {
        view: row.view as AppActivity["view"],
        items: list(row.items).map((value) => {
          const item = object(value);
          if (
            typeof item.favorite !== "boolean" ||
            !Number.isSafeInteger(item.launches30d) ||
            Number(item.launches30d) < 0 ||
            (item.lastUsedAt !== null &&
              (typeof item.lastUsedAt !== "string" ||
                !Number.isFinite(Date.parse(item.lastUsedAt))))
          )
            throw new WorkApiError("应用记录格式不正确", 502);
          return {
            code: required(item.code),
            favorite: item.favorite,
            lastUsedAt: item.lastUsedAt as string | null,
            launches30d: Number(item.launches30d),
          };
        }),
      };
    },
    signal,
  );
}

/**
 * Persist an explicit portal action in the expected authenticated workspace.
 * @param path - Encoded product action or the view preference route.
 * @param body - Desired preference or unique launch event.
 * @param scope - Expected tenant and workspace; prevents a late request crossing a switch.
 * @param signal - Scope lifecycle cancellation.
 * @returns Nothing after the server acknowledges persistence.
 * @throws When source, identity, storage or membership checks fail.
 */
export async function saveAppActivity(
  path: string,
  body: Record<string, unknown>,
  scope: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/me/app-activity/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Workbench-Request": "1",
      "X-Workbench-Scope": scope,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok)
    throw new WorkApiError("操作未保存，请重试", response.status);
}
