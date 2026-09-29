import { Suspense } from "react";
import { TicketsPage } from "@/modules/support/TicketsPage";

/* 不挂 CapabilityGate:owner 2026-09-29 第 1 条裁决「工单可见范围 = 租户级」,
   同租户成员都看得见同一批单。求助不是一项要被授权的能力。

   Suspense 是 `useSearchParams` 要的(对象页跳过来带着 ?compose=1&about=…)。 */
export default function Page() {
  return (
    <Suspense>
      <TicketsPage />
    </Suspense>
  );
}
