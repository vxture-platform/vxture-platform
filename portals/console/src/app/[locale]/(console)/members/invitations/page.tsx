import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { InvitationsPage } from "@/modules/workspace/InvitationsPage";

export default function Page() {
  return (
    <CapabilityGate
      capability={"tenant.member.manage"}
      /* 个人租户只有自己,成员管理那几页在那里没有意义(owner 2026-09-10)。 */
      tenantTypes={["organization"]}
    >
      <InvitationsPage />
    </CapabilityGate>
  );
}
