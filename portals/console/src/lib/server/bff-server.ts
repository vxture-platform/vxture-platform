/**
 * Server-side console-bff access — the foundation for building the initial
 * session snapshot during SSR (workplan #7). Import only from Server Components
 * / route handlers: it uses next/headers, which is server-only.
 *
 * The browser-facing client (src/api/console-bff.ts) talks to
 * NEXT_PUBLIC_CONSOLE_BFF_URL over same-origin; the server cannot reuse that
 * (it is a public origin that would hairpin out through Cloudflare/nginx and
 * back). The server must reach console-bff over the internal container address
 * and forward the caller's cookies (including the HttpOnly RP session) so the
 * BFF auth/tenant/permission middleware sees the logged-in user.
 */

import { headers } from "next/headers";
import type {
  Capability,
  ConsoleUser,
  SessionSnapshot,
  TenantContext,
} from "@/entities/console";

const INTERNAL_BFF_FALLBACK = "http://localhost:3021";

/**
 * Base URL the console server uses to reach console-bff.
 *
 * Production MUST set CONSOLE_BFF_INTERNAL_URL to the internal container address
 * (e.g. http://vx-platform-console-bff:3021). Without it this falls back to the
 * public browser URL and finally localhost, which only works in dev.
 */
export function resolveInternalBffBaseUrl(): string {
  const raw =
    process.env.CONSOLE_BFF_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_CONSOLE_BFF_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    INTERNAL_BFF_FALLBACK;
  return raw.trim().replace(/\/+$/, "") || INTERNAL_BFF_FALLBACK;
}

/**
 * Server-side GET to console-bff, forwarding the caller's cookies so the BFF
 * resolves the logged-in user. Returns parsed JSON, or `fallback` on any
 * non-OK / error.
 *
 * IMPORTANT for #7: a fallback/anonymous result must NOT be used to hard-redirect
 * to /signin. The cookie can exist but be expired, in which case the existing
 * client flow performs prompt=none silent SSO (ConsoleSessionProvider). Server
 * code should only use a successful snapshot to seed the provider, and otherwise
 * defer to the client — never short-circuit the auth flow.
 */
export async function fetchBffAsUser<T>(path: string, fallback: T): Promise<T> {
  try {
    const cookieHeader = (await headers()).get("cookie") ?? "";
    const response = await fetch(`${resolveInternalBffBaseUrl()}${path}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (!response.ok) {
      return fallback;
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Build the console SessionSnapshot server-side by replaying restoreSession's
 * reads against the internal BFF with the caller's cookies, so the (console)
 * layout can seed the provider and skip the client-side spinner waterfall.
 *
 * Returns null whenever the session isn't cleanly resolvable — the caller MUST
 * then neither seed nor redirect: an unseeded provider falls back to the exact
 * existing client flow (restore + prompt=none silent SSO). This is why an
 * expired cookie or a platform-only user degrades gracefully instead of
 * hard-redirecting a logged-in user to /signin.
 */
export async function loadServerSessionSnapshot(): Promise<SessionSnapshot | null> {
  // Probe first: the cookie can exist but be expired (BFF replies 401 → null).
  const probe = await fetchBffAsUser<{ status?: string } | null>(
    "/auth/session",
    null,
  );
  if (!probe || probe.status !== "active") return null;

  const [user, tenant, tenantOptions, capabilities] = await Promise.all([
    fetchBffAsUser<ConsoleUser | null>("/api/me", null),
    fetchBffAsUser<TenantContext | null>("/api/tenant-context", null),
    fetchBffAsUser<TenantContext[]>("/api/tenant-context/options", []),
    fetchBffAsUser<Capability[]>("/api/capabilities", []),
  ]);

  // Incomplete (e.g. a platform-only user with no active org) → let the client
  // do the full restore rather than seed a partial snapshot.
  if (!user || !tenant) return null;

  // 活跃租户只有服务端 RP 会话一个真相(切换 = 静默重授权换新会话,identity/080 §2.8),
  // 服务端解析到的就是用户看到的;此前还比对一枚客户端镜像 cookie,已随之撤掉。
  return { isAuthenticated: true, user, tenant, tenantOptions, capabilities };
}
