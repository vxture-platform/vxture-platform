/**
 * Revocation HTTP authentication and client/domain isolation regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OidcService } from "../oidc/oidc.service";
import { TokenService } from "../token/token.service";
import { AllExceptionsFilter } from "../filters/all-exceptions.filter";
import { OidcRouter } from "./oidc.router";

// ============================================================================
// Real routing and orchestration; only authority/storage boundaries are doubles.
// ============================================================================
function store() {
  return {
    findByHash: vi.fn(
      async (): Promise<{ clientId: string; sessionId: string } | null> => ({
        clientId: "customer",
        sessionId: "session",
      }),
    ),
    revokeSession: vi.fn(async () => {}),
  };
}
const customer = store();
const workforce = store();
const config = (id: string) => ({
  clientId: id,
  realm: id === "workforce" ? "workforce" : "customer",
  tokenEndpointAuthMethod: id === "public" ? "none" : "client_secret_basic",
});
const clients = {
  findEnabledByClientId: vi.fn(async (id: string) =>
    ["customer", "workforce", "public"].includes(id) ? config(id) : null,
  ),
  authenticateClient: vi.fn(async (id: string, secret: string) =>
    secret === "secret" ? config(id) : null,
  ),
};
let claims: Record<string, unknown>;
const keys = {
  verify: vi.fn((raw: string) => {
    if (raw !== "jwt") throw new Error("not JWT");
    return claims;
  }),
};
const redis = { addToBlacklist: vi.fn(async () => {}) };
const token = new TokenService(
  keys as never,
  customer as never,
  workforce as never,
  {} as never,
);
const service = Object.assign(
  Object.create(OidcService.prototype) as OidcService,
  { clients, token, keys, redis },
);
@Module({
  controllers: [OidcRouter],
  providers: [
    { provide: OidcService, useValue: service },
    { provide: VxConfigService, useValue: {} },
  ],
})
class RevocationTestModule {}
let app: INestApplication;
let base: string;
const basic = (id = "customer", secret = "secret") =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const post = (body: unknown, authorization: string | null = basic()) =>
  fetch(`${base}/oidc/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization === null ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  app = await NestFactory.create(RevocationTestModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  customer.findByHash
    .mockReset()
    .mockResolvedValue({ clientId: "customer", sessionId: "session" });
  workforce.findByHash
    .mockReset()
    .mockResolvedValue({ clientId: "workforce", sessionId: "admin-session" });
  redis.addToBlacklist.mockReset().mockResolvedValue();
  claims = {
    sub: "usr_identity",
    aud: "customer",
    userType: "tenant_user",
    sid: "session",
    jti: "jti",
    roles: [],
    scope: "openid",
    exp: Math.floor(Date.now() / 1000) + 300,
  };
});

// ============================================================================
// Authentication, ownership and failure semantics
// ============================================================================
describe("revocation HTTP", () => {
  it.each([
    null,
    "Bearer token",
    "Basic !!!",
    basic("customer", "wrong"),
    basic("unknown"),
  ])("rejects missing or invalid client auth: %s", async (auth) => {
    const response = await post({ token: "raw" }, auth);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Basic realm="accounts"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(customer.findByHash).not.toHaveBeenCalled();
    expect(workforce.findByHash).not.toHaveBeenCalled();
  });
  it.each([{}, { token: 3 }, { token: "raw", token_type_hint: [] }])(
    "rejects malformed token request %j",
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(customer.findByHash).not.toHaveBeenCalled();
    },
  );
  it.each(["customer", "workforce"])(
    "revokes only its own client family in the %s store",
    async (realm) => {
      const response = await post(
        { token: "raw", token_type_hint: "refresh_token" },
        basic(realm),
      );
      expect(response.status).toBe(200);
      const own = realm === "customer" ? customer : workforce;
      const other = realm === "customer" ? workforce : customer;
      expect(own.revokeSession).toHaveBeenCalledWith(
        realm === "customer" ? "session" : "admin-session",
        realm,
      );
      expect(other.findByHash).not.toHaveBeenCalled();
      expect(other.revokeSession).not.toHaveBeenCalled();
    },
  );
  it("never searches the opposite domain for an unknown refresh token", async () => {
    customer.findByHash.mockResolvedValue(null);
    expect((await post({ token: "operator-raw" })).status).toBe(200);
    expect(workforce.findByHash).not.toHaveBeenCalled();
    expect(customer.revokeSession).not.toHaveBeenCalled();
  });
  it("does not revoke another client's chain within the same domain", async () => {
    customer.findByHash.mockResolvedValue({
      clientId: "other",
      sessionId: "shared-session",
    });
    expect((await post({ token: "raw" })).status).toBe(200);
    expect(customer.revokeSession).not.toHaveBeenCalled();
  });
  it("accepts body credentials and public client ownership", async () => {
    expect(
      (
        await post(
          { client_id: "customer", client_secret: "secret", token: "raw" },
          null,
        )
      ).status,
    ).toBe(200);
    customer.findByHash.mockResolvedValue({
      clientId: "public",
      sessionId: "public-session",
    });
    expect(
      (await post({ client_id: "public", token: "raw" }, null)).status,
    ).toBe(200);
    expect(customer.revokeSession).toHaveBeenLastCalledWith(
      "public-session",
      "public",
    );
    expect(workforce.findByHash).not.toHaveBeenCalled();
  });
  it.each([null, 3, [], {}])(
    "rejects malformed body credentials without storage effects: %j",
    async (secret) => {
      expect(
        (
          await post(
            { client_id: "public", client_secret: secret, token: "raw" },
            null,
          )
        ).status,
      ).toBe(401);
      expect(customer.findByHash).not.toHaveBeenCalled();
      expect(workforce.findByHash).not.toHaveBeenCalled();
    },
  );
  it("blacklists its own access token", async () => {
    expect((await post({ token: "jwt" })).status).toBe(200);
    expect(redis.addToBlacklist).toHaveBeenCalledWith(
      "jti",
      expect.any(Number),
    );
    expect(customer.findByHash).not.toHaveBeenCalled();
  });
  it.each([
    { aud: "other" },
    { sub: "opr_identity" },
    { userType: "operator" },
    { roles: undefined },
    { stepup: true },
    { act: {} },
    { mode: "service" },
    { sid: undefined },
  ])(
    "does not revoke foreign or non-session access tokens %j",
    async (patch) => {
      Object.assign(claims, patch);
      expect((await post({ token: "jwt" })).status).toBe(200);
      expect(redis.addToBlacklist).not.toHaveBeenCalled();
      expect(customer.findByHash).not.toHaveBeenCalled();
      expect(workforce.findByHash).not.toHaveBeenCalled();
    },
  );
  it("preserves blacklist failure instead of falling into refresh revocation", async () => {
    redis.addToBlacklist.mockRejectedValue(new Error("offline"));
    expect((await post({ token: "jwt" })).status).toBe(500);
    expect(customer.findByHash).not.toHaveBeenCalled();
  });
  it("prevents caching UserInfo errors", async () => {
    const response = await fetch(`${base}/oidc/userinfo`);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
