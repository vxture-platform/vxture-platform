"use client";

/**
 * UsageRecordsPage.tsx — 调用记录(用量分析的二级页,owner 2026-09-07)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 用量分析主页三个板块都在回答「用了多少」——图看趋势、看分布、看谁用的;
 * 本页回答的是**另一个问题**:「这一笔到底怎么扣的」。owner 的原话是
 * 「一定程度上解决客户对计量正确性的质疑」,所以这页的设计只服务一件事:
 * **让客户自己把明细查准、加总、跟配额页与账单对上**。
 *
 * 三件事决定它能不能做到:
 *
 *   · **筛得准**。时间窗 + 产品 + 指标 + 成员 + 请求号五个维度,全部在服务端过滤
 *     ——不是把 500 条拉到前端再筛(那样争议的那几条可能根本没被拉下来)。
 *   · **合计对得上**。表头的「命中条数 / 实扣量合计」是**筛选后全集**的口径,
 *     不随分页变;服务端明细与合计共用同一份谓词,不会出现「逐条加起来 ≠ 合计」。
 *   · **差额说得清**。数量列同时给实扣量与申请量:两者不等就是这次没能全额扣到
 *     (超额准入自愈),「我调用了为什么没扣 / 只扣了一半」的答案直接在行上。
 *
 * 成员筛选走可视码 `user_no`,不出 UUID(全站口径)。
 */

import { RowActionsPlaceholder } from "@/components/table/RowActionsPlaceholder";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn, MetricGridItem } from "@vxture/design-system";
import {
  fetchUsageEvents,
  fetchUsageMembers,
  fetchUsageTrend,
  type ConsoleUsageEvent,
  type ConsoleUsageEvents,
  type ConsoleUsageEventsQuery,
  type ConsoleUsageMember,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { ListPagination } from "@/components/pagination";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { fmtCount } from "@/lib/format-metrics";
import { METRIC_LABEL_KEYS, useMetricLabel } from "@/lib/metric-label";
import { useDateFormat } from "@/lib/use-date-format";

const PAGE_SIZE = 20;
/** 未归集那一桶的筛选哨兵(与 BFF 的 USER_FILTER_RE 同一个字面量)。 */
const UNATTRIBUTED = "unattributed";
/** 服务端最远回看;超出这个范围的分区已不在,查了也是空。 */
const MAX_DAYS = 90;

type Filters = {
  from: string;
  to: string;
  product: string;
  metric: string;
  user: string;
  requestId: string;
};

/** `YYYY-MM-DD`(UTC),与服务端的桶口径一致。 */
const isoDay = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const initialFilters = (): Filters => ({
  from: isoDay(-30),
  to: isoDay(0),
  product: "",
  metric: "",
  user: "",
  requestId: "",
});

export function UsageRecordsPage() {
  const { fmtDate, fmtTime } = useDateFormat();

  const t = useTranslations("usageRecordsPage");
  const tableLabels = useTableLabels();
  const metricLabel = useMetricLabel();
  const router = useRouter();
  const { session } = useConsoleSession();

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [data, setData] = useState<ConsoleUsageEvents | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* 筛选项的候选值:成员来自「按成员统计」(这个窗口里真的有调用的人),
     产品来自近三个月趋势的 byProduct 并集——都只列**真的出现过**的值,
     不拿全量目录去撑一个大半是空的下拉。指标走共用字典(那是受管枚举)。 */
  const [members, setMembers] = useState<ConsoleUsageMember[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>(
    [],
  );

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      fetchUsageMembers(MAX_DAYS),
      fetchUsageTrend("month", 3),
    ]).then(([m, tr]) => {
      if (!active) return;
      if (m.status === "fulfilled") setMembers(m.value);
      if (tr.status === "fulfilled") {
        const byCode = new Map<string, string>();
        for (const b of tr.value.buckets) {
          for (const p of b.byProduct) byCode.set(p.productCode, p.productName);
        }
        setProducts([...byCode].map(([code, name]) => ({ code, name })));
      }
    });
    return () => {
      active = false;
    };
  }, [session.tenant?.id]);

  /* 记录本体:筛选或翻页一变就重取。请求号是边打边筛的,晚 350ms 再发——
     不然每敲一个字符一次往返。 */
  const query: ConsoleUsageEventsQuery = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      ...(filters.product ? { product: filters.product } : {}),
      ...(filters.metric ? { metric: filters.metric } : {}),
      ...(filters.user ? { user: filters.user } : {}),
      ...(filters.requestId ? { requestId: filters.requestId.trim() } : {}),
      page,
      pageSize,
    }),
    [filters, page, pageSize],
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadFailed(false);
      fetchUsageEvents(query)
        .then((next) => {
          if (active) setData(next);
        })
        .catch(() => {
          if (!active) return;
          setData(null);
          setLoadFailed(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, session.tenant?.id, reloadKey]);

  const setFilter = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1); // 换了筛选条件还停在第 5 页,多半是空的
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters());
    setPage(1);
  }, []);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  /* 对账锚点:这两个数是**筛选后全集**的,不随分页变——客户拿它跟配额页的
     「本期已用」、跟账单对。口径差异写在 trend 里,免得两处数对不上就炸。 */
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: "count",
        icon: "list-checks",
        label: t("metrics.count"),
        value: loadFailed || !data ? "—" : fmtCount(total),
        trend: loadFailed ? "" : t("metrics.countHint"),
      },
      {
        id: "amount",
        icon: "gauge",
        label: t("metrics.amount"),
        value: loadFailed || !data ? "—" : fmtCount(data.totalAmount),
        trend: loadFailed ? "" : t("metrics.amountHint"),
      },
    ],
    [data, total, loadFailed, t],
  );

  const columns: DataTableColumn<ConsoleUsageEvent>[] = [
    {
      id: "at",
      header: t("table.colAt"),
      cell: (e) => (
        <TableTitleCell
          title={<span className="tabular-nums">{fmtDate(e.at)}</span>}
          description={<span className="tabular-nums">{fmtTime(e.at)}</span>}
        />
      ),
    },
    {
      id: "product",
      header: t("table.colProduct"),
      align: "center",
      cell: (e) => e.productName,
    },
    {
      id: "metric",
      header: t("table.colMetric"),
      align: "center",
      cell: (e) => metricLabel(e.metric),
    },
    {
      id: "amount",
      align: "numeric",
      header: t("table.colAmount"),
      cell: (e) => {
        // 申请 ≠ 实扣 = 这次没能全额扣到(超额准入自愈)。差额直接写在行上,
        // 这正是「我调用了为什么没扣」的答案;相等时不出副行,免得每行都挂一句废话。
        const short =
          e.requestedAmount !== null && e.requestedAmount !== e.amount;
        return (
          <span className="flex flex-col tabular-nums">
            <span className="font-medium text-foreground">
              {fmtCount(e.amount)}
            </span>
            {short ? (
              <span className="text-body-sm text-warning-text">
                {t("table.requestedWas", {
                  amount: fmtCount(e.requestedAmount ?? 0),
                })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "user",
      header: t("table.colUser"),
      align: "center",
      cell: (e) =>
        e.userName ?? (
          <StatusBadge tone="neutral">{t("table.unattributed")}</StatusBadge>
        ),
    },
    {
      id: "request",
      header: t("table.colRequest"),
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

  return (
    <ViewLayout>
      <ViewHeader
        icon="search"
        title={t("title")}
        description={t("description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/usage")}
          >
            <Icon name="chart-line" size="xs" fallback="placeholder" />
            <span>{t("backToUsage")}</span>
          </Button>
        }
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={2}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="search"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: total })}
            aria-label={t("filters.groupLabel")}
            onReset={resetFilters}
            search={
              <Input
                value={filters.requestId}
                onChange={(e) => setFilter({ requestId: e.target.value })}
                placeholder={t("filters.requestPlaceholder")}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={t("filters.requestAriaLabel")}
              />
            }
          >
            <Input
              type="date"
              value={filters.from}
              max={filters.to}
              onChange={(e) => setFilter({ from: e.target.value })}
              className="w-fit basis-media-xl"
              aria-label={t("filters.fromAriaLabel")}
            />
            <Input
              type="date"
              value={filters.to}
              min={filters.from}
              onChange={(e) => setFilter({ to: e.target.value })}
              className="w-fit basis-media-xl"
              aria-label={t("filters.toAriaLabel")}
            />
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={filters.product}
              onChange={(e) => setFilter({ product: e.target.value })}
              aria-label={t("filters.productAriaLabel")}
            >
              <option value="">{t("filters.productAll")}</option>
              {products.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={filters.metric}
              onChange={(e) => setFilter({ metric: e.target.value })}
              aria-label={t("filters.metricAriaLabel")}
            >
              <option value="">{t("filters.metricAll")}</option>
              {Object.keys(METRIC_LABEL_KEYS).map((m) => (
                <option key={m} value={m}>
                  {metricLabel(m)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={filters.user}
              onChange={(e) => setFilter({ user: e.target.value })}
              aria-label={t("filters.userAriaLabel")}
            >
              <option value="">{t("filters.userAll")}</option>
              {members
                .filter((m) => m.userNo !== null)
                .map((m) => (
                  <option key={m.userNo!} value={m.userNo!}>
                    {m.userName ?? m.userNo}
                  </option>
                ))}
              <option value={UNATTRIBUTED}>{t("table.unattributed")}</option>
            </NativeSelect>
          </FilterBar>

          <DataTable<ConsoleUsageEvent>
            labels={tableLabels}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(e) =>
              `${e.at}:${e.requestId ?? ""}:${e.productCode}:${e.metric}`
            }
            /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
               与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
            leadingSpacer
            /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮——列的位置
               先占住，右缘与同页其它表对齐；将来加动作时改的是这一格的内容，
               不是整张表的列结构（owner 2026-09-07）。 */
            rowActions={() => <RowActionsPlaceholder />}
            loading={loading}
            indexStart={(page - 1) * pageSize + 1}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  title={t("table.empty")}
                  description={t("table.emptyHint")}
                  action={
                    <Button variant="outline" size="md" onClick={resetFilters}>
                      <Icon name="x" size="xs" fallback="placeholder" />
                      <span>{t("filters.reset")}</span>
                    </Button>
                  }
                />
              )
            }
            footer={
              <ListPagination
                page={page}
                pageCount={pageCount}
                total={loadFailed ? 0 : total}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                onPageChange={setPage}
              />
            }
          />
        </div>
      </PageSection>

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
                title: t("notes.reconcileTitle"),
                description: t("notes.reconcileBody"),
              },
              {
                title: t("notes.shortfallTitle"),
                description: t("notes.shortfallBody"),
              },
              {
                title: t("notes.rangeTitle"),
                description: t("notes.rangeBody", { days: MAX_DAYS }),
              },
            ]}
          />
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
