/**
 * Customer login and logout must cross the durable boundary before success.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Use the public client-registration contract.
import type { OidcClientConfig } from "@vxture/service-iam";
import { OidcService } from "./oidc.service";
import { logoutTestStore } from "./logout-test-store";

// ============================================================================
// Public orchestration with failing persistence boundaries
// ============================================================================

function fixture() {
  const client = { clientId: "product", realm: "customer" } as OidcClientConfig;
  const challenge = {
    clientId: "product",
    realm: "customer",
    redirectUri: "https://app.example/callback",
    scope: "openid",
    codeChallenge: "proof",
  };
  const durableSession = {
    create: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    bindClient: vi.fn(async () => {}),
    getContext: vi.fn(async () => null),
    customerOwner: vi.fn(async () => "user"),
    getClients: vi.fn(async () => ["product"]),
  };
  const redis = {
    consumeOidcLoginChallenge: vi.fn(async () => challenge),
    createOidcSession: vi.fn(async () => {}),
    deleteOidcSession: vi.fn(async () => {}),
    storeOidcAuthCode: vi.fn(async () => {}),
    addOidcSessionClient: vi.fn(async () => {}),
  };
  const token = { revokeSession: vi.fn(async () => {}) };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    redis,
    durableSession,
    token,
    clients: { findEnabledByClientId: vi.fn(async () => client) },
    customerMfa: { enabled: async () => false },
    activeContext: { resolveActiveContext: async () => null },
    onboarding: { ensureOnboarded: async () => {} },
    account: { isProfileCompleted: async () => true },
    recordTenantAttempt: vi.fn(async () => {}),
    config: {
      auth: { OIDC_SESSION_ABS_TTL: 3600 },
      platform: { WEBSITE_BASE_URL: "https://vxture.com" },
    },
    logger: { error: vi.fn() },
  });
  return {
    service,
    redis,
    durableSession,
    token,
    client,
    login: () => service.completeLoginWithUser("challenge", "user", "oauth"),
  };
}

describe("customer durable commit boundary", () => {
  it("never creates a cache session or authorization code when durable creation fails", async () => {
    const f = fixture();
    f.durableSession.create.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(f.login()).rejects.toThrow("database unavailable");
    expect(f.redis.createOidcSession).not.toHaveBeenCalled();
    expect(f.redis.storeOidcAuthCode).not.toHaveBeenCalled();
  });

  it("revokes the durable session if Redis setup fails", async () => {
    const f = fixture();
    f.redis.createOidcSession.mockRejectedValueOnce(
      new Error("cache unavailable"),
    );
    await expect(f.login()).rejects.toThrow("cache unavailable");
    expect(f.durableSession.revoke).toHaveBeenCalledOnce();
    expect(f.redis.storeOidcAuthCode).not.toHaveBeenCalled();
  });

  it("commits the recipient before publishing a code and uses one absolute expiry", async () => {
    const f = fixture();
    const result = await f.login();
    expect(result).toHaveProperty(
      "redirectTo",
      expect.stringContaining("code="),
    );
    expect(
      f.durableSession.bindClient.mock.invocationCallOrder[0],
    ).toBeLessThan(f.redis.storeOidcAuthCode.mock.invocationCallOrder[0]!);
    const creation = f.durableSession.create.mock.calls[0] as unknown as [
      { sid: string; expiresAt: Date },
    ];
    expect(f.redis.createOidcSession).toHaveBeenCalledWith(
      creation[0].sid,
      expect.objectContaining({
        absExpiresAt: creation[0].expiresAt.getTime() / 1000,
      }),
      3600,
    );
  });

  it("does not expose a code when revocation wins the binding race", async () => {
    const f = fixture();
    f.durableSession.bindClient.mockRejectedValueOnce(
      new Error("invalid_grant"),
    );
    await expect(f.login()).rejects.toThrow("invalid_grant");
    expect(f.redis.storeOidcAuthCode).not.toHaveBeenCalled();
    expect(f.durableSession.revoke).toHaveBeenCalledOnce();
  });

  it("can complete durable logout when Redis and refresh cleanup are unavailable", async () => {
    const f = fixture();
    f.redis.deleteOidcSession.mockRejectedValueOnce(new Error("cache down"));
    f.token.revokeSession.mockRejectedValueOnce(new Error("token store down"));
    await expect(
      f.service.endSession(
        ["sid"],
        undefined,
        undefined,
        "accounts-self:customer",
      ),
    ).resolves.toBe("https://vxture.com/");
    expect(f.durableSession.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      f.redis.deleteOidcSession.mock.invocationCallOrder[0]!,
    );
  });

  it("does not destroy recipients when the revocation transaction fails", async () => {
    const f = fixture();
    f.durableSession.revoke.mockRejectedValueOnce(
      new Error("transaction failed"),
    );
    await expect(f.service.endSession(["sid"])).rejects.toThrow(
      "transaction failed",
    );
    expect(f.redis.deleteOidcSession).not.toHaveBeenCalled();
    expect(f.token.revokeSession).not.toHaveBeenCalled();
  });

  it("keeps workforce logout independent of the customer session store", async () => {
    const f = fixture();
    f.durableSession.customerOwner.mockRejectedValue(
      new Error("customer store unavailable"),
    );
    const notify = vi.fn(async () => {});
    Object.assign(f.redis, {
      ...logoutTestStore(() => ({
        sub: "opr_operator",
        clientIds: ["operator"],
      })),
      getOidcSession: async () => ({ realm: "workforce", sub: "opr_operator" }),
      getOidcSessionClients: async () => ["operator"],
    });
    Object.assign(f.service, { sendBackChannelLogouts: notify });
    await expect(
      f.service.endSession(
        ["operator-sid"],
        undefined,
        undefined,
        "accounts-self:workforce",
        "workforce",
      ),
    ).resolves.toBe("https://vxture.com/");
    expect(f.durableSession.customerOwner).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "operator-sid",
      "opr_operator",
      ["operator"],
      true,
    );
  });

  it("does not end a customer session through a workforce cookie", async () => {
    const f = fixture();
    Object.assign(f.redis, {
      getOidcSession: async () => ({ realm: "customer", sub: "usr_user" }),
    });
    await f.service.endSession(
      ["sid"],
      undefined,
      undefined,
      "accounts-self:workforce",
      "workforce",
    );
    expect(f.durableSession.revoke).not.toHaveBeenCalled();
    expect(f.redis.deleteOidcSession).not.toHaveBeenCalled();
    expect(f.token.revokeSession).not.toHaveBeenCalled();
  });

  it("does not disclose durable recipients for a different customer owner", async () => {
    const f = fixture();
    await expect(
      f.service.getCustomerLogoutClients("other-user", "sid"),
    ).rejects.toThrow("customer_session_owner_mismatch");
    expect(f.durableSession.getClients).not.toHaveBeenCalled();
  });
});
