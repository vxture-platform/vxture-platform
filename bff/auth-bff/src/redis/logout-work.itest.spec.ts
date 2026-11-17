/**
 * Real Redis coverage for atomic logout retirement and recoverable delivery work.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import "reflect-metadata";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

// ============================================================================
// Isolated synthetic data in an explicitly provided test Redis
// ============================================================================

const enabled = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
describe.runIf(enabled)("persisted logout work (live Redis)", () => {
  const prefix = `vxtest-logout-${randomUUID()}:`;
  const url = process.env.REDIS_ITEST_URL ?? "";
  const config = { redis: { REDIS_URL: url, REDIS_KEY_PREFIX: prefix } };
  const service = new RedisService(
    config as ConstructorParameters<typeof RedisService>[0],
  );
  const raw = new Redis(url);
  const seed = async (realm = "customer") => {
    const sid = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await service.createOidcSession(
      sid,
      {
        realm,
        sub: realm === "customer" ? "usr_synthetic" : "opr_synthetic",
        authMethod: "password",
        createdAt: now,
        lastActiveAt: now,
        absExpiresAt: now + 3600,
      },
      3600,
    );
    await service.addOidcSessionClient(sid, "yucer");
    await service.addOidcSessionClient(sid, "cospace");
    return sid;
  };
  beforeAll(async () => {
    await service.onModuleInit();
  });
  afterAll(async () => {
    const keys = await raw.keys(`${prefix}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });

  it("atomically retires the central session and keeps its exact recipients without expiry", async () => {
    const sid = await seed();
    const work = await service.beginOidcLogout(sid);
    expect([...work.clientIds].sort()).toEqual(["cospace", "yucer"]);
    expect(await service.getOidcSession(sid)).toBeNull();
    expect(
      await service.checkOidcSessionStatus(sid, "yucer", "customer", false),
    ).toEqual({ valid: false });
    expect(await raw.ttl(`${prefix}oidc:logout:work:${sid}`)).toBe(-1);
    expect(await service.beginOidcLogout(sid)).toEqual(work);
  });

  it("survives a new service instance and only retries undelivered clients", async () => {
    const sid = await seed();
    await service.beginOidcLogout(sid);
    const work = (await service.claimOidcLogout(sid, "first-worker"))!;
    work.cleanupComplete = true;
    work.clientIds = ["yucer"];
    work.attempts++;
    expect(await service.saveOidcLogout(work, "first-worker")).toBe(true);
    const restarted = new RedisService(
      config as ConstructorParameters<typeof RedisService>[0],
    );
    await restarted.onModuleInit();
    try {
      expect(await restarted.claimOidcLogout(sid, "second-worker")).toEqual(
        work,
      );
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it("recovers abandoned leases and fences stale workers from discarding pending work", async () => {
    const sid = await seed();
    await service.beginOidcLogout(sid);
    const old = (await service.claimOidcLogout(sid, "old-worker"))!;
    expect(await service.claimOidcLogout(sid, "contender")).toBeNull();
    await raw.del(`${prefix}oidc:logout:lease:${sid}`);
    const current = (await service.claimOidcLogout(sid, "new-worker"))!;
    old.cleanupComplete = true;
    old.clientIds = [];
    expect(await service.saveOidcLogout(old, "old-worker")).toBe(false);
    expect(current.clientIds.sort()).toEqual(["cospace", "yucer"]);
    current.cleanupComplete = true;
    current.clientIds = [];
    expect(await service.saveOidcLogout(current, "new-worker")).toBe(true);
    expect(await raw.exists(`${prefix}oidc:logout:work:${sid}`)).toBe(0);
  });

  it("does not touch a different account or the independent workforce session", async () => {
    const old = await seed();
    const next = await seed();
    const operator = await seed("workforce");
    await service.beginOidcLogout(old);
    expect(
      await service.checkOidcSessionStatus(next, "yucer", "customer", false),
    ).toMatchObject({ valid: true });
    expect(
      await service.checkOidcSessionStatus(
        operator,
        "yucer",
        "workforce",
        false,
      ),
    ).toMatchObject({ valid: true });
  });

  it("handles expired sessions and Lua empty arrays without inventing a recipient", async () => {
    const work = await service.beginOidcLogout(randomUUID());
    expect(work.sub).toBeNull();
    expect(work.clientIds).toEqual([]);
  });

  it("recovers a missing due index without overwriting existing progress", async () => {
    const sid = await seed();
    const work = await service.beginOidcLogout(sid);
    await raw.zrem(`${prefix}oidc:logout:pending`, sid);
    expect(await service.beginOidcLogout(sid)).toEqual(work);
    expect(await service.pendingOidcLogouts()).toContain(sid);
  });

  it("repeated retirement is atomic under concurrent callers", async () => {
    const sid = await seed();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.beginOidcLogout(sid)),
    );
    for (const work of results) {
      expect([...work.clientIds].sort()).toEqual(["cospace", "yucer"]);
      expect(work.sub).toBe("usr_synthetic");
    }
    expect(await service.getOidcSession(sid)).toBeNull();
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.claimOidcLogout(sid, `worker-${index}`),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("retains original queue age across retries and removes the age index on completion", async () => {
    const sid = await seed();
    await service.beginOidcLogout(sid);
    const now = Number((await raw.time())[0]);
    await raw.zadd(`${prefix}oidc:logout:created`, now - 120, sid);
    const work = (await service.claimOidcLogout(sid, "metrics-worker"))!;
    work.attempts = 4;
    await service.saveOidcLogout(work, "metrics-worker");
    const summary = await service.oidcLogoutBacklog();
    expect(summary.oldestAgeSeconds).toBeGreaterThanOrEqual(120);
    expect(summary.clients.yucer?.maxAttempts).toBe(4);
    expect(await raw.zscore(`${prefix}oidc:logout:created`, sid)).toBe(
      String(now - 120),
    );
    const done = (await service.claimOidcLogout(sid, "done-worker"))!;
    done.cleanupComplete = true;
    done.clientIds = [];
    await service.saveOidcLogout(done, "done-worker");
    expect(await raw.zscore(`${prefix}oidc:logout:created`, sid)).toBeNull();
  });

  it("reports bounded samples and legacy age gaps without leaking session metadata", async () => {
    const isolatedPrefix = `vxtest-monitor-${randomUUID()}:`;
    const isolated = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: isolatedPrefix },
    } as ConstructorParameters<typeof RedisService>[0]);
    await isolated.onModuleInit();
    try {
      expect(await isolated.oidcLogoutBacklog()).toMatchObject({
        pending: 0,
        unknownAge: 0,
        sampled: 0,
      });
      const now = Number((await raw.time())[0]);
      for (let i = 0; i < 25; i++) {
        const sid = `synthetic-${i}`;
        await raw.zadd(`${isolatedPrefix}oidc:logout:pending`, now + i, sid);
        await raw.set(
          `${isolatedPrefix}oidc:logout:work:${sid}`,
          i === 0
            ? "malformed"
            : JSON.stringify({
                sid,
                sub: "usr_synthetic",
                clientIds: ["cospace"],
                attempts: 3,
              }),
        );
      }
      const summary = await isolated.oidcLogoutBacklog();
      expect(summary).toMatchObject({
        pending: 25,
        unknownAge: 25,
        sampled: 20,
        corruptSamples: 1,
        clients: { cospace: { pending: 19, maxAttempts: 3 } },
      });
      expect(JSON.stringify(summary)).not.toMatch(/usr_synthetic|synthetic-/);
    } finally {
      const keys = await raw.keys(`${isolatedPrefix}*`);
      if (keys.length) await raw.del(...keys);
      await isolated.onModuleDestroy();
    }
  });
});
