/**
 * Atomic RP refresh and revocation against an isolated live Redis namespace.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RpSessionStore } from "./rp-session.store";
import type { RpSession } from "./types";

// ============================================================================
// Explicit test Redis only; production configuration is never used
// ============================================================================

const url = process.env.REDIS_ITEST_URL;
describe.runIf(!!url)("RP session revocation (live Redis)", () => {
  const redis = new Redis(url ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
  });
  const prefix = `vxtest-rp-${randomUUID()}:`;
  const store = new RpSessionStore(redis, "console", prefix);
  const original: RpSession = {
    sid: "synthetic-central",
    sub: "usr_synthetic",
    idToken: "synthetic-id",
    accessToken: "synthetic-access",
    refreshToken: "synthetic-refresh",
    accessExpiresAt: 100,
  };
  const rotated = {
    ...original,
    accessToken: "rotated-access",
    refreshToken: "rotated-refresh",
  };
  beforeEach(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("rotates only the expected generation and maintains the TTL and sid index", async () => {
    await store.create("rotation", original, 120);
    expect(await store.update("rotation", rotated, 60, original)).toBe(true);
    expect(await store.update("rotation", original, 60, original)).toBe(false);
    expect(await store.get("rotation")).toEqual(rotated);
    expect(
      await redis.ttl(`${prefix}rp:console:sess:rotation`),
    ).toBeGreaterThan(0);
    expect(
      await redis.smembers(`${prefix}rp:console:sididx:${original.sid}`),
    ).toContain("rotation");
  });

  it("never recreates deleted sessions or affects another client namespace", async () => {
    const other = new RpSessionStore(redis, "website", prefix);
    await store.create("revoked", original, 120);
    await other.create("revoked", original, 120);
    await store.destroyBySid(original.sid);
    expect(await store.update("revoked", rotated, 60, original)).toBe(false);
    expect(await store.get("revoked")).toBeNull();
    expect(await other.get("revoked")).toEqual(original);
    expect(
      await redis.exists(`${prefix}rp:console:sididx:${original.sid}`),
    ).toBe(0);
  });

  it("cannot erase a concurrent winner when a stale refresh fails", async () => {
    await store.create("winner", original, 120);
    await store.update("winner", rotated, 60, original);
    await store.destroy("winner", original);
    expect(await store.get("winner")).toEqual(rotated);
    await store.destroy("winner", rotated);
    expect(await store.get("winner")).toBeNull();
  });

  it("rejects identity replacement and expired sessions", async () => {
    await store.create("identity", original, 120);
    expect(
      await store.update(
        "identity",
        { ...rotated, sub: "usr_other" },
        60,
        original,
      ),
    ).toBe(false);
    expect(
      await store.update(
        "identity",
        { ...rotated, sid: "other-central" },
        60,
        original,
      ),
    ).toBe(false);
    await redis.del(`${prefix}rp:console:sess:identity`);
    expect(await store.update("identity", rotated, 60, original)).toBe(false);
  });
});
