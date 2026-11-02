/**
 * Knowledge lifecycle and the peer relationship between Karda and Arda.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Card, Icon } from "@vxture/design-system";
import { KardaSectionIntro } from "./KardaSectionIntro";
import { ProductPlatformPeers } from "../ProductPlatformPeers";

interface Step {
  title: string;
  description: string;
}

// Knowledge lifecycle and product boundaries
/** @returns A knowledge lifecycle and two equally weighted product domains. */
export function KardaKnowledgeFlow() {
  const t = useTranslations("products.karda.flow");
  return (
    <section aria-labelledby="karda-flow-title" className="py-16 lg:py-24">
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <KardaSectionIntro
          id="karda-flow-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
        <figure aria-label={t("diagramLabel")}>
          <Card className="gap-6 p-5 sm:p-8">
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(t.raw("steps") as Step[]).map((step, index) => (
                <li
                  key={step.title}
                  className="min-w-0 rounded-lg border border-border p-5"
                >
                  <div className="mb-5 flex items-center justify-between text-primary-text">
                    <span className="font-mono text-label-sm">
                      0{index + 1}
                    </span>
                    <Icon
                      name={index === 3 ? "book-open" : "arrow-right"}
                      className="h-5 w-5"
                      aria-hidden
                    />
                  </div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-3 text-body-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary-border bg-primary-muted p-5">
              <p className="flex items-center gap-2 font-semibold text-primary-text">
                <Icon
                  name="shield-check"
                  className="h-5 w-5 shrink-0"
                  aria-hidden
                />
                {t("service")}
              </p>
              <div className="flex flex-wrap gap-3 text-body-sm">
                {(t.raw("consumers") as string[]).map((consumer) => (
                  <span
                    key={consumer}
                    className="rounded-md border border-primary-border px-3 py-2"
                  >
                    {consumer}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <figcaption className="mt-4 text-label-sm text-muted-foreground">
            {t("caption")}
          </figcaption>
        </figure>
        <ProductPlatformPeers />
      </div>
    </section>
  );
}
