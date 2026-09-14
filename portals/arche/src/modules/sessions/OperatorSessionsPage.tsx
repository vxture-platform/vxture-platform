"use client";

/**
 * OperatorSessionsPage.tsx — 在线会话：现在谁登录着（只读，现状）。
 * @package @vxture/arche
 * @layer Presentation
 *
 * 在线 = 登录服务里的中央会话仍然有效，本人正在用的这个会话也在其中（标「当前会话」）。
 * 历史——谁在什么时候登没登成、失败、锁定、异常告警——在「安全审计 / 登录记录」。
 *
 * 强制下线复用平台用户的写口（要 `operator:account.manage` 与二次验证），会结束该账号在
 * 三个平台上的全部会话。本人的会话不给这个动作：等级门本就拒绝对自己操作。
 *
 * 列表截在 500 条，排序交给 BFF（`sortParams`），页面只持有排序状态。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  ActionButton,
  ActionMenu,
  Badge,
  DataTable,
  EmptyState,
  MetricGrid,
  TableTitleCell,
  ViewLayout,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, DataTableSort } from "@vxture/design-system";
import {
  fetchOperatorSessionSummary,
  fetchOperatorSessions,
  forcePlatformAdminLogout,
  isStepUpRequiredError,
} from "@/api/arche-bff";
import type {
  OperatorSessionRecord,
  OperatorSessionSummary,
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
const EMPTY_MARK = "—";

/* 登录过的平台：client_id → 平台名。认不出的原样显示。 */
const CLIENT_LABELS: Record<string, string> = {
  admin: "运营平台",
  opera: "运维平台",
  arche: "治理平台",
};

/* 登录方式：登录服务写入中央会话的 authMethod，两步登录写成「一步+二步」
   （如 password+totp）。逐段翻译，认不出的段原样显示。 */
const AUTH_FACTOR_LABELS: Record<string, string> = {
  password: "密码",
  phone: "手机验证码",
  email: "邮箱验证码",
  totp: "验证器",
  webauthn: "通行密钥",
  recovery: "恢复码",
};

function authMethodLabel(method: string): string {
  if (!method) return EMPTY_MARK;
  return method
    .split("+")
    .map((factor) => AUTH_FACTOR_LABELS[factor] ?? factor)
    .join(" + ");
}

function clientsLabel(clients: readonly string[]): string {
  if (clients.length === 0) return EMPTY_MARK;
  return clients.map((id) => CLIENT_LABELS[id] ?? id).join("、");
}

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
          title={row.operatorName ?? "已删除的账号"}
          titleSuffix={row.isCurrent ? <Badge>当前会话</Badge> : null}
          description={row.username ? `@${row.username}` : EMPTY_MARK}
        />
      ),
    },
    {
      id: "role",
      header: "角色",
      sortable: true,
      cell: (row) => row.roleName ?? EMPTY_MARK,
    },
    {
      id: "clients",
      header: "登录平台",
      sortable: true,
      cell: (row) => clientsLabel(row.clients),
    },
    {
      id: "authMethod",
      header: "登录方式",
      sortable: true,
      cell: (row) => authMethodLabel(row.authMethod),
    },
    {
      id: "startedAt",
      header: "登录时间",
      sortable: true,
      cell: (row) => formatDateTime(row.startedAt, locale),
    },
    {
      id: "expiresAt",
      header: "到期时间",
      sortable: true,
      cell: (row) => formatDateTime(row.expiresAt, locale),
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
  const [sort, setSort] = useState<DataTableSort | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rows, totals] = await Promise.all([
        fetchOperatorSessions(sortParams(sort)),
        fetchOperatorSessionSummary(),
      ]);
      setSessions(rows);
      setSummary(totals);
    } catch (error) {
      setSessions([]);
      setLoadError(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => sessionColumns(locale), [locale]);
  const pageCount = Math.max(1, Math.ceil(sessions.length / pageSize));
  const rows = sessions.slice((page - 1) * pageSize, page * pageSize);

  async function forceLogout(row: OperatorSessionRecord) {
    const name = row.operatorName ?? row.username ?? "该账号";
    try {
      const result = await runWithStepUp(() =>
        forcePlatformAdminLogout(row.operatorId, "在线会话页强制下线"),
      );
      toast({
        tone: "success",
        title: "已强制下线",
        description: `${name} 的 ${formatNumber(result.revoked)} 个会话已结束。`,
      });
      await load();
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
        title="在线会话"
        description="三个平台运营账号当前登录着的会话，含本人。登录历史见「安全审计 / 登录记录」。"
        action={
          <ActionButton
            variant="outline"
            icon="clock-counter-clockwise"
            onClick={() => void load()}
          >
            刷新
          </ActionButton>
        }
      />

      <MetricGrid
        aria-label="在线会话统计"
        columns={2}
        loading={summary === null && loading}
        items={[
          {
            id: "sessions",
            icon: "clock",
            label: "在线会话",
            help: "登录服务里仍然有效的会话。同一账号在不同浏览器登录算多个。",
            value: summary ? formatNumber(summary.activeSessions) : EMPTY_MARK,
          },
          {
            id: "operators",
            icon: "user",
            label: "在线账号",
            help: "至少有一个在线会话的运营账号。",
            value: summary ? formatNumber(summary.onlineOperators) : EMPTY_MARK,
          },
        ]}
      />

      <DataTable
        labels={tableLabels}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.sessionRef}
        loading={loading}
        indexStart={(page - 1) * pageSize + 1}
        {...(sort ? { sort } : {})}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        {...(canManage
          ? {
              rowActions: (row: OperatorSessionRecord) =>
                row.isSelf ? null : (
                  <ActionMenu
                    label={`${row.operatorName ?? row.username ?? "会话"} 操作`}
                    items={[
                      {
                        id: "force-logout",
                        label: "强制下线",
                        icon: "sign-out",
                        danger: true,
                        confirm: withLabels({
                          verb: "强制下线",
                          target: `「${row.operatorName ?? row.username ?? "该账号"}」`,
                          consequence:
                            "结束该账号在三个平台上的全部会话，对方需要重新登录。",
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
            title={loadError ? "在线会话读取失败" : "当前没有在线会话"}
            {...(loadError ? { description: loadError } : {})}
          />
        }
        footer={
          <ListPagination
            currentPage={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={sessions.length}
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
