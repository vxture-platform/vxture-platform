import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { RolesPage } from "@/modules/workspace/RolesPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.member.read"}>
      <RolesPage />
    </CapabilityGate>
  );
}
