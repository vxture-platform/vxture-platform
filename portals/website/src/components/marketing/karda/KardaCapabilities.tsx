/**
 * Capability explorer using DS tabs for selection and keyboard navigation.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import {
  Icon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { KardaSectionIntro } from "./KardaSectionIntro";
import { KardaCapabilityScene } from "./KardaCapabilityScene";

// Capability identifiers carry structure; all customer copy comes from messages.
const CAPABILITIES: {
  id: "ingest" | "organize" | "retrieve" | "share";
  icon: IconName;
}[] = [
  { id: "ingest", icon: "file-text" },
  { id: "organize", icon: "stack" },
  { id: "retrieve", icon: "search" },
  { id: "share", icon: "shield-check" },
];

/** @returns Accessible capability tabs and their illustrative detail panels. */
export function KardaCapabilities() {
  const t = useTranslations("products.karda");
  return (
    <section
      id="karda-capabilities"
      aria-labelledby="karda-capabilities-title"
      className="scroll-mt-24 border-b border-border bg-muted/20 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <KardaSectionIntro
          id="karda-capabilities-title"
          eyebrow={t("capabilities.eyebrow")}
          title={t("capabilities.title")}
          description={t("capabilities.description")}
        />
        <Tabs defaultValue="ingest">
          <TabsList
            aria-label={t("capabilities.label")}
            className="grid h-auto w-full grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {CAPABILITIES.map(({ id, icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-auto min-w-0 gap-2 whitespace-normal px-3 py-4 text-left"
              >
                <Icon name={icon} className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-body-sm font-semibold">
                    {t(`capabilities.${id}.label`)}
                  </span>
                  <span className="mt-1 hidden text-label-sm text-muted-foreground lg:block">
                    {t(`capabilities.${id}.hint`)}
                  </span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {CAPABILITIES.map(({ id }, index) => (
            <TabsContent key={id} value={id} className="mt-8">
              <div className="grid items-center gap-8 lg:grid-cols-5 lg:gap-12">
                <div className="lg:col-span-2">
                  <p className="font-mono text-label-sm text-muted-foreground">
                    0{index + 1} / {id.toUpperCase()}
                  </p>
                  <h3 className="font-display mt-4 text-2xl font-semibold leading-snug text-balance lg:text-3xl">
                    {t(`capabilities.${id}.title`)}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-muted-foreground">
                    {t(`capabilities.${id}.description`)}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {(t.raw(`capabilities.${id}.points`) as string[]).map(
                      (point) => (
                        <li key={point} className="flex gap-3 text-body-sm">
                          <Icon
                            name="check"
                            className="mt-1 h-4 w-4 shrink-0 text-primary-text"
                            aria-hidden
                          />
                          <span>{point}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
                <div className="min-w-0 lg:col-span-3">
                  <KardaCapabilityScene kind={id} />
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
