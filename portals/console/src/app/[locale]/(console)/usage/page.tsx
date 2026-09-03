import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { UsagePage } from "@/modules/commerce/UsagePage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.quota.read"}>
      <UsagePage />
    </CapabilityGate>
  );
}
