/**
 * Browser navigation into a separate OIDC portal; identifiers are hints, never credentials.
 * @package @vxture/console
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-05
 */
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
): string {
  const url = new URL("/auth/login", origin);
  url.searchParams.set("surface", "portal");
  for (const key of ["userId", "tenantId", "workspaceId"] as const)
    url.searchParams.set(key, context[key]);
  url.searchParams.set("returnTo", new URL("/", origin).href);
  return url.href;
}
