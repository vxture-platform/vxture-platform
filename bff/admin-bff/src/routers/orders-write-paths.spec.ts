import { describe, it, expect, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type { OrderService } from "@vxture/service-subscription";
import { OrdersRouter } from "./orders.router";
import type { RequestContext } from "../types/console.types";

// product_320 §4.3 → product_330 P1-b2 — the two-stage offline-payment-confirm
// on the ORDER ENTITY (billing.orders) + void / restore delegation. Mirrors
// write-paths.spec.ts's tx-integrity pattern (auth checked before any DB
// touch; commit only on success; rollback+release on every thrown invariant)
// plus the stage-2 dispatch decision: stage 2 (OrderService.fulfill, hence the
// provisioning webhook) fires exactly when the order reaches `paid`, never for
// a partial / closed / already-fulfilled order.

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

/** RO pool: resolveOrderId runs here (uuid → billing.orders lookup). */
function roPool(found = true): Pool {
  return {
    query: vi.fn(async () => ({ rows: found ? [{ id: ORDER_ID }] : [] })),
  } as unknown as Pool;
}

function dummyRoPool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("RO pool must not be touched");
    }),
  } as unknown as Pool;
}

function makeOrdersMock() {
  return {
    fulfill: vi.fn().mockResolvedValue({ order: { id: ORDER_ID } }),
    cancel: vi.fn().mockResolvedValue({ id: ORDER_ID }),
    restore: vi.fn().mockResolvedValue({ id: ORDER_ID }),
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

const orderRow = (status: string) => ({
  id: ORDER_ID,
  tenant_id: ORDER_ID,
  workspace_id: ORDER_ID,
  status,
  currency: "CNY",
});

const invoiceRow = (
  bill_status: string,
  paid_amount: number,
  payable_amount = 100,
) => ({
  id: ORDER_ID,
  tenant_id: ORDER_ID,
  payable_amount,
  paid_amount,
  bill_status,
  currency: "CNY",
});

describe("offline-payment-confirm: authz + tx integrity", () => {
  it("rejects a caller without payment.settle before any DB access", async () => {
    const rw = noDbPool();
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      orders as unknown as OrderService,
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
    expect(orders.fulfill).not.toHaveBeenCalled();
  });

  it("404 before the tx when the order id does not resolve", async () => {
    const tx = makeTxClient(() => []);
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(false),
      tx.pool,
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.settle"]),
        ORDER_ID,
        CONFIRM_BODY,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.connect).not.toHaveBeenCalled();
    expect(orders.fulfill).not.toHaveBeenCalled();
  });

  it("404 + rollback + release when the locked order row is missing", async () => {
    const tx = makeTxClient(() => []);
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
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
    expect(orders.fulfill).not.toHaveBeenCalled();
  });

  it("400 + rollback + release: an already fulfilled order rejects a duplicate confirm", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from billing.orders") && s.includes("for update"))
        return [orderRow("fulfilled")];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [invoiceRow("paid", 100)];
      return undefined;
    });
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
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
    expect(orders.fulfill).not.toHaveBeenCalled();
  });

  it("400 + rollback: a closed (cancelled) order cannot be settled — restore first", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from billing.orders") && s.includes("for update"))
        return [orderRow("cancelled")];
      return undefined;
    });
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.confirmOfflinePayment(
        makeReq(["commerce:payment.settle"]),
        ORDER_ID,
        CONFIRM_BODY,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
    expect(
      tx.calls.some((c) => /insert\s+into\s+billing\.payments/i.test(c)),
    ).toBe(false);
    expect(orders.fulfill).not.toHaveBeenCalled();
  });
});

describe("offline-payment-confirm: stage-2 dispatch decision (product_330 §4)", () => {
  function respondFreshUnpaid(status = "pending_payment") {
    return (s: string) => {
      if (s.includes("from billing.orders") && s.includes("for update"))
        return [orderRow(status)];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [invoiceRow("unpaid", 0)];
      if (s.includes("returning id")) return [{ id: "txn-1" }];
      return undefined;
    };
  }

  it("a full-amount confirm flips the order to paid, never touches subscriptions, and fires fulfill", async () => {
    const tx = makeTxClient(respondFreshUnpaid());
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
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
    // the router never writes the subscription — that's the service's job
    expect(
      tx.calls.some((c) => /update\s+metering\.subscriptions/i.test(c)),
    ).toBe(false);
    expect(
      tx.calls.some((c) => /update\s+billing\.orders[\s\S]*'paid'/i.test(c)),
    ).toBe(true);
    expect(
      tx.calls.some((c) =>
        /insert\s+into\s+billing\.order_events[\s\S]*payment_confirmed/i.test(
          c,
        ),
      ),
    ).toBe(true);
    expect(orders.fulfill).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ actorType: "operator", actorId: OPERATOR_ID }),
    );
  });

  it("a partial amount is refused outright — full-amount rule (product_321 P9)", async () => {
    // v1.3 P9 removed partial acceptance: ≤ kept breeding unterminable
    // partial orders (void/cancel/sweep all 409 on paid_amount>0). Mismatched
    // real income goes through payment-reject + offline resolution instead.
    const tx = makeTxClient(respondFreshUnpaid());
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
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
    expect(orders.fulfill).not.toHaveBeenCalled();
  });

  it("re-drive: order already paid (stage 2 hung) skips stage 1 and re-fires fulfill", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from billing.orders") && s.includes("for update"))
        return [orderRow("paid")];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [invoiceRow("paid", 100)];
      return undefined;
    });
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
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
    expect(tx.outcome().committed).toBe(true);
    expect(orders.fulfill).toHaveBeenCalledTimes(1);
  });

  it("re-drive body is relaxed: no declaration fields needed once money is in", async () => {
    const tx = makeTxClient((s) => {
      if (s.includes("from billing.orders") && s.includes("for update"))
        return [orderRow("paid")];
      if (s.includes("from billing.invoices") && s.includes("for update"))
        return [invoiceRow("paid", 100)];
      return undefined;
    });
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      tx.pool,
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    await router.confirmOfflinePayment(
      makeReq(["commerce:payment.settle"]),
      ORDER_ID,
      {} as never,
    );
    expect(orders.fulfill).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ remark: "manual stage-2 re-drive" }),
    );
  });
});

describe("void: authz + delegation", () => {
  it("rejects a caller without order.void before any DB access", async () => {
    const rw = noDbPool();
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.voidOrder(makeReq(["commerce:order.read"]), ORDER_ID, {
        reason: "duplicate order",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.cancel).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 4 characters before calling the service", async () => {
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.voidOrder(makeReq(["commerce:order.void"]), ORDER_ID, {
        reason: "no",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.cancel).not.toHaveBeenCalled();
  });

  it("delegates to OrderService.cancel and returns the refreshed order", async () => {
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    const result = await router.voidOrder(
      makeReq(["commerce:order.void"]),
      ORDER_ID,
      { reason: "duplicate order, customer cancelled by phone" },
    );

    expect(orders.cancel).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ actorType: "operator", actorId: OPERATOR_ID }),
    );
    expect(result).toEqual({ id: ORDER_ID });
  });

  it("propagates a ConflictException when the order is not a voidable pending order", async () => {
    const orders = makeOrdersMock();
    orders.cancel.mockRejectedValue(
      new ConflictException("订单已收到支付，不能取消（请走结算流程）"),
    );
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
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
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      noDbPool().pool,
      rw.pool,
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.void"]), ORDER_ID, {
        reason: "customer confirmed, un-void",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.restore).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 4 characters before calling the service", async () => {
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.restore"]), ORDER_ID, {
        reason: "no",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.restore).not.toHaveBeenCalled();
  });

  it("delegates to OrderService.restore and returns the refreshed order", async () => {
    const orders = makeOrdersMock();
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    stubGetOrder(router);

    const result = await router.restoreOrder(
      makeReq(["commerce:order.restore"]),
      ORDER_ID,
      { reason: "customer confirmed, un-void the order" },
    );

    expect(orders.restore).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ actorType: "operator", actorId: OPERATOR_ID }),
    );
    expect(result).toEqual({ id: ORDER_ID });
  });

  it("propagates a ConflictException when the order is not a restorable closed order", async () => {
    const orders = makeOrdersMock();
    orders.restore.mockRejectedValue(
      new ConflictException("订单不是可恢复的已关闭状态"),
    );
    const router = new OrdersRouter(
      roPool(),
      dummyRoPool(),
      orders as unknown as OrderService,
      PROMOTION_STUB,
    );
    await expect(
      router.restoreOrder(makeReq(["commerce:order.restore"]), ORDER_ID, {
        reason: "attempted restore, already active",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
