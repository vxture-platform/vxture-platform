import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { TenantVerificationPage } from "@/modules/account/TenantVerificationPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.settings.manage"}>
      <TenantVerificationPage />
    </CapabilityGate>
  );
}
