/**
 * Customer MFA removal HTTP authorization and logout regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-09
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BadRequestException,
  Module,
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AccountService } from "@vxture/service-account";
import { VxConfigService } from "@vxture/core-config";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
import { CustomerSelfGuard } from "../authn/customer-self.guard";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { CustomerMfaService } from "../oidc/customer-mfa.service";
import { OidcService } from "../oidc/oidc.service";
import { RealmSessionService } from "../oidc/realm-session.service";
import { CustomerMfaRouter } from "./customer-mfa.router";

// ============================================================================
// Real guards and routing, with deterministic external collaborators.
// ============================================================================
describe("customer MFA removal endpoints", () => {
  let app: import("@nestjs/common").INestApplication;
  let base: string;
  const mfa = {
    disable: vi.fn(async () => ({ ok: true, reauthenticate: true })),
  };
  const accounts = {
    listSessions: vi.fn(async () => [{ sid: "one" }, { sid: "two" }]),
  };
  const oidc = { cleanupCustomerSessions: vi.fn(async () => {}) };
  const realms = {
    requireCustomer: vi.fn(async (sid?: string) => {
      if (sid !== "customer")
        throw new UnauthorizedException("customer_session_required");
      return { sid, userId: "customer-id", user: { status: "active" } };
    }),
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });
  beforeAll(async () => {
    @Module({
      controllers: [CustomerMfaRouter],
      providers: [
        CustomerSelfGuard,
        AccountsOriginGuard,
        { provide: RealmSessionService, useValue: realms },
        { provide: CustomerMfaService, useValue: mfa },
        { provide: CustomerSecurityChallengeService, useValue: {} },
        { provide: AccountService, useValue: accounts },
        { provide: OidcService, useValue: oidc },
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
    base = (await app.getUrl()) + "/oidc/customer/self/mfa/disable";
  });
  afterAll(async () => {
    await app?.close();
  });
  function post(
    body: unknown,
    cookie = "vx_sid=customer; vx_sid_op=operator",
    origin = "https://accounts.vxture.com",
  ) {
    return fetch(base, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  it("uses only the guarded customer, clears customer cookies and propagates logout", async () => {
    const response = await post({
      method: "totp",
      code: "123456",
      userId: "attacker",
      sid: "other",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      reauthenticate: true,
      logoutPropagationPending: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mfa.disable).toHaveBeenCalledWith(
      "customer-id",
      "customer",
      "totp",
      "123456",
    );
    expect(oidc.cleanupCustomerSessions).toHaveBeenCalledWith("customer-id", [
      "one",
      "two",
    ]);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("vx_sid=");
    expect(cookies).not.toContain("vx_sid_op");
  });
  it("accepts a recovery code without treating it as a password", async () => {
    expect(
      (await post({ method: "recovery", code: " AB12-CD34 " })).status,
    ).toBe(200);
    expect(mfa.disable).toHaveBeenCalledWith(
      "customer-id",
      "customer",
      "recovery",
      "AB12-CD34",
    );
  });
  it.each([
    { method: "password", code: "123456" },
    { method: "totp", code: "" },
    { method: "totp", code: 123456 },
    { method: "recovery", code: "a".repeat(129) },
    {},
  ])("rejects malformed proofs before reading sessions", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mfa.disable).not.toHaveBeenCalled();
    expect(accounts.listSessions).not.toHaveBeenCalled();
  });
  it("rejects a workforce-only session and an untrusted origin", async () => {
    expect(
      (await post({ method: "totp", code: "123456" }, "vx_sid_op=operator"))
        .status,
    ).toBe(401);
    expect(
      (
        await post(
          { method: "totp", code: "123456" },
          undefined,
          "https://example.com",
        )
      ).status,
    ).toBe(403);
    expect(mfa.disable).not.toHaveBeenCalled();
  });
  it("does not clear cookies or propagate logout when factor proof fails", async () => {
    mfa.disable.mockRejectedValueOnce(new BadRequestException("invalid_code"));
    const response = await post({ method: "totp", code: "123456" });
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(oidc.cleanupCustomerSessions).not.toHaveBeenCalled();
  });
  it("does not report durable removal as failed when back-channel delivery is unavailable", async () => {
    oidc.cleanupCustomerSessions.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const response = await post({ method: "totp", code: "123456" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      logoutPropagationPending: true,
    });
  });
});
