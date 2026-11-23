/**
 * subscribed-products.read.spec.ts - Read-only query and isolation contracts.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import { describe, expect, it, vi } from "vitest";
import {
  readProductIcon,
  readSubscribedProducts,
} from "./subscribed-products.read";

describe("shared subscribed product reads", () => {
  it("binds only the selected workspace and preserves the existing lifecycle/seat query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const workspace = "workspace'; delete from metering.subscriptions; --";
    expect(await readSubscribedProducts({ query }, workspace)).toEqual([]);
    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual([workspace]);
    expect(sql).not.toContain(workspace);
    expect(sql).toContain("ts.workspace_id = $1 and ts.deleted_at is null");
    expect(sql).toContain("ts.status <> 'cancelled'");
    expect(sql).toContain(
      "ps.workspace_id = ts.workspace_id and ps.product_id = prod.id",
    );
    expect(sql).toContain("ps.revoked_at is null");
    expect(sql).toContain(
      "s2.subscription_id = ts.id and s2.resumed_at is null",
    );
    expect(sql).toContain("order by coalesce(ts.start_at, ts.created_at) desc");
    expect(sql).toContain("limit 100");
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|create)\b/i);
  });

  it("returns stored facts unchanged, including nulls, expiry and suspension columns", async () => {
    const rows = [
      {
        subscription_id: "s1",
        tier: null,
        status: "expired",
        end_at: null,
        suspension_reason: null,
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    expect(await readSubscribedProducts({ query }, "one")).toBe(rows);
    await readSubscribedProducts({ query }, "two");
    expect(query.mock.calls.map((call) => call[1])).toEqual([["one"], ["two"]]);
  });

  it("binds public icon codes and preserves bytes/checksums or absence", async () => {
    const row = {
      mime_type: "image/png",
      bytes: Buffer.from([137, 80, 78, 71]),
      checksum: "checksum",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await readProductIcon({ query }, "agent'")).toBe(row);
    expect(query.mock.calls[0]![1]).toEqual(["agent'"]);
    expect(query.mock.calls[0]![0]).toContain(
      "p.product_code = $1 AND p.deleted_at IS NULL",
    );
    expect(await readProductIcon({ query }, "missing")).toBeNull();
  });

  it("does not turn database failures into successful empty reads", async () => {
    const query = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(readSubscribedProducts({ query }, "space")).rejects.toThrow(
      "unavailable",
    );
    await expect(readProductIcon({ query }, "agent")).rejects.toThrow(
      "unavailable",
    );
  });
});
