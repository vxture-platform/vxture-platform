/**
 * Account-center navigation for current and legacy entry points.
 * @package @vxture/console
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-11
 */
import { withLocalePreference } from "@vxture/platform-browser";
import type { Locale } from "@vxture-platform/shared";

const ACCOUNTS_BASE = (
  process.env.NEXT_PUBLIC_ACCOUNTS_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://accounts.vxture.com"
    : "http://localhost:3080")
)
  .trim()
  .replace(/\/+$/, "");

export type AccountSection = "security" | "devices" | "deletion";

export function accountCenterUrl(locale: string, section?: AccountSection) {
  const url = new URL(`${ACCOUNTS_BASE}/account`);
  if (section) url.searchParams.set("section", section);
  return withLocalePreference(url.toString(), locale as Locale);
}

export function legacyAccountSection(
  panel?: string,
): AccountSection | undefined {
  if (panel === "sessions" || panel === "history") return "devices";
  if (panel === "deletion") return "deletion";
  if (panel === "security") return "security";
  return undefined;
}
