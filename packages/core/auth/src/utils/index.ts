/**
 * index.ts - Auth utility exports
 * @package @vxture/core-auth
 */

export {
  extractBearerToken,
  extractBearerTokenFromHeaders,
  isTokenExpired,
  getTokenRemainingMs,
} from "./auth.utils";

export { sharedSecretMatches } from "./shared-secret";

export {
  hasPermission,
  hasRole,
  isAdmin,
  isTenantAdmin,
} from "./permission.utils";

export {
  isValidProvider,
  buildOAuthProfile,
  generateJti,
} from "./provider.utils";
