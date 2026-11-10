/**
 * Accounts locale persistence compatible with the other platform portals.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-11-10
 */
import type { Locale } from "@vxture-platform/shared";
import { setGlobalLocalePreference } from "@vxture/platform-browser";

/** Remove the legacy host cookie before writing the shared preference. */
export function setAccountsLocale(locale: Locale): void {
  document.cookie = "NEXT_LOCALE=; Path=/; Max-Age=0; SameSite=Lax";
  setGlobalLocalePreference(locale);
}
