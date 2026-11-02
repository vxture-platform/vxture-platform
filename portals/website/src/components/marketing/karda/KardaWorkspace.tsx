/**
 * A source-based knowledge search illustration, not a live search interface.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";

interface Source {
  title: string;
  location: string;
}

// Knowledge workspace illustration
/** @returns Sample search results paired with a traceable source excerpt. */
export function KardaWorkspace() {
  const t = useTranslations("products.karda.sample");
  const sources = t.raw("sources") as Source[];
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap justify-between gap-2 text-label-sm text-muted-foreground">
        <span>KARDA / KNOWLEDGE WORKSPACE</span>
        <span>{t("disclaimer")}</span>
      </figcaption>
      <Card surface="strong" className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <Icon
              name="book-open"
              className="h-4 w-4 text-primary-text"
              aria-hidden
            />
            Karda
          </span>
          <span className="text-label-sm text-muted-foreground">
            {t("workspace")}
          </span>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-label-sm text-muted-foreground">
            {t("breadcrumb")}
          </p>
          <div className="my-4 flex items-start gap-3 rounded-md border border-primary-border bg-primary-muted p-4 text-body-sm">
            <Icon
              name="search"
              className="mt-1 h-4 w-4 shrink-0 text-primary-text"
              aria-hidden
            />
            <span>{t("query")}</span>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {(t.raw("filters") as string[]).map((filter) => (
              <Badge key={filter} variant="outline">
                {filter}
              </Badge>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-3 text-label-sm text-muted-foreground">
                {t("resultsLabel")}
              </p>
              <ol className="space-y-3">
                {sources.map((source, index) => (
                  <li
                    key={source.title}
                    className={`flex items-start gap-2 rounded-lg border p-3 ${index === 0 ? "border-primary-border bg-primary-muted" : "border-border"}`}
                  >
                    <span className="font-mono text-label-sm text-primary-text">
                      [{index + 1}]
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-sm font-semibold">
                        {source.title}
                      </p>
                      <p className="mt-2 text-label-sm text-muted-foreground">
                        {source.location}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex min-w-0 flex-col rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-label-sm text-muted-foreground">
                {t("excerptLabel")}
              </p>
              <p className="mt-3 flex items-start gap-2 text-body-sm font-semibold">
                <Icon
                  name="file-text"
                  className="mt-1 h-4 w-4 shrink-0 text-primary-text"
                  aria-hidden
                />
                {sources[0]?.title}
              </p>
              <blockquote className="my-4 border-l-2 border-primary-border pl-3 text-body-sm leading-7 text-muted-foreground">
                {t("excerpt")}
              </blockquote>
              <p className="mt-auto border-t border-border pt-3 text-label-sm text-primary-text">
                {t("citation")}
              </p>
            </div>
          </div>
          <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-label-sm text-muted-foreground">
            <Icon
              name="shield-check"
              className="h-4 w-4 shrink-0 text-primary-text"
              aria-hidden
            />
            {t("scopeNote")}
          </p>
        </div>
      </Card>
      <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary-border bg-primary-muted px-3 py-3 text-center text-label-sm text-primary-text">
        <Icon name="book-open" className="h-4 w-4 shrink-0" aria-hidden />
        {t("footer")}
      </div>
    </figure>
  );
}
