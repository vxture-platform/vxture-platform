/**
 * Arda's data supply boundary and governance model.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Card, Icon } from "@vxture/design-system";
import { ArdaSectionIntro } from "./ArdaSectionIntro";
import { ProductPlatformPeers } from "../ProductPlatformPeers";

interface Guard {
  title: string;
  description: string;
}

// Data supply diagram
/** @returns A responsive data-flow diagram with explicit product boundaries. */
export function ArdaDataFlow() {
  const t = useTranslations("products.arda.flow");
  return (
    <section aria-labelledby="arda-flow-title" className="py-16 lg:py-24">
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <ArdaSectionIntro
          id="arda-flow-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
        <figure aria-label={t("diagramLabel")}>
          <Card className="gap-6 p-5 sm:p-8 lg:flex-row">
            <div className="min-w-0 flex-1">
              <p className="mb-3 text-body-sm font-semibold">
                {t("consumersLabel")}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(t.raw("consumers") as string[]).map((item) => (
                  <div
                    key={item}
                    className="rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-body-sm"
                  >
                    {item}
                  </div>
                ))}
              </div>
              <p className="flex items-center justify-center gap-3 py-4 text-label-sm text-primary-text">
                <Icon name="arrow-up" className="h-4 w-4" aria-hidden />
                {t("supply")}
              </p>
              <div className="rounded-lg border border-primary-border bg-primary-muted p-5">
                <p className="flex items-center gap-3 font-semibold text-primary-text">
                  <Icon name="database" className="h-6 w-6" aria-hidden />
                  Arda · {t("core")}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(t.raw("modules") as string[]).map((item) => (
                    <div
                      key={item}
                      className="rounded-md border border-primary-border px-3 py-4 text-center text-body-sm text-primary-text"
                    >
                      {item}
                    </div>
                  ))}
                </div>
                <p className="mt-5 flex items-center justify-center gap-2 border-t border-primary-border pt-4 text-body-sm text-primary-text">
                  <Icon name="code" className="h-4 w-4 shrink-0" aria-hidden />
                  {t("service")}
                </p>
              </div>
              <p className="flex items-center justify-center gap-3 py-4 text-label-sm text-primary-text">
                <Icon name="arrow-up" className="h-4 w-4" aria-hidden />
                {t("intake")}
              </p>
              <div className="mb-3 flex flex-wrap justify-between gap-2 text-body-sm">
                <span className="font-semibold">{t("sourcesLabel")}</span>
                <span className="text-label-sm text-muted-foreground">
                  {t("sourcesNote")}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(t.raw("sources") as string[]).map((item) => (
                  <div
                    key={item}
                    className="rounded-md border border-border bg-muted/30 px-3 py-4 text-center text-body-sm"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <aside
              aria-label={t("guardsLabel")}
              className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2 lg:w-40 lg:shrink-0 lg:grid-cols-1 lg:content-center lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
            >
              {(t.raw("guards") as Guard[]).map((guard) => (
                <div key={guard.title}>
                  <p className="text-body-sm font-semibold">{guard.title}</p>
                  <p className="mt-2 text-label-sm text-muted-foreground">
                    {guard.description}
                  </p>
                </div>
              ))}
            </aside>
          </Card>
          <figcaption className="mt-4 flex flex-wrap justify-between gap-2 text-label-sm text-muted-foreground">
            <span>{t("caption")}</span>
            <span>{t("illustration")}</span>
          </figcaption>
        </figure>
        <ProductPlatformPeers />
      </div>
    </section>
  );
}
