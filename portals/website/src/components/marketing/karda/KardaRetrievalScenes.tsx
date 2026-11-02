/**
 * Retrieval provenance and controlled knowledge reuse illustrations.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";

// Question-to-source retrieval
/** @returns A sample query paired with an attributable passage. */
export function RetrievalScene() {
  const t = useTranslations("products.karda.sample");
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-primary-border bg-primary-muted p-4 text-body-sm">
        <Icon
          name="search"
          className="mt-1 h-4 w-4 shrink-0 text-primary-text"
          aria-hidden
        />
        {t("query")}
      </div>
      <Card className="gap-4 p-5">
        <p className="text-label-sm text-muted-foreground">
          {t("excerptLabel")}
        </p>
        <p className="flex items-start gap-3 font-semibold">
          <span className="font-mono text-primary-text">[1]</span>
          {t("sourceTitle")}
        </p>
        <blockquote className="border-l-2 border-primary-border pl-4 text-body-sm leading-7 text-muted-foreground">
          {t("excerpt")}
        </blockquote>
        <p className="border-t border-border pt-4 text-label-sm text-primary-text">
          {t("citation")}
        </p>
      </Card>
      <p className="text-body-sm leading-6 text-muted-foreground">
        {t("retrievalNote")}
      </p>
    </div>
  );
}

// Authorized reuse
/** @returns Knowledge consumers with a visible authorization boundary. */
export function SharingScene() {
  const t = useTranslations("products.karda.sample");
  return (
    <div className="space-y-4">
      <Card className="items-center gap-3 border-primary-border bg-primary-muted p-5 text-center">
        <Icon
          name="book-open"
          className="h-8 w-8 text-primary-text"
          aria-hidden
        />
        <p className="font-semibold">{t("library")}</p>
        <Badge variant="outline">{t("accessLabel")}</Badge>
      </Card>
      <div className="flex justify-center">
        <Icon
          name="arrow-down"
          className="h-5 w-5 text-primary-text"
          aria-hidden
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(t.raw("consumers") as string[]).map((consumer) => (
          <Card
            key={consumer}
            className="items-center gap-3 p-4 text-center text-body-sm"
          >
            <Icon
              name="shield-check"
              className="h-5 w-5 text-primary-text"
              aria-hidden
            />
            {consumer}
          </Card>
        ))}
      </div>
      <p className="border-l-2 border-primary-border py-2 pl-4 text-body-sm leading-6 text-muted-foreground">
        {t("accessNote")}
      </p>
    </div>
  );
}
