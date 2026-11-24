/**
 * Capability revocation, regrant and late-read fencing across instances.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { describe, expect, it, vi } from "vitest";
import { SessionAggregator } from "./session.aggregator";

// ============================================================================
// Hold an old fact read while a separate instance commits an invalidation.
// ============================================================================
function fixture() {
  let version = "0";
  const changes = { authorizationVersion: vi.fn(async () => version) };
  const governance = {
    getEffectivePermissions: vi.fn(
      async (): Promise<string[]> => ["tenant.billing.manage"],
    ),
  };
  const instance = () =>
    new SessionAggregator(
      undefined as never,
      governance as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined,
      changes as never,
    );
  return {
    governance,
    changes,
    instance,
    advance: () => {
      version = String(BigInt(version) + 1n);
    },
  };
}
describe("versioned capability reconstruction", () => {
  it("invalidates every workspace and instance on revoke and permits a later regrant", async () => {
    const f = fixture(),
      a = f.instance(),
      b = f.instance();
    for (const instance of [a, b])
      expect(
        await instance.capabilitiesFor("user", "org", "workspace"),
      ).toEqual(["tenant.billing.manage"]);
    f.advance();
    f.governance.getEffectivePermissions.mockResolvedValue([]);
    for (const instance of [a, b])
      expect(
        await instance.capabilitiesFor("user", "org", "workspace"),
      ).toEqual([]);
    f.advance();
    f.governance.getEffectivePermissions.mockResolvedValue([
      "tenant.billing.manage",
    ]);
    expect(await a.capabilitiesFor("user", "org", "workspace")).toEqual([
      "tenant.billing.manage",
    ]);
  });
  it("discards an old in-flight fact read before it can refill or return stale capabilities", async () => {
    const f = fixture(),
      a = f.instance();
    let release!: (value: string[]) => void;
    f.governance.getEffectivePermissions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = a.capabilitiesFor("user", "org", "workspace");
    await vi.waitFor(() =>
      expect(f.governance.getEffectivePermissions).toHaveBeenCalledOnce(),
    );
    f.advance();
    f.governance.getEffectivePermissions.mockResolvedValue([]);
    release(["tenant.billing.manage"]);
    expect(await pending).toEqual([]);
    expect(await a.capabilitiesFor("user", "org", "workspace")).toEqual([]);
    expect(f.governance.getEffectivePermissions).toHaveBeenCalledTimes(2);
  });
  it("fails closed on governance or version-store outages", async () => {
    const f = fixture(),
      a = f.instance();
    await a.capabilitiesFor("user", "org");
    f.changes.authorizationVersion.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(a.capabilitiesFor("user", "org")).rejects.toMatchObject({
      status: 503,
    });
    f.advance();
    f.governance.getEffectivePermissions.mockRejectedValue(
      new Error("governance unavailable"),
    );
    await expect(a.capabilitiesFor("user", "org")).rejects.toThrow(
      "Governance authority unavailable",
    );
  });
});
