/**
 * Knowledge intake and organization illustrations.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";

// Source intake and processing
/** @returns Sample source materials and their knowledge preparation stages. */
export function IntakeScene() {
  const t = useTranslations("products.karda.sample");
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(t.raw("intakeSources") as string[]).map((source) => (
          <Card
            key={source}
            className="items-center gap-3 p-4 text-center text-body-sm"
          >
            <Icon
              name="file-text"
              className="h-6 w-6 text-primary-text"
              aria-hidden
            />
            {source}
          </Card>
        ))}
      </div>
      <div className="flex justify-center py-4">
        <Icon
          name="arrow-down"
          className="h-5 w-5 text-primary-text"
          aria-hidden
        />
      </div>
      <Card className="gap-4 border-primary-border bg-primary-muted p-5">
        <p className="flex items-center gap-2 text-body-sm font-semibold text-primary-text">
          <Icon name="book-open" className="h-5 w-5 shrink-0" aria-hidden />
          {t("intakeTitle")}
        </p>
        <ol className="grid gap-3 sm:grid-cols-3">
          {(t.raw("processing") as string[]).map((stage, index) => (
            <li
              key={stage}
              className="rounded-md border border-primary-border p-3 text-body-sm"
            >
              <span className="mb-2 block font-mono text-label-sm text-muted-foreground">
                0{index + 1}
              </span>
              {stage}
            </li>
          ))}
        </ol>
        <p className="border-t border-primary-border pt-4 text-body-sm text-muted-foreground">
          {t("intakeNote")}
        </p>
      </Card>
    </div>
  );
}

// Library organization and stewardship
/** @returns A sample library with ownership and classification context. */
export function OrganizationScene() {
  const t = useTranslations("products.karda.sample");
  const properties = t.raw("properties") as { label: string; value: string }[];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="gap-0 p-5">
        <Icon
          name="stack"
          className="mb-5 h-8 w-8 text-primary-text"
          aria-hidden
        />
        <p className="text-title-sm font-semibold">{t("library")}</p>
        <p className="mb-5 mt-2 text-label-sm text-muted-foreground">
          {t("libraryDescription")}
        </p>
        <dl className="divide-y divide-border">
          {properties.map((property) => (
            <div
              key={property.label}
              className="flex flex-wrap justify-between gap-2 py-3 text-body-sm"
            >
              <dt className="text-muted-foreground">{property.label}</dt>
              <dd>{property.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="grid grid-rows-2 gap-3">
        <Card className="justify-center gap-3 p-5">
          <p className="text-label-sm text-muted-foreground">
            {t("topicsLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(t.raw("topics") as string[]).map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
          <p className="text-body-sm text-muted-foreground">
            {t("topicsNote")}
          </p>
        </Card>
        <Card className="justify-center gap-2 p-5">
          <p className="text-label-sm text-muted-foreground">
            {t("maintenanceLabel")}
          </p>
          <p className="font-semibold">{t("maintenanceTitle")}</p>
          <p className="text-body-sm leading-6 text-muted-foreground">
            {t("maintenanceNote")}
          </p>
        </Card>
      </div>
    </div>
  );
}
