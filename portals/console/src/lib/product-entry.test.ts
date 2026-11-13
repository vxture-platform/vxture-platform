/**
 * Product entry context regressions.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { describe, expect, it } from "vitest";
import { productEntryUrl } from "./product-entry";
const tenant = { id: "organization", workspace: "workspace" };
describe("productEntryUrl", () => {
  it("sends the selected context via CoSpace login and preserves the registered destination", () => {
    const url = new URL(
      productEntryUrl(
        "https://cospace.example/services?view=all",
        "cospace",
        tenant,
      )!,
    );
    expect(url.pathname).toBe("/auth/login");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      returnTo: "/services?view=all",
      tenant_hint: "organization",
      workspace_hint: "workspace",
    });
  });
  it("preserves other products and omits unresolved workspace hints", () => {
    expect(productEntryUrl("https://example.com/path", "other", tenant)).toBe(
      "https://example.com/path",
    );
    expect(
      productEntryUrl("https://example.com", "cospace", {
        ...tenant,
        workspace: "default",
      }),
    ).not.toContain("workspace_hint");
  });
  it.each(["javascript:alert(1)", "https://user:pass@example.com", "", null])(
    "rejects invalid entries %s",
    (url) => {
      expect(productEntryUrl(url, "cospace", tenant)).toBeNull();
    },
  );
});
