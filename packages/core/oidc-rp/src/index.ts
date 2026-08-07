/**
 * index.ts - @vxture/core-oidc-rp package entry
 * @package @vxture/core-oidc-rp
 * @description
 *   OIDC Relying Party toolkit: RP session model, PKCE/state primitives, and the
 *   pluggable OidcRpClient contract. Concrete client + RP session store + NestJS
 *   middleware land in subsequent P1 slices. See docs/design/identity-platform-rp-integration.md.
 */
export type {
  OidcRpConfig,
  OidcTokenSet,
  RpSession,
  RpUser,
  OidcIdClaims,
  OidcAuthRequest,
  OidcRpClient,
} from "./types";

export { mapAccessClaims, stripSubPrefix } from "./claims";

export { generatePkce, pkceChallenge, randomToken, safeReturnTo } from "./pkce";
export type { PkcePair } from "./pkce";

export { RpSessionStore } from "./rp-session.store";
export type { RpRedis } from "./rp-session.store";

export { HttpOidcRpClient } from "./http-client";

export { RpAuthService } from "./rp-auth.service";
export type { RpAuthOutcome } from "./rp-auth.service";

/**
 * RP session cookie naming.
 *
 * The contract itself now lives in `@vxture/core-identity-sdk`, because the
 * portal middleware needs it too and runs on the Edge runtime, where this
 * package (ioredis, node builtins) cannot be imported at all. Re-exported here
 * so every existing RP consumer keeps its import site — there is exactly one
 * definition, and the middleware no longer keeps a hand-copied duplicate.
 */
export {
  RP_SESSION_COOKIE_SECURE_BASE as RP_SESSION_COOKIE,
  RP_SESSION_COOKIE_BASE as RP_SESSION_COOKIE_INSECURE,
  rpSessionCookieName,
} from "@vxture/core-identity-sdk";
