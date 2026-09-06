import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { TenantVerificationApplyPage } from "@/modules/account/TenantVerificationApplyPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.settings.manage"}>
      <TenantVerificationApplyPage />
    </CapabilityGate>
  );
}
