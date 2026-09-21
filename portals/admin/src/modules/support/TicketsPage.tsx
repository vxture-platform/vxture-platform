"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
import { useRouter } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Input,
  Label,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import { changeTicketStatus, fetchSupportTicketsStrict } from "@/api/admin-bff";
import type { TicketStatusInput } from "@/api/admin-bff";
import type {
  SupportTicketRecord,
  TenantOperationTicket,
} from "@/entities/console";
import { TICKET_STATUSES } from "@vxture-platform/shared";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_TONE,
} from "@/modules/shared/tenant-tone";
import {
  useTicketPriorityLabels,
  useTicketStatusLabels,
} from "@/modules/shared/enum-labels";
import {
  formatNumber,
  ticketStatusLabel,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { formatDateTime } from "@vxture-platform/shared";

type TicketStatusFilter = "all" | TenantOperationTicket["status"];
type TicketPriorityFilter = "all" | TenantOperationTicket["priority"];

function ticketStatusIcon(status: TenantOperationTicket["status"]): IconName {
  if (status === "open") return "clock";
  if (status === "processing") return "settings";
  if (status === "blocked") return "warning";
  return "check";
}

function ticketSearchText(ticket: SupportTicketRecord) {
  return [
    ticket.id,
    ticket.title,
    ticket.status,
    ticket.priority,
    ticket.tenantName,
    ticket.tenantCode,
    ticket.region,
    ticket.industry,
    ticket.ownerName,
  ]
    .join(" ")
    .toLowerCase();
}

function TicketActionsMenu({ ticket }: { ticket: SupportTicketRecord }) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${ticket.title} 工单操作`}
        items={[
          {
            id: "detail",
            label: "工单详情",
            icon: "chat-circle",
            onSelect: () =>
              router.push(`/tickets/${encodeURIComponent(ticket.id)}`),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(ticket.tenantCode)}`),
          },
          {
            id: "ops-todos",
            label: "待办任务",
            icon: "table",
            onSelect: () => router.push("/ops-todos"),
          },
        ]}
      />
    </div>
  );
}

/** 工单号只在租户内唯一，行 key 必须带上租户。 */
function ticketKey(ticket: SupportTicketRecord) {
  return `${ticket.tenantId}-${ticket.id}`;
}

/**
 * 三枚标是三件不同的事，各自取色，不共用一个 `ticketTone()`。
 *
 * 原先它们全走 `vx-commercial-pill--*`，而那族色调**一个都没生效**——实测三种
 * 状态计算出来是同一个蓝灰（2026-08-06 登录态走查）。两条独立的原因叠在一起：
 *
 * 1. **文字色**：`Badge variant="outline"` 带 `text-foreground`，Tailwind 的
 *    utilities 层压过 admin CSS 的 `layer(components)`，于是**每一枚 pill 的
 *    文字色都失效**，无论哪个修饰符都是近黑。
 * 2. **背景色**：outline 不设背景，背景归 pill CSS 管；但基类 `.vx-tenant-pill`
 *    自带背景，且在 `globals.css` 里排第 34 行，而本族色调随
 *    `admin-management.css` 在第 32 行——**同层同特异度，后写的赢**，基类把它
 *    前面定义的所有修饰符背景压死。排在基类之后的族（admin-roles 等）反而正常。
 *
 * 这类"看着还活着的死类"搜不出来：类名有引用、文件有导入、选择器也匹配得上，
 * 只有量计算样式才知道它被压掉了。判死码不能只看引用（同 §十三 的模板拼接那条）。
 */
function useTicketColumns(): DataTableColumn<SupportTicketRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();
  const priorityLabels = useTicketPriorityLabels();

  return [
    {
      id: "ticket",
      header: "工单",
      cell: (ticket) => (
        <TableTitleCell
          icon="ticket"
          title={ticket.title}
          description={`${ticket.id} / ${ticket.ownerName}`}
          /* 2026-09-21：原先点标题跳的是**租户**页。首列的标题是这一行代表的
             对象，点它该打开这张工单——租户另有一列，也另有一条行操作。 */
          onTitleClick={() =>
            router.push(`/tickets/${encodeURIComponent(ticket.id)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (ticket) => (
        <TableTitleCell
          icon={
            ticket.tenantType === "company" ? "buildings" : "building-office"
          }
          title={ticket.tenantName}
          description={`${ticket.tenantCode} / ${typeLabel(ticket.tenantType)}`}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (ticket) => (
        <StatusBadge
          tone={TICKET_STATUS_TONE[ticket.status]}
          icon={ticketStatusIcon(ticket.status)}
        >
          {ticketStatusLabel(ticket.status)}
        </StatusBadge>
      ),
    },
    {
      id: "tags",
      header: "标签",
      align: "center",
      cell: (ticket) => (
        <span className="inline-flex flex-wrap justify-center gap-2xs">
          <StatusBadge tone={TICKET_PRIORITY_TONE[ticket.priority]}>
            {priorityLabels[ticket.priority]}
          </StatusBadge>
          {/* 行业是类目，没有严重度，用朴素 Badge——理由同 publish-tone.ts 文件尾。 */}
          <Badge variant="outline">{ticket.industry}</Badge>
        </span>
      ),
    },
    {
      id: "updated",
      header: tShared("columns.updatedAt"),
      cell: (ticket) => (
        <TableTitleCell
          layout="stacked"
          title={formatDateTime(ticket.updatedAt, locale)}
          description={ticket.region}
        />
      ),
    },
  ];
}

export function TicketsPage() {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const ticketStatusInputLabels = useTicketStatusLabels();
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TicketStatusFilter>("all");
  const [priority, setPriority] = useState<TicketPriorityFilter>("all");
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchStatusOpen, setBatchStatusOpen] = useState(false);
  const [batchStatusValue, setBatchStatusValue] =
    useState<TicketStatusInput>("in_progress");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setLoadError(null);

    fetchSupportTicketsStrict()
      .then((records) => {
        if (!cancelled) {
          setTickets(records);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTickets([]);
          setLoadError(
            error instanceof Error ? error.message : "工单数据读取失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTickets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesQuery =
        !normalizedQuery || ticketSearchText(ticket).includes(normalizedQuery);
      return (
        matchesQuery &&
        (status === "all" || ticket.status === status) &&
        (priority === "all" || ticket.priority === priority)
      );
    });
  }, [priority, query, status, tickets]);

  const openTickets = tickets.filter((ticket) => ticket.status !== "closed");
  const urgentTickets = tickets.filter(
    (ticket) => ticket.priority === "p0" || ticket.priority === "p1",
  );
  const blockedTickets = tickets.filter(
    (ticket) => ticket.status === "blocked",
  );
  const affectedTenants = new Set(openTickets.map((ticket) => ticket.tenantId))
    .size;

  const ticketColumns = useTicketColumns();

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setPriority("all");
  }

  const selectedTickets = tickets.filter((ticket) =>
    selectedTicketIds.has(`${ticket.tenantId}-${ticket.id}`),
  );

  async function handleBatchStatus() {
    if (!selectedTickets.length) return;
    setBatchSubmitting(true);
    setBatchError(null);

    const results = await Promise.allSettled(
      selectedTickets.map((ticket) =>
        changeTicketStatus(ticket.id, { status: batchStatusValue }),
      ),
    );

    const updatedById = new Map<string, SupportTicketRecord>();
    let failed = 0;
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        updatedById.set(result.value.id, result.value);
      } else {
        failed += 1;
      }
    });

    if (updatedById.size) {
      setTickets((current) =>
        current.map((ticket) => updatedById.get(ticket.id) ?? ticket),
      );
    }

    setBatchSubmitting(false);
    if (failed > 0) {
      setBatchError(`${failed} 个工单更新失败`);
    } else {
      setBatchStatusOpen(false);
      setSelectedTicketIds(new Set());
    }
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-tickets-page"
        header={
          <PageHeader
            icon="chat-circle"
            eyebrow="客户服务"
            title="工单中心"
            description="聚合租户侧待处理工单，按优先级、阻塞状态和更新时间推进支持闭环。"
            secondary={<Badge>只读聚合</Badge>}
          />
        }
        summary={
          <MetricGrid
            loading={isLoading}
            aria-label="工单统计"
            items={[
              {
                id: "open",
                help: "状态不为已关闭的工单。",
                icon: "chat-circle",
                label: "未关闭工单",
                value: formatNumber(openTickets.length),
                tags: [`影响租户 ${formatNumber(affectedTenants)}`],
                tone: openTickets.length ? "warning" : "success",
              },
              {
                id: "urgent",
                help: "优先级为 P0 或 P1 的工单。",
                icon: "warning",
                label: "P0/P1 工单",
                value: formatNumber(urgentTickets.length),
                tags: ["优先处理"],
                tone: urgentTickets.length ? "danger" : "success",
              },
              {
                id: "blocked",
                help: "状态为阻塞中、等待外部条件的工单。",
                icon: "clock",
                label: "阻塞中",
                value: formatNumber(blockedTickets.length),
                tags: ["需要协同"],
                tone: blockedTickets.length ? "danger" : "success",
              },
              {
                id: "total",
                help: "当前筛选条件下的工单条数。",
                icon: "table",
                label: "工单总数",
                value: formatNumber(tickets.length),
                tags: ["来自工单数据库"],
              },
            ]}
          />
        }
        filters={
          /* 走 DS FilterBar（owner 2026-09-21：搜索/筛选字号偏大）。手搓的 flex 行
             拿不到 FilterBar 给子控件降一档的那份契约（它第 49~51 行），于是
             落回 DS 表单字段的默认 `text-body-lg md:text-body-md`。 */
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            aria-label="工单筛选"
            count={formatNumber(visibleTickets.length)}
            search={
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工单、租户、行业、负责人"
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label="搜索工单"
              />
            }
            onReset={resetFilters}
          >
            {/* 裸 <label aria-label> 去掉：aria-label 挂在 label 上不会标注里面的
                select，无障碍上是空的。NativeSelect 自己收 aria-label 才有效。 */}
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as TicketStatusFilter)
              }
              aria-label="工单状态"
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="open">{tShared("status.generic.pending")}</option>
              <option value="processing">
                {tShared("status.generic.processing")}
              </option>
              <option value="blocked">搁置</option>
              <option value="closed">完成</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TicketPriorityFilter)
              }
              aria-label="工单优先级"
            >
              {/* 「全部」而不是「全部优先级」：长词会顶到下拉箭头底下，
                  owner 2026-09-20 在待办页实看过同一件事。 */}
              <option value="all">全部</option>
              <option value="p0">P0</option>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
              <option value="p3">P3</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs vx-ticket-directory"
            aria-label="工单列表"
          >
            <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
              <strong>工单队列</strong>
              <span>{formatNumber(visibleTickets.length)} 条匹配</span>
            </header>
            {selectedTickets.length ? (
              <div
                className="flex min-w-0 items-center gap-md py-md max-xl:flex-wrap max-lg:items-stretch"
                aria-label="工单批量操作"
              >
                <span>已选 {formatNumber(selectedTickets.length)} 条</span>
                <div className="flex-1 max-lg:hidden" aria-hidden="true" />
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setBatchError(null);
                    setBatchStatusOpen(true);
                  }}
                >
                  批量改状态
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setSelectedTicketIds(new Set())}
                >
                  清空选择
                </Button>
              </div>
            ) : null}
            {/* 读取失败是第三态，DataTable 只认加载/空/有数据，故留在外层。 */}
            {loadError ? (
              <EmptyState title="工单数据读取失败" description={loadError} />
            ) : (
              <DataTable
                labels={tableLabels}
                columns={ticketColumns}
                rows={visibleTickets}
                rowKey={ticketKey}
                loading={isLoading}
                indexStart={1}
                selectedKeys={[...selectedTicketIds]}
                onSelectionChange={(keys) =>
                  setSelectedTicketIds(new Set(keys))
                }
                rowActions={(ticket) => <TicketActionsMenu ticket={ticket} />}
                empty={
                  <EmptyState
                    title="没有匹配的工单"
                    description="调整筛选条件，或重置后查看全部工单。"
                    action={
                      <Button variant="outline" onClick={resetFilters}>
                        重置
                      </Button>
                    }
                  />
                }
              />
            )}
          </section>
        }
      />

      {batchStatusOpen ? (
        <DialogForm
          open
          size="sm"
          title="批量变更工单状态"
          description={`将对已选 ${formatNumber(selectedTickets.length)} 条工单应用新状态。`}
          submitLabel="确认变更"
          cancelLabel={tShared("actions.cancel")}
          submitting={batchSubmitting}
          submitDisabled={selectedTickets.length === 0}
          onOpenChange={(open) => {
            if (!open) setBatchStatusOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleBatchStatus();
          }}
        >
          <Label htmlFor="vx-ticket-batch-status">目标状态</Label>
          <NativeSelect
            id="vx-ticket-batch-status"
            value={batchStatusValue}
            onChange={(event) =>
              setBatchStatusValue(event.target.value as TicketStatusInput)
            }
          >
            {TICKET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ticketStatusInputLabels[value]}
              </option>
            ))}
          </NativeSelect>
          {batchError ? (
            <p className="text-sm text-vx-danger">{batchError}</p>
          ) : null}
        </DialogForm>
      ) : null}
    </>
  );
}
