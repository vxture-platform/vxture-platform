"use client";

/**
 * UsagePage.tsx — 用量分析(用量配额线新增,owner 2026-08-20)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 统计视角:「过去用了多少、谁用的」。数据 = GET /api/usage/*:
 *   - 趋势 = usage_summary_* 五档降采样(纯统计/看板,永不作计费依据),
 *     周期切换 近30天/近12周/近12月/按年;
 *   - 调用记录 = usage_events 任务级(每次 consume 一行,终端用户归因,
 *     NULL = 未归集容错桶);
 *   - 按成员统计 = 商业场景细分(organization 租户展示)。
 * 本页聚焦 AI Credits(owner:细化统计主要针对 ai.credit);趋势可视化
 * 待 DS 图表原语落地后升级,现以数据表表达(不自造图表基础件)。
 * 严格 DS 组合件拼装;中文基准,zh/en 双份 i18n(usagePage 命名空间)。
 *
 * ## 2026-09-07 页面级走查改了什么
 *
 *   · **指标名不再印原始键**:调用记录的「指标」列直排 `ai.credit`,而配额页
 *     照字典显示「AI Credits」——同一个值两页两副面孔。字典收进 `lib/metric-label`
 *     的顶层 `metric` 命名空间,两页读同一份。
 *   · **翻页只留一种**:调用记录自造了一套「上一页 / 1 of 3 / 下一页」ghost 按钮,
 *     没有每页行数、没有统一计数语;换成 ListPagination,原来的「近 N 天共 M 条 /
 *     只显示最近 N 条」提示留在表尾左侧(与配额页存储表尾同一手法)。四张表全部有分页。
 *   · **长文本列并进主辅**:趋势表的「按产品」是一串明细不是一个值,居中难读、
 *     左对齐又和别的列打架;并进用量列副行,趋势表回到三列。
 *   · **对齐与时间列**:首列左、数字右、其余居中;成员表的「最近使用」改日期主/时间辅。
 *   · **补说明板块**:这页的数是**看板不是账单依据**、桶按 UTC 切、「未归集」是什么——
 *     此前只写在代码注释里,屏幕上一个字没有,而「未归集」徽章天天在用户眼前。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  BarChart,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  Progress,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, MetricGridItem } from "@vxture/design-system";
import {
  fetchUsageEvents,
  fetchUsageMembers,
  fetchUsageTrend,
  type ConsoleUsageEvent,
  type ConsoleUsageEvents,
  type ConsoleUsageMember,
  type ConsoleUsageTrend,
  type ConsoleUsageTrendBucket,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { ListPagination } from "@/components/pagination";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { fmtCount } from "@/lib/format-metrics";
import { useMetricLabel } from "@/lib/metric-label";
import { fmtDate, fmtTime } from "./components/hubModel";

const PAGE_SIZE = 10;

type TrendWindow = "hour" | "day" | "week" | "month" | "year";

/**
 * 桶期间 → 展示文本。桶键全程 UTC(与 rollup 同口径):
 *   - hour:`YYYY-MM-DD HH:00`(UTC)→ 换算成浏览器本地时刻 `HH:00`(逐时看板
 *     跨时区看着才对得上「刚才」);
 *   - day / week 保持 UTC 日期(表头注明 UTC,不做换算——换了日期边界反而对不上
 *     后台的桶),month=YYYYMM → YYYY-MM,year 原样。
 */
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

export function UsagePage() {
  const t = useTranslations("usagePage");
  const tableLabels = useTableLabels();
  // 指标名走共用字典(配额页读同一份;见 lib/metric-label)
  const metricLabel = useMetricLabel();
  const { session } = useConsoleSession();
  const isOrganization =
    session.tenant?.mode === "tenant" &&
    session.tenant.tenantType === "organization";

  const [trendWindow, setTrendWindow] = useState<TrendWindow>("day");
  const [trend, setTrend] = useState<ConsoleUsageTrend | null>(null);
  const [dayTrend, setDayTrend] = useState<ConsoleUsageTrend | null>(null);
  const [yearTrend, setYearTrend] = useState<ConsoleUsageTrend | null>(null);
  const [events, setEvents] = useState<ConsoleUsageEvents | null>(null);
  const [members, setMembers] = useState<ConsoleUsageMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  /* 四张表各自翻页:趋势桶/产品分布/调用记录/成员是四份互不相干的清单。 */
  const [trendPage, setTrendPage] = useState(1);
  const [trendPageSize, setTrendPageSize] = useState<number>(PAGE_SIZE);
  const [sharePage, setSharePage] = useState(1);
  const [sharePageSize, setSharePageSize] = useState<number>(PAGE_SIZE);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState<number>(PAGE_SIZE);
  const [eventsQuery, setEventsQuery] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = useState<number>(PAGE_SIZE);
  /* 读失败显影(批 0b):四个读都是 strict,任一失败置 loadFailed——指标画「—」、
   * 表格画「读取失败」,不再把回落的空 trend 画成「0 credits」。重试走 reloadKey。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 首屏:概览(日/年两档)+ 记录 + 成员一次取齐
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      fetchUsageTrend("day", 30),
      fetchUsageTrend("year", 2),
      fetchUsageEvents(),
      fetchUsageMembers(30),
    ])
      .then(([day, year, evts, mbrs]) => {
        if (!active) return;
        setDayTrend(day);
        setYearTrend(year);
        setEvents(evts);
        setMembers(mbrs);
      })
      .catch(() => {
        if (!active) return;
        setDayTrend(null);
        setYearTrend(null);
        setEvents(null);
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

  // ── ① 用量趋势(倒序 + 环比) ──────────────────────────────────────────────
  type TrendRow = ConsoleUsageTrendBucket & { delta: number | null };
  const trendRows = useMemo<TrendRow[]>(() => {
    const buckets = trend?.buckets ?? [];
    return buckets
      .map((b, i) => {
        const prev = i > 0 ? buckets[i - 1]! : null;
        return {
          ...b,
          delta:
            prev && prev.total > 0
              ? Math.round(((b.total - prev.total) / prev.total) * 100)
              : null,
        };
      })
      .reverse();
  }, [trend]);

  const trendPageCount = Math.max(
    1,
    Math.ceil(trendRows.length / trendPageSize),
  );
  useEffect(() => {
    setTrendPage(1);
  }, [trendWindow]);
  useEffect(() => {
    setTrendPage((p) =>
      Math.min(p, Math.max(1, Math.ceil(trendRows.length / trendPageSize))),
    );
  }, [trendRows.length, trendPageSize]);
  const pagedTrendRows = useMemo(
    () =>
      trendRows.slice(
        (trendPage - 1) * trendPageSize,
        trendPage * trendPageSize,
      ),
    [trendRows, trendPage, trendPageSize],
  );

  const trendColumns: DataTableColumn<TrendRow>[] = [
    {
      id: "period",
      header: t("trend.colPeriod"),
      cell: (r) => (
        <span className="tabular-nums text-foreground">
          {periodLabel(trend?.granularity ?? "day", r.period)}
        </span>
      ),
    },
    {
      id: "total",
      header: t("trend.colTotal"),
      align: "right",
      cell: (r) => (
        // 「按产品」并进副行:它是这一桶总量的拆解,不是并列的第四个值。
        <span className="flex flex-col tabular-nums">
          <span className="font-medium text-foreground">
            {fmtCount(r.total)}
          </span>
          {r.byProduct.length > 0 ? (
            <span className="text-body-sm text-muted-foreground">
              {r.byProduct
                .map((p) => `${p.productName} ${fmtCount(p.total)}`)
                .join(" · ")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "delta",
      header: t("trend.colDelta"),
      align: "center",
      cell: (r) =>
        r.delta === null ? (
          "—"
        ) : (
          <StatusBadge tone={r.delta > 0 ? "warning" : "success"}>
            {r.delta > 0 ? `+${r.delta}%` : `${r.delta}%`}
          </StatusBadge>
        ),
    },
  ];

  // ── ② 按产品分布(当前趋势窗口聚合) ──────────────────────────────────────
  type ProductShare = {
    productCode: string;
    productName: string;
    total: number;
  };
  const productShares = useMemo<ProductShare[]>(() => {
    const byCode = new Map<string, ProductShare>();
    for (const b of trend?.buckets ?? []) {
      for (const p of b.byProduct) {
        const cur = byCode.get(p.productCode);
        if (cur) cur.total += p.total;
        else byCode.set(p.productCode, { ...p });
      }
    }
    return [...byCode.values()].sort((a, b) => b.total - a.total);
  }, [trend]);
  const shareTotal = productShares.reduce((s, p) => s + p.total, 0);

  const shareColumns: DataTableColumn<ProductShare>[] = [
    {
      id: "product",
      header: t("share.colProduct"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="text-foreground">{p.productName}</span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {p.productCode}
          </span>
        </span>
      ),
    },
    {
      id: "total",
      header: t("share.colTotal"),
      align: "right",
      cell: (p) => (
        <span className="tabular-nums font-medium text-foreground">
          {fmtCount(p.total)}
        </span>
      ),
    },
    {
      id: "share",
      header: t("share.colShare"),
      align: "center",
      width: "md",
      cell: (p) => (
        <Progress
          value={shareTotal > 0 ? Math.round((p.total / shareTotal) * 100) : 0}
          aria-label={t("share.colShare")}
        />
      ),
    },
  ];

  const sharePageCount = Math.max(
    1,
    Math.ceil(productShares.length / sharePageSize),
  );
  useEffect(() => {
    setSharePage((p) =>
      Math.min(p, Math.max(1, Math.ceil(productShares.length / sharePageSize))),
    );
  }, [productShares.length, sharePageSize]);
  const pagedShares = productShares.slice(
    (sharePage - 1) * sharePageSize,
    sharePage * sharePageSize,
  );

  // ── ③ 调用记录(任务级) ──────────────────────────────────────────────────
  const eventItems = useMemo(() => events?.items ?? [], [events]);
  const visibleEvents = useMemo(() => {
    const q = eventsQuery.trim().toLowerCase();
    if (!q) return eventItems;
    // 搜索面:产品、指标名、归因用户、请求号——屏幕上能看到的字都能搜。
    return eventItems.filter((e) =>
      [
        e.productName,
        e.productCode,
        metricLabel(e.metric),
        e.userName ?? "",
        e.requestId ?? "",
      ].some((s) => s.toLowerCase().includes(q)),
    );
  }, [eventItems, eventsQuery, metricLabel]);
  const eventsPageCount = Math.max(
    1,
    Math.ceil(visibleEvents.length / eventsPageSize),
  );
  useEffect(() => {
    setEventsPage((p) =>
      Math.min(
        p,
        Math.max(1, Math.ceil(visibleEvents.length / eventsPageSize)),
      ),
    );
  }, [visibleEvents.length, eventsPageSize]);
  const pagedEvents = useMemo(
    () =>
      visibleEvents.slice(
        (eventsPage - 1) * eventsPageSize,
        eventsPage * eventsPageSize,
      ),
    [visibleEvents, eventsPage, eventsPageSize],
  );

  const eventColumns: DataTableColumn<ConsoleUsageEvent>[] = [
    {
      id: "at",
      header: t("events.colAt"),
      cell: (e) => (
        <span className="flex flex-col tabular-nums">
          <span className="text-foreground">{fmtDate(e.at)}</span>
          <span className="text-body-sm text-muted-foreground">
            {fmtTime(e.at)}
          </span>
        </span>
      ),
    },
    {
      id: "product",
      header: t("events.colProduct"),
      align: "center",
      cell: (e) => e.productName,
    },
    {
      id: "metric",
      header: t("events.colMetric"),
      align: "center",
      // 走共用字典:此前这里直排原始键(`ai.credit`),配额页却显示「AI Credits」。
      cell: (e) => metricLabel(e.metric),
    },
    {
      id: "amount",
      header: t("events.colAmount"),
      align: "right",
      cell: (e) => (
        <span className="tabular-nums font-medium text-foreground">
          {fmtCount(e.amount)}
        </span>
      ),
    },
    {
      id: "user",
      header: t("events.colUser"),
      align: "center",
      cell: (e) =>
        e.userName ?? (
          <StatusBadge tone="neutral">{t("events.unattributed")}</StatusBadge>
        ),
    },
    {
      id: "request",
      header: t("events.colRequest"),
      align: "center",
      cell: (e) =>
        e.requestId ? (
          <span className="font-mono text-body-sm text-muted-foreground">
            {e.requestId}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  // ── ④ 按成员统计(商业场景细分) ──────────────────────────────────────────
  const memberColumns: DataTableColumn<ConsoleUsageMember>[] = [
    {
      id: "member",
      header: t("members.colMember"),
      cell: (m) =>
        m.userName ?? (
          <StatusBadge tone="neutral">{t("events.unattributed")}</StatusBadge>
        ),
    },
    {
      id: "total",
      header: t("members.colTotal"),
      align: "right",
      cell: (m) => (
        <span className="tabular-nums font-medium text-foreground">
          {fmtCount(m.total)}
        </span>
      ),
    },
    {
      id: "count",
      header: t("members.colCount"),
      align: "right",
      cell: (m) => (
        <span className="tabular-nums">{fmtCount(m.eventCount)}</span>
      ),
    },
    {
      id: "last",
      header: t("members.colLast"),
      align: "center",
      // 与调用记录的时间列同一种写法:日期为主、时间为辅。
      cell: (m) => (
        <span className="flex flex-col tabular-nums">
          <span className="text-foreground">{fmtDate(m.lastAt)}</span>
          <span className="text-body-sm text-muted-foreground">
            {fmtTime(m.lastAt)}
          </span>
        </span>
      ),
    },
  ];

  const memberPageCount = Math.max(
    1,
    Math.ceil(members.length / memberPageSize),
  );
  useEffect(() => {
    setMemberPage((p) =>
      Math.min(p, Math.max(1, Math.ceil(members.length / memberPageSize))),
    );
  }, [members.length, memberPageSize]);
  const pagedMembers = members.slice(
    (memberPage - 1) * memberPageSize,
    memberPage * memberPageSize,
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line"
        title={t("title")}
        description={t("description")}
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

      {/* ① 用量趋势 */}
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
        {/* 上图下表(2026-08-21 owner 定):全宽柱状图逐桶展开,精确数字在表 */}
        {(trend?.buckets.length ?? 0) > 0 ? (
          <BarChart
            aria-label={t("trend.title")}
            peakLabel={t("chartPeak")}
            data={(trend?.buckets ?? []).map((b) => ({
              key: b.period,
              label: axisLabel(trend?.granularity ?? "day", b.period),
              value: b.total,
            }))}
          />
        ) : null}
        <DataTable<TrendRow>
          labels={tableLabels}
          columns={trendColumns}
          rows={pagedTrendRows}
          rowKey={(r) => r.period}
          loading={trendLoading}
          indexStart={(trendPage - 1) * trendPageSize + 1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("trend.empty")} />
            )
          }
          footer={
            <ListPagination
              page={trendPage}
              pageCount={trendPageCount}
              total={loadFailed ? 0 : trendRows.length}
              pageSize={trendPageSize}
              onPageSizeChange={setTrendPageSize}
              onPageChange={setTrendPage}
            />
          }
        />
      </PageSection>

      {/* ② 按产品分布 */}
      <PageSection
        icon="chart-pie"
        level={2}
        title={t("share.title")}
        description={t("share.description")}
      >
        {productShares.length > 0 ? (
          <BarChart
            aria-label={t("share.title")}
            peakLabel={t("chartPeak")}
            data={productShares.map((p) => ({
              key: p.productCode,
              label: p.productName,
              value: p.total,
            }))}
            labelEvery={1}
          />
        ) : null}
        <DataTable<ProductShare>
          labels={tableLabels}
          columns={shareColumns}
          rows={pagedShares}
          rowKey={(p) => p.productCode}
          loading={trendLoading}
          indexStart={(sharePage - 1) * sharePageSize + 1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("share.empty")} />
            )
          }
          footer={
            <ListPagination
              page={sharePage}
              pageCount={sharePageCount}
              total={loadFailed ? 0 : productShares.length}
              pageSize={sharePageSize}
              onPageSizeChange={setSharePageSize}
              onPageChange={setSharePage}
            />
          }
        />
      </PageSection>

      {/* ③ 调用记录 */}
      <PageSection
        icon="list"
        level={2}
        title={t("events.title")}
        description={t("events.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: visibleEvents.length })}
            aria-label={t("filters.groupLabel")}
            onReset={() => {
              setEventsQuery("");
              setEventsPage(1);
            }}
            search={
              <Input
                value={eventsQuery}
                onChange={(event) => {
                  setEventsQuery(event.target.value);
                  setEventsPage(1);
                }}
                placeholder={t("filters.searchPlaceholder")}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={t("filters.searchAriaLabel")}
              />
            }
          />

          <DataTable<ConsoleUsageEvent>
            labels={tableLabels}
            columns={eventColumns}
            rows={pagedEvents}
            rowKey={(e) => `${e.at}:${e.requestId ?? ""}:${e.productCode}`}
            loading={loading}
            indexStart={(eventsPage - 1) * eventsPageSize + 1}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  title={t("events.empty")}
                  {...(eventsQuery
                    ? {
                        action: (
                          <Button
                            variant="outline"
                            size="md"
                            onClick={() => setEventsQuery("")}
                          >
                            <Icon name="x" size="xs" fallback="placeholder" />
                            <span>{t("filters.reset")}</span>
                          </Button>
                        ),
                      }
                    : {})}
                />
              )
            }
            footer={
              <span className="flex flex-wrap items-center justify-between gap-sm">
                {/* 取数范围留在表尾左侧:它说的是「这张表能看到多远」,不是翻页。 */}
                <span className="tabular-nums text-body-sm text-muted-foreground">
                  {loadFailed || !events
                    ? "—"
                    : events.truncated
                      ? t("events.truncated", {
                          limit: events.limit,
                          days: events.days,
                        })
                      : t("events.total", {
                          count: eventItems.length,
                          days: events.days,
                        })}
                </span>
                <ListPagination
                  page={eventsPage}
                  pageCount={eventsPageCount}
                  total={loadFailed ? 0 : visibleEvents.length}
                  pageSize={eventsPageSize}
                  onPageSizeChange={setEventsPageSize}
                  onPageChange={setEventsPage}
                />
              </span>
            }
          />
        </div>
      </PageSection>

      {/* ④ 按成员统计(organization 细分) */}
      {isOrganization ? (
        <PageSection
          icon="users"
          level={2}
          title={t("members.title")}
          description={t("members.description")}
        >
          {members.length > 0 ? (
            <BarChart
              aria-label={t("members.title")}
              peakLabel={t("chartPeak")}
              data={members.map((m) => ({
                key: m.userName ?? "__unattributed__",
                label: m.userName ?? t("events.unattributed"),
                value: m.total,
              }))}
              labelEvery={1}
            />
          ) : null}
          <DataTable<ConsoleUsageMember>
            labels={tableLabels}
            columns={memberColumns}
            rows={pagedMembers}
            rowKey={(m) => m.userName ?? "__unattributed__"}
            loading={loading}
            indexStart={(memberPage - 1) * memberPageSize + 1}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState title={t("members.empty")} />
              )
            }
            footer={
              <ListPagination
                page={memberPage}
                pageCount={memberPageCount}
                total={loadFailed ? 0 : members.length}
                pageSize={memberPageSize}
                onPageSizeChange={setMemberPageSize}
                onPageChange={setMemberPage}
              />
            }
          />
        </PageSection>
      ) : null}

      {/* ⑤ 口径说明:这三条此前只写在代码注释里,屏幕上一个字没有——而「未归集」
          徽章天天在用户眼前,「看板不是账单」更是会引起争议的那条。 */}
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
            ]}
          />
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
