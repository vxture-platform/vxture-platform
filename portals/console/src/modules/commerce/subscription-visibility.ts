/**
 * Subscription retention and history projection.
 * @package @vxture/console
 * @layer Presentation
 * @category model
 * @author AI-Generated
 * @date 2026-11-12
 */
export interface RetainedSubscription {
  subscriptionId: string;
  productCode: string | null;
  productId: string | null;
  status: string;
  endAt: string | null;
}

export const isEndedSubscription = (item: RetainedSubscription): boolean =>
  item.status === "expired" || item.status === "cancelled";

/** Keep renewal opportunities for one calendar year; never delete source records. */
export function partitionSubscriptions<T extends RetainedSubscription>(
  items: readonly T[],
  now: Date = new Date(),
): { current: T[]; archived: T[] } {
  const cutoff = new Date(now);
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  // Clamp leap day to February's last day rather than rolling into March.
  if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  const key = (item: T) => item.productId ?? item.productCode;
  const liveProducts = new Set(
    items
      .filter((item) => !isEndedSubscription(item))
      .map(key)
      .filter(Boolean),
  );
  const current: T[] = [],
    archived: T[] = [];
  for (const item of items) {
    const end = item.endAt ? Date.parse(item.endAt) : NaN;
    const superseded = key(item) !== null && liveProducts.has(key(item));
    const archive =
      isEndedSubscription(item) &&
      (superseded || (Number.isFinite(end) && end < cutoff.getTime()));
    (archive ? archived : current).push(item);
  }
  return { current, archived };
}
