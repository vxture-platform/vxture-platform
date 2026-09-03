import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { SubscriptionPage } from "@/modules/commerce/SubscriptionPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.billing.read"}>
      <SubscriptionPage />
    </CapabilityGate>
  );
}
