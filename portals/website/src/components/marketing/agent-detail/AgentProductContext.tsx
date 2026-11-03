/**
 * Lightweight catalog metadata inside the product hero.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import type { AgentDetailContent } from "./agent-detail-model";

/** @param props Catalog industries. @returns Optional, compact industry metadata. */
export function AgentProductContext({
  content,
}: {
  content: AgentDetailContent;
}) {
  const t = useTranslations("products.agentDetail");
  if (content.industries.length === 0) return null;
  return (
    <dl className="mt-6 grid gap-2 border-t border-border/60 pt-4 text-label-sm leading-6 text-muted-foreground">
      <div className="flex items-baseline gap-3">
        <dt className="shrink-0">{t("industriesLabel")}</dt>
        <dd className="min-w-0 break-words">
          {content.industries.join(" · ")}
        </dd>
      </div>
    </dl>
  );
}
