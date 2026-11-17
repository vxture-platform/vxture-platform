/**
 * Direct purchases must not duplicate held primary subscriptions.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PgOrderRepository } from "./pg-order.repository";

// ============================================================================
// Repository gate and transaction ordering
// ============================================================================
describe("primary subscription purchase guard", () => {
  it.each(["active", "trialing", "expiring", "overdue", "suspended"])(
    "rejects an occupied %s slot before inserting an order or invoice",
    async (status) => {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes("select s.status") ? [{ status }] : [],
      }));
      const release = vi.fn();
      const repo = new PgOrderRepository({
        connect: async () => ({ query, release }),
      } as unknown as Pool);
      await expect(
        repo.createOrder({
          tenantId: "tenant",
          workspaceId: "workspace",
          planVersionId: "pro",
          intent: "new",
          price: 1,
          cycleUnit: "year",
          itemName: "Pro",
          createdBy: "user",
        }),
      ).rejects.toMatchObject({
        response: {
          code:
            status === "suspended"
              ? "SUBSCRIPTION_SUSPENDED"
              : "SUBSCRIPTION_ALREADY_EXISTS",
        },
      });
      expect(
        query.mock.calls.some(([sql]) => sql.includes("insert into")),
      ).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
      expect(release).toHaveBeenCalledOnce();
    },
  );
  it("scopes both primary components and excludes only the explicitly changed subscription", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
      rows: [],
    }));
    const repo = new PgOrderRepository({ query } as unknown as Pool);
    await repo.assertNoOtherSubscription(
      "selected-workspace",
      "target-version",
      "original",
    );
    const [sql, values] = query.mock.calls[0]!;
    expect(values).toEqual([
      "selected-workspace",
      "target-version",
      "original",
    ]);
    expect(sql).toContain("old_pc.component_role = 'primary'");
    expect(sql).toContain("new_pc.component_role = 'primary'");
    expect(sql).toContain("s.deleted_at is null");
    expect(sql).not.toContain("tier is distinct from");
  });
  it("uses the existing payment transaction instead of a separate pool read", async () => {
    const poolQuery = vi.fn();
    const txQuery = vi.fn(async () => ({ rows: [{ status: "active" }] }));
    const repo = new PgOrderRepository({ query: poolQuery } as unknown as Pool);
    await expect(
      repo.assertNoOtherSubscription("workspace", "pro", undefined, {
        query: txQuery,
      } as never),
    ).rejects.toMatchObject({
      response: { code: "SUBSCRIPTION_ALREADY_EXISTS" },
    });
    expect(poolQuery).not.toHaveBeenCalled();
    expect(txQuery).toHaveBeenCalledOnce();
  });
});
