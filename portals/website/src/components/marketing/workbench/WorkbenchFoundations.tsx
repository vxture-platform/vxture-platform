/**
 * Platform relationship and the distinction between local storage and inference.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { WorkbenchDataBoundary } from "./WorkbenchDataBoundary";
import { WorkbenchSectionHeading } from "./WorkbenchSectionHeading";

const CONNECTION_ICONS: IconName[] = ["squares-four", "desktop", "folder"];

// Platform and desktop form a product relationship, not a promise of file mirroring.
/** @returns Product connection and a visible local-to-online inference boundary. */
export function WorkbenchFoundations() {
  const t = useTranslations("products.workbench.foundations");
  const connections = t.raw("connection.nodes") as {
    title: string;
    detail: string;
  }[];
  return (
    <section
      id="workbench-foundations"
      aria-labelledby="workbench-foundations-title"
      className="scroll-mt-24 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <WorkbenchSectionHeading
          id="workbench-foundations-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
        <div className="mt-12 grid gap-8 border-t border-border pt-8 lg:grid-cols-12 lg:gap-16 lg:pt-10">
          <div className="lg:col-span-4">
            <span className="font-mono text-label-sm text-primary-text">
              01 / {t("connection.label")}
            </span>
            <h3 className="font-display mt-4 text-2xl font-semibold leading-snug text-balance">
              {t("connection.title")}
            </h3>
            <p className="mt-4 text-base leading-8 text-muted-foreground">
              {t("connection.description")}
            </p>
            <Link
              href="/appcenter"
              className="mt-5 inline-flex items-center gap-2 rounded-md text-body-md font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("connection.action")}
              <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-col justify-center rounded-xl border border-border bg-muted/20 p-5 sm:p-7 lg:col-span-8">
            <div className="grid gap-4 sm:grid-cols-3">
              {connections.map((node, i) => (
                <div
                  key={node.title}
                  className="relative flex min-w-0 flex-col rounded-lg border border-border bg-background p-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Icon
                      name={CONNECTION_ICONS[i] ?? "desktop"}
                      className="h-6 w-6 text-primary-text"
                      aria-hidden
                    />
                    <span className="font-mono text-label-sm text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <p className="mt-6 text-base font-semibold">{node.title}</p>
                  <p className="mt-2 text-body-md leading-6 text-muted-foreground">
                    {node.detail}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-border pt-4 text-body-sm leading-6 text-muted-foreground">
              {t("connection.note")}
            </p>
          </div>
        </div>
        <WorkbenchDataBoundary />
      </div>
    </section>
  );
}
