/**
 * Realm-scoped expiration notifications for authenticated account requests.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-10
 */
export const ACCOUNT_SESSION_EXPIRED = "accounts:session-expired";
export type AccountRealm = "customer" | "workforce";

/** Distinguish expired account authentication from invalid login credentials. */
export class AccountSessionError extends Error {
  constructor(
    readonly realm: AccountRealm,
    message: string,
  ) {
    super(message);
    this.name = "AccountSessionError";
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_SESSION_EXPIRED, { detail: realm }),
      );
  }
}
