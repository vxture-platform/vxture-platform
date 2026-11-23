/**
 * order-settlement-amount.spec.ts - Compatible order amounts from settled payment sources.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

// ============================================================================
// Execute the real list and detail routes with isolated projected invoice rows.
// ============================================================================
const NOW = new Date("2026-11-23T00:00:00Z");
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    order_no: "ORD-202611-SETTLEMENT",
    workspace_id: "workspace",
    subscription_id: "subscription",
    subscription_status: "active",
    order_status: "fulfilled",
    invoice_id: "invoice",
    payable_amount: "1.00",
    total_amount: "0.80",
    paid_amount: "0.80",
    discount_amount: "0.20",
    voucher_paid: "0.00",
    settled_payment_amount: "0.80",
    currency: "CNY",
    cycle_unit: "year",
    bill_status: "paid",
    ttl_anchor: NOW,
    refund_in_flight: false,
    refunded_amount: "0",
    created_at: NOW,
    paid_at: NOW,
    ...overrides,
  };
}
function setup(record: Record<string, unknown>) {
  const query = vi.fn(async () => ({ rows: [] as Record<string, unknown>[] }));
  query.mockResolvedValueOnce({ rows: [record] });
  const none = undefined as never;
  const router = new SubscriptionRouter(
    none,
    { getRefundForOrder: async () => null } as never,
    { listAvailableVouchers: async () => [] } as never,
    {
      getCreditBalance: async () => ({ balance: "0.00", currency: "CNY" }),
    } as never,
    none,
    { query } as unknown as Pool,
    none,
    none,
    none,
  );
  const request = {
    user: { id: "user" },
    tenant: { id: "tenant" },
    headers: {},
  } as unknown as Request & RequestContext;
  return { router, request, query };
}

// ============================================================================
// Preserve legacy contracts, partial collections and original refund history.
// ============================================================================
describe("order settlement amounts", () => {
  const cases = [
    {
      name: "no voucher",
      total: "1.00",
      voucher: "0.00",
      paid: "1.00",
      collected: "1.00",
      expected: "1.00",
    },
    {
      name: "discount 1.00 minus 0.20",
      total: "0.80",
      voucher: "0.00",
      paid: "0.80",
      collected: "0.80",
      expected: "0.80",
    },
    {
      name: "credit voucher plus balance and cash",
      total: "1.00",
      voucher: "0.30",
      paid: "1.00",
      collected: "0.70",
      expected: "0.70",
    },
    {
      name: "discount and credit voucher",
      total: "0.80",
      voucher: "0.30",
      paid: "0.80",
      collected: "0.50",
      expected: "0.50",
    },
    {
      name: "full credit voucher",
      total: "1.00",
      voucher: "1.00",
      paid: "1.00",
      collected: "0.00",
      expected: "0.00",
    },
    {
      name: "full discount",
      total: "0.00",
      voucher: "0.00",
      paid: "0.00",
      collected: "0.00",
      expected: "0.00",
    },
    {
      name: "partial payment",
      status: "pending_payment",
      total: "0.80",
      voucher: "0.30",
      paid: "0.50",
      collected: "0.20",
      expected: "0.50",
      bill: "partial",
    },
    {
      name: "unpaid discounted order",
      status: "pending_payment",
      total: "0.80",
      voucher: "0.00",
      paid: "0.00",
      collected: "0.00",
      expected: "0.80",
      bill: "unpaid",
    },
    {
      name: "refund does not reduce original payment",
      status: "refunded",
      total: "0.80",
      voucher: "0.00",
      paid: "0.80",
      collected: "0.80",
      expected: "0.80",
    },
    {
      name: "partial refund keeps original payment",
      total: "0.80",
      voucher: "0.00",
      paid: "0.80",
      collected: "0.80",
      expected: "0.80",
      refunded: "0.20",
    },
  ];
  it.each(cases)("$name is consistent in list and detail", async (test) => {
    const record = row({
      order_status: test.status ?? "fulfilled",
      total_amount: test.total,
      paid_amount: test.paid,
      voucher_paid: test.voucher,
      settled_payment_amount: test.collected,
      bill_status: test.bill ?? "paid",
      refunded_amount: test.refunded ?? "0",
    });
    const list = setup(record);
    const records = await list.router.getMyOrders(list.request);
    expect(records[0]).toMatchObject({
      amount: "1.00",
      paidAmount: test.paid,
      settlementAmount: test.expected,
      settledPaymentAmount: test.collected,
    });
    expect(list.query.mock.calls[0]).toBeDefined();
    const detail = setup(record);
    const result = await detail.router.getOrderDetail(detail.request, ORDER_ID);
    expect(result).toMatchObject({
      paidAmount: test.paid,
      settlementAmount: test.expected,
      settledPaymentAmount: test.collected,
    });
  });
  it("keeps the legacy order amount when a historical invoice is absent", async () => {
    const { router, request } = setup(
      row({
        invoice_id: null,
        total_amount: null,
        paid_amount: null,
        settled_payment_amount: "0",
        discount_amount: null,
      }),
    );
    const records = await router.getMyOrders(request);
    expect(records[0]).toMatchObject({
      amount: "1.00",
      settlementAmount: "1.00",
      settledPaymentAmount: "0",
    });
  });
});
