import { EmptyState, Icon, ViewLayout } from "@vxture/design-system";
import type { AdminNavigationItem } from "@/config/navigation";
import { PageHeader } from "./PageHeader";

export function AdminPlaceholderPage({
  item,
  sectionTitle,
}: {
  item: AdminNavigationItem;
  sectionTitle: string;
}) {
  return (
    <ViewLayout className="admin-placeholder-page">
      <PageHeader
        icon={item.icon}
        eyebrow={sectionTitle}
        title={item.label}
        description={item.description}
      />

      <section
        className="vx-page-section admin-placeholder-page__section"
        aria-label={item.label}
      >
        <span className="admin-placeholder-page__icon" aria-hidden="true">
          <Icon name={item.icon} size="lg" fallback="placeholder" />
        </span>
        <EmptyState
          title="板块待建设"
          description="此板块已纳入平台运营菜单，详细字段、操作和权限将在确认后逐步补齐。"
        />
      </section>
    </ViewLayout>
  );
}
