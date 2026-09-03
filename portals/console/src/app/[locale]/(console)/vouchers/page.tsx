import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { VouchersPage } from "@/modules/commerce/VouchersPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.billing.read"}>
      <VouchersPage />
    </CapabilityGate>
  );
}
