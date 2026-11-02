/**
 * Shared positioning for the peer data and knowledge platforms.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Card, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";

/** @returns Equal product roles with links to their respective introductions. */
export function ProductPlatformPeers() {
  const t = useTranslations("products.platformPeers");
  return (
    <section
      aria-labelledby="platform-peers-title"
      className="mt-12 border-t border-border pt-8"
    >
      <p className="text-label-sm font-semibold text-primary-text">
        {t("eyebrow")}
      </p>
      <h3
        id="platform-peers-title"
        className="font-display mt-3 text-2xl font-semibold"
      >
        {t("title")}
      </h3>
      <p className="mt-3 max-w-website-3xl text-body-md leading-7 text-muted-foreground">
        {t("description")}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(["arda", "karda"] as const).map((product) => (
          <Card key={product} className="min-w-0 gap-3 p-6">
            <h4 className="flex flex-wrap items-center gap-3 font-display text-xl font-semibold">
              <Icon
                name={product === "arda" ? "database" : "book-open"}
                className="h-6 w-6 shrink-0 text-primary-text"
                aria-hidden
              />
              {product === "arda" ? "Arda" : "Karda"}
              <span className="font-sans text-body-sm text-muted-foreground">
                {t(`${product}.label`)}
              </span>
            </h4>
            <p className="text-body-md leading-7 text-muted-foreground">
              {t(`${product}.description`)}
            </p>
            <p className="border-t border-border pt-3 text-body-sm text-primary-text">
              {t(`${product}.supply`)}
            </p>
            <Link
              href={`/products/${product}`}
              className="mt-auto inline-flex items-center gap-2 self-start rounded-md pt-2 text-body-sm font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(`${product}.action`)}
              <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}
