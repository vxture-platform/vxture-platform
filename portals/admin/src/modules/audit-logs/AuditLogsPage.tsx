"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  ActionButton,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Pagination,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import { fetchAuditLogs, type AuditLogFilters } from "@/api/admin-bff";
import type { DataTableColumn } from "@vxture/design-system";
import type { AuditLogRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDateTime, joinClasses } from "@/modules/tenants/tenant-utils";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const EMPTY_MARK = "-";

function resultLabel(result: AuditLogRecord["result"]) {
  return result === "success" ? "成功" : "失败";
}

function auditLogSearchText(log: AuditLogRecord) {
  return [
    log.operatorName,
    log.operatorEmail,
    log.action,
    log.targetType,
    log.targetLabel,
    log.ip,
    log.module,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ─── 子组件：汇总卡片 ──────────────────────────────────────────────────────────

function AuditSummary({ logs }: { logs: AuditLogRecord[] }) {
  const todayStr = new Date().toDateString();
  const todayLogs = logs.filter(
    (l) => new Date(l.createdAt).toDateString() === todayStr,
  );
  const failureCount = logs.filter((l) => l.result === "failure").length;
  const operatorSet = new Set(logs.map((l) => l.operatorId));

  return (
    <MetricGrid
      aria-label="审计日志统计"
      columns={3}
      items={[
        {
          id: "total",
          help: "当前筛选条件下加载到的审计日志条数。",
          icon: "list",
          label: "日志总数",
          value: logs.length,
          tags: [`操作员 ${operatorSet.size}`],
        },
        {
          id: "today",
          help: "发生时间为今天（本地时区）的操作。",
          icon: "check",
          label: "今日操作",
          value: todayLogs.length,
          tags: ["当日写入"],
          tone: "success",
        },
        {
          id: "failures",
          help: "执行结果为失败的操作，含被拒绝与异常中断。",
          icon: "x",
          label: "失败操作",
          value: failureCount,
          tags: ["需复核"],
          tone: "danger",
        },
      ]}
    />
  );
}

// ─── 子组件：工具栏 ────────────────────────────────────────────────────────────

type ResultFilter = "all" | "success" | "failure";

function AuditToolbar({
  search,
  resultFilter,
  dateFrom,
  dateTo,
  total,
  exportDisabled,
  onSearchChange,
  onResultFilterChange,
  onDateFromChange,
  onDateToChange,
  onReset,
  onExport,
}: {
  search: string;
  resultFilter: ResultFilter;
  dateFrom: string;
  dateTo: string;
  total: number;
  exportDisabled: boolean;
  onSearchChange: (v: string) => void;
  onResultFilterChange: (v: ResultFilter) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onReset: () => void;
  onExport: () => void;
}) {
  return (
    <FilterBar
      count={total}
      aria-label="审计日志筛选"
      search={
        <Input
          placeholder="搜索操作员、操作类型、对象…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="grow basis-media-3xl max-w-panel-sm"
          aria-label="搜索审计日志（当前结果内）"
        />
      }
      onReset={onReset}
      actions={
        <ActionButton
          icon="shield-check"
          variant={exportDisabled ? "outline" : "default"}
          disabled={exportDisabled}
          onClick={onExport}
        >
          导出审计
        </ActionButton>
      }
    >
      <Input
        type="datetime-local"
        className="w-fit"
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        aria-label="起始时间"
        title="起始时间（服务端筛选）"
      />
      <Input
        type="datetime-local"
        className="w-fit"
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        aria-label="截止时间"
        title="截止时间（服务端筛选）"
      />
      <NativeSelect
        wrapperClassName="w-fit"
        className="w-fit basis-media-xl"
        value={resultFilter}
        onChange={(e) => onResultFilterChange(e.target.value as ResultFilter)}
        aria-label="审计结果"
      >
        <option value="all">全部结果</option>
        <option value="success">成功</option>
        <option value="failure">失败</option>
      </NativeSelect>
    </FilterBar>
  );
}

const AUDIT_CSV_COLUMNS: readonly CsvColumn<AuditLogRecord>[] = [
  { label: "时间", value: (l) => l.createdAt },
  { label: "操作员", value: (l) => l.operatorName },
  { label: "邮箱", value: (l) => l.operatorEmail },
  { label: "操作", value: (l) => l.action },
  { label: "对象类型", value: (l) => l.targetType },
  { label: "对象ID", value: (l) => l.targetId ?? "" },
  { label: "模块", value: (l) => l.module },
  { label: "结果", value: (l) => (l.result === "success" ? "成功" : "失败") },
  { label: "IP", value: (l) => l.ip ?? "" },
  { label: "错误", value: (l) => l.errorMessage ?? "" },
];

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ─── 子组件：列表 ──────────────────────────────────────────────────────────────

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function auditColumns(
  locale: string,
): readonly DataTableColumn<AuditLogRecord>[] {
  return [
    {
      id: "operator",
      header: "操作员",
      cell: (log) => (
        <TableTitleCell
          title={log.operatorName}
          description={log.operatorEmail}
        />
      ),
    },
    {
      id: "action",
      header: "操作",
      // 只写一次。`actionLabel` 曾是 BFF 拿 `row.action` 原样起的别名，标题与描述
      // 因此逐字相同（`oidc.token_exchange.issued` 上下各一行）。没有译名就不装作有。
      cell: (log) => <TableTitleCell title={log.action} />,
    },
    {
      id: "target",
      header: "对象",
      cell: (log) =>
        log.targetLabel ? (
          <TableTitleCell
            title={log.targetLabel}
            description={log.targetType}
          />
        ) : (
          <span className="text-muted-foreground">{EMPTY_MARK}</span>
        ),
    },
    { id: "module", header: "模块", cell: (log) => log.module },
    {
      id: "result",
      header: "结果",
      align: "center",
      cell: (log) => (
        <StatusBadge
          tone={log.result === "success" ? "success" : "danger"}
          {...(log.errorMessage ? { title: log.errorMessage } : {})}
        >
          {resultLabel(log.result)}
        </StatusBadge>
      ),
    },
    { id: "ip", header: "IP", cell: (log) => log.ip ?? EMPTY_MARK },
    {
      id: "time",
      header: "时间",
      cell: (log) => formatDateTime(log.createdAt, locale),
    },
  ];
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function AuditLogsPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建一个数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const columns = useMemo(() => auditColumns(locale), [locale]);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Server-side filters (date range + result) drive the fetch; free-text search
  // stays client-side over the returned set (the BFF has no text search).
  useEffect(() => {
    const filters: AuditLogFilters = {};
    const fromIso = localInputToIso(dateFrom);
    const toIso = localInputToIso(dateTo);
    if (fromIso) filters.from = fromIso;
    if (toIso) filters.to = toIso;
    if (resultFilter !== "all") filters.result = resultFilter;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchAuditLogs(filters)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          setLogs([]);
          setLoadError(
            error instanceof Error ? error.message : "审计日志读取失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resultFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.trim().toLowerCase();
    return logs.filter((l) => auditLogSearchText(l).includes(q));
  }, [logs, search]);

  const pageLogs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handleResultFilter = (v: ResultFilter) => {
    setResultFilter(v);
    setPage(1);
  };
  const handleReset = () => {
    setSearch("");
    setResultFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };
  // 导出以选中项为对象（工具行契约）：没选就没有导出的对象。
  const handleExport = () => {
    exportRowsToCsv(
      "audit-logs-export",
      AUDIT_CSV_COLUMNS,
      filtered.filter((log) => selectedIds.has(log.id)),
    );
  };

  return (
    <ListPageTemplate
      className={joinClasses("vx-tenant-management-page", "vx-audit-page")}
      header={
        <PageHeader
          icon="info"
          title="审计日志"
          description="追溯运营后台关键操作，按操作员、时间和对象筛选审计记录。"
        />
      }
      summary={
        <>
          {" "}
          <AuditSummary logs={logs} />
        </>
      }
      filters={
        <AuditToolbar
          search={search}
          resultFilter={resultFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          total={filtered.length}
          exportDisabled={selectedIds.size === 0}
          onSearchChange={handleSearch}
          onResultFilterChange={handleResultFilter}
          onDateFromChange={(v) => {
            setDateFrom(v);
            setPage(1);
          }}
          onDateToChange={(v) => {
            setDateTo(v);
            setPage(1);
          }}
          onReset={handleReset}
          onExport={handleExport}
        />
      }
      table={
        <DataTable
          columns={columns}
          rows={pageLogs}
          rowKey={(log) => log.id}
          loading={loading}
          indexStart={(page - 1) * PAGE_SIZE + 1}
          selectedKeys={[...selectedIds]}
          onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
          empty={
            <EmptyState
              title={loadError ? "审计日志读取失败" : "暂无审计记录"}
              description={
                loadError ??
                (search || resultFilter !== "all" || dateFrom || dateTo
                  ? "尝试调整筛选条件或时间范围"
                  : "后台操作记录将在此处显示")
              }
              action={
                <ActionButton
                  variant="outline"
                  icon="undo"
                  onClick={handleReset}
                >
                  重置筛选
                </ActionButton>
              }
            />
          }
          footer={
            pageCount > 1 ? (
              <Pagination
                page={page}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            ) : null
          }
        />
      }
    />
  );
}
