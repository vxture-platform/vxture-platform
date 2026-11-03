/**
 * Product positioning without unsupported claims about competing products.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";
import { WorkbenchSectionHeading } from "./WorkbenchSectionHeading";

// Section composition
/** @returns Three complementary product categories and RUYIN's business focus. */
export function WorkbenchPositioning() {
  const t = useTranslations("products.workbench.positioning");
  const categories = t.raw("categories") as {
    label: string;
    title: string;
    description: string;
    focus: string;
  }[];
  return (
    <section
      aria-labelledby="workbench-positioning-title"
      className="py-16 lg:py-24"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <WorkbenchSectionHeading
          id="workbench-positioning-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {categories.map((category, i) => (
            <div
              key={category.title}
              className={`flex min-w-0 flex-col rounded-xl border p-6 lg:p-8 ${i === 2 ? "border-primary-border bg-primary-muted/40" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p
                  className={`text-label-sm font-medium ${i === 2 ? "text-primary-text" : "text-muted-foreground"}`}
                >
                  {category.label}
                </p>
                <Icon
                  name={
                    i === 2 ? "desktop" : i === 1 ? "squares-four" : "file-text"
                  }
                  className="h-5 w-5 text-muted-foreground"
                  aria-hidden
                />
              </div>
              <h3 className="font-display mt-6 text-2xl font-semibold leading-snug">
                {category.title}
              </h3>
              <p className="mt-4 flex-1 text-base leading-8 text-muted-foreground">
                {category.description}
              </p>
              <p className="mt-7 border-t border-border pt-5 text-body-md font-medium leading-6">
                {category.focus}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-website-4xl text-body-sm leading-6 text-muted-foreground">
          {t("note")}{" "}
          <a
            href="https://www.workbuddy.ai/"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            WorkBuddy
          </a>
          <span aria-hidden> · </span>
          <a
            href="https://claude.com/product/cowork"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Claude Cowork
          </a>
        </p>
      </div>
    </section>
  );
}
