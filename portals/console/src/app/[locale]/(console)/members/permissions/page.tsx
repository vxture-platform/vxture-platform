import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { PermissionsPage } from "@/modules/workspace/PermissionsPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.member.read"}>
      <PermissionsPage />
    </CapabilityGate>
  );
}
