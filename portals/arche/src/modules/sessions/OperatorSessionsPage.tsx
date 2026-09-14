"use client";

/**
 * OperatorSessionsPage.tsx — 登录与会话：在线会话 + 登录记录（只读）。
 * @package @vxture/arche
 * @layer Presentation
 *
 * 「平台用户」页能对单个人强制下线，却回答不了「现在谁在线」「昨晚有没有人在撞密码」。
 * 本页只回答这两个问题。强制下线复用平台用户的写口（要 `operator:account.manage` 与
 * 二次验证），没有这个码的人看得见会话、看不到那个动作。
 *
 * 两张表都截在 500 条，排序交给 BFF（`sortParams`），页面只持有排序状态。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  ActionButton,
  ActionMenu,
  DataTable,
  EmptyState,
  FilterBar,
  MetricGrid,
  NativeSelect,
  SectionHeader,
  StatusBadge,
  TableTitleCell,
  ViewLayout,
  useToast,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  DataTableSort,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  fetchOperatorSessionSummary,
  fetchOperatorSessions,
  fetchOperatorSignIns,
  forcePlatformAdminLogout,
  isStepUpRequiredError,
  type OperatorSignInFilters,
} from "@/api/arche-bff";
import type {
  OperatorSessionRecord,
  OperatorSessionSummary,
  OperatorSignInRecord,
} from "@/entities/console";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { formatDateTime, formatNumber } from "@/lib/format";
import { sortParams } from "@/lib/table-sort";
import { useConfirmLabels } from "@/modules/shared/destructive";
import { ListPagination } from "@/modules/shared/ListPagination";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { useTableLabels } from "@/modules/shared/table";

const ACCOUNT_MANAGE = "operator:account.manage";

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

function sessionColumns(
  locale: string,
): DataTableColumn<OperatorSessionRecord>[] {
  return [
    {
      id: "operator",
      header: "运营账号",
      sortable: true,
      cell: (row) => (
        <TableTitleCell
          icon="user"
          title={row.operatorName}
          description={`@${row.username}`}
        />
      ),
    },
    {
      id: "role",
      header: "角色",
      cell: (row) => row.roleName ?? "—",
    },
    {
      id: "client",
      header: "登录平台",
      sortable: true,
      cell: (row) => row.clientId,
    },
    {
      id: "startedAt",
      header: "登录时间",
      sortable: true,
      cell: (row) => formatDateTime(row.startedAt, locale),
    },
    {
      id: "lastRefreshedAt",
      header: "最近续期",
      sortable: true,
      cell: (row) => formatDateTime(row.lastRefreshedAt, locale),
    },
    {
      id: "expiresAt",
      header: "到期时间",
      sortable: true,
      cell: (row) => formatDateTime(row.expiresAt, locale),
    },
  ];
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
      cell: (row) => row.ipAddress,
    },
    {
      id: "time",
      header: "时间",
      sortable: true,
      cell: (row) => formatDateTime(row.createdAt, locale),
    },
  ];
}

export function OperatorSessionsPage() {
  const locale = useLocale();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const { can } = useOperatorSession();
  const canManage = can(ACCOUNT_MANAGE);

  const [summary, setSummary] = useState<OperatorSessionSummary | null>(null);
  const [sessions, setSessions] = useState<OperatorSessionRecord[]>([]);
  const [sessionSort, setSessionSort] = useState<DataTableSort | undefined>();
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState<PageSize>(10);

  const [signIns, setSignIns] = useState<OperatorSignInRecord[]>([]);
  const [signInSort, setSignInSort] = useState<DataTableSort | undefined>();
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [signInsLoading, setSignInsLoading] = useState(true);
  const [signInsError, setSignInsError] = useState<string | null>(null);
  const [signInPage, setSignInPage] = useState(1);
  const [signInPageSize, setSignInPageSize] = useState<PageSize>(20);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const [rows, totals] = await Promise.all([
        fetchOperatorSessions(sortParams(sessionSort)),
        fetchOperatorSessionSummary(),
      ]);
      setSessions(rows);
      setSummary(totals);
    } catch (error) {
      setSessions([]);
      setSessionsError(error instanceof Error ? error.message : "读取失败");
    } finally {
      setSessionsLoading(false);
    }
  }, [sessionSort]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    let active = true;
    const filters: OperatorSignInFilters = { ...sortParams(signInSort) };
    if (resultFilter !== "all") filters.result = resultFilter;
    setSignInsLoading(true);
    setSignInsError(null);
    fetchOperatorSignIns(filters)
      .then((rows) => {
        if (active) setSignIns(rows);
      })
      .catch((error) => {
        if (!active) return;
        setSignIns([]);
        setSignInsError(error instanceof Error ? error.message : "读取失败");
      })
      .finally(() => {
        if (active) setSignInsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [signInSort, resultFilter]);

  const sessionCols = useMemo(() => sessionColumns(locale), [locale]);
  const signInCols = useMemo(() => signInColumns(locale), [locale]);

  const sessionPageCount = Math.max(
    1,
    Math.ceil(sessions.length / sessionPageSize),
  );
  const sessionRows = sessions.slice(
    (sessionPage - 1) * sessionPageSize,
    sessionPage * sessionPageSize,
  );
  const signInPageCount = Math.max(
    1,
    Math.ceil(signIns.length / signInPageSize),
  );
  const signInRows = signIns.slice(
    (signInPage - 1) * signInPageSize,
    signInPage * signInPageSize,
  );

  async function forceLogout(row: OperatorSessionRecord) {
    try {
      const result = await runWithStepUp(() =>
        forcePlatformAdminLogout(row.operatorId, "登录与会话页强制下线"),
      );
      toast({
        tone: "success",
        title: "已强制下线",
        description: `${row.operatorName} 的 ${formatNumber(result.revoked)} 个会话已吊销。`,
      });
      await loadSessions();
    } catch (error) {
      if (isStepUpCancelled(error)) throw error;
      toast({
        tone: "danger",
        title: isStepUpRequiredError(error) ? "需要二次验证" : "强制下线失败",
        ...(error instanceof Error ? { description: error.message } : {}),
      });
      throw error;
    }
  }

  return (
    <ViewLayout className="w-full">
      <PageHeader
        icon="clock"
        title="登录与会话"
        description="三个平台运营账号的在线会话与登录记录，含失败与锁定。"
      />

      <MetricGrid
        aria-label="登录与会话统计"
        columns={4}
        loading={summary === null}
        items={[
          {
            id: "sessions",
            icon: "clock",
            label: "在线会话",
            help: "仍有未过期刷新令牌的会话。",
            value: formatNumber(summary?.activeSessions ?? 0),
          },
          {
            id: "operators",
            icon: "user",
            label: "在线账号",
            help: "至少有一个在线会话的运营账号。",
            value: formatNumber(summary?.onlineOperators ?? 0),
          },
          {
            id: "failed",
            icon: "x",
            label: "24 小时登录失败",
            help: "最近 24 小时凭证错误、二次验证失败或被锁定的登录尝试；待二次验证不算。",
            value: formatNumber(summary?.failedSignIns24h ?? 0),
            ...((summary?.failedSignIns24h ?? 0) > 0
              ? { tone: "warning" as const }
              : {}),
          },
          {
            id: "locked",
            icon: "shield-check",
            label: "24 小时锁定",
            help: "最近 24 小时因连续失败被锁定的登录尝试。",
            value: formatNumber(summary?.lockedSignIns24h ?? 0),
            ...((summary?.lockedSignIns24h ?? 0) > 0
              ? { tone: "danger" as const }
              : {}),
          },
        ]}
      />

      <section className="grid min-w-0 gap-sm" aria-label="在线会话">
        <SectionHeader level={2} icon="clock" title="在线会话" />
        <DataTable
          labels={tableLabels}
          columns={sessionCols}
          rows={sessionRows}
          rowKey={(row) => row.sessionId}
          loading={sessionsLoading}
          indexStart={(sessionPage - 1) * sessionPageSize + 1}
          {...(sessionSort ? { sort: sessionSort } : {})}
          onSortChange={(next) => {
            setSessionSort(next);
            setSessionPage(1);
          }}
          {...(canManage
            ? {
                rowActions: (row: OperatorSessionRecord) => (
                  <ActionMenu
                    label={`${row.operatorName} 操作`}
                    items={[
                      {
                        id: "force-logout",
                        label: "强制下线",
                        icon: "sign-out",
                        danger: true,
                        confirm: withLabels({
                          verb: "强制下线",
                          target: `「${row.operatorName}」`,
                          consequence:
                            "吊销该账号在三个平台上的全部会话，对方需要重新登录。",
                          onConfirm: () => forceLogout(row),
                        }),
                      },
                    ]}
                  />
                ),
              }
            : {})}
          empty={
            <EmptyState
              title={sessionsError ? "在线会话读取失败" : "当前没有在线会话"}
              {...(sessionsError ? { description: sessionsError } : {})}
            />
          }
          footer={
            <ListPagination
              currentPage={Math.min(sessionPage, sessionPageCount)}
              pageCount={sessionPageCount}
              total={sessions.length}
              pageSize={sessionPageSize}
              onPageSizeChange={(size) => {
                setSessionPageSize(size);
                setSessionPage(1);
              }}
              onPageChange={setSessionPage}
            />
          }
        />
      </section>

      <section className="grid min-w-0 gap-sm" aria-label="登录记录">
        <SectionHeader level={2} icon="list" title="登录记录" />
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={formatNumber(signIns.length)}
          aria-label="登录记录筛选"
          onReset={() => {
            setResultFilter("all");
            setSignInPage(1);
          }}
          actions={
            <ActionButton
              variant="outline"
              icon="clock-counter-clockwise"
              onClick={() => void loadSessions()}
            >
              刷新会话
            </ActionButton>
          }
        >
          <NativeSelect
            wrapperClassName="w-fit basis-media-xl"
            value={resultFilter}
            onChange={(event) => {
              setResultFilter(event.target.value as ResultFilter);
              setSignInPage(1);
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
          columns={signInCols}
          rows={signInRows}
          rowKey={(row) => row.id}
          loading={signInsLoading}
          indexStart={(signInPage - 1) * signInPageSize + 1}
          {...(signInSort ? { sort: signInSort } : {})}
          onSortChange={(next) => {
            setSignInSort(next);
            setSignInPage(1);
          }}
          empty={
            <EmptyState
              title={signInsError ? "登录记录读取失败" : "没有匹配的登录记录"}
              {...(signInsError ? { description: signInsError } : {})}
            />
          }
          footer={
            <ListPagination
              currentPage={Math.min(signInPage, signInPageCount)}
              pageCount={signInPageCount}
              total={signIns.length}
              pageSize={signInPageSize}
              onPageSizeChange={(size) => {
                setSignInPageSize(size);
                setSignInPage(1);
              }}
              onPageChange={setSignInPage}
            />
          }
        />
      </section>
    </ViewLayout>
  );
}
