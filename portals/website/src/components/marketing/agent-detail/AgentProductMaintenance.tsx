/**
 * Reuses the existing catalog maintenance dialog without changing its contract.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import type { ProductMaintenance } from "@/api/product-catalog.api";
import { MaintenanceDetailDialog } from "../MaintenanceDetailDialog";

/** @param props Catalog maintenance and dialog state. @returns The shared maintenance dialog. */
export function AgentProductMaintenance({
  maintenance,
  open,
  onOpenChange,
}: {
  maintenance: ProductMaintenance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("products");
  return (
    <MaintenanceDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      until={maintenance.until}
      subscribed={false}
      labels={{
        title: t("catalog.suspension.maintenance"),
        visitor: t("catalog.maintenanceDialog.visitor"),
        subscriber: t("catalog.maintenanceDialog.subscriber"),
        expected: t.raw("catalog.suspension.expected") as string,
        countdown: t("catalog.maintenanceDialog.countdown"),
        countdownReadable: t.raw("catalog.suspension.countdown") as string,
        days: t.raw("catalog.maintenanceDialog.days") as string,
        elapsed: t("catalog.maintenanceDialog.elapsed"),
        contact: t("catalog.suspension.contact"),
        close: t("catalog.suspension.close"),
      }}
    />
  );
}
