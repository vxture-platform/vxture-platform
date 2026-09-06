import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { InvitationsPage } from "@/modules/workspace/InvitationsPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.member.manage"}>
      <InvitationsPage />
    </CapabilityGate>
  );
}
