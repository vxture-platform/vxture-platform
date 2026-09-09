import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { PermissionsPage } from "@/modules/workspace/PermissionsPage";

export default function Page() {
  return (
    <CapabilityGate
      capability={"tenant.member.read"}
      /* 个人租户只有自己,成员管理那几页在那里没有意义(owner 2026-09-10)。 */
      tenantTypes={["organization"]}
    >
      <PermissionsPage />
    </CapabilityGate>
  );
}
