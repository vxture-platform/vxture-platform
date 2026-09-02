import { describe, it, expect, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import { SubscriptionsRouter } from "./subscriptions.router";
import { PaymentsRouter } from "./payments.router";
import { TenantsRouter } from "./tenants.router";
import { BillingRouter } from "./billing.router";
import type { RequestContext } from "../types/console.types";
import { UUID_RE } from "./governance.shared";

// C16 — admin-bff transactional write-path coverage. These specs assert the two
// invariants every operator write must uphold and that tsc/lint cannot see:
//   1. Authorization is checked BEFORE any DB connection is taken (a missing
//      capability must never reach the pool — mirrors the C4/C6/TD-027 authz work).
//   2. The transaction is sound: on any thrown invariant the tx is ROLLED BACK and
//      the client is ALWAYS released; only the success path COMMITs.
// Route-declaration-order regression (the C1 defect) is covered separately by
// route-order.spec.ts — not duplicated here.

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const UUID_A = "22222222-2222-4222-8222-222222222222";

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

/** A pool whose connect/query throw if touched — proves no DB work happened. */
function noDbPool(): { pool: Pool; connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn(() => {
    throw new Error("DB must not be touched");
  });
  const query = vi.fn(() => {
    throw new Error("DB must not be touched");
  });
  return { pool: { connect, query } as unknown as Pool, connect };
}

type Responder = (sqlLower: string) => unknown[] | undefined;

/**
 * A programmable transactional client. `query` records every statement and returns
 * `{ rows }` from the responder (default []). `begin`/`commit`/`rollback` and
 * `release` are observable so a test can assert the transaction outcome.
 */
function makeTxClient(responder?: Responder) {
  const calls: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    const text = String(sql);
    calls.push(text);
    const rows = responder?.(text.toLowerCase());
    return { rows: rows ?? [] };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect, query: vi.fn() } as unknown as Pool;
  const outcome = () => {
    const norm = calls.map((c) => c.trim().toLowerCase());
    return {
      committed: norm.includes("commit"),
      rolledBack: norm.includes("rollback"),
      released: release.mock.calls.length > 0,
    };
  };
  return { pool, client, calls, release, connect, outcome };
}

/** RO pool that must not be reached (all read-back methods are stubbed in tests). */
function dummyRoPool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("RO pool must not be touched");
    }),
  } as unknown as Pool;
}

// ───────────────────────── subscriptions: 4 actions ─────────────────────────
describe("subscriptions runSubscriptionAction", () => {
  const MANAGE = ["commerce:subscription.manage"];

  it("rejects a caller without subscription.manage before any DB access", async () => {
    const rw = noDbPool();
    const router = new SubscriptionsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.runSubscriptionAction(
        makeReq(["commerce:subscription.read"]),
        UUID_A,
        {
          action: "suspend",
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("rejects an unknown action before any DB access", async () => {
    const rw = noDbPool();
    const router = new SubscriptionsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
        action: "explode" as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("404 + rollback + release when the subscription is missing", async () => {
    const tx = makeTxClient(() => []); // lock returns no row
    const router = new SubscriptionsRouter(dummyRoPool(), tx.pool);
    await expect(
      router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
        action: "suspend",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
  });

  it.each([
    ["renew", "cancelled"],
    ["suspend", "suspended"],
    ["suspend", "cancelled"],
    ["resume", "active"],
    ["cancel", "cancelled"],
  ])(
    "409 + rollback + release on invalid transition %s from %s",
    async (action, status) => {
      const tx = makeTxClient((s) =>
        s.includes("for update")
          ? [{ status, tenant_id: UUID_A, end_at: null }]
          : undefined,
      );
      const router = new SubscriptionsRouter(dummyRoPool(), tx.pool);
      await expect(
        router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
          action: action as never,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const o = tx.outcome();
      expect(o.committed).toBe(false);
      expect(o.rolledBack).toBe(true);
      expect(o.released).toBe(true);
    },
  );

  // 待收款订单壳（suspended + offline_purchase + 最新账单 unpaid/partial）：四个动作
  // 全部 409。2026-09-02 实测的缺陷：renew 把一条没收钱的订单翻成 active 并延周期，
  // 账单/付款腿纹丝不动，两端状态彻底对不上。收款只能走 orders 的 offline-payment-confirm。
  it.each(["renew", "suspend", "resume", "cancel"])(
    "409 + rollback + release on %s against a pending offline order",
    async (action) => {
      const tx = makeTxClient((s) =>
        s.includes("for update")
          ? [
              {
                status: "suspended",
                activation_method: "offline_purchase",
                latest_bill_status: "unpaid",
                tenant_id: UUID_A,
                end_at: null,
              },
            ]
          : undefined,
      );
      const router = new SubscriptionsRouter(dummyRoPool(), tx.pool);
      await expect(
        router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
          action: action as never,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const o = tx.outcome();
      expect(o.committed).toBe(false);
      expect(o.rolledBack).toBe(true);
      expect(o.released).toBe(true);
      // 没有任何 update 落库：守卫在 UPDATE 之前。
      expect(
        tx.calls.some((c) => /update metering\.subscriptions/i.test(c)),
      ).toBe(false);
    },
  );

  it("a post-activation suspended offline subscription (invoice paid) is NOT a pending order — resume commits", async () => {
    const tx = makeTxClient((s) =>
      s.includes("for update")
        ? [
            {
              status: "suspended",
              activation_method: "offline_purchase",
              latest_bill_status: "paid",
              tenant_id: UUID_A,
              end_at: null,
            },
          ]
        : undefined,
    );
    const router = new SubscriptionsRouter(dummyRoPool(), tx.pool);
    (
      router as unknown as { loadSubscriptionDetail: unknown }
    ).loadSubscriptionDetail = vi.fn().mockResolvedValue({ id: UUID_A });

    await router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
      action: "resume",
    });
    const o = tx.outcome();
    expect(o.committed).toBe(true);
    expect(o.rolledBack).toBe(false);
    expect(o.released).toBe(true);
  });

  it("commits + releases on a valid suspend (active → suspended)", async () => {
    const tx = makeTxClient((s) =>
      s.includes("for update")
        ? [{ status: "active", tenant_id: UUID_A, end_at: null }]
        : undefined,
    );
    const router = new SubscriptionsRouter(dummyRoPool(), tx.pool);
    (
      router as unknown as { loadSubscriptionDetail: unknown }
    ).loadSubscriptionDetail = vi.fn().mockResolvedValue({ id: UUID_A });

    await router.runSubscriptionAction(makeReq(MANAGE), UUID_A, {
      action: "suspend",
    });
    const o = tx.outcome();
    expect(o.committed).toBe(true);
    expect(o.rolledBack).toBe(false);
    expect(o.released).toBe(true);
  });
});

// ───────────────────────── payments: settle + reject ─────────────────────────
describe("payments verifyPayment (settle) / rejectPayment", () => {
  const payRow = (payStatus: string) => ({
    id: UUID_A,
    tenant_id: UUID_A,
    bill_id: UUID_A,
    pay_status: payStatus,
    pay_source: "offline",
    pay_channel: "bank",
    total_amount: 100,
    paid_amount: 0,
    currency: "CNY",
    pay_order_no: "PO-1",
  });

  it("verify rejects a caller without payment.settle before any DB access", async () => {
    const rw = noDbPool();
    const router = new PaymentsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.verifyPayment(makeReq(["commerce:payment.manage"]), UUID_A, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("verify rejects an invalid payment id before any DB access", async () => {
    // payments' requireUuid throws Unauthorized (not BadRequest) for a malformed
    // id — an existing contract quirk; the point here is: no DB is touched.
    const rw = noDbPool();
    const router = new PaymentsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.verifyPayment(
        makeReq(["commerce:payment.settle"]),
        "not-a-uuid",
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("404 + rollback + release when the payment is missing", async () => {
    const tx = makeTxClient(() => []);
    const router = new PaymentsRouter(dummyRoPool(), tx.pool);
    await expect(
      router.verifyPayment(makeReq(["commerce:payment.settle"]), UUID_A, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
  });

  it("400 + rollback + release when the payment is not in a verifiable status", async () => {
    const tx = makeTxClient((s) =>
      s.includes("from billing.payments") && s.includes("for update")
        ? [payRow("paid")]
        : undefined,
    );
    const router = new PaymentsRouter(dummyRoPool(), tx.pool);
    await expect(
      router.verifyPayment(makeReq(["commerce:payment.settle"]), UUID_A, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
  });

  it("commits + releases on a valid settle (pending payment + invoice)", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from billing.payments") && s.includes("for update"))
        return [payRow("pending")];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [
          {
            id: UUID_A,
            payable_amount: 100,
            paid_amount: 0,
            bill_status: "unpaid",
          },
        ];
      if (s.includes("returning id")) return [{ id: "txn-1" }];
      return undefined;
    });
    const router = new PaymentsRouter(dummyRoPool(), tx.pool);
    (router as unknown as { loadPaymentRecord: unknown }).loadPaymentRecord = vi
      .fn()
      .mockResolvedValue({ id: UUID_A });

    await router.verifyPayment(
      makeReq(["commerce:payment.settle"]),
      UUID_A,
      {},
    );
    const o = tx.outcome();
    expect(o.committed).toBe(true);
    expect(o.rolledBack).toBe(false);
    expect(o.released).toBe(true);
  });

  it("reject rejects a caller without payment.manage before any DB access", async () => {
    const rw = noDbPool();
    const router = new PaymentsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.rejectPayment(makeReq(["commerce:payment.read"]), UUID_A, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});

// ─────────────────────── tenant verifications: approve/reject ───────────────────────
describe("tenant verification approve/reject", () => {
  const MANAGE = ["platform.tenant.manage"];

  it("approve rejects a caller without tenant.manage before any DB access", async () => {
    const rw = noDbPool();
    const router = new TenantsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.approveTenantVerification(
        makeReq(["platform.tenant.read"]),
        UUID_A,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("reject requires a reason before any DB access", async () => {
    const rw = noDbPool();
    const router = new TenantsRouter(noDbPool().pool, rw.pool);
    await expect(
      router.rejectTenantVerification(makeReq(MANAGE), UUID_A, {
        reason: "  ",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("404 + rollback + release when the verification is missing", async () => {
    const tx = makeTxClient(() => []);
    const router = new TenantsRouter(dummyRoPool(), tx.pool);
    await expect(
      router.approveTenantVerification(makeReq(MANAGE), UUID_A),
    ).rejects.toBeInstanceOf(NotFoundException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
  });

  it("commits + releases on a valid approve", async () => {
    const tx = makeTxClient((s) =>
      s.includes("for update")
        ? [{ id: UUID_A, tenant_id: UUID_A }]
        : undefined,
    );
    const router = new TenantsRouter(dummyRoPool(), tx.pool);
    (router as unknown as { loadVerification: unknown }).loadVerification = vi
      .fn()
      .mockResolvedValue({ id: UUID_A });

    await router.approveTenantVerification(makeReq(MANAGE), UUID_A);
    const o = tx.outcome();
    expect(o.committed).toBe(true);
    expect(o.rolledBack).toBe(false);
    expect(o.released).toBe(true);
  });
});

// ───────────────────────── billing: routine writes (三写) ─────────────────────────
// The 危-action step-up bypass guards live in billing-action-guard.spec.ts; here we
// cover the routine multi-action endpoint's transaction integrity.
describe("billing runBillAction", () => {
  const MANAGE = ["commerce:billing.manage"];

  it("rejects a caller without billing.manage before any DB access", async () => {
    const rw = noDbPool();
    const router = new BillingRouter(noDbPool().pool, rw.pool);
    await expect(
      router.runBillAction(makeReq(["commerce:billing.read"]), UUID_A, {
        action: "cancel",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });

  it("409 + rollback + release when cancelling an already-cancelled bill", async () => {
    const tx = makeTxClient((s) =>
      s.includes("for update")
        ? [
            {
              id: UUID_A,
              bill_status: "cancelled",
              paid_amount: 0,
              invoiced_amount: 0,
            },
          ]
        : undefined,
    );
    const router = new BillingRouter(dummyRoPool(), tx.pool);
    await expect(
      router.runBillAction(makeReq(MANAGE), UUID_A, {
        action: "cancel",
        reason: "dup",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
  });
});

describe("UUID_RE 只校验格式良好，不校验 RFC 4122 的 version/variant", () => {
  // 回归钉子：原正则要求 version∈[1-5] 且 variant∈[89ab]，把活库里 27 张表的
  // 种子行全判为非法（admin.operator_account 102 行中 100 行不合格，导致
  // requireOperatorId 直接 401）。Postgres 的 uuid 列接受任意 128 位值，
  // 校验器不该比存储层更严。
  it("接受 variant 不在 [89ab] 的合法 uuid（种子 / 导入数据）", () => {
    expect(UUID_RE.test("00000000-0000-4000-c000-000000220089")).toBe(true);
    expect(UUID_RE.test("00000000-0000-4000-d000-000000000001")).toBe(true);
  });

  it("接受 version 位不在 [1-5] 的合法 uuid", () => {
    expect(UUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(UUID_RE.test("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(true);
  });

  it("仍然拒绝格式不合法的输入", () => {
    for (const bad of [
      "not-a-uuid",
      "00000000-0000-4000-c000-00000022008", // 少一位
      "00000000-0000-4000-c000-0000002200890", // 多一位
      "00000000-0000-4000-c000_000000220089", // 分隔符错
      "0000000g-0000-4000-c000-000000220089", // 非十六进制
      "",
    ]) {
      expect(UUID_RE.test(bad)).toBe(false);
    }
  });
});
