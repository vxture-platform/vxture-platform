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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
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
} from "@/api/console-bff";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";
import { hasCapability } from "@/features/permissions/can";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { AddonPacksSection } from "./components/AddonPacksSection";
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
  const locale = useLocale();
  const { session } = useConsoleSession();

  const [overview, setOverview] = useState<ConsoleQuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  /* 读失败显影(批 0b):总览是 strict 读,失败置 loadFailed——指标画「—」、表格画
   * 「读取失败」,不再把回落的零值对象画成「0 B / 0 B」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  // 加油包核销/取消后自增,触发总览重取(额度入池立即可见);重试也走它
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchQuotaOverview()
      .then((next) => {
        if (active) setOverview(next);
      })
      .catch(() => {
        if (!active) return;
        setOverview(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  const money = useCallback(
    (yuan: string, currency: string) =>
      formatCurrency(
        Number.parseFloat(yuan || "0"),
        locale as Locale,
        currency,
      ),
    [locale],
  );

  const metricLabel = (metric: string): string => {
    const key = METRIC_LABEL_KEYS[metric];
    return key ? t(key) : metric;
  };
  const metricValue = (metric: string, v: number): string =>
    metric === "storage.bytes" ? formatBytes(v) : fmtCount(v);
  const sourceLabel = useCallback(
    (source: string): string =>
      KNOWN_SOURCES.has(source) ? t(`source.${source}`) : source,
    [t],
  );

  // ── 概览指标(本页业务 3 个指标 → columns=3 铺满,列数随业务不写死)────────
  // 两个基础权益统一口径(2026-08-21 owner 整改):关键值 = 用量 / 总量,
  // 用量着蓝(text-info-text)、总量着黑(text-foreground),语义一眼分明。
  const usageOverTotal = (used: string, total: string) => (
    <span className="inline-flex items-baseline gap-xs tabular-nums">
      <span className="text-info-text">{used}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-foreground">{total}</span>
    </span>
  );
  const metrics = useMemo<MetricGridItem[]>(() => {
    const st = overview?.storage;
    const cr = overview?.aiCredit;
    const storageTight =
      st != null &&
      st.limitBytes > 0 &&
      st.remainingBytes < st.limitBytes * 0.1;
    const creditDry = cr != null && cr.limit > 0 && cr.remaining <= 0;
    const addonPools = [
      ...(overview?.storage.sources ?? []),
      ...(overview?.aiCredit.pools ?? []),
    ].filter((p) => p.source === "addon_purchase");
    const earliestExpiry = addonPools
      .map((p) => p.expiresAt)
      .filter((v): v is string => v !== null)
      .sort()[0];
    return [
      {
        id: "storage",
        icon: "hard-drive",
        label: t("metrics.storage"),
        value: st
          ? usageOverTotal(
              formatBytes(st.usedBytes),
              formatBytes(st.limitBytes),
            )
          : "—",
        ...(storageTight ? { tone: "warning" as const } : {}),
        trend: st
          ? t("metrics.remainHint", {
              remaining: formatBytes(st.remainingBytes),
            })
          : "",
        ...(storageTight ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "credits",
        icon: "sparkles",
        label: t("metrics.credits"),
        value: cr ? usageOverTotal(fmtCount(cr.used), fmtCount(cr.limit)) : "—",
        ...(creditDry ? { tone: "warning" as const } : {}),
        trend: cr
          ? t("metrics.creditsRemainHint", {
              remaining: fmtCount(cr.remaining),
            })
          : "",
        ...(creditDry ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "addons",
        icon: "lightning",
        label: t("metrics.addons"),
        value: overview ? fmtCount(addonPools.length) : "—",
        trend: !overview
          ? ""
          : earliestExpiry
            ? t("metrics.addonsExpiry", { date: fmtDate(earliestExpiry) })
            : t("metrics.addonsNone"),
      },
    ];
  }, [overview, t]);

  // ── ① 存储:统一行模式(2026-08-21 owner 整改:不再拆「额度构成/用量切片」
  //    左右两表——每行一个主体,来源类别用 Badge 标注;同产品的订阅贡献与
  //    用量切片并成一行,额度/已用两列并读)─────────────────────────────────
  type StorageRow = {
    key: string;
    name: string;
    source: string | null; // null = 纯用量切片行(该产品无额度贡献)
    limitBytes: number | null;
    usedBytes: number | null;
    expiresAt: string | null;
    observedAt: string | null;
  };
  const storageRows = useMemo<StorageRow[]>(() => {
    const st = overview?.storage;
    if (!st) return [];
    const sliceByCode = new Map(st.slices.map((s) => [s.productCode, s]));
    const mergedCodes = new Set<string>();
    const rows: StorageRow[] = st.sources.map((src, i) => {
      const slice = src.productCode
        ? sliceByCode.get(src.productCode)
        : undefined;
      if (src.productCode && slice) mergedCodes.add(src.productCode);
      return {
        key: `src:${src.source}:${src.productCode ?? "ws"}:${i}`,
        name: src.productName ?? sourceLabel(src.source),
        source: src.source,
        limitBytes: src.limit,
        usedBytes: slice?.usedBytes ?? null,
        expiresAt: src.expiresAt,
        observedAt: slice?.observedAt ?? null,
      };
    });
    for (const s of st.slices) {
      if (mergedCodes.has(s.productCode)) continue;
      rows.push({
        key: `slice:${s.productCode}`,
        name: s.productName,
        source: null,
        limitBytes: null,
        usedBytes: s.usedBytes,
        expiresAt: null,
        observedAt: s.observedAt,
      });
    }
    return rows;
  }, [overview, sourceLabel]);

  const storageColumns: DataTableColumn<StorageRow>[] = [
    {
      id: "item",
      header: t("storage.colItem"),
      cell: (r) => (
        <span className="flex items-center gap-sm">
          <span className="text-foreground">{r.name}</span>
          <Badge>
            {r.source ? sourceLabel(r.source) : t("storage.usageOnly")}
          </Badge>
        </span>
      ),
    },
    {
      id: "limit",
      header: t("storage.colLimit"),
      align: "right",
      cell: (r) =>
        r.limitBytes !== null ? (
          <span className="tabular-nums font-medium text-foreground">
            {formatBytes(r.limitBytes)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "used",
      header: t("storage.colUsed"),
      align: "right",
      cell: (r) =>
        r.usedBytes !== null ? (
          <span className="tabular-nums text-info-text">
            {formatBytes(r.usedBytes)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "share",
      header: t("storage.colShare"),
      width: "sm",
      cell: (r) =>
        r.usedBytes !== null ? (
          <Progress
            value={percentOf(r.usedBytes, overview?.storage.limitBytes ?? 0)}
            aria-label={t("storage.colShare")}
          />
        ) : null,
    },
    {
      id: "expires",
      header: t("storage.colExpires"),
      align: "right",
      cell: (r) =>
        r.limitBytes === null ? (
          "—"
        ) : r.expiresAt ? (
          <span className="tabular-nums">{fmtDate(r.expiresAt)}</span>
        ) : (
          t("storage.noExpiry")
        ),
    },
    {
      id: "observed",
      header: t("storage.colObserved"),
      align: "right",
      cell: (r) =>
        r.observedAt ? (
          <span className="tabular-nums text-body-sm text-muted-foreground">
            {fmtDate(r.observedAt)} {fmtTime(r.observedAt)}
          </span>
        ) : (
          "—"
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

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 存储空间(WS 级共享资源,统一行模式) */}
      <PageSection
        icon="hard-drive"
        level={2}
        title={t("storage.title")}
        description={t("storage.description")}
      >
        <DataTable<StorageRow>
          columns={storageColumns}
          rows={storageRows}
          rowKey={(r) => r.key}
          loading={loading}
          indexStart={1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("storage.emptySources")} />
            )
          }
          footer={
            <span className="tabular-nums text-body-sm text-muted-foreground">
              {overview
                ? t("storage.totalLine", {
                    limit: formatBytes(overview.storage.limitBytes),
                    remaining: formatBytes(overview.storage.remainingBytes),
                  })
                : "—"}
            </span>
          }
        />
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
          indexStart={1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("credits.empty")} />
            )
          }
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

      {/* ③ 加油包与扩展包(自助购买闭环) */}
      <AddonPacksSection
        onSettledRefresh={() => setReloadKey((k) => k + 1)}
        formatMoney={money}
        canPurchase={hasCapability(
          session.capabilities,
          "tenant.payment.manage",
        )}
      />

      {/* ④ 各产品配额明细 */}
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
          indexStart={1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("products.empty")} />
            )
          }
        />
      </PageSection>
    </ViewLayout>
  );
}
