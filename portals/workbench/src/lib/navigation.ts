/**
 * Top-level RP transitions; no browser token or simulated scope mutation.
 * @package @vxture/workbench
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-05
 */

/**
 * Build an RP transition with the current trusted browser origin as return target.
 * @param action - Supported RP operation.
 * @param currentUrl - Current browser URL.
 * @param parameters - Optional tenant or workspace identifier.
 * @returns A same-origin navigation path.
 */
export function authNavigation(
  action: "login" | "switch" | "logout" | "switch-tenant" | "switch-workspace",
  currentUrl: string,
  parameters: Record<string, string> = {},
): string {
  const current = new URL(currentUrl);
  const target = new URL(`/auth/${action}`, current.origin);
  if (action !== "logout")
    target.searchParams.set(
      "returnTo",
      `${current.origin}${current.pathname}${current.hash}`,
    );
  for (const [key, value] of Object.entries(parameters)) {
    if (
      ((key === "tenantId" || key === "workspaceId") && value) ||
      (action === "login" && key === "prompt" && value === "none")
    )
      target.searchParams.set(key, value);
  }
  return `${target.pathname}${target.search}`;
}
