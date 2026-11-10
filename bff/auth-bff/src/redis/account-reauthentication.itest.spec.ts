/**
 * Real Redis ownership proof CAS, fixed TTL and namespace isolation.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";
const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-reauth-${randomUUID()}:`;

// ============================================================================
// Isolated test keys; never flush a shared Redis database.
// ============================================================================
describe.runIf(RUN)("account reauthentication Redis lifecycle", () => {
  let raw: Redis;
  let service: RedisService;
  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    service = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await service.onModuleInit();
  });
  afterAll(async () => {
    if (!raw) return;
    const keys = await raw.keys(`${PREFIX}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });
  it("creates once and updates without extending the original deadline", async () => {
    const id = randomUUID();
    expect(await service.createAccountReauthentication(id, "pending")).toBe(
      true,
    );
    expect(await service.createAccountReauthentication(id, "replaced")).toBe(
      false,
    );
    await raw.pexpire(`${PREFIX}accounts:reauth:${id}`, 2500);
    expect(
      await service.swapAccountReauthentication(id, "pending", "proof"),
    ).toBe(true);
    expect(
      await raw.pttl(`${PREFIX}accounts:reauth:${id}`),
    ).toBeLessThanOrEqual(2500);
    expect(await service.readAccountReauthentication(id)).toBe("proof");
  });
  it("allows exactly one consumer and cannot resurrect expired proofs", async () => {
    const id = randomUUID();
    await service.createAccountReauthentication(id, "proof");
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        service.swapAccountReauthentication(id, "proof", null),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await service.swapAccountReauthentication(id, "proof", "pending"),
    ).toBe(false);
  });
  it("does not touch login, enrollment or another ticket", async () => {
    const id = randomUUID(),
      other = randomUUID();
    await service.createAccountReauthentication(id, "proof");
    await service.createAccountReauthentication(other, "other");
    await raw.set(`${PREFIX}accounts:ceremony:${id}`, "enrollment");
    await raw.del(`${PREFIX}accounts:reauth:${id}`);
    expect(
      await service.swapAccountReauthentication(id, "proof", "renewed"),
    ).toBe(false);
    expect(await service.readAccountReauthentication(other)).toBe("other");
    expect(await raw.get(`${PREFIX}accounts:ceremony:${id}`)).toBe(
      "enrollment",
    );
  });
});
