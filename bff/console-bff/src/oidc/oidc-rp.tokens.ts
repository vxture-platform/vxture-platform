/**
 * oidc-rp.tokens.ts - DI tokens + runtime config for the console RP.
 * @package @vxture/bff-console
 */
import type { OidcRpConfig } from "@vxture/core-oidc-rp";

export const RP_RUNTIME = Symbol("RP_RUNTIME");
export const RP_REDIS = Symbol("RP_REDIS");
export const RP_OIDC_CLIENT = Symbol("RP_OIDC_CLIENT");
export const RP_SESSION_STORE = Symbol("RP_SESSION_STORE");
export const RP_AUTH_SERVICE = Symbol("RP_AUTH_SERVICE");
export const RP_SESSION_EVENTS = Symbol("RP_SESSION_EVENTS");
export const RP_RECOVERY = Symbol("RP_RECOVERY");
export const RP_CHANGES = Symbol("RP_CHANGES");
export const RP_EVENT_VERIFIER = Symbol("RP_EVENT_VERIFIER");

/** Runtime knobs derived from config/env for the RP routes + (future) middleware. */
export interface RpRuntime {
  config: OidcRpConfig;
  /** gray-rollout flag; gates the dual-read in AuthMiddleware (follow-up slice) */
  enabled: boolean;
  /** allowlist of origins accepted as post-login returnTo */
  allowedReturnOrigins: string[];
  defaultReturnTo: string;
  /** unified post-logout page (accounts surface) the IdP redirects to after SLO */
  postLogoutRedirectUri: string;
  /** set the __Host- session cookie as Secure (prod https) */
  cookieSecure: boolean;
  /** Redis key prefix (matches the session store) */
  keyPrefix: string;
  /** Explicit rollout approval after complete fact/delivery/proxy acceptance. */
  sessionPollingRetirement?: boolean;
}
