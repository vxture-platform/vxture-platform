/**
 * Preserve the selected workspace when entering CoSpace through its OIDC entry.
 * @package @vxture/console
 * @layer Presentation
 * @category navigation
 * @author AI-Generated
 * @date 2026-11-13
 */
export function productEntryUrl(
  homeUrl: string | null | undefined,
  product: string,
  tenant: { id: string; workspace: string } | null,
): string | null {
  try {
    const url = new URL(homeUrl ?? "");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (product === "cospace" && tenant) {
      const returnTo = url.pathname + url.search + url.hash;
      url.pathname = "/auth/login";
      url.search = "";
      url.hash = "";
      url.searchParams.set("returnTo", returnTo);
      url.searchParams.set("tenant_hint", tenant.id);
      if (tenant.workspace !== "default")
        url.searchParams.set("workspace_hint", tenant.workspace);
    }
    return url.href;
  } catch {
    return null;
  }
}
