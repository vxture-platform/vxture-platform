/**
 * Business illustrations kept separate from authentic product screenshots.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { WorkbenchDesktop } from "./WorkbenchDesktop";
import { WorkbenchSectionHeading } from "./WorkbenchSectionHeading";

/** @returns Illustrative professional workflows without implying released product results. */
export function WorkbenchScenarios() {
  const t = useTranslations("products.workbench.scenarios");
  return (
    <section
      aria-labelledby="workbench-scenarios-title"
      className="border-t border-border py-16 lg:py-24"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <WorkbenchSectionHeading
          id="workbench-scenarios-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
        <div className="mt-10">
          <WorkbenchDesktop />
        </div>
      </div>
    </section>
  );
}
