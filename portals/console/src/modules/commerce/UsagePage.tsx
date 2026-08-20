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
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  DataTable,
  EmptyState,
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
  type ConsoleUsageMember,
  type ConsoleUsageTrend,
  type ConsoleUsageTrendBucket,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection } from "@/layout/shell";
import { fmtDate, fmtTime } from "./components/hubModel";

const fmtCount = (v: number): string => v.toLocaleString("en-US");

const EVENTS_PAGE_SIZE = 10;

type TrendWindow = "day" | "week" | "month" | "year";

/** 桶期间 → 展示文本(month=YYYYMM → YYYY-MM,其余原样)。 */
const periodLabel = (granularity: string, period: string): string =>
  granularity === "month" && period.length === 6
    ? `${period.slice(0, 4)}-${period.slice(4)}`
    : period;

export function UsagePage() {
  const t = useTranslations("usagePage");
  const { session } = useConsoleSession();
  const isOrganization =
    session.tenant?.mode === "tenant" &&
    session.tenant.tenantType === "organization";

  const [trendWindow, setTrendWindow] = useState<TrendWindow>("day");
  const [trend, setTrend] = useState<ConsoleUsageTrend | null>(null);
  const [dayTrend, setDayTrend] = useState<ConsoleUsageTrend | null>(null);
  const [yearTrend, setYearTrend] = useState<ConsoleUsageTrend | null>(null);
  const [events, setEvents] = useState<ConsoleUsageEvent[]>([]);
  const [members, setMembers] = useState<ConsoleUsageMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [eventsPage, setEventsPage] = useState(1);

  // 首屏:概览(日/年两档)+ 记录 + 成员一次取齐
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUsageTrend("day", 30),
      fetchUsageTrend("year", 2),
      fetchUsageEvents(),
      fetchUsageMembers(30),
    ])
      .then(([day, year, evts, mbrs]) => {
        setDayTrend(day);
        setYearTrend(year);
        setEvents(evts);
        setMembers(mbrs);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id]);

  // 趋势区:随窗口切换独立刷新(day 档直接复用首屏数据)
  useEffect(() => {
    if (trendWindow === "day" && dayTrend) {
      setTrend(dayTrend);
      setTrendLoading(false);
      return;
    }
    setTrendLoading(true);
    fetchUsageTrend(trendWindow)
      .then(setTrend)
      .finally(() => setTrendLoading(false));
  }, [trendWindow, dayTrend, session.tenant?.id]);

  // ── 概览指标(本页业务 3 个指标 → columns=3 铺满,列数随业务不写死)────────
  const metrics = useMemo<MetricGridItem[]>(() => {
    const buckets = dayTrend?.buckets ?? [];
    const sumLast = (n: number): number =>
      buckets.slice(-n).reduce((s, b) => s + b.total, 0);
    const thisYear = String(new Date().getUTCFullYear());
    const yearTotal =
      yearTrend?.buckets.find((b) => b.period === thisYear)?.total ?? 0;
    return [
      {
        id: "last7",
        icon: "gauge",
        label: t("metrics.last7"),
        value: fmtCount(sumLast(7)),
        trend: t("metrics.creditsUnit"),
      },
      {
        id: "last30",
        icon: "chart-line",
        label: t("metrics.last30"),
        value: fmtCount(sumLast(30)),
        trend: t("metrics.creditsUnit"),
      },
      {
        id: "year",
        icon: "calendar",
        label: t("metrics.thisYear"),
        value: fmtCount(yearTotal),
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
        <span className="tabular-nums font-medium text-foreground">
          {fmtCount(r.total)}
        </span>
      ),
    },
    {
      id: "byProduct",
      header: t("trend.colByProduct"),
      cell: (r) => (
        <span className="text-body-sm text-muted-foreground">
          {r.byProduct
            .map((p) => `${p.productName} ${fmtCount(p.total)}`)
            .join(" · ")}
        </span>
      ),
    },
    {
      id: "delta",
      header: t("trend.colDelta"),
      align: "right",
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
      width: "md",
      cell: (p) => (
        <Progress
          value={shareTotal > 0 ? Math.round((p.total / shareTotal) * 100) : 0}
          aria-label={t("share.colShare")}
        />
      ),
    },
  ];

  // ── ③ 调用记录(任务级) ──────────────────────────────────────────────────
  const eventsPageCount = Math.max(
    1,
    Math.ceil(events.length / EVENTS_PAGE_SIZE),
  );
  const pagedEvents = useMemo(
    () =>
      events.slice(
        (eventsPage - 1) * EVENTS_PAGE_SIZE,
        eventsPage * EVENTS_PAGE_SIZE,
      ),
    [events, eventsPage],
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
      cell: (e) => e.productName,
    },
    {
      id: "metric",
      header: t("events.colMetric"),
      cell: (e) => e.metric,
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
      cell: (e) =>
        e.userName ?? (
          <StatusBadge tone="neutral">{t("events.unattributed")}</StatusBadge>
        ),
    },
    {
      id: "request",
      header: t("events.colRequest"),
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
      align: "right",
      cell: (m) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {fmtDate(m.lastAt)} {fmtTime(m.lastAt)}
        </span>
      ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line"
        title={t("title")}
        description={t("description")}
      />

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
        description={t("trend.description")}
        action={
          <SegmentedControl<TrendWindow>
            ariaLabel={t("trend.windowLabel")}
            value={trendWindow}
            onChange={setTrendWindow}
            items={[
              { value: "day", label: t("trend.windowDay") },
              { value: "week", label: t("trend.windowWeek") },
              { value: "month", label: t("trend.windowMonth") },
              { value: "year", label: t("trend.windowYear") },
            ]}
          />
        }
      >
        <DataTable<TrendRow>
          columns={trendColumns}
          rows={trendRows}
          rowKey={(r) => r.period}
          loading={trendLoading}
          empty={<EmptyState title={t("trend.empty")} />}
        />
      </PageSection>

      {/* ② 按产品分布 */}
      <PageSection
        icon="chart-pie"
        level={2}
        title={t("share.title")}
        description={t("share.description")}
      >
        <DataTable<ProductShare>
          columns={shareColumns}
          rows={productShares}
          rowKey={(p) => p.productCode}
          loading={trendLoading}
          empty={<EmptyState title={t("share.empty")} />}
        />
      </PageSection>

      {/* ③ 调用记录 */}
      <PageSection
        icon="list"
        level={2}
        title={t("events.title")}
        description={t("events.description")}
      >
        <DataTable<ConsoleUsageEvent>
          columns={eventColumns}
          rows={pagedEvents}
          rowKey={(e) => `${e.at}:${e.requestId ?? ""}:${e.productCode}`}
          loading={loading}
          indexStart={(eventsPage - 1) * EVENTS_PAGE_SIZE + 1}
          empty={<EmptyState title={t("events.empty")} />}
          footer={
            <div className="flex w-full items-center justify-between gap-md text-body-sm text-muted-foreground">
              <span className="tabular-nums">
                {t("events.total", { count: events.length })}
              </span>
              {eventsPageCount > 1 ? (
                <span className="flex items-center gap-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={eventsPage <= 1}
                    onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                  >
                    {t("events.prevPage")}
                  </Button>
                  <span className="tabular-nums">
                    {eventsPage} / {eventsPageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={eventsPage >= eventsPageCount}
                    onClick={() =>
                      setEventsPage((p) => Math.min(eventsPageCount, p + 1))
                    }
                  >
                    {t("events.nextPage")}
                  </Button>
                </span>
              ) : null}
            </div>
          }
        />
      </PageSection>

      {/* ④ 按成员统计(organization 细分) */}
      {isOrganization ? (
        <PageSection
          icon="users"
          level={2}
          title={t("members.title")}
          description={t("members.description")}
        >
          <DataTable<ConsoleUsageMember>
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.userName ?? "__unattributed__"}
            loading={loading}
            empty={<EmptyState title={t("members.empty")} />}
          />
        </PageSection>
      ) : null}
    </ViewLayout>
  );
}
