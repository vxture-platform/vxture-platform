/**
 * Verify minimal facts preserve the shared C2 coverage and status semantics.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import { readWorkspaceEntitlementSummary } from "./workspace-entitlement.read";

describe("readWorkspaceEntitlementSummary", () => {
  it("preserves primary coverage, bundled-only access and historical paid lapse", async () => {
    const codes = ["agent", "bundle", "lapsed-paid", "lapsed-trial"];
    const live = (productCode: string, role: string, tier: string | null) => ({
      product_code: productCode,
      component_role: role,
      tier_code: tier,
      features: ["unreturned-feature"],
      quota: { ceiling: 99 },
    });
    const fact = (productCode: string, status: string, end: string) => ({
      product_code: productCode,
      status,
      trial_end_at: null,
      end_at: new Date(end),
      auto_renew: false,
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: codes.map((product_code) => ({ product_code })),
      })
      .mockResolvedValueOnce({
        rows: [
          live("agent", "primary", "starter"),
          live("agent", "primary", "pro"),
          live("agent", "bundled", null),
          live("bundle", "bundled", null),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          fact("agent", "trialing", "2027-04-01"),
          fact("agent", "active", "2027-01-01"),
          fact("lapsed-paid", "expired", "2026-01-01"),
        ],
      });

    expect(
      await readWorkspaceEntitlementSummary({ query }, "workspace"),
    ).toEqual([
      { productCode: "agent", tier: "pro", bundled: true, status: "active" },
      { productCode: "bundle", tier: null, bundled: true, status: null },
      {
        productCode: "lapsed-paid",
        tier: null,
        bundled: false,
        status: "expired",
      },
      { productCode: "lapsed-trial", tier: null, bundled: false, status: null },
    ]);
    expect(query.mock.calls.map((args) => args[1])).toEqual([
      ["workspace"],
      ["workspace", codes],
      ["workspace", codes],
    ]);
  });

  it("does not reinterpret an unavailable source as known empty coverage", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    expect(
      await readWorkspaceEntitlementSummary({ query }, "workspace"),
    ).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    const outage = new Error("read unavailable");
    query.mockRejectedValueOnce(outage);
    await expect(
      readWorkspaceEntitlementSummary({ query }, "workspace"),
    ).rejects.toBe(outage);
  });
});
