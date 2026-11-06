/**
 * Same-origin, cookie-only HTTP adapters with validated response boundaries.
 * @package @vxture/workbench
 * @layer Presentation
 * @category api
 * @author AI-Generated
 * @date 2026-11-05
 */
import type {
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
 * @returns Only subscribed cards; launch availability is a separate selection axis.
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
      const coverage = subscriptions.data.filter(
        (item) => item.code === product.code,
      );
      const live = (item: Subscription): boolean =>
        ["active", "trialing", "overdue"].includes(item.status);
      // Live bundled coverage remains usable even after a direct purchase expires.
      // Prefer a live direct purchase for its own commercial tier when both exist.
      const subscribed =
        coverage.find((item) => !item.bundled && live(item)) ??
        coverage.find(live) ??
        coverage[0]!;
      const active =
        ["active", "trialing", "overdue"].includes(subscribed.status) &&
        !subscribed.maintenance
          ? subscribed
          : undefined;
      const href =
        entries.status === "ready"
          ? (entries.data.find((item) => item.code === product.code)?.href ??
            null)
          : null;
      const available =
        product.active && !product.maintenance && Boolean(active && href);
      const availabilityLabel = !product.active
        ? "即将上线"
        : product.maintenance
          ? "维护中"
          : subscribed.maintenance
            ? "维护中"
            : !active
              ? ({
                  expired: "已到期",
                  suspended: "已暂停",
                  cancelled: "已取消",
                }[subscribed.status] ?? "暂不可用")
              : !href
                ? "入口暂不可用"
                : "可使用";
      return {
        code: product.code,
        name: product.name,
        brand: product.nick || "",
        description: product.description,
        category: product.type.endsWith("_agent") ? "agent" : "platform",
        version: product.version,
        stage: product.stage,
        tier: subscribed.tier,
        icon: product.icon,
        href,
        available,
        availabilityLabel,
        favorite: coverage.some((item) => item.favorite),
      };
    });
}

// ============================================================================
// Portal bootstrap; session failures never become empty application data
// ============================================================================
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
  const session = await load(
    "/auth/session",
    (value) => {
      if (object(value).status !== "active")
        throw new WorkApiError("登录已过期，请重新登录", 401);
      return true;
    },
    signal,
  );
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
            : null,
    },
  };
}
