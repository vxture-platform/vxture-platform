/**
 * Subscription retention boundary regressions.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-12
 */
import { describe, expect, it } from "vitest";
import { partitionSubscriptions } from "./subscription-visibility";
const item = (
  id: string,
  endAt: string | null,
  status = "expired",
  productId: string | null = id,
) => ({ subscriptionId: id, productId, productCode: null, status, endAt });
describe("subscription retention", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("keeps a renewal available for one year, including the anniversary", () => {
    const recent = item("recent", "2026-01-01T00:00:00Z");
    const boundary = item("boundary", "2025-11-12T12:00:00Z");
    const older = item("older", "2025-11-12T11:59:59Z");
    expect(partitionSubscriptions([recent, boundary, older], now)).toEqual({
      current: [recent, boundary],
      archived: [older],
    });
  });
  it("archives a replaced subscription even when favorited; preserves both records", () => {
    const old = {
      ...item("old", "2026-11-01T00:00:00Z", "expired", "product"),
      favorite: true,
    };
    const live = item("new", "2027-11-01T00:00:00Z", "active", "product");
    expect(partitionSubscriptions([old, live], now)).toEqual({
      current: [live],
      archived: [old],
    });
  });
  it("does not hide live, unknown-date or unrelated subscriptions", () => {
    const items = [
      item("live", "2024-01-01", "active"),
      item("unknown", null),
      item("invalid", "invalid"),
      item("anonymous", null, "expired", null),
    ];
    expect(partitionSubscriptions(items, now).current).toEqual(items);
  });
  it("handles leap-day anniversary without a March cutoff", () => {
    const retained = item("feb", "2023-02-28T12:00:00Z");
    expect(
      partitionSubscriptions([retained], new Date("2024-02-29T12:00:00Z"))
        .current,
    ).toEqual([retained]);
  });
});
