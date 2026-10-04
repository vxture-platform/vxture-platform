/**
 * index.ts - @vxture/core-auth package entry
 * @package @vxture/core-auth
 * @description
 *   Authentication token management and session infrastructure
 */

// Types
export {
  OAuthProviderType,
  PlatformRole,
  JwtAuthScope,
  JwtUserType,
} from "./types";
export type {
  JwtAccessPayload,
  JwtRefreshPayload,
  AuthUser,
  OAuthTokens,
  OAuthUserProfile,
  OAuthProvider,
  AuthTokenPair,
  PermissionCheckOptions,
} from "./types";

// Guards
export { JwtAuthGuard, RolesGuard } from "./guards";

// Decorators
export {
  Public,
  IS_PUBLIC_KEY,
  Roles,
  ROLES_KEY,
  CurrentUser,
} from "./decorators";

// Utils
export {
  extractBearerToken,
  extractBearerTokenFromHeaders,
  isTokenExpired,
  getTokenRemainingMs,
  hasPermission,
  hasRole,
  isAdmin,
  isTenantAdmin,
  isValidProvider,
  buildOAuthProfile,
  generateJti,
  sharedSecretMatches,
} from "./utils";

// Session
export {
  AccessTokenRevocationService,
  buildAccessTokenBlacklistKey,
  buildSubjectRevokedBeforeKey,
  resolveAccessRevocationSurface,
  REDIS_REVOCATION_CONFIG,
} from "./session";
export type { AccessRevocationSurface, RedisRevocationConfig } from "./session";

// Human verification
export { TurnstileVerifier, TurnstileVerificationError } from "./turnstile";
export type {
  TurnstileSurface,
  TurnstileSiteverifyResponse,
  TurnstileVerifierOptions,
  TurnstileVerifyInput,
} from "./turnstile";
