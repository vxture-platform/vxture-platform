"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  DialogForm,
  Drawer,
  EmptyState,
  Input,
  Label,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import {
  AdminBffError,
  addTicketComment,
  assignTicket,
  changeTicketStatus,
  fetchSupportTicketsStrict,
  fetchTicket,
  fetchTicketComments,
} from "@/api/admin-bff";
import type { TicketStatusInput } from "@/api/admin-bff";
import type {
  SupportTicketRecord,
  TenantOperationTicket,
  TicketCommentRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_TONE,
} from "@/modules/shared/tenant-tone";
import {
  formatNumber,
  ticketStatusLabel,
  typeLabel,
} from "@/modules/tenants/tenant-utils";

type TicketStatusFilter = "all" | TenantOperationTicket["status"];
type TicketPriorityFilter = "all" | TenantOperationTicket["priority"];

const priorityLabels: Record<TenantOperationTicket["priority"], string> = {
  p0: "P0 紧急",
  p1: "P1 高",
  p2: "P2 中",
  p3: "P3 低",
};

const ticketStatusInputLabels: Record<TicketStatusInput, string> = {
  open: "待处理",
  pending: "挂起",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
  reopened: "重新打开",
  cancelled: "已取消",
};

const TICKET_STATUS_INPUT_ORDER: TicketStatusInput[] = [
  "open",
  "pending",
  "in_progress",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
];

function ticketEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "comment":
      return "回复";
    case "assign":
    case "assignment":
      return "指派";
    case "status_change":
    case "status":
      return "状态变更";
    case "created":
      return "创建";
    default:
      return eventType;
  }
}

function ticketEventBodyText(event: TicketCommentRecord): string | null {
  const payload = event.payload ?? {};
  const candidate =
    payload.body ?? payload.note ?? payload.comment ?? payload.message;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }
  if (typeof payload.status === "string") {
    const label =
      ticketStatusInputLabels[payload.status as TicketStatusInput] ??
      payload.status;
    return `→ ${label}`;
  }
  if (typeof payload.assigneeName === "string") {
    return `指派给 ${payload.assigneeName}`;
  }
  return null;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

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

function TicketActionsMenu({
  ticket,
  onOpenDetail,
}: {
  ticket: SupportTicketRecord;
  onOpenDetail: (ticket: SupportTicketRecord) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${ticket.title} 工单操作`}
        items={[
          {
            id: "detail",
            label: "工单详情",
            icon: "chat-circle",
            onSelect: () => onOpenDetail(ticket),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(ticket.tenantId)}`),
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
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "ticket",
      header: "工单",
      cell: (ticket) => (
        <TableTitleCell
          title={ticket.title}
          description={`${ticket.id} / ${ticket.ownerName}`}
          onTitleClick={() =>
            router.push(`/tenants/${encodeURIComponent(ticket.tenantId)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (ticket) => (
        <TableTitleCell
          icon={ticket.tenantType === "company" ? "buildings" : "user"}
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
          title={formatDateTime(ticket.updatedAt)}
          description={ticket.region}
        />
      ),
    },
  ];
}

function TicketAssignDialog({
  ticket,
  onClose,
  onAssigned,
}: {
  ticket: SupportTicketRecord;
  onClose: () => void;
  onAssigned: (updated: SupportTicketRecord) => void;
}) {
  const tShared = useTranslations();
  const [assigneeId, setAssigneeId] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    assigneeId.trim().length > 0 && assigneeName.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedNote = note.trim();
      const updated = await assignTicket(ticket.id, {
        assigneeId: assigneeId.trim(),
        assigneeName: assigneeName.trim(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      onAssigned(updated);
    } catch (err) {
      setError(err instanceof AdminBffError ? err.message : "指派失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      title="指派工单"
      description={
        <>
          工单：<strong>{ticket.title}</strong>
        </>
      }
      submitLabel="确认指派"
      cancelLabel={tShared("actions.cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={handleSubmit}
    >
      <Label htmlFor="vx-ticket-assignee-id">受理人 ID</Label>
      <Input
        id="vx-ticket-assignee-id"
        value={assigneeId}
        onChange={(event) => setAssigneeId(event.target.value)}
        placeholder="受理人账号 ID"
        autoFocus
      />
      <Label htmlFor="vx-ticket-assignee-name">受理人名称</Label>
      <Input
        id="vx-ticket-assignee-name"
        value={assigneeName}
        onChange={(event) => setAssigneeName(event.target.value)}
        placeholder="受理人显示名"
      />
      <Label htmlFor="vx-ticket-assign-note">
        备注 <small>（可选）</small>
      </Label>
      <Textarea
        id="vx-ticket-assign-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder="指派说明…"
      />
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
    </DialogForm>
  );
}

function TicketStatusDialog({
  ticket,
  onClose,
  onChanged,
}: {
  ticket: SupportTicketRecord;
  onClose: () => void;
  onChanged: (updated: SupportTicketRecord) => void;
}) {
  const tShared = useTranslations();
  const [status, setStatus] = useState<TicketStatusInput>("in_progress");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmedNote = note.trim();
      const updated = await changeTicketStatus(ticket.id, {
        status,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      onChanged(updated);
    } catch (err) {
      setError(
        err instanceof AdminBffError ? err.message : "状态变更失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      title="变更工单状态"
      description={
        <>
          工单：<strong>{ticket.title}</strong>
        </>
      }
      submitLabel="确认变更"
      cancelLabel={tShared("actions.cancel")}
      submitting={submitting}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={handleSubmit}
    >
      <Label htmlFor="vx-ticket-status">目标状态</Label>
      <NativeSelect
        id="vx-ticket-status"
        value={status}
        onChange={(event) => setStatus(event.target.value as TicketStatusInput)}
      >
        {TICKET_STATUS_INPUT_ORDER.map((value) => (
          <option key={value} value={value}>
            {ticketStatusInputLabels[value]}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor="vx-ticket-status-note">
        备注 <small>（可选）</small>
      </Label>
      <Textarea
        id="vx-ticket-status-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder="状态变更说明…"
      />
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
    </DialogForm>
  );
}

function TicketDetailDrawer({
  ticketId,
  onClose,
  onTicketUpdated,
}: {
  ticketId: string;
  onClose: () => void;
  onTicketUpdated: (updated: SupportTicketRecord) => void;
}) {
  const tShared = useTranslations();
  const [detail, setDetail] = useState<SupportTicketRecord | null>(null);
  const [comments, setComments] = useState<TicketCommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const reloadComments = useCallback(async () => {
    const list = await fetchTicketComments(ticketId);
    setComments(list);
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchTicket(ticketId), fetchTicketComments(ticketId)])
      .then(([ticket, list]) => {
        if (!cancelled) {
          setDetail(ticket);
          setComments(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "工单详情读取失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  function applyUpdated(updated: SupportTicketRecord) {
    setDetail(updated);
    onTicketUpdated(updated);
    void reloadComments();
  }

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      await addTicketComment(ticketId, body);
      setReplyBody("");
      await reloadComments();
    } catch (err) {
      setReplyError(
        err instanceof AdminBffError ? err.message : "回复失败，请重试",
      );
    } finally {
      setReplySubmitting(false);
    }
  }

  const title = detail ? detail.title : "工单详情";
  const fields = detail
    ? [
        { label: "工单编号", value: detail.id },
        {
          label: tShared("columns.state"),
          value: ticketStatusLabel(detail.status),
        },
        { label: "优先级", value: priorityLabels[detail.priority] },
        { label: "租户", value: `${detail.tenantName} / ${detail.tenantCode}` },
        { label: "负责人", value: detail.ownerName },
        { label: "行业", value: detail.industry },
        { label: "地区", value: detail.region },
        {
          label: tShared("columns.updatedAt"),
          value: formatDateTime(detail.updatedAt),
        },
      ]
    : undefined;

  return (
    /* DS 的 `DetailDrawer` 在分类重构里被拆成两件：容器归 `Drawer`（自带遮罩、
     * 关闭按钮、焦点管理），字段表归 `DetailList`/`DetailRow`。原先那件把两者
     * 焊死，字段只能走 `fields` 数组、值只能是纯文本；拆开后字段值可以是
     * 「文本 + StatusBadge」这类就地拼的表达式。 */
    <Drawer open onClose={onClose} title={title}>
      {fields ? (
        <DetailList>
          {fields.map((field) => (
            <DetailRow key={field.label} label={field.label}>
              {field.value}
            </DetailRow>
          ))}
        </DetailList>
      ) : null}
      {loading ? (
        <EmptyState
          title="正在加载工单详情"
          description="正在读取工单与时间线。"
        />
      ) : error ? (
        <EmptyState title="工单详情读取失败" description={error} />
      ) : detail ? (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => setAssignOpen(true)}
            >
              指派
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => setStatusOpen(true)}
            >
              改状态
            </Button>
          </div>

          <div className="grid gap-3">
            <strong>处理时间线</strong>
            {comments.length ? (
              <ol className="grid gap-3">
                {comments.map((event) => {
                  const bodyText = ticketEventBodyText(event);
                  return (
                    <li key={event.id} className="grid gap-1">
                      <span>
                        <Badge>{ticketEventTypeLabel(event.eventType)}</Badge>{" "}
                        <strong>{event.actorName}</strong>{" "}
                        <small>{formatDateTime(event.createdAt)}</small>
                      </span>
                      {bodyText ? <p>{bodyText}</p> : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p>
                <small>暂无时间线记录。</small>
              </p>
            )}
          </div>

          <form className="grid gap-2" onSubmit={handleReply}>
            <Label htmlFor="vx-ticket-reply">回复工单</Label>
            <Textarea
              id="vx-ticket-reply"
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              rows={3}
              placeholder="输入回复内容…"
            />
            {replyError ? (
              <p className="text-sm text-vx-danger">{replyError}</p>
            ) : null}
            <div>
              <Button
                type="submit"
                size="md"
                disabled={replySubmitting || replyBody.trim().length === 0}
              >
                {replySubmitting ? "处理中..." : "回复"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {assignOpen && detail ? (
        <TicketAssignDialog
          ticket={detail}
          onClose={() => setAssignOpen(false)}
          onAssigned={(updated) => {
            applyUpdated(updated);
            setAssignOpen(false);
          }}
        />
      ) : null}
      {statusOpen && detail ? (
        <TicketStatusDialog
          ticket={detail}
          onClose={() => setStatusOpen(false)}
          onChanged={(updated) => {
            applyUpdated(updated);
            setStatusOpen(false);
          }}
        />
      ) : null}
    </Drawer>
  );
}

export function TicketsPage() {
  const tShared = useTranslations();
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TicketStatusFilter>("all");
  const [priority, setPriority] = useState<TicketPriorityFilter>("all");
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
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

  function applyTicketUpdate(updated: SupportTicketRecord) {
    setTickets((current) =>
      current.map((ticket) => (ticket.id === updated.id ? updated : ticket)),
    );
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
        className="vx-tenant-management-page vx-tickets-page"
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
          <section className="vx-tenant-toolbar" aria-label="工单筛选">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工单、租户、行业、负责人"
              className="vx-tenant-search vx-commercial-search"
              aria-label="搜索工单"
            />
            <div className="vx-tenant-toolbar__spacer" aria-hidden="true" />
            <label aria-label="状态筛选">
              <NativeSelect
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TicketStatusFilter)
                }
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="open">
                  {tShared("status.generic.pending")}
                </option>
                <option value="processing">
                  {tShared("status.generic.processing")}
                </option>
                <option value="blocked">搁置</option>
                <option value="closed">完成</option>
              </NativeSelect>
            </label>
            <label aria-label="优先级筛选">
              <NativeSelect
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TicketPriorityFilter)
                }
              >
                <option value="all">全部优先级</option>
                <option value="p0">P0</option>
                <option value="p1">P1</option>
                <option value="p2">P2</option>
                <option value="p3">P3</option>
              </NativeSelect>
            </label>
            <Button variant="outline" size="md" onClick={resetFilters}>
              重置
            </Button>
          </section>
        }
        table={
          <section
            className="vx-tenant-directory vx-ticket-directory"
            aria-label="工单列表"
          >
            <header className="vx-tenant-directory__header">
              <strong>工单队列</strong>
              <span>{formatNumber(visibleTickets.length)} 条匹配</span>
            </header>
            {selectedTickets.length ? (
              <div className="vx-tenant-toolbar" aria-label="工单批量操作">
                <span>已选 {formatNumber(selectedTickets.length)} 条</span>
                <div className="vx-tenant-toolbar__spacer" aria-hidden="true" />
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
                columns={ticketColumns}
                rows={visibleTickets}
                rowKey={ticketKey}
                loading={isLoading}
                indexStart={1}
                selectedKeys={[...selectedTicketIds]}
                onSelectionChange={(keys) =>
                  setSelectedTicketIds(new Set(keys))
                }
                rowActions={(ticket) => (
                  <TicketActionsMenu
                    ticket={ticket}
                    onOpenDetail={(selectedTicket) =>
                      setDetailTicketId(selectedTicket.id)
                    }
                  />
                )}
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

      {detailTicketId ? (
        <TicketDetailDrawer
          ticketId={detailTicketId}
          onClose={() => setDetailTicketId(null)}
          onTicketUpdated={applyTicketUpdate}
        />
      ) : null}

      {batchStatusOpen ? (
        <DialogForm
          open
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
            {TICKET_STATUS_INPUT_ORDER.map((value) => (
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
