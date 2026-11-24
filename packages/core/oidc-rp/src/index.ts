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
export type { RpRedis, RpSessionAuthority } from "./rp-session.store";
export { HttpIdentityRecoveryClient } from "./identity-recovery.client";
export type {
  IdentityEnvironment,
  IdentityRealm,
  IdentityRecoveryClient,
  RecoverySession,
  RecoverySnapshot,
  LogoutRecoveryPage,
} from "./identity-recovery.client";

export { HttpOidcRpClient } from "./http-client";
export { checkOidcSession } from "./session-status";

export { RpAuthService } from "./rp-auth.service";
export type { RpAuthOutcome, RpAuthStore } from "./rp-auth.service";
export { rpAuthFailure, OidcTokenRequestError } from "./rp-auth.failure";
export type { RpAuthUnavailable } from "./rp-auth.failure";

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
export {
  HttpIdentityChangesClient,
  IdentityEventVerifier,
  IdentityEventVerificationError,
  parseIdentityChange,
} from "./identity-changes.client";
export type {
  IdentityChangeEvent,
  IdentityChangeScope,
  IdentityChangeSnapshot,
  IdentityChangesClient,
} from "./identity-changes.client";

export { SessionRecoveryAuthority } from "./session-recovery.authority";
export {
  IdentityChangesAuthority,
  IdentityChangeConflict,
} from "./identity-changes.authority";
export { SessionEventsHub } from "./session-events.hub";
export type {
  IdentitySql,
  IdentitySqlPool,
  IdentitySqlTransaction,
  IdentityNotificationClient,
  IdentityNotification,
} from "./identity-persistence";
export { SessionEventsEndpoint } from "./session-events.endpoint";
export { IdentitySyncRuntime } from "./identity-sync.runtime";
export type {
  SessionEventRuntime,
  SessionEventRequest,
  SessionEventResponse,
} from "./session-events.endpoint";
