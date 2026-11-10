/**
 * Browser navigation into a separate OIDC portal; identifiers are hints, never credentials.
 * @package @vxture/console
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-05
 */
import { DEFAULT_LOCALE, type Locale } from "@vxture-platform/shared";
import { withLocalePreference } from "@vxture/platform-browser";

interface PortalContext {
  userId: string;
  tenantId: string;
  workspaceId: string;
}

/**
 * Build a top-level RP login that reuses central SSO and checks the exact scope.
 * @param context - Current Console session identifiers.
 * @param origin - Target portal origin.
 * @returns A URL containing no tokens or session handles.
 */
export function buildWorkbenchEntry(
  context: PortalContext,
  origin = "https://ruyin.work",
  locale: Locale = DEFAULT_LOCALE,
): string {
  const url = new URL("/auth/login", origin);
  url.searchParams.set("surface", "portal");
  url.searchParams.set("ui_locales", locale);
  for (const key of ["userId", "tenantId", "workspaceId"] as const)
    url.searchParams.set(key, context[key]);
  url.searchParams.set(
    "returnTo",
    withLocalePreference(new URL("/", origin).href, locale),
  );
  return url.href;
}
