/**
 * Lifecycle HTTP identity, CSRF and recovery boundaries.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import {
  Module,
  UnauthorizedException,
  type INestApplication,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { VxConfigService } from "@vxture/core-config";
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { RealmSessionService } from "../oidc/realm-session.service";
import { CustomerLifecycleService } from "../oidc/customer-lifecycle.service";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { CustomerLifecycleRouter } from "./customer-lifecycle.router";

// ============================================================================
// Real Nest routes and guards; only domain adapters are replaced
// ============================================================================

describe("customer lifecycle HTTP boundary", () => {
  let app: INestApplication;
  let base: string;
  let status = "active";
  const lifecycle = {
    view: vi.fn(async () => ({ status })),
    start: vi.fn(async () => ({ challengeId: "proof" })),
    request: vi.fn(async () => ({ status: "deleting", cleanupPending: true })),
    recover: vi.fn(async () => ({ status: "active" })),
  };
  const challenges = { verify: vi.fn(async () => ({ ok: true })) };
  beforeAll(async () => {
    @Module({
      controllers: [CustomerLifecycleRouter],
      providers: [
        CustomerSelfGuard,
        AccountsOriginGuard,
        {
          provide: RealmSessionService,
          useValue: {
            requireCustomer: async (sid?: string) => {
              if (sid !== "customer")
                throw new UnauthorizedException("customer_session_required");
              return { sid, userId: "user", user: { status } };
            },
          },
        },
        { provide: CustomerLifecycleService, useValue: lifecycle },
        { provide: CustomerSecurityChallengeService, useValue: challenges },
        {
          provide: VxConfigService,
          useValue: {
            auth: { OIDC_ISSUER: "https://accounts.vxture.com" },
            platform: {
              LOGIN_UI_BASE_URL: "https://accounts.vxture.com",
              COOKIE_DOMAIN_PLATFORM: ".vxture.com",
            },
          },
        },
      ],
    })
    class HttpModule {}
    app = await NestFactory.create(HttpModule, { logger: false });
    app.use(cookieParser());
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()) + "/oidc/customer/self/deletion";
  });
  afterAll(async () => {
    await app?.close();
  });
  function post(
    path: string,
    cookie = "vx_sid=customer; vx_sid_op=operator",
    origin = "https://accounts.vxture.com",
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({
        method: "email",
        challengeId: "proof",
        acknowledged: true,
        code: "123456",
      }),
    });
  }
  it("requires the customer cookie even when workforce is authenticated", async () => {
    status = "active";
    expect((await post("", "vx_sid_op=operator")).status).toBe(401);
  });
  it("rejects cross-origin lifecycle writes", async () => {
    expect(
      (await post("", "vx_sid=customer", "https://console.vxture.com")).status,
    ).toBe(403);
  });
  it("clears only customer cookies after the committed request", async () => {
    status = "active";
    const response = await post("");
    expect(response.status).toBe(200);
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("vx_sid=");
    expect(cookies).toContain("vx_hint=");
    expect(cookies).not.toContain("vx_sid_op");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["/challenges", "/challenges/proof/verify", ""])(
    "blocks ordinary deleting mutations at %s",
    async (path) => {
      status = "deleting";
      expect((await post(path)).status).toBe(403);
    },
  );
  it.each([
    "/recovery/challenges",
    "/recovery/challenges/proof/verify",
    "/cancel",
  ])("allows only marked recovery handlers at %s", async (path) => {
    status = "deleting";
    expect((await post(path)).status).toBe(200);
  });
  it("keeps no-store on lifecycle reads without tenant context", async () => {
    const response = await fetch(base, {
      headers: {
        cookie: "vx_sid=customer",
        origin: "https://accounts.vxture.com",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
