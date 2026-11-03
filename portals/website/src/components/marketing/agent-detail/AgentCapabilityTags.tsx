/**
 * Individual feature cards rendered from catalog tags.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import { Card, Icon } from "@vxture/design-system";

/** @param props Registered tags. @returns One feature card per tag without synthesized content. */
export function AgentCapabilityTags({ tags }: { tags: readonly string[] }) {
  const t = useTranslations("products.agentDetail");
  if (tags.length === 0) return null;
  return (
    <ul
      aria-label={t("tagsLabel")}
      className={`grid gap-3 lg:gap-4 ${tags.length === 1 ? "" : tags.length === 2 ? "sm:grid-cols-2" : tags.length === 4 ? "sm:grid-cols-2 md:grid-cols-4" : "sm:grid-cols-2 md:grid-cols-3"}`}
    >
      {tags.map((tag, index) => (
        <li key={tag} className="min-w-0">
          <Card className="relative h-full min-w-0 gap-4 overflow-hidden rounded-xl border-border bg-card p-5 shadow-none sm:p-6">
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full border border-primary-border/30"
              aria-hidden
            />
            <div className="relative flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary-border/60 bg-primary-muted text-primary-text">
                <Icon name="sparkles" className="h-5 w-5" aria-hidden />
              </span>
              <span
                className="font-mono text-label-sm text-muted-foreground/60"
                aria-hidden
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="relative break-words text-base font-medium leading-7 text-foreground">
              {tag}
            </h3>
          </Card>
        </li>
      ))}
    </ul>
  );
}
