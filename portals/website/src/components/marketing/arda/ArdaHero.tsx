/**
 * Arda hero and illustrative data workspace.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { ArdaWorkspace } from "./ArdaWorkspace";

// Hero composition
/** @returns Product identity, invitation CTA and an explicitly labeled example. */
export function ArdaHero() {
  const t = useTranslations("products.arda");
  const outcomes = t.raw("hero.outcomes") as {
    title: string;
    description: string;
  }[];
  return (
    <section
      aria-labelledby="arda-title"
      className="border-b border-border bg-linear-to-b from-primary-muted/40 to-background pb-8 pt-32 lg:pt-40"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <div className="mb-8 flex flex-wrap items-center gap-3">
              <Icon
                name="database"
                className="h-8 w-8 text-primary-text"
                aria-hidden
              />
              <span className="font-display text-2xl font-semibold">Arda</span>
              <span className="border-l border-border pl-3 text-sm text-muted-foreground">
                {t("hero.product")}
              </span>
            </div>
            <p className="text-label-sm font-semibold text-primary-text">
              {t("hero.eyebrow")}
            </p>
            <h1
              id="arda-title"
              className="font-display mt-5 text-4xl font-semibold leading-tight text-balance sm:text-5xl xl:text-6xl"
            >
              {t("hero.title")}
              <br />
              <span className="text-primary-text">{t("hero.accent")}</span>
            </h1>
            <p className="mt-6 max-w-website-xl text-base leading-8 text-pretty text-muted-foreground">
              {t("hero.description")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="xl">
                <Link href="/contact#support">
                  {t("hero.primaryAction")}
                  <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="xl">
                <a href="#arda-capabilities">
                  {t("hero.secondaryAction")}
                  <Icon name="squares-four" className="h-4 w-4" aria-hidden />
                </a>
              </Button>
            </div>
            <p className="mt-5 text-body-sm text-muted-foreground">
              {t("hero.invite")}
            </p>
          </div>
          <ArdaWorkspace />
        </div>
        <div className="mt-12 grid gap-6 border-t border-border pt-6 sm:grid-cols-3 lg:mt-16">
          {outcomes.map((item, index) => (
            <div key={item.title} className="flex gap-4">
              <span className="font-mono text-label-sm text-muted-foreground">
                0{index + 1} /
              </span>
              <div>
                <p className="font-semibold">{item.title}</p>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
