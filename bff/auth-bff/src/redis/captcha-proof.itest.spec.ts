/**
 * Live Redis captcha proof lifetime and concurrency regression coverage.
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

const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-captcha-${randomUUID()}:`;

// ============================================================================
// Isolated live Redis fixture
// ============================================================================

describe.runIf(RUN)("captcha proof atomicity", () => {
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
    const keys = await raw.keys(`${PREFIX}*`);
    if (keys.length) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });

  // ============================================================================
  // Realm boundaries, expiry, replay and concurrency
  // ============================================================================

  it("permits only the owning realm and a single consumer", async () => {
    const token = randomUUID();
    await service.storeCaptchaProof(token, "customer");
    expect(await service.consumeCaptchaProof(token, "workforce")).toBe(false);
    expect(await service.consumeCaptchaProof(token, "customer")).toBe(true);
    expect(await service.consumeCaptchaProof(token, "customer")).toBe(false);
  });
  it("sets a short lifetime and rejects expired/missing proofs", async () => {
    const token = randomUUID();
    await service.storeCaptchaProof(token, "workforce");
    expect(
      await raw.ttl(`${PREFIX}captcha:proof:${token}`),
    ).toBeLessThanOrEqual(120);
    await raw.pexpire(`${PREFIX}captcha:proof:${token}`, 0);
    expect(await service.consumeCaptchaProof(token, "workforce")).toBe(false);
    expect(await service.consumeCaptchaProof(randomUUID(), "customer")).toBe(
      false,
    );
  });
  it("allows exactly one concurrent proof consumer", async () => {
    const token = randomUUID();
    await service.storeCaptchaProof(token, "workforce");
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        service.consumeCaptchaProof(token, "workforce"),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("reserves a provider ceremony once across concurrent verification requests", async () => {
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        service.reserveCaptchaCeremony("scene", id),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("allows at most thirty provider verification attempts per IP/window", async () => {
    const ip = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => service.reserveCaptchaVerification(ip)),
    );
    expect(results.filter(Boolean)).toHaveLength(30);
    expect(await service.reserveCaptchaVerification(randomUUID())).toBe(true);
  });
});
