/**
 * suspension-estimate-edit.spec.ts —— 改「预计恢复时间」的那个入口（2026-09-26）。
 *
 * 【为什么有这个端点】这一列是按**可改**设计的（迁移里写着：一个改不了的估计比没有更糟
 * ——维护拖长了、审查提前结束了，运营该能改它）。可列锁放开了之后，**只有暂停那一刻能
 * 写它**，没有任何修改入口：典型的「做了没接」。
 *
 * 【这一层要钉什么】
 *   ① 只认**进行中**的那次暂停。已经闭合的不该再被改——那个估计已经没有意义，改它只会
 *      让审计看起来像有人在事后修饰。没有进行中的暂停 → 409，不是静默 0 行。
 *   ② **不校验时间是否晚于现在**。运营填错了是个可改的估计，不是该被拒的事；界面过点
 *      之后落回「已暂停 N 天」，不翻负数。但解析不出来的值要拒——那说明送来的不是时间。
 *   ③ **要留痕**。它不改状态、不触发钩子、不发通知，但得让运营记录里看得见谁在什么时候
 *      改成了什么。清空也要留痕。
 *   ④ 权限先于一切：没权限时一次都不碰库。
 */
import { describe, it, expect, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { SubscriptionsRouter } from "./subscriptions.router";
import type { RequestContext } from "../types/console.types";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

const MANAGE = ["commerce:subscription.manage"];

/** 事务池：记下每条 SQL 与参数；episode 更新按 `openEpisode` 决定回不回行。 */
function makeRwPool(openEpisode: boolean) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    calls.push({ sql: text, params: params ?? [] });
    if (/update metering\.subscription_suspensions/i.test(text)) {
      return { rows: openEpisode ? [{ tenant_id: TENANT_ID }] : [] };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect, query: vi.fn() } as unknown as Pool;
  const find = (needle: RegExp) =>
    calls.find((c) => needle.test(c.sql.toLowerCase()));
  const outcome = () => {
    const norm = calls.map((c) => c.sql.trim().toLowerCase());
    return {
      committed: norm.includes("commit"),
      rolledBack: norm.includes("rollback"),
    };
  };
  return { pool, connect, calls, find, outcome };
}

/** 只读池：resolveSubscriptionId（传 UUID 时不走它）+ 详情读回（回空 → 404）。 */
function makeRoPool() {
  return {
    query: vi.fn(async () => ({ rows: [] as unknown[] })),
  } as unknown as Pool;
}

function makeRouter(openEpisode = true) {
  const rw = makeRwPool(openEpisode);
  const router = new SubscriptionsRouter(
    makeRoPool(),
    rw.pool,
    {} as unknown as SubscriptionService,
    {} as unknown as OrderService,
  );
  return { router, rw };
}

/** 详情读回会 404（只读池回空）——到那一步事务已经提交，本线只看写了什么。 */
async function run(
  router: SubscriptionsRouter,
  body: Record<string, unknown>,
  capabilities = MANAGE,
): Promise<unknown> {
  return router
    .updateSuspensionEstimate(makeReq(capabilities), SUB_ID, body)
    .catch((e: unknown) => e);
}

describe("权限", () => {
  it("没有 commerce:subscription.manage → 403，且一次都没碰库", async () => {
    const { router, rw } = makeRouter();
    const err = await run(router, { expectedResumeAt: null }, [
      "commerce:subscription.read",
    ]);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});

describe("只认进行中的那次暂停", () => {
  it("有进行中的 → 写进去并提交", async () => {
    const { router, rw } = makeRouter(true);
    await run(router, { expectedResumeAt: "2026-10-01T03:00:00.000Z" });
    const upd = rw.find(/update metering\.subscription_suspensions/);
    expect(upd).toBeDefined();
    expect(upd?.sql.toLowerCase()).toContain("resumed_at is null");
    expect(upd?.params[0]).toBe(SUB_ID);
    expect(upd?.params[1]).toBe("2026-10-01T03:00:00.000Z");
    expect(rw.outcome().committed).toBe(true);
  });

  it("没有进行中的 → 409 且回滚，不静默当成功", async () => {
    const { router, rw } = makeRouter(false);
    const err = await run(router, { expectedResumeAt: null });
    expect(err).toBeInstanceOf(ConflictException);
    const o = rw.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
  });
});

describe("取值：不判早晚，只判解析得出来", () => {
  it("过去的时间也收 —— 填错了是可改的估计，不是该被拒的事", async () => {
    const { router, rw } = makeRouter();
    await run(router, { expectedResumeAt: "2020-01-01T00:00:00.000Z" });
    expect(rw.outcome().committed).toBe(true);
  });

  it("null / 空串 = 清空（客户界面随即不再倒计时）", async () => {
    for (const raw of [null, ""]) {
      const { router, rw } = makeRouter();
      await run(router, { expectedResumeAt: raw });
      expect(
        rw.find(/update metering\.subscription_suspensions/)?.params[1],
      ).toBeNull();
    }
  });

  it("解析不出来 → 400，且一次都没碰库", async () => {
    const { router, rw } = makeRouter();
    const err = await run(router, { expectedResumeAt: "下周三吧" });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("送了个非字符串 → 400", async () => {
    const { router } = makeRouter();
    expect(
      await run(router, { expectedResumeAt: 1759280400000 }),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe("留痕", () => {
  it("写一条 subscription_histories，from/to 都是 suspended（它不是状态转移）", async () => {
    const { router, rw } = makeRouter();
    await run(router, { expectedResumeAt: "2026-10-01T03:00:00.000Z" });
    const hist = rw.find(/insert into metering\.subscription_histories/);
    expect(hist).toBeDefined();
    // $1 tenant / $2 sub / $3 change_type / $4 from / $5 to / $6 actor / $7 remark
    expect(hist?.params[0]).toBe(TENANT_ID);
    expect(hist?.params[2]).toBe("suspension_updated");
    expect(hist?.params[3]).toBe("suspended");
    expect(hist?.params[4]).toBe("suspended");
    expect(hist?.params[6]).toContain("2026-10-01T03:00:00.000Z");
  });

  it("清空也要留痕 —— 「把倒计时撤掉」同样是运营做的一件事", async () => {
    const { router, rw } = makeRouter();
    await run(router, { expectedResumeAt: null });
    const hist = rw.find(/insert into metering\.subscription_histories/);
    expect(String(hist?.params[6])).toContain("清空");
  });
});
