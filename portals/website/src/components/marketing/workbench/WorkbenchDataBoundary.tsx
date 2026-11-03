/**
 * Distinguishes local material storage from authorized online inference.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";

// Data boundary composition
/** @returns The local and online responsibilities with an explicit transmission boundary. */
export function WorkbenchDataBoundary() {
  const t = useTranslations("products.workbench.foundations");
  const localItems = t.raw("data.localItems") as string[];
  const serviceItems = t.raw("data.serviceItems") as string[];
  return (
    <div className="mt-14 grid gap-8 border-t border-border pt-8 lg:mt-16 lg:grid-cols-12 lg:gap-16 lg:pt-10">
      <div className="lg:col-span-4">
        <span className="font-mono text-label-sm text-primary-text">
          02 / {t("data.label")}
        </span>
        <h3 className="font-display mt-4 text-2xl font-semibold leading-snug text-balance">
          {t("data.title")}
        </h3>
        <p className="mt-4 text-base leading-8 text-muted-foreground">
          {t("data.description")}
        </p>
      </div>
      <div className="min-w-0 rounded-xl border border-border bg-muted/20 p-5 sm:p-7 lg:col-span-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-primary-border bg-background p-5">
            <p className="flex items-center gap-2 font-semibold">
              <Icon
                name="desktop"
                className="h-5 w-5 text-primary-text"
                aria-hidden
              />
              {t("data.localTitle")}
            </p>
            <ul className="mt-5 space-y-3">
              {localItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-body-md">
                  <Icon
                    name="folder"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-border pt-4 text-body-sm text-muted-foreground">
              {t("data.localNote")}
            </p>
          </div>
          <div className="flex flex-col rounded-lg border border-border bg-background p-5">
            <p className="flex items-center gap-2 font-semibold">
              <Icon
                name="cloud"
                className="h-5 w-5 text-primary-text"
                aria-hidden
              />
              {t("data.serviceTitle")}
            </p>
            <ul className="mt-5 flex-1 space-y-3">
              {serviceItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-body-md">
                  <Icon
                    name="check"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-border pt-4 text-body-sm text-muted-foreground">
              {t("data.serviceNote")}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary-border bg-primary-muted px-4 py-4 text-body-md leading-6">
          <Icon
            name="shield-check"
            className="mt-1 h-5 w-5 shrink-0 text-primary-text"
            aria-hidden
          />
          <p>{t("data.boundary")}</p>
        </div>
      </div>
    </div>
  );
}
