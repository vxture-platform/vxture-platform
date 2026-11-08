/**
 * Customer security endpoint and persistence regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-self-security-${randomUUID()}:`;

// ============================================================================
// Actual Lua atomicity, TTL and budgets in an isolated Redis namespace
// ============================================================================

describe.runIf(RUN)("customer security Redis authority", () => {
  let raw: Redis;
  let store: RedisService;
  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    store = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await store.onModuleInit();
  });
  afterAll(async () => {
    if (raw) {
      const keys = await raw.keys(PREFIX + "*");
      if (keys.length) await raw.del(...keys);
      await store.onModuleDestroy();
      await raw.quit();
    }
  });
  it("admits exactly one concurrent proof consumer", async () => {
    const id = randomUUID();
    expect(await store.createCustomerSecurity(id, "ready")).toBe(true);
    const wins = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.swapCustomerSecurity(id, "ready", null),
      ),
    );
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await store.readCustomerSecurity(id)).toBeNull();
  });
  it("does not reset expiry or permit late completion to recreate an expired proof", async () => {
    const id = randomUUID();
    await store.createCustomerSecurity(id, "sending");
    const keys = await raw.keys(PREFIX + "customer-security:ceremony:*");
    expect(keys).toHaveLength(1);
    await raw.pexpire(keys[0]!, 2000);
    await store.swapCustomerSecurity(id, "sending", "ready");
    expect(await raw.pttl(keys[0]!)).toBeLessThanOrEqual(2000);
    await raw.pexpire(keys[0]!, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await store.swapCustomerSecurity(id, "ready", "authorized")).toBe(
      false,
    );
    expect(await store.readCustomerSecurity(id)).toBeNull();
  });
  it("reserves a shared send budget atomically", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.reserveCustomerSecurityBudget(key),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("will not allow an older callback to overwrite a newer state", async () => {
    const id = randomUUID();
    await store.createCustomerSecurity(id, "a");
    expect(await store.swapCustomerSecurity(id, "a", "b")).toBe(true);
    expect(await store.swapCustomerSecurity(id, "a", "ready")).toBe(false);
    expect(await store.readCustomerSecurity(id)).toBe("b");
  });
});
