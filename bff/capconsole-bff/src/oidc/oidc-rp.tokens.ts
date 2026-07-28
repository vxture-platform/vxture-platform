/**
 * oidc-rp.tokens.ts - DI tokens + runtime config for the capconsole (workforce) RP.
 * @package @vxture/bff-capconsole
 */
import type { OidcRpConfig } from "@vxture/core-oidc-rp";

export const RP_RUNTIME = Symbol("RP_RUNTIME");
export const RP_REDIS = Symbol("RP_REDIS");
export const RP_OIDC_CLIENT = Symbol("RP_OIDC_CLIENT");
export const RP_SESSION_STORE = Symbol("RP_SESSION_STORE");
export const RP_AUTH_SERVICE = Symbol("RP_AUTH_SERVICE");

/** Runtime knobs derived from config/env for the RP routes. */
export interface RpRuntime {
  config: OidcRpConfig;
  /** allowlist of origins accepted as post-login returnTo */
  allowedReturnOrigins: string[];
  defaultReturnTo: string;
  /** set the __Host- session cookie as Secure (prod https) */
  cookieSecure: boolean;
  /** Redis key prefix (matches the session store) */
  keyPrefix: string;
}
