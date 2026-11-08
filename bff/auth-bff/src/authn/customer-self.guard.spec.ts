/**
 * Customer account-center security regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { CustomerSelfGuard } from "./customer-self.guard";

// ============================================================================
// Browser and identity boundaries
// ============================================================================

function fixture(
  method = "GET",
  headers: Record<string, string> = {},
  status = "active",
) {
  const req = {
    method,
    cookies: { vx_sid: "customer-sid", vx_sid_op: "operator-sid" },
    get: (key: string) => headers[key],
    is: (type: string) => headers["content-type"] === type,
  };
  const realms = {
    requireCustomer: vi.fn(async () => ({
      user: { status },
      sid: "customer-sid",
      userId: "123",
    })),
  };
  const config = {
    auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
    platform: { LOGIN_UI_BASE_URL: "https://accounts.vxture.com" },
  };
  const guard = new CustomerSelfGuard(
    realms as never,
    new AccountsOriginGuard(config as never),
    { getAllAndOverride: () => false } as never,
  );
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, realms, guard, context };
}

describe("customer account-center request guard", () => {
  it("reads only the customer cookie", async () => {
    const f = fixture();
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.realms.requireCustomer).toHaveBeenCalledWith("customer-sid");
  });
  it("never falls back to the workforce cookie", async () => {
    const f = fixture();
    Reflect.deleteProperty(f.req.cookies, "vx_sid");
    await f.guard.canActivate(f.context);
    expect(f.realms.requireCustomer).toHaveBeenCalledWith(undefined);
  });
  it.each([
    "null",
    "https://evil.example",
    "https://accounts.vxture.com.evil.example",
    "https://console.vxture.com",
  ])("rejects an untrusted read origin %s", async (origin) => {
    const f = fixture("GET", { origin });
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "accounts_origin_forbidden",
    );
    expect(f.realms.requireCustomer).not.toHaveBeenCalled();
  });
  it.each(["PATCH", "DELETE"])("requires Origin on %s", async (method) => {
    const f = fixture(method);
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "accounts_origin_forbidden",
    );
  });
  it("rejects cross-site browser requests without Origin", async () => {
    const f = fixture("GET", {
      "sec-fetch-site": "cross-site",
    });
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "accounts_origin_forbidden",
    );
  });
  it("rejects form submissions", async () => {
    const f = fixture("PATCH", {
      origin: "https://accounts.vxture.com",
      "content-type": "text/plain",
    });
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "accounts_json_required",
    );
  });
  it("accepts a same-origin JSON mutation", async () => {
    const f = fixture("PATCH", {
      origin: "https://accounts.vxture.com",
      "content-type": "application/json",
    });
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it("rejects mutations for deleting accounts", async () => {
    const f = fixture(
      "DELETE",
      { origin: "https://accounts.vxture.com" },
      "deleting",
    );
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "customer_account_read_only",
    );
  });
  it("propagates authentication failure", async () => {
    const f = fixture();
    f.realms.requireCustomer.mockRejectedValueOnce(
      new Error("customer_session_required"),
    );
    await expect(f.guard.canActivate(f.context)).rejects.toThrow(
      "customer_session_required",
    );
  });
});
