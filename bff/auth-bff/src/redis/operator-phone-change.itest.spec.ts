/**
 * Workforce phone-change Lua atomicity tests against an explicitly configured Redis.
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
// Isolated live-store fixture
// ============================================================================

const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-phone-change-${randomUUID()}:`;
const PHONE = "13800000000";

describe.runIf(RUN)("workforce phone-change Redis atomicity", () => {
  let raw: Redis;
  let service: RedisService;
  const key = (id: string) => `${PREFIX}operator:phone-change:${id}`;
  const budgetKey = (id: string) =>
    `${PREFIX}operator:phone-change-budget:${id}`;

  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    service = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await service.onModuleInit();
  });

  afterAll(async () => {
    // Only remove the random namespace created by this test suite.
    const keys = await raw.keys(`${PREFIX}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });

  async function ready() {
    const id = randomUUID();
    const version = await service.beginOperatorPhoneChange(id, "sid-a", PHONE);
    expect(version).toBeTypeOf("string");
    expect(await service.finishOperatorPhoneChange(id, version!, false)).toBe(
      true,
    );
    return id;
  }

  // ============================================================================
  // Binding, lifetime and single-use proofs
  // ============================================================================

  it("blocks verification during send and limits sends across sessions", async () => {
    const id = randomUUID();
    const version = await service.beginOperatorPhoneChange(id, "sid-a", PHONE);
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
    expect(
      await service.beginOperatorPhoneChange(id, "sid-b", PHONE),
    ).toBeNull();
    expect(await service.finishOperatorPhoneChange(id, version!, true)).toBe(
      true,
    );
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
  });

  it("binds verification to the account, session and exact target", async () => {
    const id = await ready();
    expect(
      await service.attemptOperatorPhoneChange(
        "another-account",
        "sid-a",
        PHONE,
      ),
    ).toBeNull();
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-b", PHONE),
    ).toBeNull();
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", "13900000000"),
    ).toBeNull();
    const attempt = await service.attemptOperatorPhoneChange(
      id,
      "sid-a",
      PHONE,
    );
    expect(await service.finishOperatorPhoneChange(id, attempt!, true)).toBe(
      true,
    );
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
    expect(await service.finishOperatorPhoneChange(id, attempt!, true)).toBe(
      false,
    );
  });

  it("allows exactly one concurrent verification and one consumer", async () => {
    const id = await ready();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
      ),
    );
    const winners = attempts.filter(
      (version): version is string => version !== null,
    );
    expect(winners).toHaveLength(1);
    const consumed = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.finishOperatorPhoneChange(id, winners[0]!, true),
      ),
    );
    expect(consumed.filter(Boolean)).toHaveLength(1);
  });

  it("caps attempts at five, including provider failures, without renewing expiry", async () => {
    const id = await ready();
    await raw.pexpire(key(id), 120000);
    const before = await raw.pttl(key(id));
    for (let i = 0; i < 5; i++) {
      const version = await service.attemptOperatorPhoneChange(
        id,
        "sid-a",
        PHONE,
      );
      expect(version).toBeTypeOf("string");
      await service.finishOperatorPhoneChange(id, version!, false);
    }
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
    expect(await raw.exists(key(id))).toBe(0);
    const other = await ready();
    await raw.pexpire(key(other), before);
    const version = await service.attemptOperatorPhoneChange(
      other,
      "sid-a",
      PHONE,
    );
    await service.finishOperatorPhoneChange(other, version!, false);
    expect(await raw.pttl(key(other))).toBeLessThanOrEqual(before);
  });

  it("rejects a provider result after the pending record has expired", async () => {
    const id = await ready();
    const version = await service.attemptOperatorPhoneChange(
      id,
      "sid-a",
      PHONE,
    );
    await raw.pexpire(key(id), 0);
    expect(await service.finishOperatorPhoneChange(id, version!, true)).toBe(
      false,
    );
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
  });

  it("prevents an old provider result or cleanup from consuming a newer resend", async () => {
    const id = await ready();
    const old = await service.attemptOperatorPhoneChange(id, "sid-a", PHONE);
    await raw.pexpire(budgetKey(id), 0);
    const next = await service.beginOperatorPhoneChange(id, "sid-b", PHONE);
    expect(await service.finishOperatorPhoneChange(id, old!, true)).toBe(false);
    expect(await service.finishOperatorPhoneChange(id, old!, false)).toBe(
      false,
    );
    expect(await service.finishOperatorPhoneChange(id, next!, false)).toBe(
      true,
    );
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-a", PHONE),
    ).toBeNull();
    expect(
      await service.attemptOperatorPhoneChange(id, "sid-b", PHONE),
    ).toBeTypeOf("string");
  });

  it("serializes resend budget reservations across concurrent requests", async () => {
    const id = randomUUID();
    const versions = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service.beginOperatorPhoneChange(id, `sid-${i}`, PHONE),
      ),
    );
    expect(versions.filter((version) => version !== null)).toHaveLength(1);
    expect(await raw.ttl(budgetKey(id))).toBeGreaterThan(0);
    expect(await raw.ttl(key(id))).toBeLessThanOrEqual(300);
  });
});
