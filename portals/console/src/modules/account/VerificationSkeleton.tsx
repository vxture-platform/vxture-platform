"use client";

import {
  DetailList,
  DetailRow,
  EmptyState,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { useTranslations } from "next-intl";
import { PageSection } from "@/layout/shell";
import {
  PlannedBadge,
  PlannedEmpty,
  PlannedNotice,
} from "@/components/planned";

/**
 * Shared verification page skeleton (console info spec §1.2 / §3.4, appendix
 * "unified page structure"). Route skeleton only — NO backend, NO tables, NO
 * submit. The four zones are reserved so that adding a third-party verification
 * provider later does not require redesigning the page:
 *   1. top status bar (status row + timeline). No status is computed yet — the
 *      BFF hardcodes `verifiedStatus: null` — so the row shows the planned
 *      empty state rather than a fabricated "unverified" badge.
 *   2. auth-method select zone (hidden now; reserved for channel cards/tabs)
 *   3. form/detail zone (empty state)
 *   4. history zone (empty state)
 */
export function VerificationSkeleton({
  scope,
}: {
  scope: "personal" | "organization";
}) {
  const t = useTranslations("verificationPage");

  return (
    <ViewLayout>
      <ViewHeader
        icon="shield-check"
        title={t(`${scope}.title`)}
        description={t(`${scope}.description`)}
        secondary={<PlannedBadge />}
      />
      <PlannedNotice />

      {/* 1. Top status bar */}
      <PageSection level={2}>
        <DetailList>
          <DetailRow label={t("fields.status")}>
            <PlannedEmpty />
          </DetailRow>
        </DetailList>
        <EmptyState title={t("timeline.empty")} />
      </PageSection>

      {/* 2. Auth-method select zone — hidden until third-party channels land */}

      {/* 3. Form / detail zone */}
      <PageSection
        title={t("sections.form.title")}
        icon="file-text"
        level={2}
        description={t("sections.form.description")}
      >
        <EmptyState title={t("sections.form.empty")} />
      </PageSection>

      {/* 4. History zone */}
      <PageSection
        title={t("sections.history.title")}
        icon="clock-counter-clockwise"
        level={2}
        description={t("sections.history.description")}
      >
        <EmptyState title={t("sections.history.empty")} />
      </PageSection>
    </ViewLayout>
  );
}
