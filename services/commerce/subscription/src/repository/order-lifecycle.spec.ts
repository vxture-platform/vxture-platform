/**
 * Only the same lifecycle cancellation may be replayed.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { PgOrderRepository } from "./pg-order.repository";

// ============================================================================
// Account deletion retries do not authorize ordinary order cancellation replays
// ============================================================================
function build(matched = true) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => ({
    rows: sql.includes("select * from billing.orders")
      ? [{ id: "order", status: "cancelled" }]
      : sql.includes("billing.order_events") && matched
        ? [{ ok: 1 }]
        : [],
    rowCount: 1,
  }));
  const release = vi.fn();
  return {
    query,
    release,
    repo: new PgOrderRepository({
      connect: async () => ({ query, release }),
    } as never),
  };
}
describe("lifecycle order cancellation retry", () => {
  it("returns the already cancelled order only for the matching customer and request", async () => {
    const f = build();
    expect(
      await f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
        "op",
      ),
    ).toMatchObject({ id: "order", status: "cancelled" });
    expect(f.query.mock.calls[2]![1]).toEqual([
      "order",
      "user",
      "account_deletion:op",
    ]);
    expect(f.query.mock.calls[2]![0]).toContain("actor_type='customer'");
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
  });
  it("rejects an unrelated prior cancellation", async () => {
    const f = build(false);
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
        "other-op",
      ),
    ).rejects.toThrow();
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
  });
  it("does not change ordinary cancellation behavior", async () => {
    const f = build();
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "customer", actorId: "user" },
        "cancelled",
      ),
    ).rejects.toThrow();
    expect(
      f.query.mock.calls.some(([s]) => s.includes("billing.order_events")),
    ).toBe(false);
  });
  it("never grants the lifecycle replay exception to a workforce actor", async () => {
    const f = build();
    await expect(
      f.repo.cancelOrder(
        "order",
        { actorType: "operator", actorId: "operator" },
        "cancelled",
        "op",
      ),
    ).rejects.toThrow();
    expect(f.release).toHaveBeenCalledOnce();
  });
});
