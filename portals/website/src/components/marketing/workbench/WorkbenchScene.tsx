/**
 * Fictional project data illustrates professional workflows, never delivery status.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";

// Section composition
/** @param props The selected illustrative workflow. @returns A local-project and task composition. */
export function WorkbenchScene({
  scenario,
}: {
  scenario: "bid" | "contract" | "operations";
}) {
  const t = useTranslations("products.workbench.demo");
  const s = useTranslations(`products.workbench.demo.scenarios.${scenario}`);
  const files = s.raw("files") as string[];
  const steps = s.raw("steps") as string[];
  const outputs = s.raw("outputs") as string[];
  return (
    <div className="grid min-w-0 md:grid-cols-12">
      <div className="hidden border-r border-border bg-muted/20 p-5 md:col-span-3 md:block xl:col-span-2">
        <p className="text-label-sm text-muted-foreground">
          {t("projectLabel")}
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-md bg-primary-muted px-3 py-3 text-body-md font-medium text-primary-text">
          <Icon name="folder" className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>{s("project")}</span>
        </div>
        <p className="mb-3 mt-8 text-label-sm text-muted-foreground">
          {t("filesLabel")}
        </p>
        <ul className="space-y-4">
          {files.map((file) => (
            <li
              key={file}
              className="flex items-start gap-2 text-body-sm leading-5 text-muted-foreground"
            >
              <Icon
                name="file-text"
                className="mt-1 h-3 w-3 shrink-0"
                aria-hidden
              />
              <span className="break-words">{file}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 p-5 sm:p-7 md:col-span-9 xl:col-span-10 xl:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <Icon
              name="folder"
              className="h-4 w-4 text-primary-text"
              aria-hidden
            />
            {s("project")}
          </p>
          <span className="rounded-full border border-primary-border bg-primary-muted px-3 py-1 text-label-sm text-primary-text">
            {t("agentLabel")}
          </span>
        </div>
        <h3 className="font-display mt-5 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
          {s("title")}
        </h3>
        <p className="mt-2 max-w-website-2xl text-body-md leading-6 text-muted-foreground">
          {s("description")}
        </p>
        <div className="mt-6 grid gap-5 lg:grid-cols-5">
          <div className="rounded-lg border border-border p-4 sm:p-5 lg:col-span-3">
            <p className="text-label-sm font-medium text-muted-foreground">
              {t("stepsLabel")}
            </p>
            <ol className="mt-5 space-y-4">
              {steps.map((step, i) => (
                <li
                  key={step}
                  className="flex items-start gap-3 text-body-md leading-6"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary-muted font-mono text-label-sm text-primary-text">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex min-w-0 flex-col rounded-lg border border-primary-border bg-primary-muted/30 p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-center gap-2 text-body-md font-semibold">
              <Icon
                name="file-text"
                className="h-4 w-4 text-primary-text"
                aria-hidden
              />
              {t("outputsLabel")}
            </div>
            <ul className="mt-4 flex-1 space-y-3">
              {outputs.map((output) => (
                <li
                  key={output}
                  className="flex items-start gap-2 rounded-md border border-border bg-background/70 p-3 text-body-md"
                >
                  <Icon
                    name="check"
                    className="mt-1 h-4 w-4 shrink-0 text-primary-text"
                    aria-hidden
                  />
                  <span className="break-words">{output}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-body-sm leading-5 text-muted-foreground">
              <Icon
                name="shield-check"
                className="h-4 w-4 shrink-0"
                aria-hidden
              />
              {t("review")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
