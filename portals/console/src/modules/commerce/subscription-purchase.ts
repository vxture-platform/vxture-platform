/**
 * Resolve purchase intent without silently turning a purchase into a renewal.
 * @package @vxture/console
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-17
 */
import { isTierUpgrade, tierRank } from "@vxture-platform/shared";
import type { SubscribeCurrent, SubscribePlanOption } from "@/api/console-bff";

export const HELD_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "expiring",
  "overdue",
  "suspended",
]);

/**
 * Derive an explicit order operation for the selected workspace and plan.
 * @param current - Current primary subscription, if any.
 * @param plan - Selected purchasable plan.
 * @param intent - Intent supplied by the purchase entry point.
 * @returns The operation and any reason that prevents placing an order.
 */
export function resolveSubscriptionPurchase(
  current: SubscribeCurrent | null,
  plan: Pick<SubscribePlanOption, "planCode" | "tier"> | null,
  intent: string | null,
): {
  orderIntent: "new" | "renew" | "upgrade";
  blocked:
    | "alreadySubscribed"
    | "downgrade"
    | "suspended"
    | "uncomparable"
    | "planConflict"
    | null;
} {
  if (!current || !plan) return { orderIntent: "new", blocked: null };
  const samePlan = current.planCode === plan.planCode;
  if (current.status === "suspended")
    return { orderIntent: "new", blocked: "suspended" };
  if (!HELD_SUBSCRIPTION_STATUSES.has(current.status))
    return {
      orderIntent: samePlan && current.status !== "cancelled" ? "renew" : "new",
      blocked: null,
    };
  if (samePlan)
    return {
      orderIntent: "renew",
      blocked: intent === "renew" ? null : "alreadySubscribed",
    };
  if (tierRank(current.tier) < 0 || tierRank(plan.tier) < 0)
    return { orderIntent: "upgrade", blocked: "uncomparable" };
  if (current.tier === plan.tier)
    return { orderIntent: "upgrade", blocked: "planConflict" };
  return {
    orderIntent: "upgrade",
    blocked: isTierUpgrade(current.tier, plan.tier) ? null : "downgrade",
  };
}
