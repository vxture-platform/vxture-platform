/**
 * cookie.ts — central-session cookie spec (pure; dependency-free for testing).
 *
 * docs/design/identity-platform-architecture.md §3: the tenant-realm session cookie `vx_sid`
 * is set on `.vxture.com` (Domain shared across subdomains for SSO); the operator
 * realm uses `vx_sid_op` host-only (hard isolation). Secure/HttpOnly/SameSite=Lax.
 *
 * `secure` is caller-supplied (IDP_COOKIE_INSECURE), not hardcoded.
 */

export interface SidCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  domain?: string;
}

export interface SidCookie {
  name: string;
  value: string;
  options: SidCookieOptions;
}

export const SID_COOKIE_NAME = {
  tenant: "vx_sid",
  operator: "vx_sid_op",
} as const;

/**
 * Build the Set-Cookie spec for a central session.
 * - tenant realm → `vx_sid`, Domain = platformCookieDomain (e.g. `.vxture.com`)
 * - operator realm → `vx_sid_op`, host-only (no Domain)
 */
export function buildSidCookie(input: {
  sid: string;
  realm: "customer" | "workforce";
  maxAgeSeconds: number;
  platformCookieDomain?: string | null;
  secure: boolean;
}): SidCookie {
  const isOperator = input.realm === "workforce";
  const options: SidCookieOptions = {
    httpOnly: true,
    secure: input.secure,
    sameSite: "lax",
    path: "/",
    maxAge: input.maxAgeSeconds * 1000,
  };
  // operator is host-only (hard isolation); tenant shares the parent domain.
  if (!isOperator && input.platformCookieDomain) {
    options.domain = input.platformCookieDomain;
  }
  return {
    name: isOperator ? SID_COOKIE_NAME.operator : SID_COOKIE_NAME.tenant,
    value: input.sid,
    options,
  };
}

/** Login-state hint cookie name (non-HttpOnly, JS-readable on *.vxture.com). */
export const HINT_COOKIE_NAME = "vx_hint";

export interface HintCookie {
  name: string;
  value: string;
  options: {
    httpOnly: false;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
    domain?: string;
  };
}

/**
 * Build the login-state HINT cookie (tenant realm only).
 *
 * A non-HttpOnly, `.vxture.com`-shared cookie so first-party pages (esp. the
 * marketing website) can tell "is anyone logged in?" synchronously via
 * `document.cookie` — a truly-anonymous visitor then never pays a full-page
 * prompt=none SSO bounce. Presence == logged in; lifecycle mirrors `vx_sid`.
 *
 * ⚠️ JS-readable (XSS-exposed) and unsigned: it carries NO secret and NO
 * authority — value is the literal "1", an optimization HINT only. Every gated
 * decision still relies on the HttpOnly `vx_sid` session + server checks. The
 * operator realm stays isolated and gets no hint.
 */
export function buildHintCookie(input: {
  maxAgeSeconds: number;
  platformCookieDomain?: string | null;
  secure: boolean;
}): HintCookie {
  const options: HintCookie["options"] = {
    httpOnly: false,
    secure: input.secure,
    sameSite: "lax",
    path: "/",
    maxAge: input.maxAgeSeconds * 1000,
  };
  if (input.platformCookieDomain) {
    options.domain = input.platformCookieDomain;
  }
  return { name: HINT_COOKIE_NAME, value: "1", options };
}
