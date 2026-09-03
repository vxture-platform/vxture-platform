import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import { AuditLogsPage } from "@/modules/settings/AuditLogsPage";

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.audit.read"}>
      <AuditLogsPage />
    </CapabilityGate>
  );
}
