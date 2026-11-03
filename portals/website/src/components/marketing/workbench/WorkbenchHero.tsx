/**
 * Focused product identity with a real desktop screenshot as the hero visual.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { WorkbenchScreenshots } from "./WorkbenchScreenshots";

// Section composition
/** @returns A concise headline and an authentic desktop product preview. */
export function WorkbenchHero() {
  const t = useTranslations("products.workbench");
  return (
    <section
      aria-labelledby="workbench-title"
      className="relative overflow-hidden border-b border-border bg-linear-to-b from-primary-muted/40 via-background to-muted/20 pb-8 pt-28 lg:pb-12 lg:pt-32"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <div className="mx-auto max-w-website-4xl text-center">
          <h1
            id="workbench-title"
            className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-3"
          >
            <span className="font-brand text-4xl font-extrabold tracking-wide text-primary-text sm:text-5xl xl:text-6xl">
              RUYIN
            </span>
            <span className="font-mono text-lg font-medium tracking-wide text-muted-foreground sm:text-2xl xl:text-3xl">
              / BUSINESS WORKSPACE
            </span>
          </h1>
          <p className="mt-6 text-lg font-medium leading-relaxed text-balance sm:text-xl">
            {t("hero.tagline")}
          </p>
          <p className="mx-auto mt-3 max-w-website-2xl text-body-md leading-7 text-pretty text-muted-foreground">
            {t("hero.description")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button asChild size="lg">
              <Link href="/contact#support">
                {t("hero.primaryAction")}
                <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-10 lg:mt-14">
          <WorkbenchScreenshots />
        </div>
      </div>
    </section>
  );
}
