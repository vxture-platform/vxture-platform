import { Suspense } from "react";
import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { BillingPage } from "@/modules/commerce/BillingPage";

/* Suspense 是硬要求不是装饰:订单表读 `?order=` 深链接(卡券页反查过来的挂单),
   `useSearchParams()` 不裹边界会让 `next build` 直接报错。与 subscribe 页同法。 */
export default function Page() {
  return (
    <CapabilityGate capability={"tenant.billing.read"}>
      <Suspense>
        <BillingPage />
      </Suspense>
    </CapabilityGate>
  );
}
