import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { InvoicesPage } from "@/modules/commerce/InvoicesPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.billing.read"}>
      <InvoicesPage />
    </CapabilityGate>
  );
}
