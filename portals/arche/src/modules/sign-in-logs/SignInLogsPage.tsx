"use client";

/**
 * SignInLogsPage.tsx — 登录记录：运营账号的每一次登录尝试（只读，历史）。
 * @package @vxture/arche
 * @layer Presentation
 *
 * 从「登录与会话」拆出来归「安全审计」：在线会话回答「现在谁登录着」，本页回答「谁在
 * 什么时候、从哪儿、登没登成」。异常登录与失败激增的告警由登录服务写进审计日志，这里
 * 给 24 小时计数，明细去审计日志看（`/audit-logs?result=alert`）。
 *
 * 列表截在 500 条，排序与结果、时间筛选交给 BFF，页面只持有状态。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  ViewLayout,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  DataTableSort,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  fetchSignInLogSummary,
  fetchSignInLogs,
  type SignInLogFilters,
} from "@/api/arche-bff";
import type {
  OperatorSignInRecord,
  SignInLogSummary,
} from "@/entities/console";
import { formatDateTime, formatNumber } from "@/lib/format";
import { sortParams } from "@/lib/table-sort";
import { ListPagination } from "@/modules/shared/ListPagination";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { useTableLabels } from "@/modules/shared/table";

const EMPTY_MARK = "—";

/* 词表照登录服务实际写入的值（auth-bff recordOperatorAttempt）。认不出的值原样显示。 */
const RESULT_LABELS: Record<string, string> = {
  success: "成功",
  mfa_required: "待二次验证",
  bad_credential: "凭证错误",
  mfa_failed: "二次验证失败",
  locked: "已锁定",
};

function resultTone(result: string): StatusBadgeTone {
  if (result === "success") return "success";
  /* 密码已过、等二次验证：正常中间步骤，不是失败。 */
  if (result === "mfa_required") return "neutral";
  if (result === "locked") return "danger";
  return "warning";
}

type ResultFilter = "all" | "success" | "failure";

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function signInColumns(
  locale: string,
): DataTableColumn<OperatorSignInRecord>[] {
  return [
    {
      id: "operator",
      header: "运营账号",
      sortable: true,
      cell: (row) => (
        <TableTitleCell
          icon="user"
          title={row.operatorName ?? row.identifier}
          description={row.operatorName ? row.identifier : "未匹配到账号"}
        />
      ),
    },
    {
      id: "method",
      header: "方式",
      sortable: true,
      cell: (row) => row.authMethod,
    },
    {
      id: "result",
      header: "结果",
      sortable: true,
      cell: (row) => (
        <StatusBadge tone={resultTone(row.result)}>
          {RESULT_LABELS[row.result] ?? row.result}
        </StatusBadge>
      ),
    },
    {
      id: "ip",
      header: "IP",
      sortable: true,
      cell: (row) => (
        <span title={row.userAgent ?? undefined}>
          {row.ipAddress || EMPTY_MARK}
        </span>
      ),
    },
    {
      id: "time",
      header: "时间",
      sortable: true,
      cell: (row) => formatDateTime(row.createdAt, locale),
    },
  ];
}

export function SignInLogsPage() {
  const locale = useLocale();
  const router = useRouter();
  const tableLabels = useTableLabels();

  const [summary, setSummary] = useState<SignInLogSummary | null>(null);
  const [rows, setRows] = useState<OperatorSignInRecord[]>([]);
  const [sort, setSort] = useState<DataTableSort | undefined>();
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    fetchSignInLogSummary()
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch(() => {
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    const filters: SignInLogFilters = { ...sortParams(sort) };
    if (resultFilter !== "all") filters.result = resultFilter;
    const fromIso = localInputToIso(dateFrom);
    const toIso = localInputToIso(dateTo);
    if (fromIso) filters.from = fromIso;
    if (toIso) filters.to = toIso;
    setLoading(true);
    setLoadError(null);
    fetchSignInLogs(filters)
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((error) => {
        if (!active) return;
        setRows([]);
        setLoadError(error instanceof Error ? error.message : "读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sort, resultFilter, dateFrom, dateTo, reloadKey]);

  const columns = useMemo(() => signInColumns(locale), [locale]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const alerts = summary?.alerts24h ?? 0;

  return (
    <ViewLayout className="w-full">
      <PageHeader
        icon="list"
        title="登录记录"
        description="三个平台运营账号的每一次登录尝试，含失败、锁定与异常告警。当前在线见「身份权限 / 在线会话」。"
        action={
          <ActionButton
            variant="outline"
            icon="shield-check"
            onClick={() => router.push("/audit-logs?result=alert")}
          >
            查看登录告警
          </ActionButton>
        }
      />

      <MetricGrid
        aria-label="登录记录统计"
        columns={3}
        loading={summary === null && loading}
        items={[
          {
            id: "failed",
            icon: "x",
            label: "24 小时登录失败",
            help: "最近 24 小时凭证错误、二次验证失败或被锁定的登录尝试；待二次验证不算。",
            value: summary ? formatNumber(summary.failed24h) : EMPTY_MARK,
            ...((summary?.failed24h ?? 0) > 0
              ? { tone: "warning" as const }
              : {}),
          },
          {
            id: "locked",
            icon: "shield-check",
            label: "24 小时锁定",
            help: "最近 24 小时因连续失败被锁定的登录尝试。",
            value: summary ? formatNumber(summary.locked24h) : EMPTY_MARK,
            ...((summary?.locked24h ?? 0) > 0
              ? { tone: "danger" as const }
              : {}),
          },
          {
            id: "alerts",
            icon: "warning",
            label: "24 小时登录告警",
            help: "异常登录（新地点、新设备）与二次验证失败激增。登录服务同时邮件提醒本人；明细在审计日志。",
            value: summary ? formatNumber(alerts) : EMPTY_MARK,
            ...(alerts > 0 ? { tone: "danger" as const } : {}),
          },
        ]}
      />

      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason="卡片视图已下线，改用列表"
        count={formatNumber(rows.length)}
        aria-label="登录记录筛选"
        onReset={() => {
          setResultFilter("all");
          setDateFrom("");
          setDateTo("");
          setPage(1);
        }}
        actions={
          <ActionButton
            variant="outline"
            icon="clock-counter-clockwise"
            onClick={reload}
          >
            刷新
          </ActionButton>
        }
      >
        <Input
          type="datetime-local"
          className="w-fit"
          value={dateFrom}
          onChange={(event) => {
            setDateFrom(event.target.value);
            setPage(1);
          }}
          aria-label="起始时间"
          title="起始时间"
        />
        <Input
          type="datetime-local"
          className="w-fit"
          value={dateTo}
          onChange={(event) => {
            setDateTo(event.target.value);
            setPage(1);
          }}
          aria-label="截止时间"
          title="截止时间"
        />
        <NativeSelect
          wrapperClassName="w-fit basis-media-xl"
          value={resultFilter}
          onChange={(event) => {
            setResultFilter(event.target.value as ResultFilter);
            setPage(1);
          }}
          aria-label="登录结果"
        >
          <option value="all">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败（含锁定）</option>
        </NativeSelect>
      </FilterBar>

      <DataTable
        labels={tableLabels}
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        loading={loading}
        indexStart={(page - 1) * pageSize + 1}
        {...(sort ? { sort } : {})}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        empty={
          <EmptyState
            title={loadError ? "登录记录读取失败" : "没有匹配的登录记录"}
            {...(loadError ? { description: loadError } : {})}
          />
        }
        footer={
          <ListPagination
            currentPage={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={rows.length}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            onPageChange={setPage}
          />
        }
      />
    </ViewLayout>
  );
}
