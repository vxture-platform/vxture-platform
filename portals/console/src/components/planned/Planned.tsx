"use client";

/**
 * Planned — the single vocabulary for "this feature is planned but not wired".
 *
 * Console has a dozen surfaces in that state. Before this, each said so
 * differently (a `backend.pending` badge on two settings pages, nothing at all
 * on the rest) and several simply rendered invented data instead, which reads
 * as real to a tenant. One vocabulary, three pieces, all built from existing DS
 * parts — no new DS component:
 *
 *   PlannedBadge   → goes in `ViewHeader`'s `secondary` slot; marks the page.
 *   PlannedNotice  → a `Banner tone="info"` under the page header; says why.
 *   PlannedEmpty   → an `EmptyState` that replaces a fabricated section body.
 *
 * The rule these encode: a planned surface may show its STRUCTURE, never
 * fabricated VALUES. Anything that would look like the tenant's own data gets
 * replaced by PlannedEmpty rather than filled with a plausible-looking guess.
 *
 * Interactive controls on a planned surface must additionally be `disabled` —
 * a toggle that moves but never persists is worse than no toggle, because the
 * user believes the policy is now in force. `PlannedNotice` carries the
 * `controlNotice` variant for those pages.
 */

import { Banner, EmptyState, StatusBadge } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { useTranslations } from "next-intl";

export function PlannedBadge() {
  const t = useTranslations("planned");
  return <StatusBadge tone="neutral">{t("badge")}</StatusBadge>;
}

export function PlannedNotice({
  variant = "page",
}: {
  /** `controls` is for pages whose inputs render but never persist. */
  readonly variant?: "page" | "controls";
}) {
  const t = useTranslations("planned");
  return (
    <Banner
      tone="info"
      title={t(variant === "controls" ? "controlNotice" : "pageNotice")}
    />
  );
}

export function PlannedEmpty({ icon }: { readonly icon?: IconName }) {
  const t = useTranslations("planned");
  return <EmptyState {...(icon ? { icon } : {})} title={t("sectionEmpty")} />;
}
