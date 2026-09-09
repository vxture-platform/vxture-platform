"use client";

/**
 * ResourcePacksSection.tsx — 「我的资源包」(订阅管理页组合件)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-09：订阅管理原先只有「我的订阅」一块，拆成两块——
 * 上面是**我的智能体**（订阅来的产品），这里是**我的资源包**（额度从哪来）。
 *
 * ── 分组规则落在库上，不另立清单 ──
 * `metering.quota_pools.pool_source` 是受管枚举（DDL 的
 * `chk_quota_pools_pool_source`），四个值里三个属于本区：
 *
 *     ws_base          工作空间基础额度 —— **¥0，但有周期**，随周期重置
 *     addon_purchase   加油包与扩展包 —— 买来的，有有效期
 *     manual_override  运营授予 —— 标明来由（库里的 grant_reason）
 *
 * 第四个 `subscription` **不进这里**：它的来由是上面那块的订阅，在这儿再列一遍
 * 等于同一件事说两处。
 *
 * 标签只有两字（owner 2026-09-09）：它挨着指标名放在卡头，长了会把指标名挤走，
 * 而卡片主体已经把额度、周期、到期、来由都写清楚了——标签只需要答一个
 * 「哪来的」。刻意不用「平台」两字：本系统里 `platform_metrics` / 平台指标是
 * 另一条真实的轴，标签写「平台」会被读成「这是个平台级指标」。
 *
 * 「¥0 但有周期」不是这里新造的说法：库里 `ws_base` 的池本来就带
 * `reset_period` / `period_anchor`，与「¥0 档也是按周期订阅、会到期」同一口径。
 *
 * ── 与 /quotas 的分工（owner 裁定）──
 * **这里答「你有什么」**：来源、额度、周期、到期。
 * **配额页答「用了多少、还剩多少」**。两页回答不同问题，不重叠。
 * 所以本区**不画用量条**——那会把配额页的活抢过来，还会让两处的数字需要对账。
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  EmptyState,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";
import { formatDay } from "@vxture-platform/shared";
import type { Locale } from "@vxture-platform/shared";
import type { ConsoleQuotaPool } from "@/api/console-bff";
import { fmtCount, formatBytes } from "@/lib/format-metrics";
import { useMetricLabel } from "@/lib/metric-label";

/** 本区收的三类来源。顺序即展示顺序：先基础、再买的、最后授予的。 */
const PACK_SOURCES = ["ws_base", "addon_purchase", "manual_override"] as const;
type PackSource = (typeof PACK_SOURCES)[number];

function isPackSource(s: string): s is PackSource {
  return (PACK_SOURCES as readonly string[]).includes(s);
}

/**
 * 三类来源的色调。标签的作用是让人**一眼分出这笔额度是哪来的**，所以三类要能
 * 互相区分，而不是「自带 = 灰、其余都是蓝」。
 *
 * `neutral` 给自带的：它是默认状态，不需要吸引注意。
 * `brand` 给买来的：花过钱的那一笔，是这一页里租户最关心的。
 * `info` 给平台发放的：它是外部给的、不由租户控制，用信息色而不是成功色——
 * 那不是一件「达成了什么」的事。
 */
const SOURCE_TONE = {
  ws_base: "neutral",
  addon_purchase: "brand",
  manual_override: "info",
} as const satisfies Record<PackSource, string>;

/** 额度按指标选格式：存储是字节，其余按个数。 */
function formatAmount(metric: string, value: number): string {
  return metric === "storage.bytes" ? formatBytes(value) : fmtCount(value);
}

export function ResourcePacksSection({
  pools,
  loading,
  loadFailed,
}: {
  pools: ConsoleQuotaPool[];
  loading: boolean;
  loadFailed: boolean;
}) {
  const t = useTranslations("subscriptionHub.packs");
  const locale = useLocale();
  /* 指标名走共用字典:`metric_key` 在库里**没有受管枚举**(是 platform_metrics 里的
     动态行),在这里写 `t(\`metric.${'${'}p.metric}\`)` 遇到新指标会直接抛。
     那份字典正是为这件事收的,未知键回退原文。 */
  const metricLabel = useMetricLabel();

  /* 只收本区的三类，并按 PACK_SOURCES 的顺序排——`subscription` 那一类被过滤掉，
     它属于上面的「我的智能体」。 */
  const rows = useMemo(
    () =>
      pools
        .filter((p) => isPackSource(p.source))
        .sort(
          (a, b) =>
            PACK_SOURCES.indexOf(a.source as PackSource) -
            PACK_SOURCES.indexOf(b.source as PackSource),
        ),
    [pools],
  );

  return (
    <PageSection
      icon="stack"
      level={2}
      title={t("title")}
      description={t("description")}
    >
      {loading ? (
        <EmptyState icon="clock" title={t("loading")} />
      ) : loadFailed ? (
        <LoadFailedEmpty />
      ) : rows.length === 0 ? (
        /* 空态是可能的、也是正常的：新工作空间在底池落库前就是这样。
           不要写成「出错了」——它和读取失败是两件事。 */
        <EmptyState
          icon="stack"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p, i) => (
            <Card key={`${p.source}-${p.metric}-${i}`} surface="base">
              <CardContent className="flex flex-col gap-sm">
                <div className="flex items-start justify-between gap-sm">
                  <span className="font-medium">{metricLabel(p.metric)}</span>
                  <StatusBadge tone={SOURCE_TONE[p.source as PackSource]}>
                    {t(`source.${p.source}`)}
                  </StatusBadge>
                </div>

                <div className="text-2xl font-semibold tabular-nums">
                  {formatAmount(p.metric, p.limit)}
                </div>

                <div className="flex flex-col gap-2xs text-sm text-muted">
                  {/* 价格：基础额度是 ¥0——**但它有周期**，所以写「¥0 / 周期」
                      而不是「免费」。买来的那些价格在订单里，这里不重复展示金额，
                      只说它是买来的（避免与订单页的实付金额出现两个数）。 */}
                  {/* 自带的那一类要说清「¥0，但有周期」——这一行同时给了价格与周期，
                      所以下面的重置行对它是重复的，不再画第二遍。 */}
                  {p.source === "ws_base" ? (
                    <span>
                      {t("basePriceAndReset", {
                        period: t(`period.${p.resetPeriod}`),
                      })}
                    </span>
                  ) : (
                    <span>
                      {p.resetPeriod === "none"
                        ? t("noReset")
                        : t("resets", { period: t(`period.${p.resetPeriod}`) })}
                    </span>
                  )}

                  {p.expiresAt ? (
                    <span>
                      {t("expires", {
                        date: formatDay(p.expiresAt, locale as Locale),
                      })}
                    </span>
                  ) : null}

                  {/* 运营授予的来由。不显示的话，租户只会看到总额度比自己买的多，
                      却不知道为什么（owner 2026-09-09 裁定要显示）。 */}
                  {p.source === "manual_override" && p.grantReason ? (
                    <span className="flex items-start gap-2xs">
                      <Icon name="info" size="xs" fallback="placeholder" />
                      <span>{p.grantReason}</span>
                    </span>
                  ) : null}
                </div>

                {p.productName ? (
                  <StatusBadge tone="neutral">{p.productName}</StatusBadge>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageSection>
  );
}
