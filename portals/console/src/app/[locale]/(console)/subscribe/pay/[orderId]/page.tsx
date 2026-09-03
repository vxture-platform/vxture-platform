import { Suspense } from "react";
import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { OrderPayPage } from "@/modules/commerce/OrderPayPage";

export default function Page() {
  return (
    <CapabilityGate capability="tenant.billing.read">
      <Suspense>
        <OrderPayPage />
      </Suspense>
    </CapabilityGate>
  );
}
