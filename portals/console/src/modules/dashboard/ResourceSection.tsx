"use client";

/**
 * ResourceSection.tsx — 概览页第三块：你有什么。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-09：概览第三块是**我有的资源、我的产品**，「更多」去智能体域主页。
 *
 * ── 这是多产品平台的那一块 ──
 * owner 的原话：「必须清楚我们是多产品服务平台，不是一款产品」。这一块回答的就是
 * 「我手里有几个产品、哪个能用」——旧版概览完全没有它，第一块是「快捷操作」三个
 * 按钮，把一个多产品工作台讲成了单一后台的入口页。
 *
 * 磁贴走 `fetchMyApps`（应用中心那一套）：它已按 `product_code` 折叠去重、且**含
 * bundled**（套餐捆绑进来的产品同样是这个工作空间持有的）。不另写一套取数——
 * 同一批磁贴两处各算一遍，就一定会有一处先漂。
 *
 * ── 「更多」去哪 ──
 * 智能体域主页（应用中心视图）。这一页只给一眼能看完的量，全量在那边。
 *
 * ── 额度只给一行 ──
 * 「还剩多少」在配额管理，那一页才是台账。这里只答「有没有快用完的」——
 * 一个需要注意的信号，不是一张表。
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

/** 概览上最多列几个磁贴。更多的去应用中心。 */
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
          {/* 智能体域主页 = 应用中心视图。它是产品的全量清单，这里只给一眼的量。 */}
          <Link href="/?view=appcenter">{t("viewAll")}</Link>
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
