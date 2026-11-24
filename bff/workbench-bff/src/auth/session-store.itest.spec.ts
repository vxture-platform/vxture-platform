/**
 * Session fencing and lock ownership against an isolated real Redis namespace.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { SessionStore, type Session } from "./session-store";

// ============================================================================
// Explicit opt-in prevents local unit tests from opening real infrastructure.
// ============================================================================
const run =
  process.env.WORKBENCH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
describe.runIf(run)("workbench sessions (live Redis)", () => {
  let redis: Redis;
  let store: SessionStore;
  const id = () => randomBytes(32).toString("base64url");
  const session = (sid = randomUUID()): Session => ({
    sid,
    sub: "usr_00000000-0000-4000-8000-000000000001",
    org: "00000000-0000-4000-8000-000000000002",
    workspace: "00000000-0000-4000-8000-000000000003",
    idToken: "synthetic-id-token",
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 60,
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    nextCheckAt: 0,
  });

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_ITEST_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 3000,
      commandTimeout: 3000,
    });
    await redis.connect();
    const config = loadConfig({
      NODE_ENV: "production",
      WORKBENCH_BASE_URL: "https://workbench.test",
      WORKBENCH_BFF_PORT: "3061",
      OIDC_ISSUER: "https://accounts.test",
      OIDC_CLIENT_ID: "workbench",
      OIDC_CLIENT_SECRET: "synthetic-test-secret",
      DATABASE_URL: "postgresql://test:test@127.0.0.1/test",
      WORKBENCH_INBOX_DATABASE_URL:
        "postgresql://svc_workbench_inbox:test@127.0.0.1/test",
      REDIS_URL: process.env.REDIS_ITEST_URL,
    });
    // A unique RP namespace keeps cleanup strictly within this test invocation.
    store = new SessionStore(redis, {
      ...config,
      oidc: { ...config.oidc, clientId: `workbench-itest-${randomUUID()}` },
    });
  });
  afterEach(async () => {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${store.prefix}*`,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  });
  afterAll(() => redis?.disconnect());

  // ============================================================================
  // Lua operations must preserve expiry and resist stale concurrent writers.
  // ============================================================================
  it("creates once and preserves the existing record on duplicate creation", async () => {
    const key = id();
    const value = session();
    await store.create(key, value);
    await expect(store.create(key, session())).rejects.toThrow();
    expect((await store.read(key))?.session).toEqual(value);
  });
  it("rejects stale refresh writes and never extends the absolute TTL", async () => {
    const key = id();
    await store.create(key, session());
    const before = (await store.read(key))!;
    const ttl = await redis.pttl(store.key(key));
    const refreshed = { ...before.session, accessToken: "rotated" };
    expect(await store.update(key, before.raw, refreshed)).toBe(true);
    expect(await store.update(key, before.raw, before.session)).toBe(false);
    expect((await store.read(key))?.session.accessToken).toBe("rotated");
    expect(await redis.pttl(store.key(key))).toBeLessThanOrEqual(ttl);
    expect(await redis.pttl(store.key(key))).toBeGreaterThan(0);
  });
  it("revokes all bindings for one SID and fences racing or future writes", async () => {
    const value = session();
    const first = id();
    const second = id();
    const other = id();
    await store.create(first, value);
    await store.create(second, value);
    await store.create(other, session());
    const old = (await store.read(first))!;
    await Promise.all([
      store.update(first, old.raw, { ...value, accessToken: "racing" }),
      store.revokeSid(value.sid),
    ]);
    expect(await store.read(first)).toBeNull();
    expect(await store.read(second)).toBeNull();
    expect(await store.read(other)).not.toBeNull();
    expect(await store.update(first, old.raw, value)).toBe(false);
    await expect(store.create(id(), value)).rejects.toThrow();
    await store.revokeSid(value.sid);
  });
  it("does not recreate a locally destroyed binding during refresh", async () => {
    const key = id();
    await store.create(key, session());
    const old = (await store.read(key))!;
    await store.destroy(key);
    expect(await store.update(key, old.raw, old.session)).toBe(false);
    expect(await store.read(key)).toBeNull();
  });
  it("rejects already expired sessions before persisting any record", async () => {
    const key = id();
    await expect(
      store.create(key, { ...session(), expiresAt: 0 }),
    ).rejects.toThrow();
    expect(await redis.exists(store.key(key))).toBe(0);
  });
  it("allows only the lock owner to release the distributed refresh lock", async () => {
    const key = id();
    expect(await store.lock(key, "first")).toBe(true);
    expect(await store.lock(key, "second")).toBe(false);
    await store.unlock(key, "second");
    expect(await store.lock(key, "second")).toBe(false);
    await store.unlock(key, "first");
    expect(await store.lock(key, "second")).toBe(true);
  });
});
