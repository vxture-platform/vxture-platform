import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { QuotasPage } from "@/modules/commerce/QuotasPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.quota.read"}>
      <QuotasPage />
    </CapabilityGate>
  );
}
