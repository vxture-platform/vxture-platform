/**
 * Team-oriented positioning separates shared organization from local project files.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { WorkbenchSectionHeading } from "./WorkbenchSectionHeading";

const TEAM_ICONS: IconName[] = ["users", "squares-four", "file-text"];

// Section composition
/** @returns Team value, an illustrative handoff and explicit collaboration availability. */
export function WorkbenchTeams() {
  const t = useTranslations("products.workbench.teams");
  const roles = t.raw("roles") as { role: string; task: string }[];
  const points = t.raw("points") as { title: string; description: string }[];
  return (
    <section
      aria-labelledby="workbench-teams-title"
      className="border-y border-border bg-muted/20 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <WorkbenchSectionHeading
              id="workbench-teams-title"
              eyebrow={t("eyebrow")}
              title={t("title")}
              description={t("description")}
            />
            <div className="mt-8 space-y-6">
              {points.map((point, i) => (
                <div key={point.title} className="flex gap-4">
                  <Icon
                    name={TEAM_ICONS[i] ?? "users"}
                    className="mt-1 h-5 w-5 shrink-0 text-primary-text"
                    aria-hidden
                  />
                  <div>
                    <h3 className="text-base font-semibold">{point.title}</h3>
                    <p className="mt-2 text-body-md leading-7 text-muted-foreground">
                      {point.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <figure className="flex min-w-0 flex-col rounded-xl border border-border bg-background p-5 sm:p-8 lg:col-span-7">
            <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-5 text-body-sm text-muted-foreground">
              <span>{t("sample.title")}</span>
              <span>{t("sample.label")}</span>
            </figcaption>
            <div className="mt-7 flex items-center gap-3 rounded-lg border border-primary-border bg-primary-muted p-5">
              <Icon
                name="users"
                className="h-6 w-6 shrink-0 text-primary-text"
                aria-hidden
              />
              <div>
                <p className="font-semibold">{t("sample.workspace")}</p>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {t("sample.resources")}
                </p>
              </div>
            </div>
            <div className="mx-auto h-6 w-px bg-border" aria-hidden />
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              {roles.map((item, i) => (
                <div
                  key={item.role}
                  className="rounded-lg border border-border p-4"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-body-sm text-muted-foreground">
                    0{i + 1}
                  </span>
                  <p className="mt-4 text-base font-semibold">{item.role}</p>
                  <p className="mt-2 text-body-md leading-6 text-muted-foreground">
                    {item.task}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
              <Icon
                name="file-text"
                className="h-5 w-5 shrink-0 text-primary-text"
                aria-hidden
              />
              <p className="text-body-md font-medium">{t("sample.outcome")}</p>
            </div>
            <p className="mt-6 text-body-sm leading-6 text-muted-foreground">
              {t("availability")}
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
