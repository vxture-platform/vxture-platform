/**
 * Customer security endpoint and persistence regression coverage.
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
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { RealmSessionService } from "../oidc/realm-session.service";
import { CustomerSecurityService } from "../oidc/customer-security.service";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { SocialAuthService } from "../oauth/social-auth.service";
import { CustomerSecurityRouter } from "./customer-security.router";

// ============================================================================
// HTTP routes, realm authorization and cookie behavior
// ============================================================================

describe("customer security HTTP endpoints", () => {
  let app: import("@nestjs/common").INestApplication;
  let base: string;
  const security = {
    start: vi.fn(async () => ({ challengeId: "proof" })),
    execute: vi.fn(async () => ({ ok: true, reauthenticate: true })),
  };
  const challenges = {
    verify: vi.fn(async () => ({ ok: true })),
    sendTarget: vi.fn(async () => ({ ok: true })),
  };
  const realms = {
    requireCustomer: vi.fn(async (sid?: string) => {
      if (sid !== "customer")
        throw new UnauthorizedException("customer_session_required");
      return { sid, userId: "123", user: { status: "active" } };
    }),
  };
  beforeAll(async () => {
    @Module({
      controllers: [CustomerSecurityRouter],
      providers: [
        { provide: SocialAuthService, useValue: {} },
        CustomerSelfGuard,
        AccountsOriginGuard,
        { provide: RealmSessionService, useValue: realms },
        { provide: CustomerSecurityService, useValue: security },
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
    base = (await app.getUrl()) + "/oidc/customer/self/security";
  });
  afterAll(async () => {
    await app?.close();
  });
  function post(
    path: string,
    cookie = "vx_sid=customer; vx_sid_op=operator",
    origin = "https://accounts.vxture.com",
    body: unknown = {},
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  it.each([
    "/challenges",
    "/challenges/proof/verify",
    "/challenges/proof/target",
    "/challenges/proof/target/verify",
    "/challenges/proof/execute",
  ])("rejects workforce-only credentials on %s", async (path) => {
    expect((await post(path, "vx_sid_op=operator")).status).toBe(401);
  });
  it("blocks an untrusted mutation origin", async () => {
    expect(
      (
        await post(
          "/challenges",
          "vx_sid=customer",
          "https://console.vxture.com",
        )
      ).status,
    ).toBe(403);
  });
  it("starts only through the authenticated customer context", async () => {
    const res = await post("/challenges", undefined, undefined, {
      operation: "password",
      method: "phone",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(security.start).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "123" }),
      { operation: "password", method: "phone" },
    );
  });
  it("separates anchor and target verification routes", async () => {
    await post("/challenges/proof/verify", undefined, undefined, {
      code: "123456",
    });
    expect(challenges.verify).toHaveBeenLastCalledWith(
      expect.any(Object),
      "proof",
      "123456",
    );
    await post("/challenges/proof/target");
    expect(challenges.sendTarget).toHaveBeenCalledWith(
      expect.any(Object),
      "proof",
    );
    await post("/challenges/proof/target/verify", undefined, undefined, {
      code: "654321",
    });
    expect(challenges.verify).toHaveBeenLastCalledWith(
      expect.any(Object),
      "proof",
      "654321",
      true,
    );
  });
  it("clears customer cookies after a committed operation without affecting workforce", async () => {
    const res = await post("/challenges/proof/execute");
    expect(res.status).toBe(200);
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("vx_sid=;");
    expect(cookies).toContain("vx_hint=;");
    expect(cookies).toContain("Domain=.vxture.com");
    expect(cookies).not.toContain("vx_sid_op");
  });
  it("keeps customer cookies after a username-only change", async () => {
    security.execute.mockResolvedValueOnce({ ok: true, reauthenticate: false });
    const res = await post("/challenges/proof/execute");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
