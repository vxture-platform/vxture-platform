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

// Catalog and quality examples
export function CatalogScene() {
  const t = useTranslations("products.arda.sample");
  const properties = t.raw("properties") as { label: string; value: string }[];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="gap-0 p-5">
        <Icon
          name="database"
          className="mb-5 h-8 w-8 text-primary-text"
          aria-hidden
        />
        <p className="text-title-sm font-semibold">{t("assetName")}</p>
        <p className="mb-6 mt-2 text-label-sm text-muted-foreground">
          {t("assetDomain")}
        </p>
        <dl className="divide-y divide-border">
          {properties.map((item) => (
            <div
              key={item.label}
              className="flex flex-wrap justify-between gap-2 py-3 text-body-sm"
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="grid grid-rows-2 gap-3">
        <Card className="justify-center gap-2 p-5">
          <p className="text-label-sm text-muted-foreground">
            {t("termLabel")}
          </p>
          <p className="font-semibold">{t("term")}</p>
          <p className="text-body-sm text-muted-foreground">
            {t("termDescription")}
          </p>
        </Card>
        <Card className="justify-center gap-2 p-5">
          <p className="text-label-sm text-muted-foreground">
            {t("governanceLabel")}
          </p>
          <p className="font-semibold">{t("governance")}</p>
          <p className="flex items-center gap-2 text-body-sm text-primary-text">
            <Icon name="check" className="h-4 w-4" aria-hidden />
            {t("linked")}
          </p>
        </Card>
      </div>
    </div>
  );
}

export function QualityScene() {
  const t = useTranslations("products.arda.sample");
  const rules = t.raw("rules") as string[];
  return (
    <div className="space-y-3">
      {rules.map((rule, index) => (
        <Card
          key={rule}
          className="flex-row flex-wrap items-center justify-between gap-3 p-4"
        >
          <p className="flex items-center gap-3 text-body-sm">
            <Icon
              name="file-text"
              className="h-4 w-4 shrink-0 text-primary-text"
              aria-hidden
            />
            {rule}
          </p>
          <Badge variant="outline">
            {index === 2 ? t("anomaly") : t("passed")}
          </Badge>
        </Card>
      ))}
      <p className="border-l-2 border-primary-border py-2 pl-4 text-body-sm leading-6 text-muted-foreground">
        {t("qualityNote")}
      </p>
    </div>
  );
}
