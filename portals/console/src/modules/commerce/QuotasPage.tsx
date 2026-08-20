"use client";

/**
 * QuotasPage.tsx — 配额管理(用量配额线重建,owner 2026-08-20)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 运营视角:「此刻还剩多少、要不要加购」。数据 = GET /api/quota/overview:
 *   - 存储空间 = WS 级总账(product_220 §4.4):额度 Σ 全来源池(基础授予/
 *     订阅贡献/加油包),用量 Σ 各产品水位切片;剩余可为负(超冲,如实展示);
 *   - AI Credits = 池明细(来源/本期已用/剩余/周期/效期)+ 共享参与产品;
 *   - 各产品配额明细 = 产品级指标 + 平台指标贡献。
 * 严格 DS 组合件拼装(billing 页口径):MetricGrid columns=3(本页 3 指标铺满,
 * 列数随业务不写死)+ PageSection 原生 icon + DataTable + SignalList,无自造
 * 样式层。中文基准,zh/en 双份 i18n(quotasPage 命名空间)。全页无 UUID。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DataTable,
  EmptyState,
  MetricGrid,
  Progress,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  fetchQuotaOverview,
  type ConsoleProductQuota,
  type ConsoleQuotaOverview,
  type ConsoleQuotaPool,
  type ConsoleStorageSlice,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { DashboardSplit, PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "./components/hubModel";

// ── 展示工具(格式化,非样式) ────────────────────────────────────────────────

/** 二进制字节格式化(200 MiB 底池等额度都是 2 的幂,用 1024 进位)。 */
export function formatBytes(value: number): string {
  const neg = value < 0 ? "-" : "";
  let v = Math.abs(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${neg}${v.toFixed(digits)} ${units[i]}`;
}

const fmtCount = (v: number): string => v.toLocaleString("en-US");

/** 用量占比(额度 0 时归 0,超冲钳 100)。 */
const percentOf = (used: number, limit: number): number =>
  limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

/** 已知指标 → i18n 键(未知键回退原文,契约演进容错)。 */
const METRIC_LABEL_KEYS: Record<string, string> = {
  "storage.bytes": "metric.storage",
  "ai.credit": "metric.aiCredit",
  "service.api.call": "metric.apiCall",
  "quality.check.run": "metric.qualityCheck",
};

const KNOWN_SOURCES = new Set([
  "ws_base",
  "subscription",
  "addon_purchase",
  "manual_override",
]);

type ProductMetricRow = ConsoleProductQuota["metrics"][number] & {
  productCode: string;
  productName: string;
  rowKey: string;
};

export function QuotasPage() {
  const t = useTranslations("quotasPage");
  const { session } = useConsoleSession();

  const [overview, setOverview] = useState<ConsoleQuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchQuotaOverview()
      .then(setOverview)
      .finally(() => setLoading(false));
  }, [session.tenant?.id]);

  const metricLabel = (metric: string): string => {
    const key = METRIC_LABEL_KEYS[metric];
    return key ? t(key) : metric;
  };
  const metricValue = (metric: string, v: number): string =>
    metric === "storage.bytes" ? formatBytes(v) : fmtCount(v);
  const sourceLabel = (source: string): string =>
    KNOWN_SOURCES.has(source) ? t(`source.${source}`) : source;

  // ── 概览指标(本页业务 3 个指标 → columns=3 铺满,列数随业务不写死)────────
  const metrics = useMemo<MetricGridItem[]>(() => {
    const st = overview?.storage;
    const cr = overview?.aiCredit;
    const storageTight =
      st != null &&
      st.limitBytes > 0 &&
      st.remainingBytes < st.limitBytes * 0.1;
    const creditDry = cr != null && cr.limit > 0 && cr.remaining <= 0;
    return [
      {
        id: "storage",
        icon: "hard-drive",
        label: t("metrics.storage"),
        value: st ? formatBytes(st.usedBytes) : "—",
        ...(storageTight ? { tone: "warning" as const } : {}),
        trend: st
          ? t("metrics.storageHint", {
              limit: formatBytes(st.limitBytes),
              remaining: formatBytes(st.remainingBytes),
            })
          : "",
        ...(storageTight ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "credit-remaining",
        icon: "sparkles",
        label: t("metrics.creditRemaining"),
        value: cr ? fmtCount(cr.remaining) : "—",
        ...(creditDry ? { tone: "warning" as const } : {}),
        trend: cr
          ? t("metrics.creditRemainingHint", { limit: fmtCount(cr.limit) })
          : "",
        ...(creditDry ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "credit-used",
        icon: "gauge",
        label: t("metrics.creditUsed"),
        value: cr ? fmtCount(cr.used) : "—",
        trend: t("metrics.creditUsedHint"),
      },
    ];
  }, [overview, t]);

  // ── ① 存储:额度构成 + 产品切片 ───────────────────────────────────────────
  const storageSourceColumns: DataTableColumn<ConsoleQuotaPool>[] = [
    {
      id: "source",
      header: t("storage.colSource"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="text-foreground">{sourceLabel(p.source)}</span>
          {p.productName ? (
            <span className="text-body-sm text-muted-foreground">
              {p.productName}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "limit",
      header: t("storage.colLimit"),
      align: "right",
      cell: (p) => (
        <span className="tabular-nums font-medium text-foreground">
          {formatBytes(p.limit)}
        </span>
      ),
    },
    {
      id: "expires",
      header: t("storage.colExpires"),
      align: "right",
      cell: (p) =>
        p.expiresAt ? (
          <span className="tabular-nums">{fmtDate(p.expiresAt)}</span>
        ) : (
          t("storage.noExpiry")
        ),
    },
  ];

  const storageSliceColumns: DataTableColumn<ConsoleStorageSlice>[] = [
    {
      id: "product",
      header: t("storage.colProduct"),
      cell: (s) => s.productName,
    },
    {
      id: "used",
      header: t("storage.colUsed"),
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-medium text-foreground">
          {formatBytes(s.usedBytes)}
        </span>
      ),
    },
    {
      id: "share",
      header: t("storage.colShare"),
      width: "md",
      cell: (s) => (
        <Progress
          value={percentOf(s.usedBytes, overview?.storage.limitBytes ?? 0)}
          aria-label={t("storage.colShare")}
        />
      ),
    },
    {
      id: "observed",
      header: t("storage.colObserved"),
      align: "right",
      cell: (s) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {fmtDate(s.observedAt)} {fmtTime(s.observedAt)}
        </span>
      ),
    },
  ];

  // ── ② AI Credits 池 ──────────────────────────────────────────────────────
  const creditPoolColumns: DataTableColumn<ConsoleQuotaPool>[] = [
    {
      id: "source",
      header: t("credits.colSource"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="text-foreground">
            {p.productName ?? sourceLabel(p.source)}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {sourceLabel(p.source)}
          </span>
        </span>
      ),
    },
    {
      id: "limit",
      header: t("credits.colLimit"),
      align: "right",
      cell: (p) => <span className="tabular-nums">{fmtCount(p.limit)}</span>,
    },
    {
      id: "used",
      header: t("credits.colUsed"),
      align: "right",
      cell: (p) => <span className="tabular-nums">{fmtCount(p.used)}</span>,
    },
    {
      id: "remaining",
      header: t("credits.colRemaining"),
      align: "right",
      cell: (p) => {
        const dry = p.limit > 0 && p.remaining <= 0;
        return (
          <span
            className={`tabular-nums font-medium ${dry ? "text-warning-text" : "text-foreground"}`}
          >
            {fmtCount(p.remaining)}
          </span>
        );
      },
    },
    {
      id: "reset",
      header: t("credits.colReset"),
      align: "center",
      cell: (p) => {
        const tone: StatusBadgeTone =
          p.resetPeriod === "none" ? "neutral" : "info";
        return (
          <StatusBadge tone={tone}>
            {t(
              `reset.${p.resetPeriod === "day" || p.resetPeriod === "month" ? p.resetPeriod : "none"}`,
            )}
          </StatusBadge>
        );
      },
    },
    {
      id: "expires",
      header: t("credits.colExpires"),
      align: "right",
      cell: (p) =>
        p.expiresAt ? (
          <span className="tabular-nums">{fmtDate(p.expiresAt)}</span>
        ) : (
          t("storage.noExpiry")
        ),
    },
  ];

  // ── ③ 各产品配额明细 ─────────────────────────────────────────────────────
  const productRows = useMemo<ProductMetricRow[]>(
    () =>
      (overview?.products ?? []).flatMap((p) =>
        p.metrics.map((m) => ({
          ...m,
          productCode: p.productCode,
          productName: p.productName,
          rowKey: `${p.productCode}:${m.metric}`,
        })),
      ),
    [overview],
  );

  const productColumns: DataTableColumn<ProductMetricRow>[] = [
    {
      id: "product",
      header: t("products.colProduct"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-foreground">{r.productName}</span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {r.productCode}
          </span>
        </span>
      ),
    },
    {
      id: "metric",
      header: t("products.colMetric"),
      cell: (r) => metricLabel(r.metric),
    },
    {
      id: "limit",
      header: t("products.colLimit"),
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{metricValue(r.metric, r.limit)}</span>
      ),
    },
    {
      id: "used",
      header: t("products.colUsed"),
      align: "right",
      cell: (r) =>
        r.metric === "storage.bytes" ? (
          // 存储是 WS 总账,池级 used 无意义 → 展示该产品水位切片
          <span className="tabular-nums">
            {(() => {
              const slice = overview?.storage.slices.find(
                (s) => s.productCode === r.productCode,
              );
              return slice ? formatBytes(slice.usedBytes) : "—";
            })()}
          </span>
        ) : (
          <span className="tabular-nums">{metricValue(r.metric, r.used)}</span>
        ),
    },
    {
      id: "remaining",
      header: t("products.colRemaining"),
      align: "right",
      cell: (r) =>
        r.metric === "storage.bytes" ? (
          <span className="tabular-nums text-muted-foreground">
            {t("products.wsShared")}
          </span>
        ) : (
          <span className="tabular-nums font-medium text-foreground">
            {metricValue(r.metric, r.remaining)}
          </span>
        ),
    },
  ];

  const sharingProducts = overview?.aiCredit.sharingProducts ?? [];

  return (
    <ViewLayout>
      <ViewHeader
        icon="database"
        title={t("title")}
        description={t("description")}
      />

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 存储空间(WS 级共享资源) */}
      <PageSection
        icon="hard-drive"
        level={2}
        title={t("storage.title")}
        description={t("storage.description")}
      >
        <DashboardSplit>
          <DataTable<ConsoleQuotaPool>
            columns={storageSourceColumns}
            rows={overview?.storage.sources ?? []}
            rowKey={(p) =>
              `${p.source}:${p.productCode ?? "ws"}:${p.expiresAt ?? ""}`
            }
            loading={loading}
            empty={<EmptyState title={t("storage.emptySources")} />}
            footer={
              <span className="tabular-nums text-body-sm text-muted-foreground">
                {t("storage.totalLine", {
                  limit: formatBytes(overview?.storage.limitBytes ?? 0),
                  remaining: formatBytes(overview?.storage.remainingBytes ?? 0),
                })}
              </span>
            }
          />
          <DataTable<ConsoleStorageSlice>
            columns={storageSliceColumns}
            rows={overview?.storage.slices ?? []}
            rowKey={(s) => s.productCode}
            loading={loading}
            empty={<EmptyState title={t("storage.emptySlices")} />}
          />
        </DashboardSplit>
      </PageSection>

      {/* ② AI Credits */}
      <PageSection
        icon="sparkles"
        level={2}
        title={t("credits.title")}
        description={t("credits.description")}
      >
        <DataTable<ConsoleQuotaPool>
          columns={creditPoolColumns}
          rows={overview?.aiCredit.pools ?? []}
          rowKey={(p) =>
            `${p.source}:${p.productCode ?? "ws"}:${p.expiresAt ?? ""}:${p.limit}`
          }
          loading={loading}
          empty={<EmptyState title={t("credits.empty")} />}
        />
        <SignalList
          items={[
            {
              title: t("credits.sharingTitle"),
              description:
                sharingProducts.length > 0
                  ? t("credits.sharingOn", {
                      products: sharingProducts
                        .map((p) => p.productName)
                        .join(" / "),
                    })
                  : t("credits.sharingOff"),
            },
            {
              title: t("credits.boosterTitle"),
              description: t("credits.boosterBody"),
            },
          ]}
        />
      </PageSection>

      {/* ③ 各产品配额明细 */}
      <PageSection
        icon="package"
        level={2}
        title={t("products.title")}
        description={t("products.description")}
      >
        <DataTable<ProductMetricRow>
          columns={productColumns}
          rows={productRows}
          rowKey={(r) => r.rowKey}
          loading={loading}
          empty={<EmptyState title={t("products.empty")} />}
        />
      </PageSection>
    </ViewLayout>
  );
}
