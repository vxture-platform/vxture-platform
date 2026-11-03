/**
 * Makes catalog highlights primary content rather than tiny chips.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Card, Icon } from "@vxture/design-system";

/** @param props Registered highlights. @returns An optional capability grid. */
export function AgentCapabilities({
  highlights,
}: {
  highlights: readonly string[];
}) {
  const t = useTranslations("products.agentDetail");
  if (highlights.length === 0) return null;
  const fourColumns =
    highlights.length === 4 ||
    (highlights.length > 6 && highlights.length % 3 !== 0);
  const columns =
    highlights.length === 1
      ? ""
      : highlights.length === 2
        ? "sm:grid-cols-2"
        : fourColumns
          ? "sm:grid-cols-2 md:grid-cols-4"
          : "sm:grid-cols-2 md:grid-cols-3";
  return (
    <section
      id="agent-capabilities"
      aria-labelledby="agent-capabilities-title"
      className="scroll-mt-24 py-12 lg:py-16"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-12">
        <p className="text-label-sm font-semibold text-primary-text">
          {t("capabilitiesEyebrow")}
        </p>
        <h2
          id="agent-capabilities-title"
          className="font-display mt-2 max-w-website-3xl text-2xl font-semibold leading-snug tracking-tight text-balance sm:text-3xl"
        >
          {t("capabilitiesTitle")}
        </h2>
        <div className={`mt-7 grid gap-3 lg:gap-4 ${columns}`}>
          {highlights.map((highlight, index) => (
            <Card
              key={highlight}
              className="relative min-w-0 gap-5 overflow-hidden rounded-xl border-border bg-card p-5 shadow-none sm:p-6"
            >
              <div
                className="flex items-center justify-between gap-4"
                aria-hidden
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted text-primary-text">
                  <Icon name="squares-four" className="h-4 w-4" />
                </span>
                <span className="font-mono text-label-sm text-muted-foreground/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="font-display break-words text-lg font-semibold leading-7 text-balance">
                {highlight}
              </h3>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
