/**
 * Catalog detail text with restrained, consistent reading typography.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { AgentDetailContent } from "./agent-detail-model";
import { AgentCapabilityTags } from "./AgentCapabilityTags";

// Progressive disclosure retains complete catalog text while keeping the initial view compact.
/** @param props Normalized catalog content. @returns Recorded detail without synthesized subheadings. */
export function AgentIntroduction({
  content,
}: {
  content: AgentDetailContent;
}) {
  const t = useTranslations("products.agentDetail");
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const hasDetail = content.paragraphs.length > 0;
  const hasTags = content.tags.length > 0;
  if (!hasDetail && !hasTags) return null;
  return (
    <section
      aria-labelledby="agent-introduction-title"
      className="border-t border-border bg-muted/20 py-12 lg:py-16"
    >
      <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
        <h2
          id="agent-introduction-title"
          className="text-body-sm font-medium leading-8 text-muted-foreground"
        >
          {t("detailLabel")}
        </h2>
        <div className="mt-4 space-y-7">
          {hasDetail ? (
            <div className="min-w-0 max-w-website-4xl">
              <p className="whitespace-pre-line break-words text-base leading-8 text-foreground">
                {content.paragraphs[0]}
              </p>
              {content.paragraphs.length > 1 ? (
                <>
                  <div
                    id={detailId}
                    hidden={!expanded}
                    className="mt-5 space-y-5"
                  >
                    {content.paragraphs.slice(1).map((paragraph, index) => (
                      <p
                        key={`${index}-${paragraph.slice(0, 24)}`}
                        className="whitespace-pre-line break-words text-base leading-8 text-foreground"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? t("collapseDetail") : t("expandDetail")}
                    <Icon
                      name="chevron-down"
                      className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {hasTags ? <AgentCapabilityTags tags={content.tags} /> : null}
        </div>
      </div>
    </section>
  );
}
