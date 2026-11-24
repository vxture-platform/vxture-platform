/**
 * Logout faults must not preserve central identity or discard retry recipients.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OidcService } from "./oidc.service";
import { logoutTestStore } from "./logout-test-store";

// ============================================================================
// Independent service instances sharing persisted work
// ============================================================================

function fixture(ids = ["website", "yucer", "cospace"]) {
  const active = new Set(["old", "new", "operator"]);
  const redis = logoutTestStore(
    () => ({ sub: "usr_old", clientIds: ids }),
    (sid) => {
      active.delete(sid);
    },
  );
  const revoke = vi.fn(async () => {});
  const tokenRevoke = vi.fn(async () => {});
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const logger = { warn: vi.fn(), error: vi.fn() };
  const clients = {
    findEnabledByClientId: vi.fn(async (id: string) => ({
      clientId: id,
      sloParticipation: "back_channel",
      backChannelLogoutUri: `https://${id}.example/logout`,
    })),
  };
  const instance = (): OidcService =>
    Object.assign(Object.create(OidcService.prototype), {
      redis,
      token: { revokeSession: tokenRevoke },
      durableSession: { revoke, customerOwner: vi.fn(async () => null) },
      clients,
      keys: { sign: vi.fn(() => "synthetic-logout-token") },
      logger,
    });
  return {
    instance,
    redis,
    active,
    revoke,
    tokenRevoke,
    fetcher,
    logger,
    clients,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("logout backlog telemetry", () => {
  it("alerts on sustained backlog, throttles repeats and records recovery without identity data", async () => {
    const snapshot = {
      pending: 2,
      unknownAge: 0,
      oldestAgeSeconds: 60,
      sampled: 2,
      corruptSamples: 0,
      clients: { yucer: { pending: 2, maxAttempts: 6 } },
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const oidcLogoutBacklog = vi.fn(async () => snapshot);
    const service: OidcService = Object.assign(
      Object.create(OidcService.prototype),
      {
        redis: { oidcLogoutBacklog },
        logger,
      },
    );
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    await service.reportLogoutBacklog();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      event: "oidc_logout_backlog_alert",
      ...snapshot,
    });
    await service.reportLogoutBacklog();
    expect(logger.error).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(301_000);
    await service.reportLogoutBacklog();
    expect(logger.error).toHaveBeenCalledTimes(2);
    Object.assign(snapshot, {
      pending: 0,
      oldestAgeSeconds: 0,
      sampled: 0,
      clients: {},
    });
    await service.reportLogoutBacklog();
    expect(logger.log).toHaveBeenLastCalledWith({
      event: "oidc_logout_backlog_recovered",
      ...snapshot,
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toMatch(
      /usr_|sid|token/i,
    );
  });

  it.each([{ pending: 100 }, { unknownAge: 1 }, { corruptSamples: 1 }])(
    "alerts on excessive depth, unknown legacy age or corrupt work: %j",
    async (overrides) => {
      const logger = { log: vi.fn(), error: vi.fn() };
      const snapshot = {
        pending: 1,
        unknownAge: 0,
        oldestAgeSeconds: 0,
        sampled: 1,
        corruptSamples: 0,
        clients: {},
        ...overrides,
      };
      const service: OidcService = Object.assign(
        Object.create(OidcService.prototype),
        {
          redis: { oidcLogoutBacklog: async () => snapshot },
          logger,
        },
      );
      await service.reportLogoutBacklog();
      expect(logger.error).toHaveBeenCalledOnce();
    },
  );
});

describe("resumable central logout", () => {
  it("retires only the old browser session and records work before database cleanup", async () => {
    const f = fixture();
    f.tokenRevoke.mockImplementation(async () => {
      expect(f.active.has("old")).toBe(false);
      expect(f.redis.records.has("old")).toBe(true);
    });
    await f.instance().endSession(["old"]);
    expect([...f.active]).toEqual(["new", "operator"]);
    expect(f.redis.records.size).toBe(0);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith("old");
  });

  it("retains failed HTTP recipients and resumes them after a process restart", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(
      async (url) =>
        new Response(null, {
          status: url.includes("yucer") ? 503 : 200,
        }),
    );
    await f.instance().endSession(["old"]);
    expect(f.redis.records.get("old")).toMatchObject({
      cleanupComplete: true,
      clientIds: ["yucer"],
      attempts: 1,
    });
    expect(f.active.has("old")).toBe(false);
    f.fetcher.mockResolvedValue(new Response(null, { status: 200 }));
    await f.instance().retryPendingLogouts();
    expect(f.fetcher).toHaveBeenCalledTimes(4);
    expect(f.tokenRevoke).toHaveBeenCalledTimes(1);
    expect(f.redis.records.size).toBe(0);
  });

  it("keeps recipients on connection failures and applies a timeout without following redirects", async () => {
    const f = fixture(["yucer"]);
    f.fetcher.mockRejectedValue(new Error("network contains confidential URL"));
    await f.instance().endSession(["old"]);
    expect(f.redis.records.get("old")?.clientIds).toEqual(["yucer"]);
    expect(f.fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain(
      "synthetic-logout-token",
    );
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain(
      "confidential URL",
    );
  });

  it("fails interactive logout on durable cleanup failure while preserving retryable work", async () => {
    const f = fixture();
    f.revoke.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.instance().endSession(["old"])).rejects.toThrow(
      "Central session status unavailable",
    );
    expect(f.active.has("old")).toBe(false);
    expect(f.redis.records.get("old")).toMatchObject({
      cleanupComplete: false,
      clientIds: [],
    });
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    await f.instance().retryPendingLogouts();
    expect(f.redis.records.size).toBe(0);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });

  it("cannot report success if retiring the central session was not persisted", async () => {
    const f = fixture();
    f.redis.beginOidcLogout.mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );
    await expect(f.instance().endSession(["old"])).rejects.toThrow(
      "Redis unavailable",
    );
    expect(f.active.has("old")).toBe(true);
    expect(f.revoke).not.toHaveBeenCalled();
  });

  it("preserves work when the process loses its lease during delivery", async () => {
    const f = fixture(["yucer"]);
    f.fetcher.mockImplementation(async () => {
      f.redis.leases.set("old", "new-worker");
      return new Response(null, { status: 200 });
    });
    await expect(f.instance().endSession(["old"])).rejects.toThrow();
    expect(f.redis.records.has("old")).toBe(true);
  });

  it("does not replace pending recipients on repeated logout after the cache was deleted", async () => {
    const f = fixture(["yucer"]);
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await f.instance().endSession(["old"]);
    await f.instance().endSession(["old"]);
    expect(f.redis.records.size).toBe(0);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds the initial fanout and finishes larger product catalogs in later passes", async () => {
    const f = fixture(Array.from({ length: 19 }, (_, n) => `product-${n}`));
    await f.instance().endSession(["old"]);
    expect(f.fetcher).toHaveBeenCalledTimes(8);
    await f.instance().retryPendingLogouts();
    await f.instance().retryPendingLogouts();
    expect(f.fetcher).toHaveBeenCalledTimes(19);
    expect(f.redis.records.size).toBe(0);
  });

  it("does not let eight unavailable products starve later healthy products", async () => {
    const ids = Array.from({ length: 10 }, (_, n) => `product-${n}`);
    const f = fixture(ids);
    f.fetcher.mockImplementation(
      async (url) =>
        new Response(null, {
          status:
            url.includes("product-8") || url.includes("product-9") ? 200 : 503,
        }),
    );
    await f.instance().endSession(["old"]);
    await f.instance().retryPendingLogouts();
    expect(f.redis.records.get("old")?.clientIds).not.toContain("product-8");
    expect(f.redis.records.get("old")?.clientIds).not.toContain("product-9");
    expect(f.redis.records.get("old")?.clientIds).toHaveLength(8);
  });

  it("attempts durable revocation even when refresh-chain cleanup fails", async () => {
    const f = fixture();
    f.tokenRevoke.mockRejectedValueOnce(new Error("refresh store unavailable"));
    await expect(f.instance().endSession(["old"])).rejects.toThrow();
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith("old");
    expect(f.redis.records.get("old")?.cleanupComplete).toBe(false);
  });

  it("bounds a real stalled callback and leaves it retryable", async () => {
    const realFetch = globalThis.fetch;
    const server = createServer(() => {});
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const f = fixture(["yucer"]);
      vi.stubGlobal("fetch", realFetch);
      f.clients.findEnabledByClientId.mockResolvedValue({
        clientId: "yucer",
        sloParticipation: "back_channel",
        backChannelLogoutUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/logout`,
      });
      const started = Date.now();
      await f.instance().endSession(["old"]);
      expect(Date.now() - started).toBeLessThan(9000);
      expect(f.redis.records.get("old")?.clientIds).toEqual(["yucer"]);
      expect(f.active.has("old")).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);
});
