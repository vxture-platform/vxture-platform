/**
 * Accounts stream origin, realm, outage and handshake-race boundaries over HTTP.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import {
  Module,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { VxConfigService } from "@vxture/core-config";
import { AccountsEventsRouter } from "./accounts-events.router";
import { CentralEventsHub } from "../authn/central-events.hub";
import { SessionService } from "../authn/session.service";
import { RealmSessionService } from "../oidc/realm-session.service";
const customer = vi.fn(),
  operator = vi.fn(),
  durable = vi.fn(),
  unsubscribe = vi.fn();
let onSubscribe: () => void = () => undefined;
const subscribe = vi.fn(async () => {
  onSubscribe();
  return unsubscribe;
});
let app: INestApplication, base: string;
@Module({
  controllers: [AccountsEventsRouter],
  providers: [
    {
      provide: VxConfigService,
      useValue: {
        auth: { OIDC_ISSUER: "https://accounts.test" },
        platform: { LOGIN_UI_BASE_URL: "https://accounts.test" },
      },
    },
    { provide: CentralEventsHub, useValue: { subscribe } },
    { provide: SessionService, useValue: { get: durable } },
    {
      provide: RealmSessionService,
      useValue: { requireCustomer: customer, requireOperator: operator },
    },
  ],
})
class TestModule {}
const request = (query: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/oidc/session-events${query}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      cookie: "vx_sid=customer-sid; vx_sid_op=operator-sid",
      ...headers,
    },
  });
beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
beforeEach(() => {
  vi.stubEnv("ACCOUNTS_SESSION_EVENTS_ENABLED", "true");
  vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "true");
  vi.clearAllMocks();
  onSubscribe = () => undefined;
  customer.mockResolvedValue({ userId: "customer" });
  operator.mockResolvedValue("operator");
  durable.mockImplementation(async (sid: string) => ({
    userId: sid.startsWith("operator") ? "operator" : "customer",
    realm: sid.startsWith("operator") ? "workforce" : "customer",
    expiresAt: new Date(Date.now() + 60000),
  }));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await app.close();
});

// ============================================================================
// A successful handshake proves a fresh view, never authorization from hints.
// ============================================================================
it("rejects query identities and foreign browser origins before opening a stream", async () => {
  expect((await request("?realm=customer&sid=attacker")).status).toBe(400);
  expect(
    (await request("?realm=customer", { "sec-fetch-site": "same-site" }))
      .status,
  ).toBe(403);
  expect(
    (await request("?realm=customer", { origin: "https://other.test" })).status,
  ).toBe(403);
  expect(subscribe).not.toHaveBeenCalled();
});
it.each(["customer", "workforce"])(
  "authenticates only the %s cookie and sends no credentials",
  async (realm) => {
    const response = await request(`?realm=${realm}`, {
      origin: "https://accounts.test",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vxture-session-sync")).toBe("events-v1");
    const reader = response.body!.getReader();
    const part = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(part.value);
    expect(frame).toContain('"reason":"connected"');
    expect(frame).not.toContain("sid");
    expect(realm === "workforce" ? operator : customer).toHaveBeenCalledWith(
      realm === "workforce" ? "operator-sid" : "customer-sid",
    );
    expect(realm === "workforce" ? customer : operator).not.toHaveBeenCalled();
  },
);
it("refuses a session revoked between subscription and final verification", async () => {
  onSubscribe = () => customer.mockRejectedValue(new UnauthorizedException());
  expect((await request("?realm=customer")).status).toBe(401);
  expect(unsubscribe).toHaveBeenCalled();
});
it("keeps outages distinct from logout and requires explicit workforce enablement", async () => {
  customer.mockRejectedValueOnce(new Error("database offline"));
  expect((await request("?realm=customer")).status).toBe(503);
  customer.mockRejectedValue(new ServiceUnavailableException());
  expect((await request("?realm=customer")).status).toBe(503);
  vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "false");
  expect((await request("?realm=workforce")).status).toBe(204);
  expect(operator).not.toHaveBeenCalled();
});
