import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { MembersPage } from "@/modules/workspace/MembersPage";

export default function Page() {
  return (
    <CapabilityGate
      capability={"tenant.member.read"}
      /* 个人租户只有自己,成员管理那几页在那里没有意义(owner 2026-09-10)。 */
      tenantTypes={["organization"]}
    >
      <MembersPage />
    </CapabilityGate>
  );
}
