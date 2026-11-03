/**
 * Real product screenshots with accessible selection and full-resolution viewing.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  Icon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vxture/design-system";

const SCREENS = ["workspace", "privacy", "capabilities"] as const;

/** @returns Privacy-redacted software screenshots, distinct from business illustrations. */
export function WorkbenchScreenshots() {
  const t = useTranslations("products.workbench.screenshots");
  return (
    <Tabs defaultValue="workspace">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TabsList
          aria-label={t("label")}
          className="grid h-auto w-full grid-cols-3 sm:inline-flex sm:w-auto"
        >
          {SCREENS.map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className="h-auto min-w-0 whitespace-normal px-3 py-2 text-body-sm sm:flex-none sm:whitespace-nowrap sm:px-5"
            >
              {t(`${id}.label`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="hidden text-label-sm text-muted-foreground sm:block">
          {t("badge")}
        </span>
      </div>
      {SCREENS.map((id) => (
        <TabsContent key={id} value={id} className="m-0">
          <figure>
            <a
              href={`/images/workbench/${id}.webp`}
              target="_blank"
              rel="noreferrer"
              aria-label={t("enlarge", { screen: t(`${id}.label`) })}
              className="group relative block overflow-hidden rounded-xl border border-border shadow-xl shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Image
                src={`/images/workbench/${id}.webp`}
                alt={t(`${id}.alt`)}
                width={2560}
                height={1528}
                sizes="(min-width: 1536px) 1472px, (min-width: 1024px) calc(100vw - 64px), calc(100vw - 48px)"
                quality={90}
                priority={id === "workspace"}
                className="h-auto w-full"
              />
              <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-label-sm text-foreground shadow-sm sm:bottom-4 sm:right-4">
                <Icon name="external-link" className="h-4 w-4" aria-hidden />
                {t("view")}
              </span>
            </a>
            <figcaption className="mt-3 text-body-sm leading-6 text-muted-foreground">
              {t("note")}
            </figcaption>
          </figure>
        </TabsContent>
      ))}
    </Tabs>
  );
}
