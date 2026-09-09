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
 *   - AI Credits = 池明细(来源/本期已用/剩余/周期/效期);
 *   - 各产品配额明细 = 产品级指标 + 平台指标贡献。
 * 严格 DS 组合件拼装(billing 页口径):MetricGrid columns=3(本页 3 指标铺满,
 * 列数随业务不写死)+ PageSection 原生 icon + DataTable,无自造
 * 样式层。中文基准,zh/en 双份 i18n(quotasPage 命名空间)。全页无 UUID。
 *
 * ## 2026-09-07 页面级走查改了什么
 *
 *   · **用上读回来却没用的两个字段**:产品明细的已用存储改读 `storageUsedBytes`
 *     (原来在 cell 里对 `slices` 现扫一遍,每次渲染 O(n));补「重置周期」列
 *     ——`metrics[].resetPeriod` 一直返回却不显示,月度重置与一次性额度长得一样。
 *   · **超冲要能读**:剩余为负是有意义的状态(见 API 契约注释),但「剩余 -1.2 GB」
 *     是数学不是话。负值一律改说「已超出 1.2 GB」,概览卡与表尾同一个表达。
 *   · **额度告急有去处**:存储/Credits 板块头各有一个「去加购」(primary),跨页直达
 *     费用中心的加油包板块。本页**不留任何加油包/扩展包板块**(owner 2026-09-09)
 *     ——买在费用中心,这一页只答「用了多少、还剩多少」。
 *   · **一致性**:三张表补 ListPagination;产品明细补 FilterBar;日期列改居中
 *     (金额/数字才右对齐);上报时间改日期主/时间辅;说明裹 SectionBody。
 *
 * 这三张表**不设行操作列**——它们是读数不是台账,配额行上没有可做的动作;
 * 真正的动作(加购)是板块级的,不该在每行摆一个只有一项的菜单凑格式。
 */

import { RowActionsPlaceholder } from "@/components/table/RowActionsPlaceholder";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  Progress,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  TableTitleCell,
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
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { Link } from "@/lib/i18n/navigation";
import { ListPagination } from "@/components/pagination";
import { PageSection } from "@/layout/shell";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { ADDON_SECTION_HREF } from "./addon-routes";
import { fmtDate, fmtTime } from "./components/hubModel";
import { fmtCount, formatBytes } from "@/lib/format-metrics";
import { useMetricLabel } from "@/lib/metric-label";

/** 用量占比(额度 0 时归 0,超冲钳 100)。 */
const percentOf = (used: number, limit: number): number =>
  limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

const KNOWN_SOURCES = new Set([
  "ws_base",
  "subscription",
  "addon_purchase",
  "manual_override",
]);

type ProductMetricRow = ConsoleProductQuota["metrics"][number] & {
  productCode: string;
  productName: string;
  /** 该产品的存储水位(BFF 已按产品算好,不必在 cell 里对 slices 现扫)。 */
  storageUsedBytes: number | null;
  rowKey: string;
};

const PAGE_SIZE = 10;

export function QuotasPage() {
  const t = useTranslations("quotasPage");
  const tableLabels = useTableLabels();
  const { session } = useConsoleSession();

  const [overview, setOverview] = useState<ConsoleQuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  /* 读失败显影(批 0b):总览是 strict 读,失败置 loadFailed——指标画「—」、表格画
   * 「读取失败」,不再把回落的零值对象画成「0 B / 0 B」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  // 加油包核销/取消后自增,触发总览重取(额度入池立即可见);重试也走它
  const [reloadKey, setReloadKey] = useState(0);

  /* 三张表各自翻页:来源/池/产品指标是三份互不相干的清单,共用一个页码只会互相踩。 */
  const [storagePage, setStoragePage] = useState(1);
  const [storagePageSize, setStoragePageSize] = useState<number>(PAGE_SIZE);
  const [creditPage, setCreditPage] = useState(1);
  const [creditPageSize, setCreditPageSize] = useState<number>(PAGE_SIZE);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState<number>(PAGE_SIZE);
  const [productQuery, setProductQuery] = useState("");

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

  // 指标名走共用字典(用量页读同一份;见 lib/metric-label)
  const metricLabel = useMetricLabel();
  const metricValue = (metric: string, v: number): string =>
    metric === "storage.bytes" ? formatBytes(v) : fmtCount(v);
  const sourceLabel = useCallback(
    (source: string): string =>
      KNOWN_SOURCES.has(source) ? t(`source.${source}`) : source,
    [t],
  );

  /* 剩余为负 = 超冲(API 契约里明写不钳制)。「剩余 -1.2 GB」是数学不是话,
     一律翻成「已超出 1.2 GB」;概览卡与表尾走同一个表达。 */
  const remainText = useCallback(
    (remaining: number, fmt: (v: number) => string): string =>
      remaining < 0
        ? t("overBy", { amount: fmt(-remaining) })
        : t("remainBy", { amount: fmt(remaining) }),
    [t],
  );

  /** 重置周期徽章:Credits 池表与产品明细表共用一种写法(原来只有前者有)。 */
  const resetBadge = (period: string) => {
    const known = period === "day" || period === "month";
    const tone: StatusBadgeTone = known ? "info" : "neutral";
    return (
      <StatusBadge tone={tone}>
        {t(`reset.${known ? period : "none"}`)}
      </StatusBadge>
    );
  };

  /* 「去加购」:额度告急时唯一能做的事,所以走 **primary**——它是这两个板块里
     唯一的动作,压成次要档会让「额度告急」这件事没有出口。
     加油包板块 2026-09-08 迁到费用中心,这里跨页直达锚点;用 Link 而不是
     onClick+router.push:它是导航,中键/新标签页/复制链接都该能用。 */
  const addonsAction = (
    <Button asChild size="sm">
      <Link href={ADDON_SECTION_HREF}>
        <Icon name="lightning" size="xs" fallback="placeholder" />
        <span>{t("gotoAddons")}</span>
      </Link>
    </Button>
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
        trend: st ? remainText(st.remainingBytes, formatBytes) : "",
        ...(storageTight ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "credits",
        icon: "sparkles",
        label: t("metrics.credits"),
        value: cr ? usageOverTotal(fmtCount(cr.used), fmtCount(cr.limit)) : "—",
        ...(creditDry ? { tone: "warning" as const } : {}),
        trend: cr ? remainText(cr.remaining, fmtCount) : "",
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
  }, [overview, t, remainText]);

  /** 时间列的统一写法(与卡券页同口径):日期为主、时间为辅。 */
  const timeCell = (iso: string | null) =>
    iso ? (
      <span className="flex flex-col tabular-nums">
        <span className="text-foreground">{fmtDate(iso)}</span>
        <span className="text-body-sm text-muted-foreground">
          {fmtTime(iso)}
        </span>
      </span>
    ) : (
      "—"
    );

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

  const storagePageCount = Math.max(
    1,
    Math.ceil(storageRows.length / storagePageSize),
  );
  useEffect(() => {
    setStoragePage((p) =>
      Math.min(p, Math.max(1, Math.ceil(storageRows.length / storagePageSize))),
    );
  }, [storageRows.length, storagePageSize]);
  /* 三张表各自排序，都在**分页之前**——只排当前页等于只排看得见的那几条。 */
  const storageSortAcc = useMemo(
    () => ({
      item: (r: StorageRow) => r.name,
      limit: (r: StorageRow) => r.limitBytes,
      used: (r: StorageRow) => r.usedBytes,
    }),
    [],
  );
  const {
    sort: storageSort,
    onSortChange: onStorageSortChange,
    rows: sortedStorageRows,
  } = useTableSort(storageRows, storageSortAcc);

  const pagedStorageRows = useMemo(
    () =>
      sortedStorageRows.slice(
        (storagePage - 1) * storagePageSize,
        storagePage * storagePageSize,
      ),
    [sortedStorageRows, storagePage, storagePageSize],
  );

  const storageColumns: DataTableColumn<StorageRow>[] = [
    {
      id: "item",
      sortable: true,
      header: t("storage.colItem"),
      cell: (r) => (
        <TableTitleCell
          title={r.name}
          titleSuffix={
            <Badge>
              {r.source ? sourceLabel(r.source) : t("storage.usageOnly")}
            </Badge>
          }
        />
      ),
    },
    {
      id: "limit",
      sortable: true,
      align: "numeric",
      header: t("storage.colLimit"),
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
      sortable: true,
      align: "numeric",
      header: t("storage.colUsed"),
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
      align: "center",
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
      align: "center",
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
      align: "center",
      cell: (r) => timeCell(r.observedAt),
    },
  ];

  // ── ② AI Credits 池 ──────────────────────────────────────────────────────
  const creditPoolColumns: DataTableColumn<ConsoleQuotaPool>[] = [
    {
      id: "source",
      sortable: true,
      header: t("credits.colSource"),
      cell: (p) => (
        <TableTitleCell
          title={p.productName ?? sourceLabel(p.source)}
          description={sourceLabel(p.source)}
        />
      ),
    },
    {
      id: "limit",
      sortable: true,
      align: "numeric",
      header: t("credits.colLimit"),
      cell: (p) => <span className="tabular-nums">{fmtCount(p.limit)}</span>,
    },
    {
      id: "used",
      sortable: true,
      align: "numeric",
      header: t("credits.colUsed"),
      cell: (p) => <span className="tabular-nums">{fmtCount(p.used)}</span>,
    },
    {
      id: "remaining",
      sortable: true,
      align: "numeric",
      header: t("credits.colRemaining"),
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
      cell: (p) => resetBadge(p.resetPeriod),
    },
    {
      id: "expires",
      header: t("credits.colExpires"),
      align: "center",
      cell: (p) =>
        p.expiresAt ? (
          <span className="tabular-nums">{fmtDate(p.expiresAt)}</span>
        ) : (
          t("storage.noExpiry")
        ),
    },
  ];

  const creditPools = overview?.aiCredit.pools ?? [];
  const creditPageCount = Math.max(
    1,
    Math.ceil(creditPools.length / creditPageSize),
  );
  useEffect(() => {
    setCreditPage((p) =>
      Math.min(p, Math.max(1, Math.ceil(creditPools.length / creditPageSize))),
    );
  }, [creditPools.length, creditPageSize]);
  const creditSortAcc = useMemo(
    () => ({
      source: (p: ConsoleQuotaPool) => p.productName ?? p.source,
      limit: (p: ConsoleQuotaPool) => p.limit,
      used: (p: ConsoleQuotaPool) => p.used,
      remaining: (p: ConsoleQuotaPool) => p.remaining,
    }),
    [],
  );
  const {
    sort: creditSort,
    onSortChange: onCreditSortChange,
    rows: sortedCreditPools,
  } = useTableSort(creditPools, creditSortAcc);

  const pagedCreditPools = sortedCreditPools.slice(
    (creditPage - 1) * creditPageSize,
    creditPage * creditPageSize,
  );

  // ── ③ 各产品配额明细 ─────────────────────────────────────────────────────
  const productRows = useMemo<ProductMetricRow[]>(
    () =>
      (overview?.products ?? []).flatMap((p) =>
        p.metrics.map((m) => ({
          ...m,
          productCode: p.productCode,
          productName: p.productName,
          storageUsedBytes: p.storageUsedBytes,
          rowKey: `${p.productCode}:${m.metric}`,
        })),
      ),
    [overview],
  );

  const visibleProductRows = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productRows;
    // 搜索面:产品名、产品代码、指标名——三样都是屏幕上能看到的字。
    return productRows.filter((r) =>
      [r.productName, r.productCode, metricLabel(r.metric)].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [productRows, productQuery, metricLabel]);

  const productPageCount = Math.max(
    1,
    Math.ceil(visibleProductRows.length / productPageSize),
  );
  useEffect(() => {
    setProductPage((p) =>
      Math.min(
        p,
        Math.max(1, Math.ceil(visibleProductRows.length / productPageSize)),
      ),
    );
  }, [visibleProductRows.length, productPageSize]);
  const productSortAcc = useMemo(
    () => ({
      limit: (r: ProductMetricRow) => r.limit,
      used: (r: ProductMetricRow) => r.used,
      remaining: (r: ProductMetricRow) => r.remaining,
    }),
    [],
  );
  const {
    sort: productSort,
    onSortChange: onProductSortChange,
    rows: sortedProductRows,
  } = useTableSort(visibleProductRows, productSortAcc);

  const pagedProductRows = useMemo(
    () =>
      sortedProductRows.slice(
        (productPage - 1) * productPageSize,
        productPage * productPageSize,
      ),
    [sortedProductRows, productPage, productPageSize],
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
      align: "center",
      cell: (r) => metricLabel(r.metric),
    },
    {
      id: "limit",
      sortable: true,
      align: "numeric",
      header: t("products.colLimit"),
      cell: (r) => (
        <span className="tabular-nums">{metricValue(r.metric, r.limit)}</span>
      ),
    },
    {
      id: "used",
      sortable: true,
      align: "numeric",
      header: t("products.colUsed"),
      cell: (r) =>
        r.metric === "storage.bytes" ? (
          // 存储是 WS 总账,池级 used 无意义 → 用 BFF 按产品算好的水位
          <span className="tabular-nums">
            {r.storageUsedBytes !== null
              ? formatBytes(r.storageUsedBytes)
              : "—"}
          </span>
        ) : (
          <span className="tabular-nums">{metricValue(r.metric, r.used)}</span>
        ),
    },
    {
      id: "remaining",
      sortable: true,
      align: "numeric",
      header: t("products.colRemaining"),
      cell: (r) =>
        r.metric === "storage.bytes" ? (
          <span className="tabular-nums text-muted-foreground">
            {t("products.wsShared")}
          </span>
        ) : (
          <span
            className={`tabular-nums font-medium ${r.remaining < 0 ? "text-warning-text" : "text-foreground"}`}
          >
            {metricValue(r.metric, r.remaining)}
          </span>
        ),
    },
    {
      id: "reset",
      header: t("products.colReset"),
      align: "center",
      cell: (r) =>
        // 存储不按周期重置(WS 总账),这一格空着比画一个「一次性」准确。
        r.metric === "storage.bytes" ? "—" : resetBadge(r.resetPeriod),
    },
  ];

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
        action={addonsAction}
      >
        <DataTable<StorageRow>
          labels={tableLabels}
          columns={storageColumns}
          rows={pagedStorageRows}
          {...(storageSort ? { sort: storageSort } : {})}
          onSortChange={onStorageSortChange}
          rowKey={(r) => r.key}
          /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
             与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
          leadingSpacer
          /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮——列的位置
             先占住，右缘与同页其它表对齐；将来加动作时改的是这一格的内容，
             不是整张表的列结构（owner 2026-09-07）。 */
          rowActions={() => <RowActionsPlaceholder />}
          loading={loading}
          indexStart={(storagePage - 1) * storagePageSize + 1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("storage.emptySources")} />
            )
          }
          footer={
            <span className="flex flex-wrap items-center justify-between gap-sm">
              {/* 合计行留在表尾左侧:它是这张表的读数,不是翻页控件的一部分。 */}
              <span className="tabular-nums text-body-sm text-muted-foreground">
                {overview
                  ? t("storage.totalLine", {
                      limit: formatBytes(overview.storage.limitBytes),
                      remaining: remainText(
                        overview.storage.remainingBytes,
                        formatBytes,
                      ),
                    })
                  : "—"}
              </span>
              <ListPagination
                page={storagePage}
                pageCount={storagePageCount}
                total={loadFailed ? 0 : storageRows.length}
                pageSize={storagePageSize}
                onPageSizeChange={setStoragePageSize}
                onPageChange={setStoragePage}
              />
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
        action={addonsAction}
      >
        <DataTable<ConsoleQuotaPool>
          labels={tableLabels}
          columns={creditPoolColumns}
          rows={pagedCreditPools}
          {...(creditSort ? { sort: creditSort } : {})}
          onSortChange={onCreditSortChange}
          rowKey={(p) =>
            `${p.source}:${p.productCode ?? "ws"}:${p.expiresAt ?? ""}:${p.limit}`
          }
          /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
             与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
          leadingSpacer
          /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮——列的位置
             先占住，右缘与同页其它表对齐；将来加动作时改的是这一格的内容，
             不是整张表的列结构（owner 2026-09-07）。 */
          rowActions={() => <RowActionsPlaceholder />}
          loading={loading}
          indexStart={(creditPage - 1) * creditPageSize + 1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("credits.empty")} />
            )
          }
          footer={
            <ListPagination
              page={creditPage}
              pageCount={creditPageCount}
              total={loadFailed ? 0 : creditPools.length}
              pageSize={creditPageSize}
              onPageSizeChange={setCreditPageSize}
              onPageChange={setCreditPage}
            />
          }
        />
      </PageSection>

      {/* ③ 各产品配额明细 */}
      <PageSection
        icon="package"
        level={2}
        title={t("products.title")}
        description={t("products.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: visibleProductRows.length })}
            aria-label={t("filters.groupLabel")}
            onReset={() => {
              setProductQuery("");
              setProductPage(1);
            }}
            search={
              <Input
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setProductPage(1);
                }}
                placeholder={t("filters.searchPlaceholder")}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={t("filters.searchAriaLabel")}
              />
            }
          />

          <DataTable<ProductMetricRow>
            labels={tableLabels}
            columns={productColumns}
            rows={pagedProductRows}
            {...(productSort ? { sort: productSort } : {})}
            onSortChange={onProductSortChange}
            rowKey={(r) => r.rowKey}
            /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
               与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
            leadingSpacer
            /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮——列的位置
               先占住，右缘与同页其它表对齐；将来加动作时改的是这一格的内容，
               不是整张表的列结构（owner 2026-09-07）。 */
            rowActions={() => <RowActionsPlaceholder />}
            loading={loading}
            indexStart={(productPage - 1) * productPageSize + 1}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  title={t("products.empty")}
                  {...(productQuery
                    ? {
                        action: (
                          <Button
                            variant="outline"
                            size="md"
                            onClick={() => setProductQuery("")}
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
              <ListPagination
                page={productPage}
                pageCount={productPageCount}
                total={loadFailed ? 0 : visibleProductRows.length}
                pageSize={productPageSize}
                onPageSizeChange={setProductPageSize}
                onPageChange={setProductPage}
              />
            }
          />
        </div>
      </PageSection>
    </ViewLayout>
  );
}
