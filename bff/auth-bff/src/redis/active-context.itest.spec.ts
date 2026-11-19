/**
 * Atomic current customer context against real Redis, with session lifecycle checks.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

// ============================================================================
// Only synthetic sessions in a unique test namespace are written or removed.
// ============================================================================
const enabled =
  process.env.AUTH_ITEST === "1" && Boolean(process.env.REDIS_ITEST_URL);
describe.runIf(enabled)("current customer context (live Redis)", () => {
  const prefix = `vxtest-context-${randomUUID()}:`;
  const raw = new Redis(
    process.env.REDIS_ITEST_URL ?? "redis://127.0.0.1:6379",
    { lazyConnect: true },
  );
  const store = new RedisService({} as never);
  Object.assign(store, { prefix, client: raw });
  const key = (sid: string) => `${prefix}sess:${sid}`;
  const seed = async (realm = "customer") => {
    const sid = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await store.createOidcSession(
      sid,
      {
        realm,
        sub: realm === "customer" ? "usr_synthetic" : "opr_synthetic",
        authMethod: "password",
        createdAt: now,
        lastActiveAt: now,
        absExpiresAt: now + 300,
      },
      300,
    );
    return sid;
  };
  beforeAll(async () => {
    await raw.connect();
  });
  afterAll(async () => {
    if (raw.status === "ready") {
      const keys = await raw.keys(`${prefix}*`);
      if (keys.length) await raw.del(...keys);
    }
    raw.disconnect();
  });

  // ========================================================================
  // Shared pair, null workspace, expired sessions, and malformed state
  // ========================================================================
  it("overrides application history while preserving the absolute session TTL", async () => {
    const sid = await seed();
    await store.setOidcActiveOrg(sid, "product", "personal");
    await store.setOidcActiveWorkspace(sid, "product", "personal-space");
    const ttl = await raw.pttl(key(sid));
    await store.setOidcActiveContext(sid, {
      orgId: "team",
      workspaceId: "second",
    });
    expect(await store.getOidcActiveOrg(sid, "product")).toBe("team");
    expect(await store.getOidcActiveWorkspace(sid, "product")).toBe("second");
    expect(await raw.pttl(key(sid))).toBeLessThanOrEqual(ttl);
    expect(await raw.pttl(key(sid))).toBeGreaterThan(0);
  });

  it("stores a coherent pair under concurrent switches", async () => {
    const sid = await seed();
    await Promise.all([
      store.setOidcActiveContext(sid, { orgId: "a", workspaceId: "a-space" }),
      store.setOidcActiveContext(sid, { orgId: "b", workspaceId: "b-space" }),
    ]);
    const org = await store.getOidcActiveOrg(sid, "console");
    expect(await store.getOidcActiveWorkspace(sid, "console")).toBe(
      `${org}-space`,
    );
  });

  it("does not fall back to an old workspace when the current tenant has none", async () => {
    const sid = await seed();
    await store.setOidcActiveWorkspace(sid, "product", "old-space");
    await store.setOidcActiveContext(sid, { orgId: "team", workspaceId: null });
    expect(await store.getOidcActiveWorkspace(sid, "product")).toBeNull();
  });

  it("does not recreate a deleted central session", async () => {
    const sid = await seed();
    await raw.del(key(sid));
    await expect(
      store.setOidcActiveContext(sid, { orgId: "team", workspaceId: "space" }),
    ).rejects.toThrow("persistence failed");
    expect(await raw.exists(key(sid))).toBe(0);
  });

  it("does not store customer context in a workforce session", async () => {
    const sid = await seed("workforce");
    await expect(
      store.setOidcActiveContext(sid, { orgId: "team", workspaceId: "space" }),
    ).rejects.toThrow("persistence failed");
    expect(await raw.hget(key(sid), "active_context")).toBeNull();
  });

  it("fails closed on corrupt context instead of choosing a default", async () => {
    const sid = await seed();
    await raw.hset(key(sid), "active_context", "invalid-json");
    await expect(store.getOidcActiveOrg(sid, "console")).rejects.toThrow(
      "lookup failed",
    );
    await expect(store.getOidcActiveWorkspace(sid, "console")).rejects.toThrow(
      "lookup failed",
    );
  });
});
