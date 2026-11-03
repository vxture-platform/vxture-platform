/**
 * Editorial hero with catalog content and a product identity illustration.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon, StatusBadge } from "@vxture/design-system";
import type { ProductCatalogItem } from "@/api/product-catalog.api";
import { Link } from "@/lib/i18n/navigation";
import { productTypeKey } from "../product-catalog-view";
import { AgentHeroArtwork } from "./AgentHeroArtwork";
import { AgentProductActions } from "./AgentProductActions";
import { AgentProductIcon } from "./AgentProductIcon";
import { AgentProductContext } from "./AgentProductContext";
import {
  agentAvailability,
  type AgentDetailContent,
} from "./agent-detail-model";

// Identity and content adapt without any per-product page definitions.
/** @param props Catalog identity, content and maintenance callback. @returns The introduction hero. */
export function AgentProductHero({
  product,
  content,
  onMaintenance,
}: {
  product: ProductCatalogItem;
  content: AgentDetailContent;
  onMaintenance: () => void;
}) {
  const t = useTranslations("products");
  const availability = agentAvailability(product);
  const typeLabel = t(`catalog.types.${productTypeKey(product.productType)}`);
  const stage = availability === "preview" ? "preview" : product.releaseStage;
  const stageLabel = ["stable", "beta", "sunset", "preview"].includes(stage)
    ? t(`catalog.badges.${stage}`)
    : null;
  return (
    <section
      aria-labelledby="agent-product-title"
      className="relative overflow-hidden border-b border-border bg-linear-to-br from-primary-muted/50 via-background to-muted/30 pb-10 pt-24 lg:pb-12 lg:pt-28"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-12">
        <Link
          href="/appcenter"
          className="inline-flex items-center gap-2 rounded-md text-body-sm text-muted-foreground transition-colors hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="arrow-left" className="h-4 w-4" aria-hidden />
          {t("catalog.backAppcenter")}
        </Link>
        <div className="mt-6 grid items-center gap-6 sm:gap-10 lg:mt-8 lg:grid-cols-12 lg:gap-12">
          <div className="relative z-10 min-w-0 py-4 lg:col-span-7 lg:py-8">
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-label-sm font-semibold text-primary-text">
                {content.tagline || typeLabel}
              </span>
              {availability === "maintenance" ? (
                <StatusBadge tone="warning">
                  {t("catalog.suspension.maintenance")}
                </StatusBadge>
              ) : stageLabel ? (
                <StatusBadge tone={stage === "stable" ? "success" : "neutral"}>
                  {stageLabel}
                </StatusBadge>
              ) : null}
            </div>
            <h1
              id="agent-product-title"
              className="font-display max-w-website-2xl break-words text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-5xl"
            >
              {content.name}
            </h1>
            {content.lead ? (
              <p className="mt-5 max-w-website-xl whitespace-pre-line break-words text-body-sm leading-7 text-pretty text-muted-foreground">
                {content.lead}
              </p>
            ) : null}
            <div className="mt-8">
              <AgentProductActions
                product={product}
                onMaintenance={onMaintenance}
              />
            </div>
            {content.highlights.length > 0 ? (
              <a
                href="#agent-capabilities"
                className="mt-6 inline-flex items-center gap-2 rounded-md text-body-sm text-muted-foreground hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("agentDetail.explore")}
                <Icon name="arrow-down" className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
            <AgentProductContext content={content} />
          </div>
          <div className="relative mx-auto flex aspect-square w-full max-w-website-md min-w-0 items-center justify-center lg:col-span-5">
            <AgentHeroArtwork variant={content.artwork} />
            <div className="relative flex w-3/4 min-w-0 flex-col items-center rounded-xl border border-border bg-card/90 px-6 py-7 text-center shadow-lg shadow-primary/5 backdrop-blur-sm sm:py-8">
              <AgentProductIcon url={product.iconUrl ?? null} />
              <p className="mt-5 text-label-sm font-medium tracking-widest text-muted-foreground">
                {t("agentDetail.identityLabel")}
              </p>
              <p className="font-display mt-2 max-w-full break-words text-xl font-semibold leading-snug sm:text-2xl">
                {content.brand || content.name}
              </p>
              <p className="mt-4 max-w-full break-words border-t border-border pt-4 text-body-sm text-muted-foreground">
                {typeLabel}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
