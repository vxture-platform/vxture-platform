import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { UsageRecordsPage } from "@/modules/commerce/UsageRecordsPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.quota.read"}>
      <UsageRecordsPage />
    </CapabilityGate>
  );
}
