/**
 * refund-settlement.spec.ts - Historical payment sources cannot authorize cash refunds.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  insertRefundAllocations,
  prepareRefundCalculation,
  readRefundSources,
  validateRefundAllocations,
  type RefundCalculation,
} from "./refund-settlement";

// ===========================================================================
// Raw database values deliberately retain a wider domain than RefundSource.
// ===========================================================================
function database(
  source: string | null,
  amount = "1.00",
  balanceVerified = false,
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("select * from billing.orders"))
      return {
        rows: [
          {
            status: "fulfilled",
            currency: "CNY",
            balance_verified: balanceVerified,
            scope_verified: true,
            leftover_amount: "0",
            credit_amount: "0",
            subscription_id: null,
          },
        ],
      };
    if (sql.includes("select p.id,p.pay_source"))
      return {
        rows: [
          {
            id: "payment",
            pay_source: source,
            paid_amount: amount,
            currency: "CNY",
            balance_verified: balanceVerified,
            scope_verified: true,
          },
        ],
      };
    if (sql.includes("sum(paid_amount)"))
      return { rows: [{ paid: amount, payable: amount }] };
    if (sql.includes("::text cents")) return { rows: [{ cents: "0" }] };
    return { rows: [] };
  });
  // Only the query method is used; no connection or transaction is created here.
  return { client: { query } as unknown as PoolClient, query };
}

// ===========================================================================
// Quotes, preparation, retries and allocation persistence share cash isolation.
// ===========================================================================
describe("refund settlement source evidence", () => {
  it.each(["balance", "unknown", "", null])(
    "rejects source %s before quote, preparation or retry can allocate funds",
    async (source) => {
      for (const action of [
        (client: PoolClient) => readRefundSources(client, "order"),
        (client: PoolClient) => readRefundSources(client, "order", true),
        (client: PoolClient) =>
          prepareRefundCalculation(client, "order", 100, 0.5, 0.2),
        (client: PoolClient) =>
          validateRefundAllocations(client, "refund", "order"),
      ]) {
        const { client, query } = database(source);
        await expect(action(client)).rejects.toBeInstanceOf(ConflictException);
        expect(
          query.mock.calls.every(
            ([sql]) => !/^(insert|update|delete)/i.test(sql),
          ),
        ).toBe(true);
        expect(
          query.mock.calls.some(([sql]) =>
            sql.includes("billing.refund_allocations"),
          ),
        ).toBe(false);
      }
    },
  );
  it("does not hide a zero-value unknown source before validation", async () => {
    const { client } = database("balance", "0.00");
    await expect(readRefundSources(client, "order")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it.each(["online", "offline", "voucher"])(
    "reads supported %s sources",
    async (source) => {
      const { client } = database(source);
      await expect(readRefundSources(client, "order")).resolves.toEqual([
        { id: "payment", source, cents: 100, currency: "CNY" },
      ]);
    },
  );
  it.each(["online", "offline"])(
    "prepares a supported %s cash refund",
    async (source) => {
      const { client } = database(source);
      const result = await prepareRefundCalculation(
        client,
        "order",
        90,
        0.5,
        0.2,
      );
      expect(result.cashTargetCents).toBe(90);
      expect(result.cash[0]).toMatchObject({ source, targetCents: 90 });
    },
  );
  it("keeps voucher value outside the cash refund capacity", async () => {
    const { client } = database("voucher");
    await expect(
      prepareRefundCalculation(client, "order", 1, 0.5, 0.2),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("accepts only proven balance sources and prepares wallet restoration without cash allocations", async () => {
    const { client } = database("balance", "1.00", true);
    expect(await readRefundSources(client, "order")).toEqual([
      { id: "payment", source: "balance", cents: 100, currency: "CNY" },
    ]);
    expect(
      await prepareRefundCalculation(client, "order", 90, 0.5, 0.2),
    ).toMatchObject({
      cash: [],
      cashTargetCents: 0,
      wallet: [{ id: "payment", source: "balance", targetCents: 90 }],
    });
    await expect(
      prepareRefundCalculation(client, "order", 101, 0.5, 0.2),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(["balance", "unknown", "voucher"])(
    "rejects a forged %s calculation before any insert",
    async (source) => {
      const { client, query } = database("offline");
      const cash = {
        id: "payment",
        source: "offline",
        currency: "CNY",
        cents: 100,
        targetCents: 100,
      };
      // Simulate an untrusted historical snapshot containing a non-cash source.
      const calculation = {
        version: 1,
        alpha: 0,
        usage: 0,
        cashTargetCents: 200,
        targets: [],
        cash: [cash, { ...cash, id: "legacy", source }],
      } as unknown as RefundCalculation;
      await expect(
        insertRefundAllocations(client, "refund", calculation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(query).not.toHaveBeenCalled();
    },
  );
});
