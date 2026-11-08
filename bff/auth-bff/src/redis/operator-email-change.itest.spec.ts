/**
 * Workforce email proof binding and Lua atomicity against an explicit test Redis.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

// ============================================================================
// Every live test owns a random key namespace; never use the application prefix
// ============================================================================
const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-email-change-${randomUUID()}:`;
const EMAIL = "new@example.com";
const CODE = "123456";

describe.runIf(RUN)("workforce email-change Redis atomicity", () => {
  let raw: Redis;
  let service: RedisService;
  const key = (id: string) => `${PREFIX}operator:email-change:${id}`;
  const budget = (id: string) => `${PREFIX}operator:email-change-budget:${id}`;
  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    service = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await service.onModuleInit();
  });
  afterAll(async () => {
    const keys = await raw.keys(`${PREFIX}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });
  async function ready() {
    const id = randomUUID();
    const version = await service.beginOperatorEmailChange(
      id,
      "sid-a",
      EMAIL,
      CODE,
    );
    expect(await service.finishOperatorEmailChange(id, version!, false)).toBe(
      true,
    );
    return id;
  }

  // ============================================================================
  // Delivery, ownership, bounded attempts and concurrent consumption
  // ============================================================================
  it("blocks verification during dispatch and bounds sends across sessions", async () => {
    const id = randomUUID();
    const version = await service.beginOperatorEmailChange(
      id,
      "sid-a",
      EMAIL,
      CODE,
    );
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
    expect(
      await service.beginOperatorEmailChange(id, "sid-b", EMAIL, CODE),
    ).toBeNull();
    expect(await service.finishOperatorEmailChange(id, version!, true)).toBe(
      true,
    );
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
  });
  it("binds proof to account and session without consuming another session's attempts", async () => {
    const id = await ready();
    expect(
      await service.consumeOperatorEmailChange("another", "sid-a", CODE),
    ).toBeNull();
    for (let i = 0; i < 6; i++)
      expect(
        await service.consumeOperatorEmailChange(id, "sid-b", CODE),
      ).toBeNull();
    expect(await service.consumeOperatorEmailChange(id, "sid-a", CODE)).toBe(
      EMAIL,
    );
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
  });
  it("has exactly one winner under concurrent correct submissions", async () => {
    const id = await ready();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.consumeOperatorEmailChange(id, "sid-a", CODE),
      ),
    );
    expect(results.filter((value) => value === EMAIL)).toHaveLength(1);
  });
  it("caps wrong attempts and never renews the original expiry", async () => {
    const id = await ready();
    await raw.pexpire(key(id), 120000);
    const before = await raw.pttl(key(id));
    for (let i = 0; i < 4; i++)
      expect(
        await service.consumeOperatorEmailChange(id, "sid-a", "000000"),
      ).toBeNull();
    expect(await raw.pttl(key(id))).toBeLessThanOrEqual(before);
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", "000000"),
    ).toBeNull();
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
    expect(await raw.exists(key(id))).toBe(0);
  });
  it("does not let stale dispatch activate or delete a newer target", async () => {
    const id = randomUUID();
    const old = await service.beginOperatorEmailChange(
      id,
      "sid-a",
      EMAIL,
      CODE,
    );
    await raw.del(budget(id));
    const fresh = await service.beginOperatorEmailChange(
      id,
      "sid-b",
      "other@example.com",
      "654321",
    );
    expect(await service.finishOperatorEmailChange(id, old!, false)).toBe(
      false,
    );
    expect(await service.finishOperatorEmailChange(id, old!, true)).toBe(false);
    expect(await service.finishOperatorEmailChange(id, fresh!, false)).toBe(
      true,
    );
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
    expect(
      await service.consumeOperatorEmailChange(id, "sid-b", "654321"),
    ).toBe("other@example.com");
  });
  it("does not resurrect an expired proof or share the old legacy namespace", async () => {
    const id = await ready();
    await raw.del(key(id));
    await raw.setex(
      `${PREFIX}operator:contact:${id}:email`,
      600,
      JSON.stringify({ newValue: EMAIL, code: CODE }),
    );
    expect(
      await service.consumeOperatorEmailChange(id, "sid-a", CODE),
    ).toBeNull();
    expect(await raw.exists(key(id))).toBe(0);
  });
});
