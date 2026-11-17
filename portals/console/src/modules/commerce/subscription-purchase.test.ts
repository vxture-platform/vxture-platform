/**
 * Purchase decisions for anonymous entry points returning after login.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { describe, expect, it } from "vitest";
import type { SubscribeCurrent } from "@/api/console-bff";
import { resolveSubscriptionPurchase } from "./subscription-purchase";

// ============================================================================
// Current workspace subscription and requested purchase
// ============================================================================
const pro = { planCode: "vxtpl-pro", tier: "pro" };
const starter = { planCode: "vxtpl-starter", tier: "starter" };
const business = { planCode: "vxtpl-business", tier: "business" };
function current(status = "active"): SubscribeCurrent {
  return {
    ...pro,
    status,
    subscriptionId: "sub",
    planVersionId: "old-version",
    endAt: "2027-11-12T00:00:00Z",
    trialEndAt: null,
    autoRenew: false,
    suspension: null,
  };
}

describe("subscription purchase intent", () => {
  it("does not treat another plan at the same tier as an upgrade", () => {
    expect(
      resolveSubscriptionPurchase(
        current(),
        { ...pro, planCode: "another-pro" },
        "upgrade",
      ).blocked,
    ).toBe("planConflict");
  });
  it.each(["active", "trialing", "expiring", "overdue"])(
    "%s does not silently renew a same-plan purchase",
    (status) => {
      expect(
        resolveSubscriptionPurchase(current(status), pro, "subscribe"),
      ).toEqual({ orderIntent: "renew", blocked: "alreadySubscribed" });
      expect(
        resolveSubscriptionPurchase(current(status), pro, "upgrade").blocked,
      ).toBe("alreadySubscribed");
    },
  );
  it.each(["active", "trialing", "expiring", "overdue"])(
    "%s accepts explicit renewal and higher-tier upgrade, but rejects downgrade",
    (status) => {
      expect(
        resolveSubscriptionPurchase(current(status), pro, "renew"),
      ).toEqual({ orderIntent: "renew", blocked: null });
      expect(
        resolveSubscriptionPurchase(current(status), business, "subscribe"),
      ).toEqual({ orderIntent: "upgrade", blocked: null });
      expect(
        resolveSubscriptionPurchase(current(status), starter, "subscribe")
          .blocked,
      ).toBe("downgrade");
    },
  );
  it("compares plans across versions instead of treating a version change as an upgrade", () => {
    expect(
      resolveSubscriptionPurchase(current(), pro, "subscribe").blocked,
    ).toBe("alreadySubscribed");
    expect(
      resolveSubscriptionPurchase(current(), pro, "renew").orderIntent,
    ).toBe("renew");
  });
  it.each([pro, starter, business])(
    "blocks all purchases while suspended",
    (plan) => {
      expect(
        resolveSubscriptionPurchase(current("suspended"), plan, "renew")
          .blocked,
      ).toBe("suspended");
    },
  );
  it("does not inherit a subscription from another workspace", () => {
    expect(resolveSubscriptionPurchase(null, pro, "subscribe")).toEqual({
      orderIntent: "new",
      blocked: null,
    });
  });
  it("allows a lapsed subscription to renew its own plan or buy another tier", () => {
    expect(
      resolveSubscriptionPurchase(current("expired"), pro, "renew"),
    ).toEqual({ orderIntent: "renew", blocked: null });
    expect(
      resolveSubscriptionPurchase(current("expired"), starter, "subscribe"),
    ).toEqual({ orderIntent: "new", blocked: null });
    expect(
      resolveSubscriptionPurchase(current("cancelled"), pro, "subscribe"),
    ).toEqual({ orderIntent: "new", blocked: null });
  });
  it("fails closed when tier configuration cannot be compared", () => {
    expect(
      resolveSubscriptionPurchase(
        { ...current(), tier: null },
        business,
        "subscribe",
      ).blocked,
    ).toBe("uncomparable");
  });
});
