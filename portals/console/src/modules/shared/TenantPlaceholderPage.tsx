import { ViewHeader, ViewLayout } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { PageSection, SignalList } from "@/layout/shell";
import { PlannedBadge, PlannedNotice } from "@/components/planned";

/**
 * Shared skeleton for tenant screens that only have an information
 * architecture so far. `icon` is a prop rather than a constant because the
 * two routes using it (/todos, /invitations) carry different nav icons, and
 * a page header's icon mirrors its nav item (config/navigation.ts).
 */
export function TenantPlaceholderPage({
  icon,
  title,
  description,
  signals,
}: {
  icon: IconName;
  title: string;
  description: string;
  signals: Array<{ title: string; description: string }>;
}) {
  return (
    <ViewLayout>
      <ViewHeader
        icon={icon}
        title={title}
        description={description}
        secondary={<PlannedBadge />}
      />
      <PlannedNotice />
      <PageSection
        icon="list-checks"
        level={2}
        title="规划内容"
        description="当前先完成租户管理门户的信息架构，页面细节后续逐个打磨。"
      >
        <SignalList items={signals} />
      </PageSection>
    </ViewLayout>
  );
}
