/**
 * Customer-only account-center read API.
 * @package @vxture/accounts
 * @layer Presentation
 * @category api
 * @author AI-Generated
 * @date 2026-11-07
 */
import { apiMessage } from "@/lib/api-message";

// ============================================================================
// HTTP projections
// ============================================================================

export interface CustomerProfile {
  id: string;
  realm: "customer";
  avatarHash?: string | null;
  language?: string | null;
  timezone?: string | null;
  status?: string;
  account: string;
  userNo?: string;
  name: string | null;
  createdAt?: string;
}

export interface CustomerSecurity {
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  hasPassword: boolean;
  accountLoginEnabled: boolean;
  emailLoginEnabled: boolean;
  identities: { provider: string; connectedAt: string }[];
}

export interface CustomerSession {
  sid: string;
  authMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  current: boolean;
}

export interface CustomerLoginAttempt {
  loginAt: string;
  ipAddress: string;
  userAgent: string | null;
  authMethod: string;
  result: string;
}

export class CustomerReadError extends Error {
  constructor(readonly kind: "unauthenticated" | "unavailable") {
    super(kind);
    this.name = "CustomerReadError";
  }
}

// ============================================================================
// Customer session reads
// ============================================================================

const API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

interface CustomerProjections {
  "": CustomerProfile;
  "/security": CustomerSecurity;
  "/sessions": CustomerSession[];
  "/login-history": CustomerLoginAttempt[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function validProjection(
  resource: keyof CustomerProjections,
  data: unknown,
): boolean {
  if (resource === "/sessions") {
    return (
      Array.isArray(data) &&
      data.every(
        (item: unknown) =>
          record(item) &&
          strings(item, ["sid", "authMethod", "lastActiveAt"]) &&
          nullableString(item.ipAddress) &&
          nullableString(item.userAgent) &&
          typeof item.current === "boolean",
      )
    );
  }
  if (resource === "/login-history") {
    return (
      Array.isArray(data) &&
      data.every(
        (item: unknown) =>
          record(item) &&
          strings(item, ["loginAt", "ipAddress", "authMethod", "result"]) &&
          nullableString(item.userAgent),
      )
    );
  }
  if (!record(data)) return false;
  if (resource === "") {
    return (
      data.realm === "customer" &&
      strings(data, ["id", "account"]) &&
      nullableString(data.name) &&
      (data.userNo === undefined || typeof data.userNo === "string") &&
      (data.createdAt === undefined || typeof data.createdAt === "string")
    );
  }
  return (
    [data.email, data.phone].every(nullableString) &&
    [
      "emailVerified",
      "phoneVerified",
      "hasPassword",
      "accountLoginEnabled",
      "emailLoginEnabled",
    ].every((key) => typeof data[key] === "boolean") &&
    Array.isArray(data.identities) &&
    data.identities.every(
      (identity: unknown) =>
        record(identity) && strings(identity, ["provider", "connectedAt"]),
    )
  );
}

/**
 * Read a customer projection without falling back to the workforce domain.
 * @param resource - Known self-service projection.
 * @param signal - Request lifetime owned by the caller.
 * @returns The requested HTTP projection.
 * @throws {CustomerReadError} When the customer session is absent or the service fails.
 */
export async function fetchCustomerSelf<K extends keyof CustomerProjections>(
  resource: K,
  signal: AbortSignal,
): Promise<CustomerProjections[K]> {
  try {
    const response = await fetch(`${API_BASE}/oidc/customer/self${resource}`, {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (response.status === 401) throw new CustomerReadError("unauthenticated");
    if (!response.ok) throw new CustomerReadError("unavailable");
    const data: unknown = await response.json();
    if (!validProjection(resource, data))
      throw new CustomerReadError("unavailable");
    return data as CustomerProjections[K];
  } catch (error) {
    if (error instanceof CustomerReadError) throw error;
    throw new CustomerReadError("unavailable");
  }
}

// ============================================================================
// Authenticated self-service writes
// ============================================================================

/**
 * Call an accounts-owned API with bounded lifetime and cookie authentication.
 * @param path - Fixed path selected by account UI components.
 * @param init - HTTP request options.
 * @returns The server response, without persisting credentials in browser storage.
 * @throws {Error} For authentication, validation, rate-limit or network failure.
 */
export async function accountsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(15000),
      headers: {
        ...(init.body instanceof Blob
          ? {}
          : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(apiMessage("error_5"));
  }
  if (response.status === 401) throw new Error(apiMessage("error_54"));
  if (response.status === 429) throw new Error(apiMessage("error_55"));
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      message?: unknown;
    };
    const messages: Record<string, string> = {
      invalid_code: apiMessage("error_56"),
      invalid_security_code: apiMessage("error_56"),
      security_challenge_expired: apiMessage("error_57"),
      invalid_current_password: apiMessage("error_58"),
      verified_anchor_required: apiMessage("error_59"),
      deletion_blocked: apiMessage("error_60"),
      username_already_taken: apiMessage("error_61"),
      mfa_unavailable: apiMessage("error_62"),
    };
    throw new Error(
      typeof data.message === "string"
        ? (messages[data.message] ?? apiMessage("error_63"))
        : apiMessage("error_63"),
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
