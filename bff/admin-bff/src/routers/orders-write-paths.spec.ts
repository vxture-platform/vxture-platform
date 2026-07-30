import { describe, it, expect, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type { SubscriptionService } from "@vxture/service-subscription";
import { OrdersRouter } from "./orders.router";
import type { RequestContext } from "../types/console.types";

// product_320 §4.3 — the two-stage offline-payment-confirm rewrite + the new
// void endpoint. Mirrors write-paths.spec.ts's tx-integrity pattern (auth
// checked before any DB touch; commit only on success; rollback+release on
// every thrown invariant) plus the stage-2 dispatch decision that is the
// actual point of this rewrite: stage 2 (SubscriptionService, hence the
// provisioning webhook) fires exactly for a genuine pending offline order
// and never for any other subscription state.

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

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

function dummyRoPool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("RO pool must not be touched");
    }),
  } as unknown as Pool;
}

function makeSubscriptionsMock() {
  return {
    activatePendingOrder: vi.fn().mockResolvedValue({ id: ORDER_ID }),
    applyUpgradeOrder: vi.fn().mockResolvedValue({ id: "old-sub" }),
    cancelPendingOrder: vi.fn().mockResolvedValue({ id: ORDER_ID }),
    restoreOfflineOrder: vi.fn().mockResolvedValue({ id: ORDER_ID }),
  };
}

const CONFIRM_BODY = {
  paidAmount: 100,
  offlinePayType: "bank_transfer" as const,
  payerName: "Acme Inc",
  paidAt: new Date().toISOString(),
  reason: "bank receipt confirmed",
};

// Voucher-less suites: promotion primitives are exercised by the declared-leg
// and reject paths (PR3 follow-up specs), not these.
const PROMOTION_STUB = {
  finalizeReserved: async () => [],
  releaseReserved: async () => [],
} as never;

function stubGetOrder(router: OrdersRouter) {
  return vi
    .spyOn(router, "getOrder")
    .mockResolvedValue({ id: ORDER_ID } as never);
}

describe("offline-payment-confirm: authz + tx integrity", () => {
  it("rejects a caller without payment.settle before any DB access", async () => {
    const rw = noDbPool();
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.manage"]),
        ORDER_ID,
        CONFIRM_BODY,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
  });

  it("404 + rollback + release when the order is missing", async () => {
    const tx = makeTxClient(() => []);
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.settle"]),
        ORDER_ID,
        CONFIRM_BODY,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
  });

  it("400 + rollback + release: fully paid, non-pending-order row rejects a duplicate confirm", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from metering.subscriptions") && s.includes("for update"))
        return [
          {
            id: ORDER_ID,
            tenant_id: ORDER_ID,
            status: "active",
            activation_method: "online_purchase",
            currency: "CNY",
          },
        ];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [
          {
            id: ORDER_ID,
            tenant_id: ORDER_ID,
            payable_amount: 100,
            paid_amount: 100,
            bill_status: "paid",
            currency: "CNY",
            operate_remark: null,
          },
        ];
      return undefined;
    });
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.settle"]),
        ORDER_ID,
        CONFIRM_BODY,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const o = tx.outcome();
    expect(o.committed).toBe(false);
    expect(o.rolledBack).toBe(true);
    expect(o.released).toBe(true);
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
  });
});

describe("offline-payment-confirm: stage-2 dispatch decision (the point of product_320 §4.3)", () => {
  function respondFreshUnpaid(subRow: Record<string, unknown>) {
    return (s: string) => {
      if (s.includes("from metering.subscriptions") && s.includes("for update"))
        return [subRow];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [
          {
            id: ORDER_ID,
            tenant_id: ORDER_ID,
            payable_amount: 100,
            paid_amount: 0,
            bill_status: "unpaid",
            currency: "CNY",
            operate_remark: subRow.operate_remark ?? null,
          },
        ];
      if (s.includes("returning id")) return [{ id: "txn-1" }];
      return undefined;
    };
  }

  it("a genuine pending order (suspended + offline_purchase) skips raw activation and fires stage 2", async () => {
    const subRow = {
      id: ORDER_ID,
      tenant_id: ORDER_ID,
      status: "suspended",
      activation_method: "offline_purchase",
      currency: "CNY",
    };
    const tx = makeTxClient(respondFreshUnpaid(subRow));
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await router.confirmOfflinePayment(
      makeReq(["commerce:payment.settle"]),
      ORDER_ID,
      CONFIRM_BODY,
    );

    const o = tx.outcome();
    expect(o.committed).toBe(true);
    expect(o.released).toBe(true);
    // the router itself never flips status to active — that's the service's job now
    expect(
      tx.calls.some((c) => /update\s+metering\.subscriptions/i.test(c)),
    ).toBe(false);
    expect(subs.activatePendingOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ operatorId: OPERATOR_ID }),
    );
    expect(subs.applyUpgradeOrder).not.toHaveBeenCalled();
  });

  it("an upgrade-intent pending order routes to applyUpgradeOrder with the parsed target", async () => {
    const subRow = {
      id: ORDER_ID,
      tenant_id: ORDER_ID,
      status: "suspended",
      activation_method: "offline_purchase",
      currency: "CNY",
      operate_remark: JSON.stringify({
        intent: "upgrade",
        upgrade_of: "old-sub-id",
      }),
    };
    const tx = makeTxClient(respondFreshUnpaid(subRow));
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await router.confirmOfflinePayment(
      makeReq(["commerce:payment.settle"]),
      ORDER_ID,
      CONFIRM_BODY,
    );

    expect(subs.applyUpgradeOrder).toHaveBeenCalledWith(
      ORDER_ID,
      "old-sub-id",
      expect.objectContaining({ operatorId: OPERATOR_ID }),
    );
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
  });

  it("a legacy non-offline suspended row still activates via raw SQL, no stage 2", async () => {
    const subRow = {
      id: ORDER_ID,
      tenant_id: ORDER_ID,
      status: "suspended",
      activation_method: "redemption",
      currency: "CNY",
    };
    const tx = makeTxClient(respondFreshUnpaid(subRow));
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await router.confirmOfflinePayment(
      makeReq(["commerce:payment.settle"]),
      ORDER_ID,
      CONFIRM_BODY,
    );

    expect(
      tx.calls.some((c) => /update\s+metering\.subscriptions/i.test(c)),
    ).toBe(true);
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
    expect(subs.applyUpgradeOrder).not.toHaveBeenCalled();
  });

  it("a partial amount is refused outright — full-amount rule (product_321 P9)", async () => {
    // v1.3 P9 removed partial acceptance: ≤ kept breeding unterminable
    // partial orders (void/cancel/sweep all 409 on paid_amount>0). Mismatched
    // real income goes through payment-reject + offline resolution instead.
    const subRow = {
      id: ORDER_ID,
      tenant_id: ORDER_ID,
      status: "suspended",
      activation_method: "offline_purchase",
      currency: "CNY",
    };
    const tx = makeTxClient(respondFreshUnpaid(subRow));
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.settle"]),
        ORDER_ID,
        { ...CONFIRM_BODY, paidAmount: 40 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No money writes of any kind reached the ledger.
    expect(
      tx.calls.some((c) => /insert\s+into\s+billing\.transactions/i.test(c)),
    ).toBe(false);
    expect(
      tx.calls.some((c) => /insert\s+into\s+billing\.payments/i.test(c)),
    ).toBe(false);
    expect(subs.activatePendingOrder).not.toHaveBeenCalled();
    expect(subs.applyUpgradeOrder).not.toHaveBeenCalled();
  });

  it("re-drive: invoice already paid but a pending order is still suspended skips stage 1 and re-fires stage 2", async () => {
    const subRow = {
      id: ORDER_ID,
      tenant_id: ORDER_ID,
      status: "suspended",
      activation_method: "offline_purchase",
      currency: "CNY",
    };
    const tx = makeTxClient((s) => {
      if (s.includes("from metering.subscriptions") && s.includes("for update"))
        return [subRow];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [
          {
            id: ORDER_ID,
            tenant_id: ORDER_ID,
            payable_amount: 100,
            paid_amount: 100,
            bill_status: "paid",
            currency: "CNY",
            operate_remark: null,
          },
        ];
      return undefined;
    });
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      tx.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await router.confirmOfflinePayment(
      makeReq(["commerce:payment.settle"]),
      ORDER_ID,
      CONFIRM_BODY,
    );

    // no duplicate money writes — stage 1 was already done
    expect(
      tx.calls.some((c) => /insert\s+into\s+billing\.payments/i.test(c)),
    ).toBe(false);
    expect(subs.activatePendingOrder).toHaveBeenCalledTimes(1);
  });
});

describe("void: authz + delegation", () => {
  it("rejects a caller without order.void before any DB access", async () => {
    const rw = noDbPool();
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.voidOrder(makeReq(["commerce:order.read"]), ORDER_ID, {
        reason: "duplicate order",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subs.cancelPendingOrder).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 4 characters before calling the service", async () => {
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.voidOrder(makeReq(["commerce:order.void"]), ORDER_ID, {
        reason: "no",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subs.cancelPendingOrder).not.toHaveBeenCalled();
  });

  it("delegates to cancelPendingOrder and returns the refreshed order", async () => {
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    const result = await router.voidOrder(
      makeReq(["commerce:order.void"]),
      ORDER_ID,
      { reason: "duplicate order, customer cancelled by phone" },
    );

    expect(subs.cancelPendingOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ actorType: "operator", actorId: OPERATOR_ID }),
    );
    expect(result).toEqual({ id: ORDER_ID });
  });

  it("propagates a ConflictException when the order is not a voidable pending order", async () => {
    const subs = makeSubscriptionsMock();
    subs.cancelPendingOrder.mockRejectedValue(
      new ConflictException("订单已收到支付，不能取消（请走结算流程）"),
    );
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.voidOrder(makeReq(["commerce:order.void"]), ORDER_ID, {
        reason: "duplicate order, please ignore",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("restore: authz + delegation", () => {
  it("rejects a caller without order.restore before any DB access", async () => {
    const rw = noDbPool();
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.void"]), ORDER_ID, {
        reason: "customer confirmed, un-void",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subs.restoreOfflineOrder).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 4 characters before calling the service", async () => {
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.restore"]), ORDER_ID, {
        reason: "no",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subs.restoreOfflineOrder).not.toHaveBeenCalled();
  });

  it("delegates to restoreOfflineOrder and returns the refreshed order", async () => {
    const subs = makeSubscriptionsMock();
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    const result = await router.restoreOrder(
      makeReq(["commerce:order.restore"]),
      ORDER_ID,
      { reason: "customer confirmed, un-void the order" },
    );

    expect(subs.restoreOfflineOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ actorType: "operator", actorId: OPERATOR_ID }),
    );
    expect(result).toEqual({ id: ORDER_ID });
  });

  it("propagates a ConflictException when the order is not a restorable cancelled order", async () => {
    const subs = makeSubscriptionsMock();
    subs.restoreOfflineOrder.mockRejectedValue(
      new ConflictException("订单不存在或不是可恢复的已取消状态"),
    );
    const router = new OrdersRouter(
      dummyRoPool(),
      dummyRoPool(),
      subs as unknown as SubscriptionService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.restore"]), ORDER_ID, {
        reason: "attempted restore, already active",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
