/**
 * Account-center boundary regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { AccountsOriginGuard } from "./accounts-origin.guard";

function check(
  origin?: string,
  method = "POST",
  type = "application/json",
  site?: string,
  raw = false,
) {
  const config = {
    auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
    platform: { LOGIN_UI_BASE_URL: "http://localhost:3080" },
  };
  const req = {
    method,
    get: (key: string) => ({ origin, "sec-fetch-site": site })[key],
    is: (value: string) => type === value,
  };
  return () =>
    new AccountsOriginGuard(config as never).assertRequest(req as never, raw);
}

describe("configured account-center browser boundary", () => {
  it.each(["https://accounts.vxture.com", "http://localhost:3080"])(
    "accepts the configured exact origin %s",
    (origin) => {
      expect(check(origin)).not.toThrow();
    },
  );
  it.each([
    "null",
    "https://console.vxture.com",
    "https://accounts.vxture.com.evil.test",
    "http://localhost:3089",
    undefined,
  ])("rejects untrusted mutation origins %s", (origin) =>
    expect(check(origin)).toThrow("accounts_origin_forbidden"),
  );
  it("does not promote general CORS origins to account-center authority", () => {
    vi.stubEnv("ALLOWED_ORIGIN", "https://console.vxture.com");
    try {
      expect(check("https://console.vxture.com")).toThrow(
        "accounts_origin_forbidden",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("allows configured cross-site UI origins", () => {
    expect(
      check("http://localhost:3080", "POST", "application/json", "cross-site"),
    ).not.toThrow();
  });
  it("blocks cross-site reads lacking Origin", () => {
    expect(check(undefined, "GET", "", "cross-site")).toThrow(
      "accounts_origin_forbidden",
    );
  });
  it("allows same-origin reads without Origin", () =>
    expect(check(undefined, "GET")).not.toThrow());
  it("rejects form bodies", () =>
    expect(check("https://accounts.vxture.com", "POST", "text/plain")).toThrow(
      "accounts_json_required",
    ));
  it("allows bodyless deletion", () =>
    expect(check("https://accounts.vxture.com", "DELETE", "")).not.toThrow());
  it("permits raw bytes only for a server-selected upload", () => {
    expect(
      check("https://accounts.vxture.com", "PUT", "image/png", undefined, true),
    ).not.toThrow();
    expect(
      check("https://evil.test", "PUT", "image/png", undefined, true),
    ).toThrow("accounts_origin_forbidden");
  });
});
