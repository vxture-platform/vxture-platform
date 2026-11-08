/**
 * Strict lifecycle logout propagation survives missing Redis state.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { OidcService } from "./oidc.service";

// ============================================================================
// Strict lifecycle delivery preserves existing best-effort logout behavior
// ============================================================================
function build(realm = "customer") {
  const redis = {
    getOidcSession: vi.fn(async () =>
      realm === "missing"
        ? null
        : { realm, sub: realm === "customer" ? "usr_user" : "opr_operator" },
    ),
    getOidcSessionClients: vi.fn(async () => ["console"]),
    deleteOidcSession: vi.fn(async () => {}),
  };
  const token = { revokeSession: vi.fn(async () => {}) };
  const clients = {
    findEnabledByClientId: vi.fn(async () => ({
      clientId: "console",
      backChannelLogoutUri: "https://console.example/logout",
      sloParticipation: "back_channel",
    })),
  };
  const service = Object.assign(Object.create(OidcService.prototype), {
    redis,
    token,
    clients,
    keys: { sign: () => "signed" },
  }) as OidcService;
  return { service, redis, token };
}
afterEach(() => vi.unstubAllGlobals());
describe("lifecycle logout propagation", () => {
  it("reports HTTP failures as retryable even after cache deletion", async () => {
    const f = build();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(
      f.service.cleanupCustomerLifecycleSession("user", "sid", ["console"]),
    ).rejects.toThrow("backchannel_delivery_failed");
    expect(f.redis.deleteOidcSession).toHaveBeenCalledWith("sid");
  });
  it("reuses checkpointed clients when Redis no longer holds the session", async () => {
    const f = build("missing");
    const fetcher = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    await f.service.cleanupCustomerLifecycleSession("user", "sid", ["console"]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(f.token.revokeSession).toHaveBeenCalledWith("sid");
  });
  it("never touches a workforce session on an inconsistent target", async () => {
    const f = build("workforce");
    await expect(
      f.service.cleanupCustomerLifecycleSession("user", "sid", ["console"]),
    ).rejects.toThrow("customer_session_owner_mismatch");
    expect(f.token.revokeSession).not.toHaveBeenCalled();
    expect(f.redis.deleteOidcSession).not.toHaveBeenCalled();
  });
  it("reports network failure for persistent retry", async () => {
    const f = build();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(
      f.service.cleanupCustomerLifecycleSession("user", "sid", ["console"]),
    ).rejects.toThrow("network down");
  });
});
