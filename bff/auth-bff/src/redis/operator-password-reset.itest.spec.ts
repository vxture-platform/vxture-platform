/**
 * Workforce recovery and credential transaction regressions.
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
const PREFIX = `vxtest-op-reset-${randomUUID()}:`;

// ============================================================================
// Real Redis: isolated key prefix, never flush shared databases.
// ============================================================================
describe.runIf(RUN)("operator reset atomic lifecycle", () => {
  let raw: Redis;
  let service: RedisService;
  const proof = {
    operatorId: "op-1",
    email: "owner@example.test",
    credentialVersion: "a".repeat(64),
  };
  beforeAll(async () => {
    const url = process.env.REDIS_ITEST_URL!;
    raw = new Redis(url);
    service = new RedisService({
      redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
    } as never);
    await service.onModuleInit();
  });
  afterAll(async () => {
    if (raw) {
      const keys = await raw.keys(`${PREFIX}*`);
      if (keys.length) await raw.del(...keys);
      await service.onModuleDestroy();
      await raw.quit();
    }
  });
  it("allows only the latest concurrent issue to be consumed", async () => {
    const tokens = Array.from({ length: 16 }, () => randomUUID());
    await Promise.all(
      tokens.map((token) =>
        service.storeOperatorPasswordReset(token, proof, 120),
      ),
    );
    const results = await Promise.all(
      tokens.map((token) => service.consumeOperatorPasswordReset(token)),
    );
    expect(results.filter(Boolean)).toEqual([proof]);
  });
  it("allows exactly one concurrent consumer", async () => {
    const token = randomUUID();
    await service.storeOperatorPasswordReset(token, proof, 120);
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        service.consumeOperatorPasswordReset(token),
      ),
    );
    expect(results.filter(Boolean)).toEqual([proof]);
  });
  it("refuses legacy bindings and an owner pointer replaced by another issue", async () => {
    const token = randomUUID();
    await raw.set(
      `${PREFIX}operator:pwreset:${token}`,
      JSON.stringify({ operatorId: proof.operatorId }),
    );
    expect(await service.consumeOperatorPasswordReset(token)).toBeNull();
    await service.storeOperatorPasswordReset(token, proof, 120);
    await raw.set(
      `${PREFIX}operator:pwreset:by-op:${proof.operatorId}`,
      "newer",
    );
    expect(await service.consumeOperatorPasswordReset(token)).toBeNull();
    expect(
      await raw.get(`${PREFIX}operator:pwreset:by-op:${proof.operatorId}`),
    ).toBe("newer");
  });
  it("expires proofs without touching another operator", async () => {
    const token = randomUUID(),
      other = randomUUID();
    await service.storeOperatorPasswordReset(token, proof, 120);
    await service.storeOperatorPasswordReset(
      other,
      { ...proof, operatorId: "op-2" },
      120,
    );
    await raw.pexpire(`${PREFIX}operator:pwreset:${token}`, 0);
    expect(await service.consumeOperatorPasswordReset(token)).toBeNull();
    expect(
      (await service.consumeOperatorPasswordReset(other))?.operatorId,
    ).toBe("op-2");
  });
});
