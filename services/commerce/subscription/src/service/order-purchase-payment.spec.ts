/**
 * Revalidate old orders before payment or restoration can cause side effects.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { OrderRecord, OrderInvoice } from "../types/order.types";
import { OrderService } from "./order.service";

// ============================================================================
// Existing pending orders with changed subscription facts
// ============================================================================
function setup(
  options: {
    conflict?: boolean;
    intent?: "new" | "renew" | "upgrade";
    sourceStatus?: string;
    sourceVersion?: string;
    paid?: boolean;
  } = {},
) {
  const order = {
    id: "order",
    orderNo: "ORD-202611-3CFBC34DE1",
    tenantId: "tenant",
    workspaceId: "workspace",
    planVersionId: "pro",
    status: "pending_payment",
    intent: options.intent ?? "new",
    fromSubscriptionId:
      options.intent && options.intent !== "new" ? "source" : null,
    proration:
      options.intent === "upgrade" ? { fromPlanVersionId: "starter" } : null,
  } as OrderRecord;
  const invoice: OrderInvoice = {
    id: "invoice",
    billNo: "INV",
    billStatus: options.paid ? "paid" : "unpaid",
    totalAmount: "1.00",
    payableAmount: "1.00",
    paidAmount: options.paid ? "1.00" : "0.00",
    currency: "CNY",
  };
  const client = {} as PoolClient;
  const orders = {
    getById: vi.fn(async () => order),
    assertNoOtherSubscription: vi.fn(async () => {
      if (options.conflict)
        throw new ConflictException({ code: "SUBSCRIPTION_ALREADY_EXISTS" });
    }),
    withOrderTx: vi.fn(
      async (
        _id: string,
        callback: (ctx: {
          client: PoolClient;
          order: OrderRecord;
          invoice: OrderInvoice;
        }) => Promise<unknown>,
      ) => callback({ client, order, invoice }),
    ),
    resolveRenewTarget: vi.fn(async () => ({
      samePlan: options.intent === "renew",
      sameProduct: true,
      toPlanStatus: "active",
      toIsCurrent: true,
      fromTier: "starter",
      toTier: "pro",
    })),
    restoreOrder: vi.fn(),
    markDeclaredTx: vi.fn(),
    insertEventTx: vi.fn(),
    getPlanDisplay: vi.fn(async () => ({
      productName: "VXTPL",
      planName: "Pro",
    })),
  };
  const subRepo = {
    findPendingVerifyLegTx: vi.fn(async () => null),
    softDeleteDiscountItemsTx: vi.fn(async () => 0),
    recomputeInvoiceTx: vi.fn(async () => ({ totalAmount: "1.00" })),
    insertCashLegTx: vi.fn(async () => "payment"),
  };
  const subscriptions = {
    assertTierAvailable: vi.fn(),
    getSubscription: vi.fn(async () => ({
      id: "source",
      tenantId: "tenant",
      workspaceId: "workspace",
      planVersionId:
        options.sourceVersion ??
        (options.intent === "renew" ? "pro" : "starter"),
      status: options.sourceStatus ?? "active",
    })),
  };
  const promotion = { reserveForOrder: vi.fn(async () => []) };
  const service = new OrderService(
    orders as never,
    subRepo as never,
    subscriptions as never,
    promotion as never,
  );
  const input = {
    orderId: "order",
    tenantId: "tenant",
    userId: "user",
    payChannel: "bank_transfer" as const,
  };
  return { service, orders, subRepo, promotion, subscriptions, client, input };
}

// ============================================================================
// Payment checks happen before vouchers, payments, or order state changes
// ============================================================================
describe("existing-order purchase validation", () => {
  it("rejects a duplicate old new-order before reserving vouchers or writing payment rows", async () => {
    const f = setup({ conflict: true });
    await expect(f.service.declarePayment(f.input)).rejects.toMatchObject({
      response: { code: "SUBSCRIPTION_ALREADY_EXISTS" },
    });
    expect(f.orders.assertNoOtherSubscription).toHaveBeenCalledWith(
      "workspace",
      "pro",
      undefined,
      f.client,
    );
    expect(f.promotion.reserveForOrder).not.toHaveBeenCalled();
    expect(f.subRepo.softDeleteDiscountItemsTx).not.toHaveBeenCalled();
    expect(f.subRepo.insertCashLegTx).not.toHaveBeenCalled();
  });
  it.each(["renew", "upgrade"] as const)(
    "rejects an old %s order after its source was suspended",
    async (intent) => {
      const f = setup({ intent, sourceStatus: "suspended" });
      await expect(f.service.declarePayment(f.input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.promotion.reserveForOrder).not.toHaveBeenCalled();
    },
  );
  it("rejects an upgrade if its original proration source has changed", async () => {
    const f = setup({ intent: "upgrade", sourceVersion: "business" });
    await expect(f.service.declarePayment(f.input)).rejects.toMatchObject({
      response: { code: "SUBSCRIPTION_CHANGED" },
    });
    expect(f.promotion.reserveForOrder).not.toHaveBeenCalled();
  });

  it.each(["fromPeriodEnd", "fromPaidAmount"])(
    "rejects stale upgrade credit after %s changes",
    async (field) => {
      const f = setup({ intent: "upgrade" });
      const existing = await f.orders.getById();
      existing.proration![field] =
        field === "fromPeriodEnd" ? "2026-12-12T00:00:00.000Z" : "99.00";
      await expect(f.service.declarePayment(f.input)).rejects.toMatchObject({
        response: { code: "SUBSCRIPTION_CHANGED" },
      });
      expect(f.subRepo.insertCashLegTx).not.toHaveBeenCalled();
    },
  );
  it("allows an explicit renewal to exclude its own subscription", async () => {
    const f = setup({ intent: "renew" });
    await expect(f.service.declarePayment(f.input)).resolves.toMatchObject({
      outcome: "declared",
    });
    expect(f.orders.assertNoOtherSubscription).toHaveBeenCalledWith(
      "workspace",
      "pro",
      "source",
      f.client,
    );
    expect(f.subRepo.insertCashLegTx).toHaveBeenCalledOnce();
  });
  it("keeps already-paid retries idempotent even when subscription facts changed", async () => {
    const f = setup({ paid: true, conflict: true });
    await expect(f.service.declarePayment(f.input)).resolves.toMatchObject({
      outcome: "already_settled",
    });
    expect(f.orders.assertNoOtherSubscription).not.toHaveBeenCalled();
  });
  it("checks tenant ownership even for already-paid retries", async () => {
    const f = setup({ paid: true });
    await expect(
      f.service.declarePayment({ ...f.input, tenantId: "other-tenant" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("rejects restoring an obsolete order before touching the closed order or invoice", async () => {
    const f = setup({ conflict: true });
    await expect(
      f.service.restore("order", {
        actorType: "operator",
        actorId: "operator",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.orders.restoreOrder).not.toHaveBeenCalled();
  });
});
