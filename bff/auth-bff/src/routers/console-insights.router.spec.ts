/**
 * Console observations preserve central authority and tenant isolation.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleInsightsRouter } from "./console-insights.router";

// ===== Scoped fixtures =====
const USER = "00000000-0000-4000-a000-000000000100";
const TENANT = "00000000-0000-4000-a000-000000000200";
const AUTH = `Basic ${Buffer.from("console:secret").toString("base64")}`;
const body = {
  sid: "actor-session",
  tenantId: TENANT,
  kind: "members",
  ids: [USER],
};
const now = Math.floor(Date.now() / 1000);
const central = {
  sub: `usr_${USER}`,
  realm: "customer",
  absExpiresAt: now + 3600,
  lastActiveAt: now,
};
function fixture() {
  const oidc = { sessionStatus: vi.fn().mockResolvedValue({ valid: true }) };
  const redis = {
    getOidcSession: vi.fn().mockResolvedValue(central),
    customerPresence: vi
      .fn()
      .mockResolvedValue([{ id: USER, presence: "online" }]),
  };
  const governance = { assertCan: vi.fn().mockResolvedValue(undefined) };
  const pool = {
    query: vi.fn().mockResolvedValue({
      rows: [{ user_id: USER, session_ids: ["member-session"] }],
    }),
  };
  const locations = {
    locate: vi.fn().mockResolvedValue({
      kind: "private",
      country: null,
      region: null,
      city: null,
    }),
  };
  const args = [
    oidc,
    redis,
    governance,
    pool,
    locations,
  ] as unknown as ConstructorParameters<typeof ConsoleInsightsRouter>;
  return {
    router: new ConsoleInsightsRouter(...args),
    oidc,
    redis,
    governance,
    pool,
    locations,
  };
}

// ===== Authentication, scoping and bounded observations =====
describe("ConsoleInsightsRouter", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("rejects absent or foreign client credentials before looking up records", async () => {
    const f = fixture();
    await expect(f.router.read(body)).rejects.toThrow();
    await expect(
      f.router.read(
        body,
        `Basic ${Buffer.from("yucer:secret").toString("base64")}`,
      ),
    ).rejects.toThrow("console_client_required");
    expect(f.pool.query).not.toHaveBeenCalled();
  });
  it("does not accept arbitrary addresses, oversized batches or malformed record ids", async () => {
    const f = fixture();
    for (const invalid of [
      { ...body, ip: "8.8.8.8" },
      { ...body, ids: Array(101).fill(USER) },
      { ...body, ids: ["not-a-uuid"] },
      { ...body, tenantId: "invalid" },
    ]) {
      await expect(f.router.read(invalid, AUTH)).rejects.toThrow(
        "invalid_request",
      );
    }
    expect(f.pool.query).not.toHaveBeenCalled();
  });
  it("rejects revoked actor sessions and workforce sessions", async () => {
    const f = fixture();
    f.oidc.sessionStatus.mockResolvedValueOnce({ valid: false });
    await expect(f.router.read(body, AUTH)).rejects.toThrow("invalid_session");
    f.redis.getOidcSession.mockResolvedValueOnce({
      ...central,
      realm: "workforce",
    });
    await expect(f.router.read(body, AUTH)).rejects.toThrow("invalid_session");
    expect(f.pool.query).not.toHaveBeenCalled();
  });
  it("authorizes the central actor against the requested tenant before querying", async () => {
    const f = fixture();
    f.governance.assertCan.mockRejectedValueOnce(new Error("forbidden"));
    await expect(f.router.read(body, AUTH)).rejects.toThrow("forbidden");
    expect(f.governance.assertCan).toHaveBeenCalledWith(
      USER,
      { orgId: TENANT },
      "tenant.member.read",
    );
    expect(f.pool.query).not.toHaveBeenCalled();
  });
  it("uses durable rows only as candidates and returns no session identifiers", async () => {
    const f = fixture();
    const result = await f.router.read(body, AUTH);
    expect(result).toEqual({
      items: [{ id: USER, presence: "online" }],
      activeWithinSeconds: 90,
    });
    expect(f.pool.query.mock.calls[0]?.[1]).toEqual([TENANT, [USER]]);
    expect(f.pool.query.mock.calls[0]?.[0]).not.toMatch(
      /status\s*=\s*'active'/,
    );
    expect(f.pool.query.mock.calls[0]?.[0]).toContain(
      "order by max(r.created_at) desc, r.session_id limit 21",
    );
    expect(JSON.stringify(result)).not.toContain("member-session");
  });
  it("reports unknown when the central batch observation fails", async () => {
    const f = fixture();
    f.redis.customerPresence.mockRejectedValueOnce(new Error("unavailable"));
    expect((await f.router.read(body, AUTH)).items).toEqual([
      { id: USER, presence: "unknown" },
    ]);
  });
  it("geolocates only stored audit addresses selected by tenant and record id", async () => {
    const f = fixture();
    f.pool.query.mockResolvedValueOnce({
      rows: [{ id: USER, ip_address: "10.0.0.1" }],
    });
    const result = await f.router.read({ ...body, kind: "audit" }, AUTH);
    expect(f.governance.assertCan).toHaveBeenCalledWith(
      USER,
      { orgId: TENANT },
      "tenant.audit.read",
    );
    expect(f.pool.query.mock.calls[0]?.[1]).toEqual([TENANT, [USER]]);
    expect(f.locations.locate).toHaveBeenCalledWith("10.0.0.1");
    expect(result.items).toHaveLength(1);
  });
});
