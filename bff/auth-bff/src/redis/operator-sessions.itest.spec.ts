/**
 * operator-sessions.itest.spec.ts —— 运营者中央会话索引（真 Redis）。
 *
 * 在线会话页按这份索引列出「谁登录着」。要验的是四件事：索引上线前就存在的会话被补录、
 * 新会话入索引、删掉 / 过期的会话出索引、客户会话（customer realm）不进来。
 *
 * 跑法：本机起 Redis 后 `AUTH_ITEST=1 REDIS_ITEST_URL=redis://127.0.0.1:6379 npx vitest run
 * src/redis/operator-sessions.itest.spec.ts`。键前缀带时间戳，跑完删干净。
 */
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisService } from "./redis.service";

const RUN = process.env.AUTH_ITEST === "1" && !!process.env.REDIS_ITEST_URL;
const PREFIX = `vxtest-opr-${Date.now()}:`;

describe.runIf(RUN)("operator central session index (live Redis)", () => {
  const url = process.env.REDIS_ITEST_URL ?? "";
  const service = new RedisService({
    redis: { REDIS_URL: url, REDIS_KEY_PREFIX: PREFIX },
  } as unknown as ConstructorParameters<typeof RedisService>[0]);
  const raw = new Redis(url);
  const now = Math.floor(Date.now() / 1000);

  const workforce = (sub: string) => ({
    sub,
    realm: "workforce",
    authMethod: "password+totp",
    amr: ["pwd", "otp"],
    createdAt: now - 60,
    lastActiveAt: now - 60,
    absExpiresAt: now + 3600,
  });

  beforeAll(async () => {
    await service.onModuleInit();
  });

  afterAll(async () => {
    const keys = await raw.keys(`${PREFIX}*`);
    if (keys.length > 0) await raw.del(...keys);
    await service.onModuleDestroy();
    await raw.quit();
  });

  it("补录旧会话、收新会话、剔除删掉与过期的、不收客户会话", async () => {
    /* 索引上线前写下的会话：只有 hash，不在索引里。 */
    await raw.hset(`${PREFIX}sess:before-index`, {
      sub: "opr_a",
      realm: "workforce",
      authMethod: "password",
      amr: "[]",
      createdAt: String(now - 600),
      lastActiveAt: String(now - 600),
      absExpiresAt: String(now + 3600),
    });
    await raw.sadd(`${PREFIX}sess:before-index:clients`, "arche", "admin");

    await service.createOidcSession("fresh", workforce("opr_b"), 3600);
    await service.createOidcSession(
      "customer",
      { ...workforce("usr_c"), realm: "customer" },
      3600,
    );

    let sessions = await service.listOperatorSessions();
    expect(sessions.map((s) => s.sid).sort()).toEqual([
      "before-index",
      "fresh",
    ]);
    expect(
      sessions.find((s) => s.sid === "before-index")?.clients.sort(),
    ).toEqual(["admin", "arche"]);

    await service.deleteOidcSession("before-index");
    /* 索引里过期、hash 却还在（TTL 未到）的成员按分值剪掉。 */
    await raw.zadd(`${PREFIX}opr:sessions`, now - 1, "expired");
    /* 索引里有、hash 已不在（TTL 到期）的成员顺手移出。 */
    await raw.zadd(`${PREFIX}opr:sessions`, now + 3600, "vanished");

    sessions = await service.listOperatorSessions();
    expect(sessions.map((s) => s.sid)).toEqual(["fresh"]);
    expect(await raw.zscore(`${PREFIX}opr:sessions`, "expired")).toBeNull();
    expect(await raw.zscore(`${PREFIX}opr:sessions`, "vanished")).toBeNull();
  });
});
