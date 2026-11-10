/**
 * Locale routing regressions independent of the authentication decision.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@vxture/core-identity-sdk/edge", () => ({
  createAuthMiddleware: (options: {
    onAllow: (request: NextRequest) => NextResponse;
  }) => options.onAllow,
}));
vi.mock("next-intl/middleware", () => ({
  default: () => () => NextResponse.next(),
}));
import { middleware } from "./middleware";

it("follows the shared preference instead of a stale URL and preserves navigation context", async () => {
  const request = new NextRequest(
    "https://console.vxture.com/zh-CN/billing?tab=all",
    { headers: { cookie: "NEXT_LOCALE=en-US" } },
  );
  const response = await middleware(request);
  expect(response?.headers.get("location")).toBe(
    "https://console.vxture.com/en-US/billing?tab=all",
  );
});

it("accepts a cross-domain preference and removes the navigation hint", async () => {
  const request = new NextRequest(
    "https://console.vxture.com/en-US/billing?vx_locale=en-US&tab=all",
    { headers: { cookie: "NEXT_LOCALE=zh-CN" } },
  );
  const response = await middleware(request);
  expect(response?.headers.get("location")).toBe(
    "https://console.vxture.com/en-US/billing?tab=all",
  );
  expect(response?.headers.get("set-cookie")).toContain("NEXT_LOCALE=en-US");
  expect(response?.headers.get("set-cookie")).toContain("Domain=.vxture.com");
});

it("ignores unsupported language hints and proceeds normally", async () => {
  const request = new NextRequest(
    "https://console.vxture.com/en-US?vx_locale=unsupported",
  );
  const response = await middleware(request);
  expect(response?.headers.get("location")).toBeNull();
});

it("shares locale cookies when NextURL uses the internal proxy origin", async () => {
  const request = new NextRequest(
    "http://localhost:3000/en-US/signin?vx_locale=en-US",
    { headers: { host: "console.vxture.com", "x-forwarded-proto": "https" } },
  );
  const response = await middleware(request);
  const cookie = response?.headers.get("set-cookie");
  expect(cookie).toContain("NEXT_LOCALE=en-US");
  expect(cookie).toContain("Domain=.vxture.com");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("Max-Age=0");
});

it("keeps local development cookies on their own host", async () => {
  const request = new NextRequest(
    "http://localhost:3000/en-US/signin?vx_locale=en-US",
    { headers: { host: "localhost:3000" } },
  );
  const response = await middleware(request);
  expect(response?.headers.get("set-cookie")).not.toContain("Domain=");
});
