"use client";

/**
 * UsagePage.tsx — 用量分析(用量配额线,owner 2026-08-20;2026-09-07 重构为图表页)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * ## 这一页回答什么
 *
 * `metering.usage_events` 是一张事实表:四个维度(时间 / 产品 / 人 / 指标)、
 * 一个度量(数量)。owner 2026-09-07 定的三个板块正好是它的三种切法——
 * 按**时间**切 = 总体用量趋势、按**产品**切 = 按产品分布、按**人**切 = 按成员统计,
 * 不重不漏,所以不增不减。
 *
 * 第四个维度「指标」**不做成第四个板块**:它不是并列的切法,是过滤器。本页统一
 * 按 AI Credits 口径统计(与配额页的 Credits 对得上),这一点写在页头与说明里,
 * 不再像此前那样只写在注释中、屏幕上一个字没有;要切别的指标去调用记录页筛。
 *
 * ## 图表化(owner 2026-09-07)
 *
 * 三个板块**以图为主**:BarChart 铺满 + 一行紧凑读数(合计 / 峰值 / 占比)。
 * 逐桶、逐行的精确数字不再在这页堆表——那是**调用记录**(二级页)的事,那边有
 * 完整筛选、服务端分页与筛选后合计。这页负责「看出形状」,那页负责「查得准」。
 *
 * 严格 DS 组合件拼装;中文基准,zh/en 双份 i18n(usagePage 命名空间)。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BarChart,
  Button,
  EmptyState,
  Icon,
  MetricGrid,
  SegmentedControl,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { MetricGridItem } from "@vxture/design-system";
import {
  fetchUsageMembers,
  fetchUsageTrend,
  type ConsoleUsageMember,
  type ConsoleUsageTrend,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { fmtCount } from "@/lib/format-metrics";

type TrendWindow = "hour" | "day" | "week" | "month" | "year";

/**
 * 桶期间 → 展示文本。桶键全程 UTC(与 rollup 同口径):
 *   - hour:`YYYY-MM-DD HH:00`(UTC)→ 换算成浏览器本地时刻 `HH:00`(逐时看板
 *     跨时区看着才对得上「刚才」);
 *   - day / week 保持 UTC 日期(不做换算——换了日期边界反而对不上后台的桶),
 *     month=YYYYMM → YYYY-MM,year 原样。
 */
/* **不走 useDateFormat**:这是**图表轴标**,规范里短形态点名的场景
   (「短形态保留在规范里——窄列、图表轴标这类地方用得上」)。
   小时档只要 `14:00` 这个刻度,套长日期长时间会把一排轴标挤成一团。 */
const periodLabel = (granularity: string, period: string): string => {
  if (granularity === "hour" && period.length >= 16) {
    const d = new Date(`${period.slice(0, 10)}T${period.slice(11, 16)}:00Z`);
    return Number.isNaN(d.getTime())
      ? period.slice(11)
      : `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  if (granularity === "month" && period.length === 6)
    return `${period.slice(0, 4)}-${period.slice(4)}`;
  return period;
};

/** day 档横轴标签去年份(MM-DD),柱多时更可读。 */
const axisLabel = (granularity: string, period: string): string =>
  granularity === "day" && period.length === 10
    ? period.slice(5)
    : periodLabel(granularity, period);

/**
 * 图下面那一行紧凑读数。图看形状,这行给「一眼要知道的三个数」;
 * 逐桶精确值在图的读数条上(键盘左右键也能扫),逐条明细去调用记录页。
 */
function ChartStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-lg gap-y-xs text-body-sm">
      {items.map((s) => (
        <span key={s.label} className="flex items-baseline gap-xs">
          <span className="text-muted-foreground">{s.label}</span>
          <span className="tabular-nums font-medium text-foreground">
            {s.value}
          </span>
        </span>
      ))}
    </p>
  );
}

/**
 * 分布图下面的构成读数:名称 · 数量 · 占比。
 * 不做成表——三五行的表格是把一句话撑成一个板块;这里要的就是一句话。
 */
function ShareLegend({
  items,
}: {
  items: { key: string; name: string; value: number; percent: number }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-lg gap-y-sm text-body-sm">
      {items.map((it) => (
        <li key={it.key} className="flex items-baseline gap-xs">
          <span className="text-foreground">{it.name}</span>
          <span className="tabular-nums font-medium text-foreground">
            {fmtCount(it.value)}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {it.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function UsagePage() {
  const t = useTranslations("usagePage");
  const router = useRouter();
  const { session } = useConsoleSession();
  const isOrganization =
    session.tenant?.mode === "tenant" &&
    session.tenant.tenantType === "organization";

  const [trendWindow, setTrendWindow] = useState<TrendWindow>("day");
  const [trend, setTrend] = useState<ConsoleUsageTrend | null>(null);
  const [dayTrend, setDayTrend] = useState<ConsoleUsageTrend | null>(null);
  const [yearTrend, setYearTrend] = useState<ConsoleUsageTrend | null>(null);
  const [members, setMembers] = useState<ConsoleUsageMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  /* 读失败显影(批 0b):三个读都是 strict,任一失败置 loadFailed——指标画「—」、
   * 板块画「读取失败」,不再把回落的空 trend 画成「0 credits」。重试走 reloadKey。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 首屏:概览(日/年两档)+ 成员一次取齐(调用记录已拆去二级页,这里不再取)
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      fetchUsageTrend("day", 30),
      fetchUsageTrend("year", 2),
      fetchUsageMembers(30),
    ])
      .then(([day, year, mbrs]) => {
        if (!active) return;
        setDayTrend(day);
        setYearTrend(year);
        setMembers(mbrs);
      })
      .catch(() => {
        if (!active) return;
        setDayTrend(null);
        setYearTrend(null);
        setMembers([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  /* 趋势区:随窗口切换独立刷新;day 档**只**复用首屏数据——此前 dayTrend 还没
   * 回来时这里也发一次 day 请求,首屏同一份数据取两遍(批 3)。 */
  useEffect(() => {
    if (trendWindow === "day") {
      setTrend(dayTrend);
      setTrendLoading(loading);
      return;
    }
    let active = true;
    setTrendLoading(true);
    fetchUsageTrend(trendWindow)
      .then((next) => {
        if (active) setTrend(next);
      })
      .catch(() => {
        if (!active) return;
        setTrend(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setTrendLoading(false);
      });
    return () => {
      active = false;
    };
  }, [trendWindow, dayTrend, loading, session.tenant?.id, reloadKey]);

  // ── 概览指标(本页业务 3 个指标 → columns=3 铺满,列数随业务不写死)────────
  const metrics = useMemo<MetricGridItem[]>(() => {
    const buckets = dayTrend?.buckets ?? [];
    const sumLast = (n: number): number =>
      buckets.slice(-n).reduce((s, b) => s + b.total, 0);
    const thisYear = String(new Date().getUTCFullYear());
    const yearTotal =
      yearTrend?.buckets.find((b) => b.period === thisYear)?.total ?? 0;
    // 没读到就是「—」:读失败时的 0 不是用量为零,是没有数据。
    const dayValue = (n: number) => (dayTrend ? fmtCount(sumLast(n)) : "—");
    return [
      {
        id: "last7",
        icon: "gauge",
        label: t("metrics.last7"),
        value: dayValue(7),
        trend: t("metrics.creditsUnit"),
      },
      {
        id: "last30",
        icon: "chart-line",
        label: t("metrics.last30"),
        value: dayValue(30),
        trend: t("metrics.creditsUnit"),
      },
      {
        id: "year",
        icon: "calendar",
        label: t("metrics.thisYear"),
        value: yearTrend ? fmtCount(yearTotal) : "—",
        trend: t("metrics.creditsUnit"),
      },
    ];
  }, [dayTrend, yearTrend, t]);

  // ── ① 总体用量趋势 ───────────────────────────────────────────────────────
  const trendBuckets = useMemo(() => trend?.buckets ?? [], [trend]);
  const trendStats = useMemo(() => {
    if (trendBuckets.length === 0) return [];
    const total = trendBuckets.reduce((s, b) => s + b.total, 0);
    const peak = trendBuckets.reduce((a, b) => (b.total > a.total ? b : a));
    const last = trendBuckets[trendBuckets.length - 1];
    const prev = trendBuckets[trendBuckets.length - 2];
    const granularity = trend?.granularity ?? "day";
    const stats = [
      { label: t("trend.statTotal"), value: fmtCount(total) },
      {
        label: t("trend.statPeak"),
        value: `${fmtCount(peak.total)} · ${periodLabel(granularity, peak.period)}`,
      },
    ];
    // 环比只在前一桶有量时成立:分母为 0 算不出百分比,写「—」比写「+∞」诚实。
    if (last && prev && prev.total > 0) {
      const delta = Math.round(((last.total - prev.total) / prev.total) * 100);
      stats.push({
        label: t("trend.statDelta"),
        value: delta > 0 ? `+${delta}%` : `${delta}%`,
      });
    }
    return stats;
  }, [trendBuckets, trend, t]);

  // ── ② 按产品分布(当前趋势窗口聚合) ──────────────────────────────────────
  const productShares = useMemo(() => {
    const byCode = new Map<string, { name: string; total: number }>();
    for (const b of trendBuckets) {
      for (const p of b.byProduct) {
        const cur = byCode.get(p.productCode);
        if (cur) cur.total += p.total;
        else byCode.set(p.productCode, { name: p.productName, total: p.total });
      }
    }
    const rows = [...byCode]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.total - a.total);
    const sum = rows.reduce((s, r) => s + r.total, 0);
    return rows.map((r) => ({
      key: r.code,
      name: r.name,
      value: r.total,
      percent: sum > 0 ? Math.round((r.total / sum) * 100) : 0,
    }));
  }, [trendBuckets]);

  // ── ③ 按成员统计(organization 细分) ─────────────────────────────────────
  const memberShares = useMemo(() => {
    const sum = members.reduce((s, m) => s + m.total, 0);
    return members.map((m) => ({
      key: m.userNo ?? "__unattributed__",
      name: m.userName ?? t("unattributed"),
      value: m.total,
      percent: sum > 0 ? Math.round((m.total / sum) * 100) : 0,
    }));
  }, [members, t]);

  /** 图 + 读数的共用骨架:没数据就画空态,不画一张全零的图。 */
  const chartBlock = (
    ready: boolean,
    chart: React.ReactNode,
    stats: React.ReactNode,
    emptyTitle: string,
  ) =>
    loadFailed ? (
      <LoadFailedEmpty />
    ) : ready ? (
      <div className="flex flex-col gap-md">
        {chart}
        {stats}
      </div>
    ) : (
      <EmptyState title={emptyTitle} />
    );

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line"
        title={t("title")}
        description={t("description")}
        action={
          /* 调用记录是**去处**不是本页的动作:这页看形状,那页查明细。 */
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/usage/records")}
          >
            <Icon name="search" size="xs" fallback="placeholder" />
            <span>{t("viewRecords")}</span>
          </Button>
        }
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading || trendLoading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 总体用量趋势 */}
      <PageSection
        icon="chart-line"
        level={2}
        title={t("trend.title")}
        description={
          trendWindow === "hour"
            ? t("trend.descriptionHour")
            : t("trend.description")
        }
        action={
          <SegmentedControl<TrendWindow>
            ariaLabel={t("trend.windowLabel")}
            value={trendWindow}
            onChange={setTrendWindow}
            items={[
              { value: "hour", label: t("trend.windowHour") },
              { value: "day", label: t("trend.windowDay") },
              { value: "week", label: t("trend.windowWeek") },
              { value: "month", label: t("trend.windowMonth") },
              { value: "year", label: t("trend.windowYear") },
            ]}
          />
        }
      >
        {chartBlock(
          !trendLoading && trendBuckets.length > 0,
          <BarChart
            aria-label={t("trend.title")}
            peakLabel={t("chartPeak")}
            formatValue={fmtCount}
            data={trendBuckets.map((b) => ({
              key: b.period,
              label: axisLabel(trend?.granularity ?? "day", b.period),
              value: b.total,
            }))}
          />,
          <ChartStats items={trendStats} />,
          t("trend.empty"),
        )}
      </PageSection>

      {/* ② 按产品分布 */}
      <PageSection
        icon="chart-pie"
        level={2}
        title={t("share.title")}
        description={t("share.description")}
      >
        {chartBlock(
          !trendLoading && productShares.length > 0,
          <BarChart
            aria-label={t("share.title")}
            peakLabel={t("chartPeak")}
            formatValue={fmtCount}
            labelEvery={1}
            data={productShares.map((p) => ({
              key: p.key,
              label: p.name,
              value: p.value,
            }))}
          />,
          <ShareLegend items={productShares} />,
          t("share.empty"),
        )}
      </PageSection>

      {/* ③ 按成员统计(organization 细分:个人租户只有自己,这块没有意义) */}
      {isOrganization ? (
        <PageSection
          icon="users"
          level={2}
          title={t("members.title")}
          description={t("members.description")}
        >
          {chartBlock(
            !loading && memberShares.length > 0,
            <BarChart
              aria-label={t("members.title")}
              peakLabel={t("chartPeak")}
              formatValue={fmtCount}
              labelEvery={1}
              data={memberShares.map((m) => ({
                key: m.key,
                label: m.name,
                value: m.value,
              }))}
            />,
            <ShareLegend items={memberShares} />,
            t("members.empty"),
          )}
        </PageSection>
      ) : null}

      {/* ④ 口径说明:这几条此前只写在代码注释里,屏幕上一个字没有——而「未归集」
          天天在用户眼前,「看板不是账单」更是会引起争议的那条。 */}
      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
          <SignalList
            items={[
              {
                title: t("notes.scopeTitle"),
                description: t("notes.scopeBody"),
              },
              {
                title: t("notes.bucketTitle"),
                description: t("notes.bucketBody"),
              },
              {
                title: t("notes.attributionTitle"),
                description: t("notes.attributionBody"),
              },
              {
                title: t("notes.recordsTitle"),
                description: t("notes.recordsBody"),
              },
            ]}
          />
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
