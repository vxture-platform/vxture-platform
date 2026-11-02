/**
 * Illustrative catalog, deliberately distinct from a functional product screen.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

const MENU_ICONS: IconName[] = [
  "chart-line",
  "database",
  "squares-four",
  "file-text",
  "shield-check",
  "tree-structure",
  "code",
];

// Workspace illustration
/** @returns A responsive, noninteractive catalog illustration with sample data. */
export function ArdaWorkspace() {
  const t = useTranslations("products.arda");
  const menu = t.raw("sample.menu") as string[];
  const rows = t.raw("sample.assets") as { name: string; domain: string }[];
  const stages = t.raw("sample.stages") as string[];
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap justify-between gap-2 text-label-sm text-muted-foreground">
        <span>ARDA / DATA WORKSPACE</span>
        <span>{t("sample.disclaimer")}</span>
      </figcaption>
      <Card surface="strong" className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <Icon
              name="database"
              className="h-4 w-4 text-primary-text"
              aria-hidden
            />
            Arda
          </span>
          <span className="text-label-sm text-muted-foreground">
            {t("sample.workspace")}
          </span>
        </div>
        <div className="flex">
          <div
            className="hidden w-28 shrink-0 space-y-2 border-r border-border bg-muted/30 p-3 sm:block"
            aria-hidden
          >
            {menu.map((item, index) => (
              <div
                key={item}
                className={`flex items-center gap-2 rounded-md px-2 py-2 text-label-sm ${index === 2 ? "bg-primary-muted text-primary-text" : "text-muted-foreground"}`}
              >
                <Icon
                  name={MENU_ICONS[index] ?? "squares-four"}
                  className="h-3 w-3 shrink-0"
                />
                {item}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <p className="text-label-sm text-muted-foreground">
              {t("sample.breadcrumb")}
            </p>
            <p className="mt-3 text-title-sm font-semibold">
              {t("sample.title")}
            </p>
            <div className="my-5 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-label-sm text-muted-foreground">
              <Icon name="search" className="h-3 w-3 shrink-0" aria-hidden />
              {t("sample.search")}
            </div>
            <ul
              aria-label={t("sample.assetsLabel")}
              className="divide-y divide-border"
            >
              {rows.map((row) => (
                <li
                  key={row.name}
                  className="flex items-center justify-between gap-3 py-4"
                >
                  <span className="flex min-w-0 items-start gap-2 text-body-sm">
                    <Icon
                      name="database"
                      className="mt-1 h-3 w-3 shrink-0 text-primary-text"
                      aria-hidden
                    />
                    <span>
                      {row.name}
                      <small className="mt-1 block text-label-sm text-muted-foreground">
                        {row.domain}
                      </small>
                    </span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-label-sm">
                    {t("sample.passed")}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-label-sm text-muted-foreground">
              {t("sample.footer")}
            </p>
          </div>
        </div>
      </Card>
      <div
        className="mt-3 flex flex-wrap items-center justify-center gap-3 rounded-lg border border-primary-border bg-primary-muted px-3 py-3 text-label-sm text-primary-text"
        aria-hidden
      >
        {stages.map((item, index) => (
          <span key={item} className="inline-flex items-center gap-3">
            {index > 0 && <Icon name="arrow-right" className="h-3 w-3" />}
            {item}
          </span>
        ))}
      </div>
    </figure>
  );
}
