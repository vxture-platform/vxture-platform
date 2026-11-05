"use client";

/**
 * Overview resource and product summary; full management lives in subscriptions.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */

import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Progress,
  StatusBadge,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { Link } from "@/lib/i18n/navigation";
import type { ProductAppTile } from "@/api/console-bff";

/** Keep the overview compact; complete product management lives in subscriptions. */
const MAX_TILES = 6;

/** 用量超过这个比例就算「该注意了」。与配额页的告急阈值同口径。 */
const ATTENTION_PERCENT = 80;

export interface OverviewQuotaRow {
  /** 展示名（已过 metric 字典） */
  label: string;
  /** 已用占额度的百分比，0–100；额度为 0 时给 null（除不动，不是 0%） */
  percent: number | null;
  /** 「3.2 / 10 GB」这类可读文本 */
  text: string;
}

export function ResourceSection({
  tiles,
  tilesFailed,
  quotaRows,
  quotaFailed,
  loading,
}: {
  tiles: ProductAppTile[] | null;
  tilesFailed: boolean;
  quotaRows: OverviewQuotaRow[];
  quotaFailed: boolean;
  loading: boolean;
}) {
  const t = useTranslations("dashboard.resources");
  const shown = (tiles ?? []).slice(0, MAX_TILES);
  const more = (tiles?.length ?? 0) - shown.length;

  return (
    <PageSection
      icon="squares-four"
      level={2}
      title={t("title")}
      description={t("description")}
      action={
        <Button asChild variant="outline" size="sm">
          {/* Keep management navigation inside Console. */}
          <Link href="/subscription">{t("viewAll")}</Link>
        </Button>
      }
    >
      {/* ── 产品 ────────────────────────────────────────────────────── */}
      {loading ? (
        <EmptyState icon="clock" title={t("loading")} />
      ) : tilesFailed ? (
        <EmptyState icon="warning" title={t("tilesFailed")} />
      ) : shown.length === 0 ? (
        /* 「一个产品都没有」是真实且正常的状态（刚开工作空间）。
           给一条去处，不要只写「暂无」——那时人最需要知道下一步去哪。 */
        <EmptyState
          icon="squares-four"
          title={t("noProducts")}
          description={t("noProductsHint")}
        />
      ) : (
        <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((tile) => (
            <Card key={tile.code} surface="base" className="py-md">
              <CardContent className="flex items-center gap-md">
                <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <span className="truncate text-label-md text-foreground">
                    {tile.name}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {tile.planName}
                  </span>
                </span>
                <StatusBadge
                  tone={tile.status === "active" ? "success" : "info"}
                >
                  {t(`status.${tile.status}`)}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {more > 0 ? (
        <span className="text-body-sm text-muted-foreground">
          {t("moreProducts", { count: more })}
        </span>
      ) : null}

      {/* ── 额度：只画需要注意的那几行 ────────────────────────────────
          全量在配额管理。这里的判据是「用过 80%」——没有任何一项到线时整块不画，
          而不是画一堆 5% 的进度条:那些不需要人做任何事。 */}
      {!quotaFailed && quotaRows.length > 0 ? (
        <div className="flex flex-col gap-sm">
          {quotaRows.map((r) => (
            <div key={r.label} className="flex flex-col gap-2xs">
              <div className="flex items-baseline justify-between gap-sm text-body-sm">
                <span className="text-foreground">{r.label}</span>
                <span
                  className={
                    r.percent !== null && r.percent >= ATTENTION_PERCENT
                      ? "font-medium text-warning-text tabular-nums"
                      : "text-muted-foreground tabular-nums"
                  }
                >
                  {r.text}
                </span>
              </div>
              {r.percent !== null ? <Progress value={r.percent} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </PageSection>
  );
}
