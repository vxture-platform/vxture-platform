/**
 * Capability illustrations, using sample data rather than production claims.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";

// Lineage and service examples
export function LineageScene() {
  const t = useTranslations("products.arda.sample");
  const sources = t.raw("lineageSources") as string[];
  const consumers = t.raw("consumers") as string[];
  return (
    <div className="grid items-center gap-3 py-3 sm:grid-cols-3">
      <div className="space-y-3">
        {sources.map((source) => (
          <Card
            key={source}
            className="items-center gap-2 p-4 text-center text-body-sm"
          >
            <Icon
              name="database"
              className="h-5 w-5 text-muted-foreground"
              aria-hidden
            />
            {source}
          </Card>
        ))}
      </div>
      <div className="flex flex-col items-center gap-3">
        <Icon
          name="arrow-down"
          className="h-4 w-4 text-primary-text sm:hidden"
          aria-hidden
        />
        <Icon
          name="arrow-right"
          className="hidden h-4 w-4 text-primary-text sm:block"
          aria-hidden
        />
        <div className="w-full rounded-lg border border-primary-border bg-primary-muted p-4 text-center text-body-sm text-primary-text">
          {t("assetName")}
        </div>
        <Icon
          name="arrow-down"
          className="h-4 w-4 text-primary-text sm:hidden"
          aria-hidden
        />
        <Icon
          name="arrow-right"
          className="hidden h-4 w-4 text-primary-text sm:block"
          aria-hidden
        />
      </div>
      <div className="space-y-3">
        {consumers.map((consumer) => (
          <Card
            key={consumer}
            className="items-center gap-2 p-4 text-center text-body-sm"
          >
            <Icon
              name="stack"
              className="h-5 w-5 text-muted-foreground"
              aria-hidden
            />
            {consumer}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ServiceScene() {
  const t = useTranslations("products.arda.sample");
  return (
    <Card className="gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-title-sm font-semibold">{t("service")}</p>
        <Icon
          name="code"
          className="h-6 w-6 shrink-0 text-primary-text"
          aria-hidden
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {(t.raw("serviceTags") as string[]).map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>
      <p className="text-body-sm leading-6 text-muted-foreground">
        {t("serviceConsumers")}
      </p>
      <p className="flex items-start gap-2 border-t border-border pt-5 text-body-sm text-primary-text">
        <Icon
          name="shield-check"
          className="mt-1 h-4 w-4 shrink-0"
          aria-hidden
        />
        {t("serviceAudit")}
      </p>
    </Card>
  );
}
