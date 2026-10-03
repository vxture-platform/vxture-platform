/**
 * accounts-read-gate.spec.ts — 账号三个读入口判 user:profile.read（2026-10-04 拆门）。
 *
 * 此前判遗留扁平码 platform.tenant.manage（旧桥从 tenant:profile.manage 合成）：目录里
 * 持 user:profile.read 的 finance / support / auditor 看得见账号页却 403；反过来，能改租户
 * 资料的人（tenant:profile.manage）凭那个合成码读得到全部账号，与目录无关。
 * 这里钉两头：读码进得来；租户资料码与账号生命周期码都进不来。
 */
import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";
import { AccountsRouter } from "./accounts.router";
import type { RequestContext } from "../types/console.types";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

function emptyRoPool() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return {
    pool: {
      query,
      connect: vi.fn(() => {
        throw new Error("read path must not take a client");
      }),
    } as unknown as Pool,
    query,
  };
}

function noDbPool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("DB must not be touched");
    }),
    connect: vi.fn(() => {
      throw new Error("DB must not be touched");
    }),
  } as unknown as Pool;
}

function noOperatorAdmin() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`must not touch OperatorAdminService.${String(prop)}`);
      },
    },
  ) as never;
}

describe("GET /api/accounts 的读门", () => {
  it("user:profile.read → 过门，列表落到只读池", async () => {
    const ro = emptyRoPool();
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    await expect(
      router.listAccounts(makeReq(["user:profile.read"])),
    ).resolves.toEqual([]);
    expect(ro.query).toHaveBeenCalledTimes(1);
  });

  it("tenant:profile.manage（旧桥的来源码）→ 403，且没碰库", async () => {
    const ro = emptyRoPool();
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    await expect(
      router.listAccounts(makeReq(["tenant:profile.manage"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ro.query).not.toHaveBeenCalled();
  });

  it("user:account.manage（生命周期写码）不蕴含读 → 403", async () => {
    const ro = emptyRoPool();
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    await expect(
      router.listAccounts(makeReq(["user:account.manage"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ro.query).not.toHaveBeenCalled();
  });

  it("详情与头像读同一道门", async () => {
    const ro = emptyRoPool();
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    const id = "44444444-4444-4444-8444-444444444444";
    await expect(
      router.getAccount(makeReq(["tenant:profile.manage"]), id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      router.getAccountAvatar(makeReq(["tenant:profile.manage"]), id, {
        status: vi.fn().mockReturnThis(),
        end: vi.fn(),
        setHeader: vi.fn(),
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ro.query).not.toHaveBeenCalled();
    /* 读码进得来：详情查不到行是 404（NotFound），不是 403。 */
    await expect(
      router.getAccount(makeReq(["user:profile.read"]), id),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });
});
