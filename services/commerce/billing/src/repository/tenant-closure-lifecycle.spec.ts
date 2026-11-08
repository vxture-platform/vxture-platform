/**
 * Coherent closure snapshots distinguish safely cancellable invoices.
 * @package @vxture/service-billing
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { PgTenantClosureRepository } from "./pg-tenant-closure.repository";

// ============================================================================
// Snapshot consistency and payment-leg protection
// ============================================================================
function build(fail = false) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (fail && sql.includes("from billing.refunds"))
      throw new Error("snapshot unavailable");
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  return {
    query,
    release,
    repo: new PgTenantClosureRepository({
      connect: async () => ({ query, release }),
    } as never),
  };
}
describe("lifecycle closure snapshot", () => {
  it("reads every domain fact in one repeatable-read transaction", async () => {
    const f = build();
    expect(await f.repo.getSnapshot("tenant")).toMatchObject({
      unpaidBills: 0,
      paidBalance: "0.00",
      pendingOrdersCancellable: [],
    });
    expect(f.query.mock.calls[0]![0]).toBe(
      "begin isolation level repeatable read read only",
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("excludes only unpaid zero-receipt invoices of safely cancellable orders", async () => {
    const f = build();
    await f.repo.getSnapshot("tenant");
    const sql = f.query.mock.calls.find(([s]) =>
      s.includes("count(*)::text as unpaid"),
    )![0];
    expect(sql).toContain("i.bill_status='unpaid'");
    expect(sql).toContain("coalesce(i.paid_amount,0)=0");
    expect(sql).toContain("o.status='pending_payment'");
    expect(sql).toContain("p.pay_status='pending_verify'");
    expect(sql).toContain("paid.paid_amount>0");
  });
  it("fails closed and releases its connection on any fact failure", async () => {
    const f = build(true);
    await expect(f.repo.getSnapshot("tenant")).rejects.toThrow(
      "snapshot unavailable",
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
