/**
 * auth-login.utils.ts - 认证入口浏览器工具。
 * @package @vxture/platform-browser
 * @layer Infrastructure
 * @category Utils
 * @author AI-Generated
 * @date 2026-06-03
 */

export type TenantOAuthProvider = "dingtalk" | "feishu";

export interface RememberedLogin {
  readonly remember: boolean;
  readonly identifier: string;
}

export interface PortalOAuthStartOptions {
  readonly provider: TenantOAuthProvider;
  readonly source: string;
  readonly authBffUrl?: string | undefined;
  readonly apiUrl?: string | undefined;
  readonly apiPrefix?: string | undefined;
  readonly fallbackAuthBffUrl?: string | undefined;
}

export const DEFAULT_REMEMBER_LOGIN_KEY = "vxture-login-remember";
export const DEFAULT_REMEMBER_IDENTIFIER_KEY = "vxture-login-identifier";
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;

function isBrowser(): boolean {
  return globalThis.window !== undefined && globalThis.document !== undefined;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const normalized = trimTrailingSlashes(value?.trim() ?? "");
  return normalized || fallback;
}

function readCookie(name: string): string {
  if (!isBrowser()) return "";

  const prefix = `${name}=`;
  const value = globalThis.document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  return value ? decodeURIComponent(value) : "";
}

function writeCookie(name: string, value: string): void {
  if (!isBrowser()) return;

  globalThis.document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${REMEMBER_MAX_AGE}; samesite=lax`;
}

function clearCookie(name: string): void {
  if (!isBrowser()) return;

  globalThis.document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function readRememberedLogin(
  rememberKey = DEFAULT_REMEMBER_LOGIN_KEY,
  identifierKey = DEFAULT_REMEMBER_IDENTIFIER_KEY,
): RememberedLogin {
  if (!isBrowser()) {
    return { remember: false, identifier: "" };
  }

  const remember = readCookie(rememberKey) === "1";
  const identifier = readCookie(identifierKey).trim();
  return { remember, identifier };
}

export function writeRememberedLogin(
  identifier: string,
  rememberKey = DEFAULT_REMEMBER_LOGIN_KEY,
  identifierKey = DEFAULT_REMEMBER_IDENTIFIER_KEY,
): void {
  if (!isBrowser()) return;

  writeCookie(rememberKey, "1");
  writeCookie(identifierKey, identifier);
}

export function clearRememberedLogin(
  rememberKey = DEFAULT_REMEMBER_LOGIN_KEY,
  identifierKey = DEFAULT_REMEMBER_IDENTIFIER_KEY,
): void {
  if (!isBrowser()) return;

  clearCookie(rememberKey);
  clearCookie(identifierKey);
}

export function persistRememberedLogin(
  identifier: string,
  remember: boolean,
): void {
  if (remember) {
    writeRememberedLogin(identifier);
    return;
  }

  clearRememberedLogin();
}

const LAST_RP_ORIGIN_KEY = "vxture-last-rp-origin";
/** Absolute last-resort landing page when no RP/referrer/configured home is known. */
const DEFAULT_HOME_URL = "https://vxture.com";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Cache the current page's referrer origin as "last known RP" so a later
 * dead-end visit (expired challenge, bookmarked accounts URL) can send the
 * user back to the app they actually came from.
 */
export function rememberRpOrigin(): void {
  if (!isBrowser()) return;
  const origin = originOf(globalThis.document.referrer);
  if (!origin || origin === globalThis.window.location.origin) return;
  try {
    globalThis.window.localStorage.setItem(LAST_RP_ORIGIN_KEY, origin);
  } catch {
    // storage unavailable (private mode, quota) — nothing to fall back to here
  }
}

/**
 * Resolve where to send a user stranded on the accounts surface with no live
 * login flow, in priority order: (1) the last RP we cached via
 * `rememberRpOrigin`, (2) the current request's referrer, (3) the caller-
 * supplied configured home URL, (4) the hardcoded public site root.
 */
export function resolveReturnUrl(configuredHomeUrl?: string): string {
  if (!isBrowser()) return configuredHomeUrl?.trim() || DEFAULT_HOME_URL;

  try {
    const cached = globalThis.window.localStorage.getItem(LAST_RP_ORIGIN_KEY);
    if (cached) return cached;
  } catch {
    // storage unavailable — fall through to referrer/config
  }

  const referrerOrigin = originOf(globalThis.document.referrer);
  if (referrerOrigin && referrerOrigin !== globalThis.window.location.origin) {
    return referrerOrigin;
  }

  return configuredHomeUrl?.trim() || DEFAULT_HOME_URL;
}

export async function storeBrowserPasswordCredential(
  identifier: string,
  password: string,
): Promise<void> {
  if (!isBrowser()) return;

  const PasswordCredentialCtor = (
    globalThis.window as Window & {
      PasswordCredential?: new (data: {
        id: string;
        password: string;
      }) => Credential;
    }
  ).PasswordCredential;
  if (!PasswordCredentialCtor) return;

  try {
    await navigator.credentials.store(
      new PasswordCredentialCtor({ id: identifier, password }),
    );
  } catch {
    // 隐私模式或用户拒绝时静默忽略
  }
}

export function buildPortalOAuthStartUrl({
  provider,
  source,
  authBffUrl,
  apiUrl,
  apiPrefix,
  fallbackAuthBffUrl = "http://localhost:3081",
}: PortalOAuthStartOptions): string {
  const hasDirectAuthBff = Boolean(authBffUrl?.trim());
  const baseUrl = normalizeBaseUrl(authBffUrl ?? apiUrl, fallbackAuthBffUrl);
  const prefix = normalizeBaseUrl(
    apiPrefix ?? (hasDirectAuthBff || !apiUrl?.trim() ? "" : "/auth-api"),
    "",
  );
  const returnTo = isBrowser() ? `${globalThis.window.location.origin}/` : "/";

  return `${baseUrl}${prefix}/auth/oauth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}&source=${encodeURIComponent(source)}`;
}

export function openBrowserUrl(url: string): void {
  if (!isBrowser()) return;
  globalThis.window.location.href = url;
}
