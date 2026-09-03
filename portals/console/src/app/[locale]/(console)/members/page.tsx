import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { MembersPage } from "@/modules/workspace/MembersPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.member.read"}>
      <MembersPage />
    </CapabilityGate>
  );
}
