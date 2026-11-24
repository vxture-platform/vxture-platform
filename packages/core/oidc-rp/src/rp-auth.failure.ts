/**
 * RP authentication failures that do not assert central logout.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */

/** Upstream token failure; only invalid_grant requires a fresh authorization. */
export class OidcTokenRequestError extends Error {
  constructor(readonly reauthorizationRequired: boolean) {
    super("OIDC token request failed");
    this.name = "OidcTokenRequestError";
  }
}

/** No usable authorization is available; the local identity remains stored. */
export interface RpAuthUnavailable {
  status: "unavailable";
  reauthorizationRequired: boolean;
}

/**
 * Map a failed RP authorization to the existing BFF error-envelope shape.
 * @param outcome Failed authorization, distinct from an absent session.
 * @returns A non-401 response that cannot be mistaken for confirmed logout.
 */
export function rpAuthFailure(outcome: RpAuthUnavailable) {
  return {
    code: outcome.reauthorizationRequired
      ? "AUTH_REAUTHORIZATION_REQUIRED"
      : "AUTH_UNAVAILABLE",
    message: outcome.reauthorizationRequired
      ? "Authorize this session again"
      : "Authentication temporarily unavailable",
    retryable: !outcome.reauthorizationRequired,
    statusCode: 503,
  };
}
