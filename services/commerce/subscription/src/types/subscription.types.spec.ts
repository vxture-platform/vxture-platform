import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUSES } from "@vxture-platform/shared";
import { SubscriptionStatus } from "./subscription.types";

// Mechanical link to the value-domain authority: the local enum exists only
// because class-validator's IsEnum needs an enum object; its VALUES must be
// exactly the @shared set (which the DB CHECK also mirrors via
// lint:catalog-domains). Order is not asserted — precedence is the @shared
// array's job, not this enum's.
describe("SubscriptionStatus enum ↔ @vxture-platform/shared SUBSCRIPTION_STATUSES", () => {
  it("has exactly the @shared value set", () => {
    expect(new Set(Object.values(SubscriptionStatus))).toEqual(
      new Set(SUBSCRIPTION_STATUSES),
    );
  });
});
