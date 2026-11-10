/**
 * Browser navigation into a separate OIDC portal; identifiers are hints, never credentials.
 * @package @vxture/workbench
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-05
 */
import { withLocalePreference } from "@vxture/platform-browser";
import { DEFAULT_LOCALE, type Locale } from "@vxture-platform/shared";
import type { WorkData } from "./contracts";

/**
 * Enter Console through its own OIDC RP rather than relying on a cross-site cookie.
 * @param data - Current authenticated workbench identity and scope.
 * @param origin - Configured Console origin.
 * @param path - Console destination relative to the selected locale root.
 * @returns A browser URL carrying only identifiers and an allowlisted destination.
 */
export function buildConsoleEntry(
  data: WorkData,
  origin: string,
  path = "",
  locale: Locale = DEFAULT_LOCALE,
): string {
  const url = new URL("/auth/login", origin);
  url.searchParams.set("surface", "portal");
  url.searchParams.set("ui_locales", locale);
  url.searchParams.set("userId", data.user.id);
  url.searchParams.set("tenantId", data.scope.id);
  url.searchParams.set("workspaceId", data.scope.workspace);
  url.searchParams.set(
    "returnTo",
    withLocalePreference(new URL(`/${locale}/${path}`, origin).href, locale),
  );
  return url.href;
}

/**
 * Resolve notification destinations only inside known Console business routes.
 * @param data - Current authenticated identity and scope.
 * @param origin - Configured Console origin.
 * @param link - Untrusted message destination.
 * @returns An OIDC entry preserving context, falling back to the inbox.
 */
export function notificationEntry(
  data: WorkData,
  origin: string,
  link: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  let path = "inbox";
  try {
    const target = new URL(link ?? "/inbox", origin);
    const relative = target.pathname.replace(/^\/(?:zh-CN|en-US)\//, "/");
    if (
      target.origin === new URL(origin).origin &&
      !target.username &&
      !target.password &&
      /^\/(?:inbox|billing|subscription|subscribe|quotas|tickets|members|invitations|accept-invitation|tenant|profile|vouchers|usage)(?:\/|$)/.test(
        relative,
      )
    ) {
      path = relative.slice(1) + target.search + target.hash;
    }
  } catch {
    /* Invalid message links return to the authenticated inbox. */
  }
  return buildConsoleEntry(data, origin, path, locale);
}
