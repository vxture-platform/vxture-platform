/**
 * Identity realm isolation regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import { describe, expect, it, vi } from "vitest";
import {
  RealmSessionService,
  realmSubjectMatches,
} from "./realm-session.service";

function build(overrides: Record<string, unknown> = {}, enabled = true) {
  const session = {
    realm: "workforce",
    authMethod: "phone+totp",
    sub: "opr_123",
    absExpiresAt: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
  const redis = { getOidcSession: vi.fn(async () => session) };
  const operators = {
    findById: vi.fn(async () => (enabled ? { id: "123" } : null)),
  };
  return {
    service: new RealmSessionService(
      redis as never,
      operators as never,
      {} as never,
      {} as never,
      { read: async () => null } as never,
    ),
    redis,
    operators,
  };
}

describe("operator self-service identity boundary", () => {
  it("accepts an active workforce account", async () => {
    const { service, operators } = build();
    await expect(service.requireOperator("operator-sid")).resolves.toBe("123");
    expect(operators.findById).toHaveBeenCalledWith("123");
  });

  it.each([
    { realm: "customer", sub: "usr_123" },
    { realm: "workforce", sub: "usr_123" },
    { realm: "workforce", sub: "opr_" },
    { absExpiresAt: 0 },
    { absExpiresAt: Number.NaN },
    { authMethod: "password" },
    { authMethod: "phone" },
    { authMethod: "" },
  ])(
    "rejects wrong realms, subjects and expired sessions: %j",
    async (session) => {
      const { service, operators } = build(session);
      await expect(service.requireOperator("sid")).rejects.toThrow(
        "operator_session_required",
      );
      expect(operators.findById).not.toHaveBeenCalled();
    },
  );

  it("rejects a disabled operator even while its Redis session remains", async () => {
    const { service } = build({}, false);
    await expect(service.requireOperator("sid")).rejects.toThrow(
      "operator_session_required",
    );
  });

  it("rejects a force-logged-out session removed from Redis", async () => {
    const { service, redis } = build();
    redis.getOidcSession.mockResolvedValueOnce(null as never);
    await expect(service.requireOperator("sid")).rejects.toThrow(
      "operator_session_required",
    );
  });

  it("does not query stores without an operator cookie", async () => {
    const { service, redis } = build();
    await expect(service.requireOperator(undefined)).rejects.toThrow(
      "operator_session_required",
    );
    expect(redis.getOidcSession).not.toHaveBeenCalled();
  });

  it("does not downgrade infrastructure errors into successful authentication", async () => {
    const { service, operators } = build();
    operators.findById.mockRejectedValueOnce(new Error("store unavailable"));
    await expect(service.requireOperator("sid")).rejects.toThrow(
      "store unavailable",
    );
  });
});

// ============================================================================
// Subject namespaces
// ============================================================================

describe("identity subject namespaces", () => {
  it.each([
    ["customer", "usr_1", true],
    ["workforce", "opr_1", true],
    ["customer", "opr_1", false],
    ["workforce", "usr_1", false],
    ["unknown", "usr_1", false],
    ["customer", "usr_", false],
  ])("%s / %s => %s", (realm, sub, expected) => {
    expect(realmSubjectMatches(realm, sub)).toBe(expected);
  });
});

// ============================================================================
// Customer authority checks
// ============================================================================

describe("customer central-session boundary", () => {
  function customer() {
    const cached = {
      realm: "customer",
      sub: "usr_123",
      absExpiresAt: Date.now() / 1000 + 60,
    };
    const redis = { getOidcSession: vi.fn(async () => cached) };
    const durable = { sid: "sid", realm: "customer", userId: "123" };
    const sessions = { get: vi.fn(async () => durable) };
    const user = { id: "123", status: "active" };
    const accounts = { getUserById: vi.fn(async () => user) };
    const service = new RealmSessionService(
      redis as never,
      {} as never,
      sessions as never,
      accounts as never,
      { read: async () => null } as never,
    );
    return { cached, durable, user, redis, sessions, accounts, service };
  }

  it("resolves the customer from both stores", async () => {
    const f = customer();
    await expect(f.service.requireCustomer("sid")).resolves.toEqual({
      sid: "sid",
      userId: "123",
      user: f.user,
    });
    expect(f.accounts.getUserById).toHaveBeenCalledWith("123");
  });

  it.each([
    { realm: "workforce", sub: "opr_123" },
    { sub: "opr_123" },
    { absExpiresAt: 0 },
    { absExpiresAt: NaN },
    { sub: "usr_" },
  ])("rejects invalid cached authority %j", async (patch) => {
    const f = customer();
    Object.assign(f.cached, patch);
    await expect(f.service.requireCustomer("sid")).rejects.toThrow(
      "customer_session_required",
    );
    expect(f.sessions.get).not.toHaveBeenCalled();
  });

  it.each([{ realm: "workforce" }, { userId: "other" }])(
    "rejects inconsistent durable authority %j",
    async (patch) => {
      const f = customer();
      Object.assign(f.durable, patch);
      await expect(f.service.requireCustomer("sid")).rejects.toThrow(
        "customer_session_required",
      );
      expect(f.accounts.getUserById).not.toHaveBeenCalled();
    },
  );

  it("rejects revoked or absent durable rows despite a live Redis record", async () => {
    const f = customer();
    f.sessions.get.mockResolvedValueOnce(null as never);
    await expect(f.service.requireCustomer("sid")).rejects.toThrow(
      "customer_session_required",
    );
  });
  it("rejects absent Redis records", async () => {
    const f = customer();
    f.redis.getOidcSession.mockResolvedValueOnce(null as never);
    await expect(f.service.requireCustomer("sid")).rejects.toThrow(
      "customer_session_required",
    );
  });
  it.each(["disabled", "deleted"])(
    "rejects account status %s",
    async (status) => {
      const f = customer();
      f.user.status = status;
      await expect(f.service.requireCustomer("sid")).rejects.toThrow(
        "customer_session_required",
      );
    },
  );
  it("allows a deleting account to read its status", async () => {
    const f = customer();
    f.user.status = "deleting";
    await expect(f.service.requireCustomer("sid")).resolves.toMatchObject({
      user: { status: "deleting" },
    });
  });
  it("does not authenticate through a database outage", async () => {
    const f = customer();
    f.sessions.get.mockRejectedValueOnce(new Error("unavailable"));
    await expect(f.service.requireCustomer("sid")).rejects.toThrow(
      "unavailable",
    );
  });
  it("requires the customer cookie before reading stores", async () => {
    const f = customer();
    await expect(f.service.requireCustomer(undefined)).rejects.toThrow(
      "customer_session_required",
    );
    expect(f.redis.getOidcSession).not.toHaveBeenCalled();
  });
});
