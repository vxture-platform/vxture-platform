/**
 * native-auth.spec.ts —— 桌面端会话领取的四条判据（2026-09-12）。
 *
 * 这是认证代码，每一条失败都是安全问题而不是功能问题，所以逐条钉住：
 *
 *   1. **平台永远不存 deviceSecret**。键按 `sha256(secret)` 索引——Redis 被读走时，
 *      里面没有任何能直接换会话的东西。
 *   2. **领取是一次性的**。走 `getdel` 而不是 get + del：两个进程同时轮询同一个
 *      secret 时只有一个能拿到，分成两步会开一个双领窗口。
 *   3. **未就绪回 404，不是 401**。401 会让调用方以为凭据错了而停止重试，
 *      而这里正确的反应是继续轮询。
 *   4. **handle 形状不合法就不绑**。它直接进 Redis 键，不校验等于让调用方决定键名。
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type Redis from "ioredis";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  NATIVE_PENDING_TTL_SEC,
  NativeAuthRouter,
  bindNativePending,
  nativePendingKey,
} from "./native-auth.router";
import type { RpRuntime } from "../oidc/oidc-rp.tokens";

const PREFIX = "vx:";
const SECRET = "a".repeat(64);
const HANDLE = createHash("sha256").update(SECRET).digest("hex");

function makeRedis(seeded?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seeded ?? {}));
  const setexCalls: Array<{ key: string; ttl: number; value: string }> = [];
  const redis = {
    getdel: vi.fn(async (key: string) => {
      const hit = store.get(key) ?? null;
      store.delete(key);
      return hit;
    }),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      setexCalls.push({ key, ttl, value });
      store.set(key, value);
      return "OK";
    }),
  };
  return { redis: redis as unknown as Redis, store, setexCalls };
}

function makeRouter(redis: Redis) {
  const rt = {
    keyPrefix: PREFIX,
    config: { sessionTtlSec: 3600 },
  } as unknown as RpRuntime;
  return new NativeAuthRouter(redis, rt);
}

describe("桌面端领取会话", () => {
  it("按 sha256(secret) 找键——平台不存 secret 原文", async () => {
    const key = nativePendingKey(PREFIX, HANDLE);
    const { redis } = makeRedis({
      [key]: JSON.stringify({ rpsid: "sess-1", createdAt: Date.now() }),
    });
    const out = await makeRouter(redis).claim({ deviceSecret: SECRET });
    expect(out.rpsid).toBe("sess-1");

    /* 决定性的一条：查的那个键里**不含** secret 原文。
       写死键名会让这条测试跟着实现一起错，所以从 secret 现算一遍哈希去比。 */
    const asked = vi.mocked(redis.getdel).mock.calls[0]?.[0] as string;
    expect(asked).toContain(HANDLE);
    expect(asked).not.toContain(SECRET);
  });

  it("领一次就没了——重放同一个 secret 拿不到第二次", async () => {
    const { redis } = makeRedis({
      [nativePendingKey(PREFIX, HANDLE)]: JSON.stringify({
        rpsid: "sess-1",
        createdAt: Date.now(),
      }),
    });
    const router = makeRouter(redis);
    await expect(router.claim({ deviceSecret: SECRET })).resolves.toMatchObject(
      { rpsid: "sess-1" },
    );
    await expect(router.claim({ deviceSecret: SECRET })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("用 getdel 而不是 get + del——双领窗口不能存在", async () => {
    const { redis } = makeRedis({
      [nativePendingKey(PREFIX, HANDLE)]: JSON.stringify({
        rpsid: "sess-1",
        createdAt: Date.now(),
      }),
    });
    await makeRouter(redis).claim({ deviceSecret: SECRET });
    /* 读与删必须是同一次往返。拆成两步时，两个并发轮询都会读到同一条。 */
    expect(redis.getdel).toHaveBeenCalledTimes(1);
    expect((redis as unknown as { del?: unknown }).del).toBeUndefined();
  });

  it("还没登录完 → 404，不是 401", async () => {
    const { redis } = makeRedis();
    await expect(
      makeRouter(redis).claim({ deviceSecret: SECRET }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("secret 太短 → 400，且一次 Redis 都没查", async () => {
    const { redis } = makeRedis();
    await expect(
      makeRouter(redis).claim({ deviceSecret: "short" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });
});

describe("回调侧绑定", () => {
  it("绑定写的是 handle 键，值里只有 rpsid", async () => {
    const { redis, setexCalls } = makeRedis();
    const ok = await bindNativePending(redis, PREFIX, HANDLE, "sess-9");
    expect(ok).toBe(true);

    const call = setexCalls[0]!;
    expect(call.key).toBe(nativePendingKey(PREFIX, HANDLE));
    expect(call.ttl).toBe(NATIVE_PENDING_TTL_SEC);
    expect(JSON.parse(call.value)).toMatchObject({ rpsid: "sess-9" });
  });

  it.each([
    ["空", ""],
    ["太短", "abc"],
    ["非 hex", "z".repeat(64)],
    ["带路径分隔符", "../".padEnd(64, "a")],
  ])("handle %s → 不绑，且一次都没写 Redis", async (_name, bad) => {
    /* handle 直接进 Redis 键名。不校验就是让调用方决定键长什么样——
       `../` 那一条尤其：键空间里能不能爬出去取决于前缀实现，不该赌。 */
    const { redis } = makeRedis();
    await expect(bindNativePending(redis, PREFIX, bad, "sess-9")).resolves.toBe(
      false,
    );
    expect(redis.setex).not.toHaveBeenCalled();
  });
});
