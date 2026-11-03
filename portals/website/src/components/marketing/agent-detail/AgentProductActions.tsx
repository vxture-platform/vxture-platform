/**
 * Existing pricing and maintenance actions, shared by both conversion areas.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { ProductCatalogItem } from "@/api/product-catalog.api";
import { Link } from "@/lib/i18n/navigation";
import { agentAvailability } from "./agent-detail-model";

/** @param props Catalog state and maintenance callback. @returns Lifecycle-aware actions. */
export function AgentProductActions({
  product,
  onMaintenance,
}: {
  product: ProductCatalogItem;
  onMaintenance: () => void;
}) {
  const t = useTranslations("products");
  const availability = agentAvailability(product);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {availability === "maintenance" ? (
        <Button size="xl" variant="outline" onClick={onMaintenance}>
          {t("catalog.suspension.maintenance")}
        </Button>
      ) : availability === "preview" ? (
        <Button size="xl" disabled>
          {t("catalog.actions.coming")}
        </Button>
      ) : availability === "sunset" ? (
        <p className="text-body-md text-muted-foreground">
          {t("subscription.sunsetHint")}
        </p>
      ) : (
        <Button asChild size="xl">
          <Link href={`/pricing?product=${product.productCode}`}>
            {t("catalog.demoCta")}
            <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      )}
      <Button asChild size="xl" variant="outline">
        <Link href="/contact">{t("catalog.consultCta")}</Link>
      </Button>
    </div>
  );
}
