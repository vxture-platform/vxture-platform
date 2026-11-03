/**
 * Accessible scenario tabs inside a product-shaped desktop illustration.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import {
  Icon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vxture/design-system";
import { WorkbenchScene } from "./WorkbenchScene";

const SCENARIOS = ["bid", "contract", "operations"] as const;

// Section composition
/** @returns An interactive scene illustration without implying a live product session. */
export function WorkbenchDesktop() {
  const t = useTranslations("products.workbench.demo");
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 text-label-sm text-muted-foreground">
        <span className="font-mono tracking-widest">
          RUYIN / BUSINESS WORKSPACE
        </span>
        <span>{t("disclaimer")}</span>
      </figcaption>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-primary/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Icon
              name="desktop"
              className="h-4 w-4 shrink-0 text-primary-text"
              aria-hidden
            />
            <span className="font-brand text-body-md font-semibold tracking-wider">
              RUYIN
            </span>
            <span className="hidden border-l border-border pl-3 text-label-sm text-muted-foreground sm:block">
              {t("workspace")}
            </span>
          </div>
          <span className="flex items-center gap-2 text-label-sm text-muted-foreground">
            <Icon
              name="shield-check"
              className="h-4 w-4 text-primary-text"
              aria-hidden
            />
            {t("boundary")}
          </span>
        </div>
        <Tabs defaultValue="bid">
          <div className="border-b border-border px-3 py-3 sm:px-6">
            <TabsList
              aria-label={t("label")}
              className="grid h-auto w-full grid-cols-3 gap-1 sm:w-auto sm:inline-flex"
            >
              {SCENARIOS.map((id) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="h-auto min-w-0 whitespace-normal px-3 py-2 text-center text-body-md sm:px-5"
                >
                  {t(`scenarios.${id}.label`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {SCENARIOS.map((id) => (
            <TabsContent key={id} value={id} className="m-0">
              <WorkbenchScene scenario={id} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </figure>
  );
}
