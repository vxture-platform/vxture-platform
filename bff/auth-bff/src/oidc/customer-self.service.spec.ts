/**
 * Customer account-center security regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: Exercise the public account-domain history contract.
import type { LoginHistoryEntry } from "@vxture/service-account";
import { CustomerSelfService } from "./customer-self.service";
import { OidcService } from "./oidc.service";
import type { CustomerSessionContext } from "./realm-session.service";

// ============================================================================
// Profile projection and input boundary
// ============================================================================

const context: CustomerSessionContext = {
  sid: "current",
  userId: "123",
  user: {
    id: "123",
    status: "active",
    account: "customer",
    name: "Name",
    phone: "13800138000",
    email: "a@example.com",
    avatarHash: null,
  },
};
function fixture() {
  const accounts = {
    updateProfile: vi.fn(async () => ({ ...context.user, name: "New" })),
    listIdentitiesByUser: vi.fn(async () => [
      { provider: "google", providerSubject: "private", connectedAt: "date" },
    ]),
    listSessions: vi.fn(async () => [{ sid: "current" }, { sid: "other" }]),
    listLoginHistory: vi.fn<() => Promise<LoginHistoryEntry[]>>(async () => []),
  };
  const oidc = { endCustomerSession: vi.fn(async () => true) };
  const locations = {
    locate: vi.fn(() => ({
      kind: "public",
      country: "中国",
      region: "广东省",
      city: "深圳市",
      countryCode: "CN",
    })),
  };
  const service = new CustomerSelfService(
    accounts as never,
    oidc as never,
    locations as never,
  );
  return { accounts, oidc, locations, service };
}

describe("customer account-center data boundary", () => {
  it.each([
    { email: "hijack@example.com" },
    { phone: "13900139000" },
    { status: "active" },
    { userId: "other" },
    { name: "New", emailVerified: true },
    {},
    null,
    [],
    { name: 7 },
    { name: "x".repeat(101) },
    { gender: "other" },
  ])("rejects unsafe profile patches %j", async (body) => {
    const f = fixture();
    await expect(f.service.updateProfile(context, body)).rejects.toThrow();
    expect(f.accounts.updateProfile).not.toHaveBeenCalled();
  });
  it("writes safe fields using only the authenticated user ID", async () => {
    const f = fixture();
    await expect(
      f.service.updateProfile(context, { name: "New", bio: "Hello" }),
    ).resolves.toMatchObject({ name: "New", realm: "customer" });
    expect(f.accounts.updateProfile).toHaveBeenCalledWith("123", {
      name: "New",
      bio: "Hello",
    });
  });
  it("omits internal provider subjects and defaults missing verification evidence to false", async () => {
    const f = fixture();
    await expect(f.service.getSecurity(context)).resolves.toMatchObject({
      emailVerified: false,
      phoneVerified: false,
      identities: [{ provider: "google", connectedAt: "date" }],
    });
    expect(JSON.stringify(await f.service.getSecurity(context))).not.toContain(
      "private",
    );
  });
  it.each([
    [null, null],
    ["2026-10-10T08:15:00.000Z", "2026-11-09T08:15:00.000Z"],
  ])(
    "projects the account and its next change time from %s",
    async (changedAt, nextAt) => {
      const f = fixture();
      await expect(
        f.service.getSecurity({
          ...context,
          user: { ...context.user, accountChangedAt: changedAt },
        }),
      ).resolves.toMatchObject({
        account: "customer",
        accountChangeableAt: nextAt,
      });
    },
  );
  it("enriches only owned history from the thirty-day window", async () => {
    const f = fixture();
    const entry = {
      loginAt: new Date(Date.now() - 60000).toISOString(),
      ipAddress: "113.118.113.77",
      userAgent: null,
      countryCode: null,
      authMethod: "phone",
      result: "success",
    };
    f.accounts.listLoginHistory.mockResolvedValue([
      entry,
      { ...entry, loginAt: new Date(Date.now() - 31 * 86400000).toISOString() },
      { ...entry, loginAt: "invalid" },
      { ...entry, loginAt: new Date(Date.now() + 86400000).toISOString() },
    ]);
    const history = await f.service.getLoginHistory(context);
    expect(history).toEqual([
      { ...entry, location: f.locations.locate.mock.results[0]!.value },
    ]);
    expect(f.accounts.listLoginHistory).toHaveBeenCalledWith("123", 20);
    expect(f.locations.locate).toHaveBeenCalledOnce();
    expect(f.locations.locate).toHaveBeenCalledWith(entry.ipAddress);
  });
  it("marks only the current device and bounds login history", async () => {
    const f = fixture();
    expect(await f.service.getSessions(context)).toEqual([
      { sid: "current", current: true },
      { sid: "other", current: false },
    ]);
    await f.service.getLoginHistory(context);
    expect(f.accounts.listLoginHistory).toHaveBeenCalledWith("123", 20);
  });
});

// ============================================================================
// Durable revocation, refresh chains and application logout
// ============================================================================

function revocation() {
  const durable = { userId: "123", realm: "customer" };
  const cached = { sub: "usr_123", realm: "customer" };
  const durableSession = { get: vi.fn(async () => durable) };
  const redis = {
    getOidcSession: vi.fn(async () => cached),
    getOidcSessionClients: vi.fn(async () => ["console"]),
    deleteOidcSession: vi.fn(async () => {}),
  };
  const account = { revokeSession: vi.fn(async () => true) };
  const token = { revokeSession: vi.fn(async () => {}) };
  const sendBackChannelLogouts = vi.fn(async () => {});
  const oidc = Object.create(OidcService.prototype) as OidcService;
  Object.assign(oidc, {
    durableSession,
    redis,
    account,
    token,
    sendBackChannelLogouts,
  });
  return {
    oidc,
    durable,
    cached,
    durableSession,
    redis,
    account,
    token,
    sendBackChannelLogouts,
  };
}

describe("owned customer session revocation", () => {
  it("revokes durably before tokens, cache and application logout", async () => {
    const f = revocation();
    expect(await f.oidc.endCustomerSession("123", "target")).toBe(true);
    expect(f.account.revokeSession).toHaveBeenCalledWith("123", "target");
    expect(f.token.revokeSession).toHaveBeenCalledWith("target");
    expect(f.redis.deleteOidcSession).toHaveBeenCalledWith("target");
    expect(f.sendBackChannelLogouts).toHaveBeenCalledWith("target", "usr_123", [
      "console",
    ]);
    expect(f.account.revokeSession.mock.invocationCallOrder[0]).toBeLessThan(
      f.token.revokeSession.mock.invocationCallOrder[0]!,
    );
  });
  it.each([{ userId: "other" }, { realm: "workforce" }])(
    "refuses an unowned durable session %j",
    async (patch) => {
      const f = revocation();
      Object.assign(f.durable, patch);
      expect(await f.oidc.endCustomerSession("123", "target")).toBe(false);
      expect(f.account.revokeSession).not.toHaveBeenCalled();
      expect(f.redis.deleteOidcSession).not.toHaveBeenCalled();
    },
  );
  it("refuses a mismatched Redis realm", async () => {
    const f = revocation();
    f.cached.realm = "workforce";
    expect(await f.oidc.endCustomerSession("123", "target")).toBe(false);
    expect(f.token.revokeSession).not.toHaveBeenCalled();
  });
  it("does not touch tokens when durable revocation fails", async () => {
    const f = revocation();
    f.account.revokeSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(f.oidc.endCustomerSession("123", "target")).rejects.toThrow(
      "database unavailable",
    );
    expect(f.token.revokeSession).not.toHaveBeenCalled();
  });
  it("reports cleanup failures after durable revocation", async () => {
    const f = revocation();
    f.token.revokeSession.mockRejectedValueOnce(
      new Error("token store unavailable"),
    );
    await expect(f.oidc.endCustomerSession("123", "target")).rejects.toThrow(
      "token store unavailable",
    );
    expect(f.account.revokeSession).toHaveBeenCalled();
  });
  it("revokes tokens even when the Redis session already disappeared", async () => {
    const f = revocation();
    f.redis.getOidcSession.mockResolvedValueOnce(null as never);
    expect(await f.oidc.endCustomerSession("123", "target")).toBe(true);
    expect(f.token.revokeSession).toHaveBeenCalled();
  });
  it("is idempotent for expired and already revoked durable sessions", async () => {
    const f = revocation();
    f.durableSession.get.mockResolvedValueOnce(null as never);
    expect(await f.oidc.endCustomerSession("123", "target")).toBe(false);
    expect(f.account.revokeSession).not.toHaveBeenCalled();
  });
});
