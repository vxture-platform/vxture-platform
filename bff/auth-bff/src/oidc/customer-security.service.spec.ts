/**
 * Customer self-service security regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { CustomerSecurityService } from "./customer-security.service";
import { OidcService } from "./oidc.service";
import type { CustomerSessionContext } from "./realm-session.service";

// ============================================================================
// Input normalization and trusted proof execution
// ============================================================================

const context = {
  userId: "123",
  sid: "sid",
  user: {
    phone: "+8613800138000",
    email: "old@example.com",
    account: "account",
  },
} as CustomerSessionContext;
function fixture() {
  const proof = {
    operation: "email-change",
    target: "new@example.com",
    snapshot: {},
  };
  const challenges = {
    start: vi.fn(async () => ({ challengeId: "id" })),
    consume: vi.fn(async () => proof),
  };
  const accounts = {
    listIdentitiesByUser: vi.fn(async () => [
      { provider: "google", providerSubject: "subject", connectedAt: "date" },
    ]),
    listSessions: vi.fn(async () => [{ sid: "sid" }]),
    applySelfSecurity: vi.fn(async () => {}),
  };
  const oidc = { cleanupCustomerSessions: vi.fn(async () => {}) };
  return {
    proof,
    challenges,
    accounts,
    oidc,
    service: new CustomerSecurityService(
      accounts as never,
      challenges as never,
      oidc as never,
    ),
  };
}
describe("customer sensitive self-service orchestration", () => {
  it.each([
    null,
    [],
    {},
    { operation: "workforce-password", method: "phone" },
    { operation: "phone-change", method: "phone", target: "123" },
    { operation: "email-change", method: "email", target: "bad" },
    { operation: "account-login", method: "phone", target: "yes" },
    { operation: "identity-unlink", method: "phone", target: "../google" },
  ])("rejects malformed request %j", async (body) => {
    const f = fixture();
    await expect(f.service.start(context, body)).rejects.toThrow();
    expect(f.challenges.start).not.toHaveBeenCalled();
  });
  it("normalizes email before binding it into the ceremony", async () => {
    const f = fixture();
    await f.service.start(context, {
      operation: "email-change",
      target: " NEW@Example.com ",
      method: "phone",
    });
    expect(f.challenges.start).toHaveBeenCalledWith(
      context,
      "email-change",
      "new@example.com",
      "phone",
    );
  });
  it("binds unlink proof to the exact current provider subject", async () => {
    const f = fixture();
    await f.service.start(context, {
      operation: "identity-unlink",
      target: "google",
      method: "phone",
    });
    expect(f.challenges.start).toHaveBeenCalledWith(
      context,
      "identity-unlink",
      "google",
      "phone",
      ["subject"],
    );
  });
  it("does not send a code for a provider that is not bound", async () => {
    const f = fixture();
    f.accounts.listIdentitiesByUser.mockResolvedValueOnce([]);
    await expect(
      f.service.start(context, {
        operation: "identity-unlink",
        target: "google",
        method: "phone",
      }),
    ).rejects.toThrow("identity_not_bound");
    expect(f.challenges.start).not.toHaveBeenCalled();
  });
  it("ignores caller-supplied account and target at execution", async () => {
    const f = fixture();
    await f.service.execute(context, "id", {
      operation: "phone-change",
      target: "attacker",
      userId: "other",
    });
    expect(f.accounts.applySelfSecurity).toHaveBeenCalledWith(
      "123",
      f.proof,
      expect.any(Object),
    );
    expect(f.oidc.cleanupCustomerSessions).toHaveBeenCalledWith("123", ["sid"]);
    expect(f.challenges.consume.mock.invocationCallOrder[0]).toBeLessThan(
      f.accounts.applySelfSecurity.mock.invocationCallOrder[0]!,
    );
  });
  it("never writes without a consumed proof", async () => {
    const f = fixture();
    f.challenges.consume.mockRejectedValueOnce(new Error("expired"));
    await expect(f.service.execute(context, "id", {})).rejects.toThrow(
      "expired",
    );
    expect(f.accounts.applySelfSecurity).not.toHaveBeenCalled();
  });
  it("does not clean session caches before a durable mutation succeeds", async () => {
    const f = fixture();
    f.accounts.applySelfSecurity.mockRejectedValueOnce(new Error("stale"));
    await expect(f.service.execute(context, "id", {})).rejects.toThrow("stale");
    expect(f.oidc.cleanupCustomerSessions).not.toHaveBeenCalled();
  });
  it("reports committed success separately from incomplete logout propagation", async () => {
    const f = fixture();
    f.oidc.cleanupCustomerSessions.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    await expect(f.service.execute(context, "id", {})).resolves.toMatchObject({
      ok: true,
      reauthenticate: true,
      logoutPropagationPending: true,
    });
    expect(f.accounts.applySelfSecurity).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Realm-safe post-commit cleanup
// ============================================================================

it("does not delete another customer's or workforce cache", async () => {
  const redis = {
    getOidcSession: vi.fn(async (sid: string) =>
      sid === "owned"
        ? { realm: "customer", sub: "usr_123" }
        : { realm: "workforce", sub: "opr_123" },
    ),
    getOidcSessionClients: vi.fn(async () => ["console"]),
    deleteOidcSession: vi.fn(async () => {}),
  };
  const token = { revokeSession: vi.fn(async () => {}) };
  const logout = vi.fn(async () => {});
  const oidc = Object.create(OidcService.prototype) as OidcService;
  Object.assign(oidc, { redis, token, sendBackChannelLogouts: logout });
  await oidc.cleanupCustomerSessions("123", ["owned", "other"]);
  expect(redis.deleteOidcSession).toHaveBeenCalledExactlyOnceWith("owned");
  expect(logout).toHaveBeenCalledWith("owned", "usr_123", ["console"]);
});
