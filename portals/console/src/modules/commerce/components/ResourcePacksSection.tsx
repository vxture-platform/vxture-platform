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
 *     ws_base          默认自带 —— 生命周期随工作空间，显示「长期有效」
 *     addon_purchase   用户加购 —— 有到期时间，画周期进度、临期提醒
 *     manual_override  平台发放 —— 长期有效 / 周期有效两种都支持
 *
 * 第四个 `subscription` **不进这里**：它的来由是上面那块的订阅，在这儿再列一遍
 * 等于同一件事说两处。
 *
 * ── 这一页不出现钱（owner 2026-09-09）──
 * 订阅管理**只显示权益结果，不显示费用**。上一版我在自带那张卡上写了「¥0 / 月」，
 * 是错的：它把「多少钱」带进了一个回答「我有什么」的页面，而且 ¥0 这个数字本身
 * 只会让人问「那为什么要标价」。花了多少钱在费用中心。
 *
 * ── 与 /quotas 的分工（owner 裁定）──
 * **这里答「你有什么」**：额度、来源、有效期。
 * **配额页答「用了多少、还剩多少」**。所以本区**不画用量条**——那会把配额页的活
 * 抢过来，还会让两处的数字需要对账。这里的进度条画的是**时间**（周期走了多少），
 * 不是用量。
 *
 * ── 卡片分区（与智能体卡同构，owner 2026-09-09）──
 *     标题区   指标名
 *     状态区   来源标签，右上角
 *     权益区   额度 + 有效期（+ 周期进度）
 *   资源包没有操作区：它不能被退订或改续费，那些动作在费用中心。
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  EmptyState,
  Icon,
  Progress,
  StatusBadge,
  cn,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";
import { formatDay } from "@vxture-platform/shared";
import type { Locale } from "@vxture-platform/shared";
import type { ConsoleQuotaPool } from "@/api/console-bff";
import { fmtCount, formatBytes } from "@/lib/format-metrics";
import { useMetricLabel } from "@/lib/metric-label";

/** 本区收的三类来源。顺序即展示顺序：先自带、再买的、最后发放的。 */
const PACK_SOURCES = ["ws_base", "addon_purchase", "manual_override"] as const;
type PackSource = (typeof PACK_SOURCES)[number];

function isPackSource(s: string): s is PackSource {
  return (PACK_SOURCES as readonly string[]).includes(s);
}

/**
 * 三类来源的外观：卡顶一条色条 + 同色系的来源标签。
 *
 * owner 2026-09-09：三类要在**整卡层面**分得开，光靠右上角一个小标签不够——
 * 一屏十几张卡时，眼睛先看到的是块面不是文字。色条放顶部而不是左侧，是因为
 * 卡片是栅格排列的，顶边在每张卡上都对齐，左边缘会被相邻卡片打断。
 *
 * 颜色全部走 DS 语义令牌（`--color-primary-border` 等），不写死色值：
 * 令牌自带深色主题的那一套，写死的话暗色下会瞎。
 *
 * `neutral` 给自带的：它是默认状态，不需要吸引注意。
 * `brand` 给买来的：花过钱的那一笔，是这一页里租户最关心的。
 * `info` 给平台发放的：外部给的、不由租户控制，用信息色而不是成功色——
 * 那不是一件「达成了什么」的事。
 */
const SOURCE_LOOK = {
  ws_base: { tone: "neutral", bar: "border-t-border" },
  addon_purchase: { tone: "brand", bar: "border-t-primary" },
  manual_override: { tone: "info", bar: "border-t-info" },
} as const satisfies Record<PackSource, { tone: string; bar: string }>;

/** 额度按指标选格式：存储是字节，其余按个数。 */
function formatAmount(metric: string, value: number): string {
  return metric === "storage.bytes" ? formatBytes(value) : fmtCount(value);
}

/**
 * 周期走完了百分之多少。
 *
 * 两端都要有才画得出来：只有终点画不出进度，一条没有起点的线只能显示剩余天数。
 * 与智能体卡的 `cyclePercent` 同口径——两张卡上的同一根线不该按两套算法走。
 */
function elapsedPercent(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}

/** 距到期还有几天；已过期或无终点返回 null。 */
function daysLeft(to: string | null): number | null {
  if (!to) return null;
  const end = new Date(to).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - Date.now();
  return ms <= 0 ? null : Math.ceil(ms / 86_400_000);
}

/** 到期前多少天开始提醒续费。与智能体卡同阈值。 */
const RENEW_THRESHOLD_DAYS = 30;

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
  /* 指标名走共用字典：`metric_key` 在库里**没有受管枚举**（是 platform_metrics
     里的动态行），在这里按键取文案遇到新指标会直接抛。
     那份字典正是为这件事收的，未知键回退原文。 */
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
            <PackCard
              key={`${p.source}-${p.metric}-${i}`}
              pool={p}
              label={metricLabel(p.metric)}
              locale={locale as Locale}
            />
          ))}
        </div>
      )}
    </PageSection>
  );
}

function PackCard({
  pool,
  label,
  locale,
}: {
  pool: ConsoleQuotaPool;
  label: string;
  locale: Locale;
}) {
  const t = useTranslations("subscriptionHub.packs");
  const look = SOURCE_LOOK[pool.source as PackSource];

  /* 「长期有效」= 没有终点。自带的那一类天生如此：它的生命周期随工作空间走
     （再往深是租户的生命周期），工作空间还在这份额度就还在——所以不写一个假的
     到期日，写「长期有效」。平台发放的也可能是这一形态。 */
  const perpetual = pool.expiresAt === null;
  const left = daysLeft(pool.expiresAt);
  const expired = !perpetual && left === null;
  const percent = elapsedPercent(pool.effectiveAt, pool.expiresAt);
  const nearExpiry = left !== null && left <= RENEW_THRESHOLD_DAYS;

  return (
    <Card surface="base" className={cn("gap-md border-t-4 py-lg", look.bar)}>
      <CardContent className="flex flex-1 flex-col gap-md">
        {/* ── 标题区 + 状态区 ──────────────────────────────────────────
            与智能体卡同构：名字在左，来源标签在右上角。 */}
        {/* 单行标题 + 徽章同一行盒,用 items-center——与智能体卡同一条对齐规则。 */}
        <div className="flex items-center gap-md">
          <span className="min-w-0 flex-1 truncate text-label-md text-foreground">
            {label}
          </span>
          <StatusBadge tone={look.tone}>
            {t(`source.${pool.source}`)}
          </StatusBadge>
        </div>

        {/* ── 权益区：给了多少 ──────────────────────────────────────────
            这是「权益结果」——订阅管理这一页要答的就是它。不出现价格。 */}
        <div className="text-title-md tabular-nums text-foreground">
          {formatAmount(pool.metric, pool.limit)}
        </div>

        {/* ── 权益区：管到什么时候 ──────────────────────────────────────
            三种形态：长期有效 / 周期内（画进度）/ 已到期。
            进度条画的是**时间**不是用量——用量在配额管理。填充走 DS 的
            `bg-primary`（品牌色，当前就是蓝），不需要为「蓝色进度线」再造一个档；
            也不在这里记具体色值——DS 改了色，抄在注释里的那个数就成了错的记载。 */}
        <div className="flex flex-col gap-2xs">
          <div className="flex items-baseline justify-between gap-sm text-body-sm">
            <span className="text-muted-foreground tabular-nums">
              {perpetual
                ? t("perpetual")
                : `${formatDay(pool.effectiveAt, locale, "—")} ~ ${formatDay(
                    pool.expiresAt,
                    locale,
                    "—",
                  )}`}
            </span>
            {expired ? (
              <span className="font-medium text-warning-text">
                {t("expired")}
              </span>
            ) : left !== null ? (
              <span
                className={cn(
                  "tabular-nums",
                  nearExpiry
                    ? "font-medium text-warning-text"
                    : "text-muted-foreground",
                )}
              >
                {t("daysLeft", { days: left })}
              </span>
            ) : null}
          </div>
          {percent !== null && !expired ? <Progress value={percent} /> : null}

          {/* 周期性重置的池：额度每周期回满，与「到期作废」是两件事，要说清楚。 */}
          {pool.resetPeriod !== "none" ? (
            <span className="text-body-sm text-muted-foreground">
              {t("resets", { period: t(`period.${pool.resetPeriod}`) })}
            </span>
          ) : null}

          {/* 平台发放的来由。不显示的话，租户只会看到总额度比自己买的多，
              却不知道为什么（owner 2026-09-09 裁定要显示）。 */}
          {pool.source === "manual_override" && pool.grantReason ? (
            <span className="flex items-start gap-2xs text-body-sm text-muted-foreground">
              <Icon name="info" size="xs" fallback="placeholder" />
              <span>{pool.grantReason}</span>
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
