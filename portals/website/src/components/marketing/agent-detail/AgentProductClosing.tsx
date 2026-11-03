/**
 * Closing invitation that preserves catalog availability restrictions.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";
import type { ProductCatalogItem } from "@/api/product-catalog.api";
import { Link } from "@/lib/i18n/navigation";
import { AgentProductActions } from "./AgentProductActions";

/** @param props Catalog state and maintenance callback. @returns A next step without invented claims. */
export function AgentProductClosing({
  product,
  onMaintenance,
}: {
  product: ProductCatalogItem;
  onMaintenance: () => void;
}) {
  const t = useTranslations("products");
  return (
    <section
      aria-labelledby="agent-closing-title"
      className="border-t border-border py-12 lg:py-16"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-12">
        <div className="flex flex-col gap-7 rounded-xl border border-border bg-linear-to-br from-primary-muted/40 to-card p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="min-w-0 max-w-website-2xl lg:flex-1">
            <p className="text-label-sm font-semibold text-primary-text">
              {t("agentDetail.closingEyebrow")}
            </p>
            <h2
              id="agent-closing-title"
              className="font-display mt-2 text-2xl font-semibold leading-snug tracking-tight text-balance"
            >
              {t("agentDetail.closingTitle")}
            </h2>
            <p className="mt-3 max-w-website-xl text-body-sm leading-7 text-muted-foreground">
              {t("agentDetail.closingDescription")}
            </p>
          </div>
          <div className="shrink-0">
            <AgentProductActions
              product={product}
              onMaintenance={onMaintenance}
            />
          </div>
        </div>
        <Link
          href="/appcenter"
          className="mt-8 inline-flex items-center gap-2 rounded-md text-body-sm text-muted-foreground hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="arrow-left" className="h-4 w-4" aria-hidden />
          {t("catalog.backAppcenter")}
        </Link>
      </div>
    </section>
  );
}
