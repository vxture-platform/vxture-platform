import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import type { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { PromotionService } from "@vxture/service-promotion";
import type { SubscriptionRecord } from "../types/subscription.types";

// declarePayment / sweepExpiredPaymentOrders / reconcileHungPaidOrders
// behavior tests (product_321 P8/P8b/§4.3): repo + promotion mocked; the
// subjects are the orchestration guards — idempotency, hang-window handling,
// TTL-sweep isolation, reconcile failure ledger and the upgrade re-drive
// idempotency guard.

const ORDER: SubscriptionRecord = {
  id: "order-1",
  tenantId: "org-1",
  workspaceId: "ws-1",
  planVersionId: "pv-2",
  cycleType: "month",
  cycleCount: 1,
  startAt: new Date(),
  endAt: null,
  trialEndAt: null,
  status: "suspended",
  subscriptionKind: "paid",
  activationMethod: "offline_purchase",
  autoRenew: false,
  orderNo: "ORD-202607-ABCDEF0123",
  payAmount: "960",
  currency: "CNY",
  createdBy: "u-1",
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const INVOICE = {
  id: "inv-1",
  billNo: "INV-202607-1",
  billStatus: "unpaid",
  totalAmount: "960.00",
  payableAmount: "960.00",
  paidAmount: "0.00",
  currency: "CNY",
  operateRemark: JSON.stringify({ intent: "new" }),
};

interface Mocks {
  repo: Record<string, ReturnType<typeof vi.fn>>;
  promotion: Record<string, ReturnType<typeof vi.fn>>;
  service: SubscriptionService;
}

const build = (invoice = INVOICE, order = ORDER): Mocks => {
  const repo: Mocks["repo"] = {
    getById: vi.fn().mockResolvedValue(order),
    withPendingOrderTx: vi.fn(
      async (
        _orderId: string,
        fn: (ctx: {
          client: unknown;
          order: SubscriptionRecord;
          invoice: typeof INVOICE | null;
        }) => Promise<unknown>,
      ) => fn({ client: {}, order, invoice }),
    ),
    findPendingVerifyLegTx: vi.fn().mockResolvedValue(null),
    softDeleteDiscountItemsTx: vi.fn().mockResolvedValue(0),
    recomputeInvoiceTx: vi
      .fn()
      .mockResolvedValue({ totalAmount: "960.00", payableAmount: "960.00" }),
    insertDiscountItemTx: vi.fn().mockResolvedValue("item-d"),
    insertCashLegTx: vi.fn().mockResolvedValue("pay-cash"),
    settleInvoiceByVouchersTx: vi
      .fn()
      .mockResolvedValue({ voucherLegId: "pay-voucher" }),
    insertHistoryTx: vi.fn().mockResolvedValue(undefined),
    // product_330 P1-b1：订单实体状态同步（申报 → pending_verify；结清 → paid）
    markOrderDeclaredTx: vi.fn().mockResolvedValue(undefined),
    markOrderPaidTx: vi.fn().mockResolvedValue(undefined),
    applyOrderTermsOnUpgrade: vi.fn().mockResolvedValue(null),
    activateOrder: vi.fn().mockResolvedValue({ ...order, status: "active" }),
    cancelOfflineOrder: vi
      .fn()
      .mockResolvedValue({ ...order, status: "cancelled" }),
    findExpiredPaymentOrderIds: vi.fn().mockResolvedValue([]),
    findHungPaidOrders: vi.fn().mockResolvedValue([]),
    findTierConflicts: vi.fn().mockResolvedValue([]),
    listVersionProducts: vi.fn().mockResolvedValue([]),
    hasOtherActiveCoverage: vi.fn().mockResolvedValue(false),
    update: vi.fn(),
  };
  const promotion: Mocks["promotion"] = {
    reserveForOrder: vi.fn().mockResolvedValue([]),
    finalizeReserved: vi.fn().mockResolvedValue([]),
    releaseReserved: vi.fn().mockResolvedValue([]),
  };
  const provisioning = {
    onSubscriptionActivated: vi.fn().mockResolvedValue(undefined),
    onSubscriptionDeactivated: vi.fn().mockResolvedValue(undefined),
    enqueueEvent: vi.fn().mockResolvedValue("evt"),
  };
  const service = new SubscriptionService(
    repo as unknown as PgSubscriptionRepository,
    provisioning as unknown as ProvisioningService,
    promotion as unknown as PromotionService,
  );
  return { repo, promotion, service };
};

const DECLARE_INPUT = {
  orderId: "order-1",
  tenantId: "org-1",
  userId: "u-1",
  payChannel: "alipay" as const,
};

let m: Mocks;
beforeEach(() => {
  m = build();
});

describe("declarePayment — declared path (cashDue > 0)", () => {
  it("creates the pending_verify cash leg with the settlement credential", async () => {
    const result = await m.service.declarePayment(DECLARE_INPUT);
    expect(result).toEqual({
      outcome: "declared",
      cashDue: "960.00",
      paymentId: "pay-cash",
    });
    const legInput = m.repo.insertCashLegTx?.mock.calls[0]?.[1] as {
      amountYuan: string;
      payChannel: string;
      credential: { settlement: { released: boolean } };
    };
    expect(legInput.amountYuan).toBe("960.00");
    expect(legInput.payChannel).toBe("alipay");
    expect(legInput.credential.settlement.released).toBe(false);
    expect(m.repo.insertHistoryTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ changeType: "payment_declared" }),
    );
  });

  it("bank_transfer maps to pay_channel 'bank' + offline_pay_type", async () => {
    await m.service.declarePayment({
      ...DECLARE_INPUT,
      payChannel: "bank_transfer",
    });
    const legInput = m.repo.insertCashLegTx?.mock.calls[0]?.[1] as {
      payChannel: string;
      offlinePayType: string | null;
    };
    expect(legInput.payChannel).toBe("bank");
    expect(legInput.offlinePayType).toBe("bank_transfer");
  });

  it("is idempotent: an existing declared leg is returned, nothing re-runs", async () => {
    m.repo.findPendingVerifyLegTx?.mockResolvedValue({
      id: "pay-old",
      totalAmount: "960.00",
    });
    const result = await m.service.declarePayment(DECLARE_INPUT);
    expect(result).toEqual({
      outcome: "already_declared",
      cashDue: "960.00",
      paymentId: "pay-old",
    });
    expect(m.promotion.reserveForOrder).not.toHaveBeenCalled();
    expect(m.repo.insertCashLegTx).not.toHaveBeenCalled();
  });

  it("hang-window re-submit on a cleared invoice reports already_settled", async () => {
    m = build({ ...INVOICE, billStatus: "paid" });
    const result = await m.service.declarePayment(DECLARE_INPUT);
    expect(result.outcome).toBe("already_settled");
    expect(m.promotion.reserveForOrder).not.toHaveBeenCalled();
  });

  it("rejects a non-pending order", async () => {
    m = build(INVOICE, { ...ORDER, status: "active" });
    await expect(
      m.service.declarePayment(DECLARE_INPUT),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("legacy partial order: cashDue nets out the collected money (P5)", async () => {
    m = build({ ...INVOICE, billStatus: "partial", paidAmount: "500.00" });
    m.repo.recomputeInvoiceTx?.mockResolvedValue({
      totalAmount: "960.00",
      payableAmount: "960.00",
    });
    const result = await m.service.declarePayment(DECLARE_INPUT);
    expect(result.cashDue).toBe("460.00");
  });
});

describe("declarePayment — vouchers", () => {
  it("discount + credit voucher: negative item written, cash leg = cashDue", async () => {
    m.promotion.reserveForOrder?.mockResolvedValue([
      {
        voucherId: "v-d",
        kind: "discount",
        effect: { discountType: "percent", value: 20, maxOffCents: null },
        effectSnapshot: { discount_type: "percent", value: 20 },
      },
      {
        voucherId: "v-c",
        kind: "credit_voucher",
        effect: { amountCents: 10000 },
        effectSnapshot: { amount_cents: 10000 },
      },
    ]);
    const result = await m.service.declarePayment({
      ...DECLARE_INPUT,
      discountVoucherId: "v-d",
      creditVoucherId: "v-c",
    });
    // 960 − 192 (20%) − 100 = 668
    expect(result.cashDue).toBe("668.00");
    const item = m.repo.insertDiscountItemTx?.mock.calls[0]?.[1] as {
      amountYuan: string;
    };
    expect(item.amountYuan).toBe("-192.00");
  });

  it("discount pushing payable below collected money → 409, tx aborts", async () => {
    m = build({ ...INVOICE, billStatus: "partial", paidAmount: "900.00" });
    m.promotion.reserveForOrder?.mockResolvedValue([
      {
        voucherId: "v-d",
        kind: "discount",
        effect: { discountType: "percent", value: 40, maxOffCents: null },
        effectSnapshot: {},
      },
    ]);
    await expect(
      m.service.declarePayment({ ...DECLARE_INPUT, discountVoucherId: "v-d" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(m.repo.insertCashLegTx).not.toHaveBeenCalled();
  });

  it("cashDue=0: settles in-tx, finalizes vouchers, activates post-commit as customer", async () => {
    m.promotion.reserveForOrder?.mockResolvedValue([
      {
        voucherId: "v-c",
        kind: "credit_voucher",
        effect: { amountCents: 96000 },
        effectSnapshot: { amount_cents: 96000 },
      },
    ]);
    const result = await m.service.declarePayment({
      ...DECLARE_INPUT,
      creditVoucherId: "v-c",
    });
    expect(result.outcome).toBe("activated");
    expect(m.repo.settleInvoiceByVouchersTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ voucherLegYuan: "960.00" }),
    );
    expect(m.promotion.finalizeReserved).toHaveBeenCalledTimes(1);
    // Stage 2 ran as the customer actor (P8), not operator.
    const activateArgs = m.repo.activateOrder?.mock.calls[0]?.[1] as {
      actorType?: string;
    };
    expect(activateArgs.actorType).toBe("customer");
  });

  it("cashDue=0 with hung stage 2 degrades to 'activating' (never an error)", async () => {
    m.promotion.reserveForOrder?.mockResolvedValue([
      {
        voucherId: "v-c",
        kind: "credit_voucher",
        effect: { amountCents: 96000 },
        effectSnapshot: {},
      },
    ]);
    m.repo.findTierConflicts?.mockResolvedValue([
      { productCode: "arda", newTier: "pro", existingTier: "free" },
    ]);
    const result = await m.service.declarePayment({
      ...DECLARE_INPUT,
      creditVoucherId: "v-c",
    });
    expect(result.outcome).toBe("activating");
  });
});

describe("sweepExpiredPaymentOrders (§4.3 duty 1)", () => {
  it("closes candidates with actor=system + change_type=order_expired", async () => {
    m.repo.findExpiredPaymentOrderIds?.mockResolvedValue(["order-1"]);
    const closed = await m.service.sweepExpiredPaymentOrders(30);
    expect(closed).toBe(1);
    // env value reaches the repo as the LEGACY-ROW FALLBACK only — the
    // predicate itself reads each order's persisted payment_ttl_minutes
    // (P4 rev. 2026-08-20).
    expect(m.repo.findExpiredPaymentOrderIds).toHaveBeenCalledWith(30, 100);
    expect(m.repo.cancelOfflineOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({
        actorType: "system",
        changeType: "order_expired",
      }),
    );
  });

  it("a failing order never kills the pass", async () => {
    m.repo.findExpiredPaymentOrderIds?.mockResolvedValue(["bad", "good"]);
    m.repo.cancelOfflineOrder
      ?.mockRejectedValueOnce(new ConflictException("boom"))
      .mockResolvedValueOnce({ ...ORDER, status: "cancelled" });
    const closed = await m.service.sweepExpiredPaymentOrders(30);
    expect(closed).toBe(1);
  });
});

describe("reconcileHungPaidOrders (§4.3 duty 2)", () => {
  it("dispatches the activate arm for intent=new and heals", async () => {
    m.repo.findHungPaidOrders?.mockResolvedValue([
      { id: "order-1", operateRemark: JSON.stringify({ intent: "new" }) },
    ]);
    const healed = await m.service.reconcileHungPaidOrders();
    expect(healed).toBe(1);
    const args = m.repo.activateOrder?.mock.calls[0]?.[1] as {
      actorType?: string;
    };
    expect(args.actorType).toBe("system");
  });

  it("upgrade arm re-drive: target already on the order version → only closes the order row (no re-upgrade)", async () => {
    const target = {
      ...ORDER,
      id: "sub-live",
      status: "active",
      planVersionId: "pv-2", // already switched — crash window re-drive
    };
    m.repo.getById?.mockImplementation(async (id: string) =>
      id === "sub-live" ? target : ORDER,
    );
    m.repo.update?.mockResolvedValue({ ...ORDER, status: "cancelled" });
    m.repo.findHungPaidOrders?.mockResolvedValue([
      {
        id: "order-1",
        operateRemark: JSON.stringify({
          intent: "upgrade",
          upgrade_of: "sub-live",
        }),
      },
    ]);
    const healed = await m.service.reconcileHungPaidOrders();
    expect(healed).toBe(1);
    // The order row closed; the live target was NOT re-upgraded (no
    // toPlanVersionId write = no pool re-materialization).
    const updateInput = m.repo.update?.mock.calls[0]?.[2] as {
      status?: string;
      toPlanVersionId?: string;
    };
    expect(updateInput.status).toBe("cancelled");
    expect(updateInput.toPlanVersionId).toBeUndefined();
  });

  it("failure ledger: stops auto-retry after 3 consecutive failures", async () => {
    m.repo.findHungPaidOrders?.mockResolvedValue([
      { id: "order-1", operateRemark: JSON.stringify({ intent: "new" }) },
    ]);
    m.repo.activateOrder?.mockRejectedValue(new Error("still conflicting"));
    m.repo.findTierConflicts?.mockResolvedValue([
      { productCode: "arda", newTier: "pro", existingTier: "free" },
    ]);
    for (let i = 0; i < 5; i += 1) {
      await m.service.reconcileHungPaidOrders();
    }
    // Attempts stop at the limit: activateOrder is never reached (conflict
    // throws first), and after 3 failed passes the order is skipped.
    expect(m.repo.findHungPaidOrders?.mock.calls.length).toBe(5);
    expect(m.repo.getById?.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
