import { Suspense } from "react";
import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { SubscribePage } from "@/modules/commerce/SubscribePage";

export default function Page() {
  return (
    <CapabilityGate capability="tenant.billing.manage">
      <Suspense>
        <SubscribePage />
      </Suspense>
    </CapabilityGate>
  );
}
