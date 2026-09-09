import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { WorkspacesPage } from "@/modules/workspace/WorkspacesPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.member.read"}>
      <WorkspacesPage />
    </CapabilityGate>
  );
}
