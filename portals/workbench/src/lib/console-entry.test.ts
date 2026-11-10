/**
 * Scope-carrying Console links must enter the target RP before visiting a page.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { expect, it } from "vitest";
import { buildConsoleEntry, notificationEntry } from "./console-entry";
import type { WorkData } from "./contracts";
it("preserves identity, organization, workspace and the Console destination", () => {
  const data: WorkData = {
    user: { id: "user", name: "User", email: "", phone: "", picture: null },
    scope: {
      id: "org",
      name: "Org",
      workspace: "space",
      workspaceName: "Space",
      personal: false,
    },
    catalog: { status: "ready", data: [] },
    scopeOptions: { status: "ready", data: [] },
    workspaces: { status: "ready", data: [] },
    availabilityIssue: null,
    resources: { status: "error", code: 503, message: "Unavailable" },
    balance: { status: "ready", data: "0" },
    monthlyBill: { status: "ready", data: "0" },
  };
  for (const unsafe of [
    "https://evil.invalid/billing",
    "javascript:alert(1)",
    "/auth/logout",
    "/../auth/logout",
    "https://console.vxture.com.evil.invalid/inbox",
  ]) {
    expect(
      new URL(
        notificationEntry(data, "https://console.vxture.com", unsafe),
      ).searchParams.get("returnTo"),
    ).toBe("https://console.vxture.com/zh-CN/inbox?vx_locale=zh-CN");
  }
  expect(
    new URL(
      notificationEntry(
        data,
        "https://console.vxture.com",
        "/zh-CN/billing?tab=unpaid",
      ),
    ).searchParams.get("returnTo"),
  ).toBe("https://console.vxture.com/zh-CN/billing?tab=unpaid&vx_locale=zh-CN");
  const url = new URL(
    buildConsoleEntry(data, "https://console.vxture.com", "billing"),
  );
  expect(url.origin).toBe("https://console.vxture.com");
  expect(url.pathname).toBe("/auth/login");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    userId: "user",
    tenantId: "org",
    workspaceId: "space",
    surface: "portal",
    ui_locales: "zh-CN",
    returnTo: "https://console.vxture.com/zh-CN/billing?vx_locale=zh-CN",
  });
});
