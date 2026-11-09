/**
 * Customer account-center security regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { VxConfigService } from "@vxture/core-config";
import { RealmSessionService } from "../oidc/realm-session.service";
import { CustomerSelfService } from "../oidc/customer-self.service";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CustomerSelfRouter } from "./customer-self.router";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { CustomerSelfGuard } from "../authn/customer-self.guard";

describe("customer self route boundary", () => {
  it("protects every endpoint with the customer guard", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerSelfRouter)).toContain(
      CustomerSelfGuard,
    );
  });
  it.each([true, false])(
    "clears only the customer cookies when current=%s",
    async (current) => {
      const self = {
        revokeSession: vi.fn(async () => ({
          ok: true,
          revoked: true,
          current,
        })),
      };
      const config = { platform: { COOKIE_DOMAIN_PLATFORM: ".vxture.com" } };
      const router = new CustomerSelfRouter(self as never, config as never);
      const req = { customer: { sid: "current", userId: "123" } };
      const res = { clearCookie: vi.fn() };
      await router.revokeSession(req as never, "target", res as never);
      expect(self.revokeSession).toHaveBeenCalledWith(req.customer, "target");
      if (current) {
        expect(res.clearCookie.mock.calls).toEqual([
          ["vx_sid", { path: "/", domain: ".vxture.com" }],
          ["vx_hint", { path: "/", domain: ".vxture.com" }],
        ]);
      } else expect(res.clearCookie).not.toHaveBeenCalled();
    },
  );
});

// ============================================================================
// Real HTTP routing, guard wiring and cookie behavior
// ============================================================================

describe("customer account center over HTTP", () => {
  let app: import("@nestjs/common").INestApplication;
  let base: string;
  const realms = {
    requireCustomer: vi.fn(async (sid: string | undefined) => {
      if (sid !== "customer-sid")
        throw new UnauthorizedException("customer_session_required");
      return { sid, userId: "123", user: { status: "active" } };
    }),
  };
  const self = {
    getProfile: vi.fn(() => ({ id: "123", realm: "customer" })),
    updateProfile: vi.fn(async () => ({ id: "123", name: "New" })),
    getSecurity: vi.fn(async () => ({ phoneVerified: false })),
    getSessions: vi.fn(async () => [{ sid: "customer-sid", current: true }]),
    getLoginHistory: vi.fn(async () => []),
    revokeSession: vi.fn(async (_context: unknown, sid: string) => ({
      ok: true,
      revoked: true,
      current: sid === "customer-sid",
    })),
  };

  beforeAll(async () => {
    @Module({
      controllers: [CustomerSelfRouter],
      providers: [
        CustomerSelfGuard,
        AccountsOriginGuard,
        { provide: RealmSessionService, useValue: realms },
        { provide: CustomerSelfService, useValue: self },
        {
          provide: VxConfigService,
          useValue: {
            auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
            platform: {
              COOKIE_DOMAIN_PLATFORM: ".vxture.com",
              LOGIN_UI_BASE_URL: "https://accounts.vxture.com",
            },
          },
        },
      ],
    })
    class HttpTestModule {}
    app = await NestFactory.create(HttpTestModule, { logger: false });
    app.use(cookieParser());
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/oidc/customer/self`;
  });
  afterAll(async () => {
    await app?.close();
  });

  it("rejects a workforce-only browser with 401", async () => {
    const res = await fetch(base, {
      headers: { cookie: "vx_sid_op=operator-sid" },
    });
    expect(res.status).toBe(401);
  });
  it("returns customer data with no-store", async () => {
    const res = await fetch(base, {
      headers: { cookie: "vx_sid=customer-sid; vx_sid_op=operator-sid" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "123", realm: "customer" });
  });
  it("blocks credentialed reads from another origin", async () => {
    const res = await fetch(`${base}/security`, {
      headers: {
        cookie: "vx_sid=customer-sid",
        origin: "https://evil.example",
      },
    });
    expect(res.status).toBe(403);
  });
  it("blocks a mutation without Origin", async () => {
    const res = await fetch(base, {
      method: "PATCH",
      headers: {
        cookie: "vx_sid=customer-sid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(403);
  });
  it("accepts JSON profile updates from the accounts origin", async () => {
    const res = await fetch(base, {
      method: "PATCH",
      headers: {
        cookie: "vx_sid=customer-sid",
        origin: "https://accounts.vxture.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    expect(self.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "123" }),
      { name: "New" },
    );
  });
  it("serves activity routes through the authenticated context", async () => {
    for (const route of ["security", "sessions", "login-history"]) {
      const res = await fetch(`${base}/${route}`, {
        headers: { cookie: "vx_sid=customer-sid" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("returns location fields only through owned history and prevents workforce access", async () => {
    const response = await fetch(`${base}/login-history`, {
      headers: { cookie: "vx_sid=customer-sid; vx_sid_op=operator-sid" },
    });
    expect(response.status).toBe(200);
    expect(self.getLoginHistory).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "123" }),
    );
    const before = self.getLoginHistory.mock.calls.length;
    const denied = await fetch(`${base}/login-history`, {
      headers: { cookie: "vx_sid_op=operator-sid" },
    });
    expect(denied.status).toBe(401);
    expect(self.getLoginHistory).toHaveBeenCalledTimes(before);
  });
  it("clears parent-domain customer cookies when ending the current session", async () => {
    const res = await fetch(`${base}/sessions/customer-sid`, {
      method: "DELETE",
      headers: {
        cookie: "vx_sid=customer-sid; vx_sid_op=operator-sid",
        origin: "https://accounts.vxture.com",
      },
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("vx_sid=;");
    expect(cookies).toContain("vx_hint=;");
    expect(cookies).toContain("Domain=.vxture.com");
    expect(cookies).not.toContain("vx_sid_op");
  });
});
