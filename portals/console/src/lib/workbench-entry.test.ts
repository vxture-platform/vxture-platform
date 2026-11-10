/**
 * Cross-deployment URL regression for the Console header entry.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { expect, it } from "vitest";
import { buildWorkbenchEntry } from "./workbench-entry";
it("enters the target RP with exact source context and no forced prompt", () => {
  const context = { userId: "user", tenantId: "org", workspaceId: "workspace" };
  const url = new URL(buildWorkbenchEntry(context));
  expect(url.origin).toBe("https://ruyin.work");
  expect(url.pathname).toBe("/auth/login");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    ...context,
    surface: "portal",
    ui_locales: "zh-CN",
    returnTo: "https://ruyin.work/?vx_locale=zh-CN",
  });
});

it("carries English to the target callback across registrable domains", () => {
  const url = new URL(
    buildWorkbenchEntry(
      { userId: "user", tenantId: "org", workspaceId: "space" },
      undefined,
      "en-US",
    ),
  );
  expect(url.searchParams.get("returnTo")).toBe(
    "https://ruyin.work/?vx_locale=en-US",
  );
});
