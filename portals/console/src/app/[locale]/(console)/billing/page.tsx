import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { BillingPage } from "@/modules/commerce/BillingPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.billing.read"}>
      <BillingPage />
    </CapabilityGate>
  );
}
