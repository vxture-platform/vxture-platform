import { ViewLayout } from "@vxture/design-system";
import { SystemNoticesSection } from "@/modules/ops/SystemNoticesSection";

/**
 * 全部消息（二级页，owner 2026-09-20：「全部消息做二级页面展示」）。
 *
 * 与待办页 S2 同一个件，只换作用域：这一页不按「当天已读 + 所有未读」收敛，
 * 列全部并带翻页。
 */
export default function AdminMessagesRoute() {
  return (
    <ViewLayout>
      <SystemNoticesSection scope="all" />
    </ViewLayout>
  );
}
