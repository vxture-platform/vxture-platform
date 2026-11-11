/**
 * Resolve the identity-layer operator account center.
 * @package @vxture/admin
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-11
 */
const ACCOUNTS_BASE = (
  process.env.NEXT_PUBLIC_ACCOUNTS_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://accounts.vxture.com"
    : "http://localhost:3080")
)
  .trim()
  .replace(/\/+$/, "");

/**
 * Resolve the workforce entry without crossing into customer identity.
 * @returns Absolute workforce account-center URL.
 */
export function operatorAccountCenterUrl(): string {
  return `${ACCOUNTS_BASE}/workforce/account`;
}
