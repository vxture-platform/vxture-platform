/**
 * RP storage integration tests against isolated keys in a real Redis instance.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { RpSessionStore } from "./rp-session.store";
import { RpAuthService } from "./rp-auth.service";
import type { OidcRpClient, RpSession } from "./types";

// ============================================================================
// Isolated fixture; never flush a shared Redis database.
// ============================================================================
const url = process.env.REDIS_ITEST_URL;
const suite = describe.skipIf(!url);
const prefix = `rp-itest:${randomUUID()}:`;
const now = () => Math.floor(Date.now() / 1000);
const session = (sid = "central"): RpSession => ({
  sid,
  sub: "usr_test",
  idToken: "id",
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: now() + 3600,
});
let redis: Redis;
let second: Redis;
let store: RpSessionStore;

suite("RP atomic session lifecycle", () => {
  beforeAll(async () => {
    redis = new Redis(url!, { lazyConnect: true, maxRetriesPerRequest: 0 });
    second = new Redis(url!, { lazyConnect: true, maxRetriesPerRequest: 0 });
    await Promise.all([redis.connect(), second.connect()]);
    store = new RpSessionStore(redis, "console", prefix);
  });
  async function cleanup() {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  }
  beforeEach(cleanup);
  afterAll(async () => {
    if (redis?.status === "ready") await cleanup();
    redis?.disconnect();
    second?.disconnect();
  });

  it("indexes all sessions and preserves client and sid isolation", async () => {
    const website = new RpSessionStore(second, "website", prefix);
    await store.create("a", session(), 60);
    await store.create("b", session(), 60);
    await store.create("c", session("other"), 60);
    await website.create("a", session(), 60);
    expect(await store.destroyBySid("central")).toBe(2);
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBeNull();
    expect(await store.get("c")).not.toBeNull();
    expect(await website.get("a")).not.toBeNull();
    expect(await store.destroyBySid("central")).toBe(0);
  });

  it("rejects a late callback even when logout arrived before the first local session", async () => {
    await store.destroyBySid("central");
    await expect(store.create("late", session(), 60)).rejects.toThrow(
      "revoked",
    );
    expect(await store.get("late")).toBeNull();
    await store.create("new", session("new-central"), 60);
    expect(await store.get("new")).not.toBeNull();
  });

  it("does not shorten the sid index when a shorter session is added", async () => {
    await store.create("long", session(), 60);
    await store.create("short", session(), 2);
    expect(
      await redis.ttl(`${prefix}rp:console:sididx:central`),
    ).toBeGreaterThan(50);
    // Millisecond precision prevents an older index expiring before a new
    // session with the same rounded TTL.
    const index = `${prefix}rp:console:sididx:central`;
    await redis.pexpire(index, 59900);
    await store.create("same-lifetime", session(), 60);
    const indexTtl = await redis.pttl(index);
    expect(indexTtl).toBeGreaterThanOrEqual(
      await redis.pttl(`${prefix}rp:console:sess:same-lifetime`),
    );
  });

  it("rejects stale updates, changed subjects, and update-after-local-logout", async () => {
    const old = session();
    await store.create("a", old, 60);
    const next = { ...old, accessToken: "rotated" };
    expect(await store.update("a", next, 60, old)).toBe(true);
    expect(await store.update("a", old, 60, old)).toBe(false);
    expect(await store.update("a", { ...next, sub: "other" }, 60, next)).toBe(
      false,
    );
    await store.destroy("a");
    expect(await store.update("a", old, 60, next)).toBe(false);
    expect(await store.get("a")).toBeNull();
  });

  it("preserves the original absolute TTL when rotating", async () => {
    const old = session();
    await store.create("a", old, 60);
    const key = `${prefix}rp:console:sess:a`;
    await redis.pexpire(key, 1800);
    const before = await redis.pttl(key);
    expect(
      await store.update("a", { ...old, accessToken: "new" }, 3600, old),
    ).toBe(true);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(before);
  });

  it("fences a stale refresh holder and preserves the replacement owner's lease", async () => {
    const old = session();
    await store.create("a", old, 60);
    expect(await store.lockRefresh("a", old, "old-owner")).toBe(true);
    await redis.set(`${prefix}rp:console:refresh:a`, "new-owner", "PX", 60000);
    expect(
      await store.update(
        "a",
        { ...old, accessToken: "stale" },
        60,
        old,
        "old-owner",
      ),
    ).toBe(false);
    await store.unlockRefresh("a", "old-owner");
    expect(await redis.get(`${prefix}rp:console:refresh:a`)).toBe("new-owner");
  });

  it("serializes competing creates and never lets create or refresh survive sid revocation", async () => {
    const other = new RpSessionStore(second, "console", prefix);
    const old = session();
    const creates = await Promise.allSettled([
      store.create("a", old, 60),
      other.create("a", old, 60),
    ]);
    expect(
      creates.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await Promise.all([
      other.destroyBySid("central"),
      store.update("a", { ...old, accessToken: "new" }, 60, old),
    ]);
    expect(await store.get("a")).toBeNull();
    await expect(store.create("late", old, 60)).rejects.toThrow();
  });

  // ========================================================================
  // Real cross-connection orchestration races
  // ========================================================================

  function client(refresh: OidcRpClient["refresh"]): OidcRpClient {
    return {
      buildAuthorizeUrl: () => "",
      buildEndSessionUrl: () => "",
      exchangeCode: async () => session(),
      refresh,
      verifyAccessToken: async () => ({ sub: "usr_test", sid: "central" }),
      verifyIdToken: async () => ({
        sub: "usr_test",
        sid: "central",
        iss: "issuer",
        aud: "console",
        exp: now() + 3600,
      }),
      verifyLogoutToken: async () => ({ sid: "central" }),
    };
  }

  it("makes one refresh across two independently constructed services", async () => {
    const old = { ...session(), accessExpiresAt: now() - 1 };
    await store.create("a", old, 60);
    let calls = 0;
    const oidc = client(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 75));
      return { ...session(), accessToken: "new", refreshToken: "rotated" };
    });
    const one = new RpAuthService(store, oidc, 60);
    const two = new RpAuthService(
      new RpSessionStore(second, "console", prefix),
      oidc,
      60,
    );
    const results = await Promise.all([one.resolve("a"), two.resolve("a")]);
    expect(calls).toBe(1);
    expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
  });

  it("rejects refresh completion after logout without recreating a session", async () => {
    await store.create("a", { ...session(), accessExpiresAt: now() - 1 }, 60);
    const oidc = client(async () => {
      await new RpSessionStore(second, "console", prefix).destroyBySid(
        "central",
      );
      return { ...session(), accessToken: "late" };
    });
    expect((await new RpAuthService(store, oidc, 60).resolve("a")).status).toBe(
      "expired",
    );
    expect(await store.get("a")).toBeNull();
  });
});
