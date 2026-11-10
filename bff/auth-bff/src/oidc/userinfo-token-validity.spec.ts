/**
 * UserInfo accepts only live, client-bound session access tokens.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import type { OidcCentralSession } from "../redis/redis.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Public UserInfo fixtures
// ============================================================================
function build(realm: "customer" | "workforce") {
  const workforce = realm === "workforce";
  const sub = workforce ? "opr_identity" : "usr_identity";
  const claims: Record<string, unknown> = {
    sub,
    aud: "client",
    sid: "session",
    jti: "token-id",
    roles: [],
    userType: workforce ? "operator" : "tenant_user",
    scope: "openid profile email",
  };
  const session: OidcCentralSession = {
    sub,
    realm,
    authMethod: workforce ? "password+totp" : "phone",
    authenticationVersion: "auth-v1",
    createdAt: 123,
    lastActiveAt: 123,
    absExpiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  const client = { clientId: "client", realm };
  const redis = {
    getOidcSession: vi.fn(
      async (): Promise<OidcCentralSession | null> => session,
    ),
    isBlacklisted: vi.fn(async () => false),
  };
  const customers = {
    updateProfile: vi.fn(async () => ({ language: "en-US" })),
    getUserById: vi.fn(async () => ({
      id: "identity",
      account: "Customer",
      name: "Customer",
      status: "active",
      language: "zh-CN",
      email: "customer@example.test",
      emailVerified: true,
    })),
  };
  const operators = {
    findById: vi.fn(
      async (): Promise<object | null> => ({
        id: "identity",
        username: "Operator",
        email: "operator@example.test",
        emailVerified: true,
        authenticationVersion: "auth-v1",
        mfaEnrolled: true,
        webauthnRequired: false,
      }),
    ),
  };
  const durableSession = {
    get: vi.fn(
      async (): Promise<object | null> => ({
        userId: "identity",
        realm: "customer",
      }),
    ),
  };
  const clients = {
    findEnabledByClientId: vi.fn(
      async (): Promise<typeof client | null> => client,
    ),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    keys: { verify: () => claims },
    redis,
    clients,
    operators,
    account: customers,
    durableSession,
    customerMfa: { enabled: async () => false },
  });
  return {
    service,
    claims,
    session,
    redis,
    customers,
    operators,
    clients,
    client,
    durableSession,
  };
}

// ============================================================================
// Purpose, revocation and realm boundaries
// ============================================================================
describe("Customer language preferences", () => {
  it("reads the current account language and persists only the authenticated identity", async () => {
    const f = build("customer");
    await expect(f.service.userinfo("access")).resolves.toHaveProperty(
      "language",
      "zh-CN",
    );
    await expect(
      f.service.updateLanguage("access", { language: "en-US" }),
    ).resolves.toEqual({ language: "en-US" });
    expect(f.customers.updateProfile).toHaveBeenCalledWith("identity", {
      language: "en-US",
    });
  });
  it.each([
    { language: "fr" },
    { language: "en-US", userId: "other" },
    null,
    {},
  ])("rejects invalid patches %j", async (patch) => {
    const f = build("customer");
    await expect(f.service.updateLanguage("access", patch)).rejects.toThrow(
      "invalid_language",
    );
    expect(f.customers.updateProfile).not.toHaveBeenCalled();
  });
  it("rejects workforce tokens and revoked customer sessions", async () => {
    const workforce = build("workforce");
    await expect(
      workforce.service.updateLanguage("access", { language: "en-US" }),
    ).rejects.toThrow("invalid_token");
    expect(workforce.customers.updateProfile).not.toHaveBeenCalled();
    const customer = build("customer");
    customer.redis.isBlacklisted.mockResolvedValue(true);
    await expect(
      customer.service.updateLanguage("access", { language: "en-US" }),
    ).rejects.toThrow("invalid_token");
    expect(customer.customers.updateProfile).not.toHaveBeenCalled();
  });
});

describe.each(["customer", "workforce"] as const)("%s UserInfo", (realm) => {
  it("returns its own identity through a live session", async () => {
    const f = build(realm);
    await expect(f.service.userinfo("access")).resolves.toHaveProperty(
      "sub",
      f.claims.sub,
    );
    expect(f.redis.isBlacklisted).toHaveBeenCalledWith("token-id");
    if (realm === "workforce") {
      expect(f.customers.getUserById).not.toHaveBeenCalled();
      expect(f.durableSession.get).not.toHaveBeenCalled();
    } else expect(f.operators.findById).not.toHaveBeenCalled();
  });

  it.each([
    { roles: undefined }, // ID tokens carry no access-token roles.
    { scope: undefined },
    { scope: "profile email" },
    { scope: "openid mgmt:atlas" },
    { stepup: true },
    { act: { sub: "product" } },
    { mode: "service" },
    { sub: "unknown_identity" },
    { sid: "" },
    { jti: "" },
    { aud: ["client"] },
    { userType: "unknown" },
  ])(
    "rejects the wrong token purpose or shape before profile reads: %j",
    async (patch) => {
      const f = build(realm);
      Object.assign(f.claims, patch);
      await expect(f.service.userinfo("wrong-purpose")).rejects.toThrow(
        "invalid_token",
      );
      expect(f.customers.getUserById).not.toHaveBeenCalled();
      expect(f.operators.findById).not.toHaveBeenCalled();
    },
  );

  it("rejects explicitly revoked access tokens before reading an identity", async () => {
    const f = build(realm);
    f.redis.isBlacklisted.mockResolvedValue(true);
    await expect(f.service.userinfo("revoked")).rejects.toThrow(
      "invalid_token",
    );
    expect(f.redis.getOidcSession).not.toHaveBeenCalled();
    expect(f.customers.getUserById).not.toHaveBeenCalled();
    expect(f.operators.findById).not.toHaveBeenCalled();
  });

  it("rejects a signed token after the central session has ended", async () => {
    const f = build(realm);
    f.redis.getOidcSession.mockResolvedValue(null);
    await expect(f.service.userinfo("stale")).rejects.toThrow("invalid_token");
  });

  it("rejects absolute session expiry", async () => {
    const f = build(realm);
    f.session.absExpiresAt = Math.floor(Date.now() / 1000);
    await expect(f.service.userinfo("expired-session")).rejects.toThrow(
      "invalid_token",
    );
  });

  it("rejects a client that has been disabled", async () => {
    const f = build(realm);
    f.clients.findEnabledByClientId.mockResolvedValue(null);
    await expect(f.service.userinfo("disabled-client")).rejects.toThrow(
      "invalid_token",
    );
    expect(f.redis.getOidcSession).not.toHaveBeenCalled();
  });

  it("rejects a client moved into the opposite identity domain", async () => {
    const f = build(realm);
    f.client.realm = realm === "customer" ? "workforce" : "customer";
    await expect(f.service.userinfo("crossed-client")).rejects.toThrow(
      "invalid_token",
    );
    expect(f.redis.getOidcSession).not.toHaveBeenCalled();
  });

  it("preserves service-failure semantics without releasing a profile", async () => {
    const f = build(realm);
    f.redis.isBlacklisted.mockRejectedValue(
      new ServiceUnavailableException("unavailable"),
    );
    await expect(f.service.userinfo("access")).rejects.toThrow("unavailable");
    expect(f.customers.getUserById).not.toHaveBeenCalled();
    expect(f.operators.findById).not.toHaveBeenCalled();
  });
});

it("rejects a customer token after durable revocation despite a surviving Redis session", async () => {
  const f = build("customer");
  f.durableSession.get.mockResolvedValue(null);
  await expect(f.service.userinfo("stale")).rejects.toThrow("invalid_token");
  expect(f.customers.getUserById).not.toHaveBeenCalled();
});
