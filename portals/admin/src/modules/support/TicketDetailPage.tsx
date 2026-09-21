"use client";

/**
 * TicketDetailPage.tsx — 一张工单的详情页。
 *
 * ── 为什么它不再是列表页里的抽屉 ──
 * 工单详情原先长在 `TicketsPage` 的 `TicketDetailDrawer` 里，只能由列表上的行
 * 操作打开，**没有地址**。后果不是"少个链接"这么轻：运营总览的待办队列里，
 * 「工单处理」那一类的「去处理工单」只能跳 `/tickets` 列表，跟同一个菜单里的
 * 「查看全部工单」是同一个地址——待办点进去还得自己在列表里找回那一条
 * （owner 2026-09-21：「操作：…能够跳转具体处置页面」）。
 *
 * 订单早就是这个形（`/orders/<order_no>`），工单照它做。
 *
 * ── 路由参数是可读码 ──
 * `ticketId` 现在的含义是「`ticket_no` 或 uuid」。地址栏是可见面，UUID 不在
 * 任何场景对外展示；`support.tickets.ticket_no` 是 NOT NULL + UNIQUE，列表投影
 * 给出的 `id` 本来就是它（admin-bff `tickets.router.ts`：`row.ticket_no ?? row.id`）。
 * BFF 那一半早就双接受，所以这里只要把前端这一半拄上——「约定要拄两半」那条
 * 教训的另一面：后端先有了，前端没跟上，一样跳不过去。
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Badge,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Icon,
  Input,
  Label,
  NativeSelect,
  PanelItem,
  PanelList,
  SHELL_PANEL_HAIRLINE,
  StatusBadge,
  TableTitleCell,
  Textarea,
} from "@vxture/design-system";
import {
  AdminBffError,
  addTicketComment,
  assignTicket,
  changeTicketStatus,
  fetchTicket,
  fetchTicketComments,
} from "@/api/admin-bff";
import type { TicketStatusInput } from "@/api/admin-bff";
import type {
  SupportTicketRecord,
  TicketCommentRecord,
} from "@/entities/console";
import { TICKET_STATUSES } from "@vxture-platform/shared";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import {
  useTicketPriorityLabels,
  useTicketStatusLabels,
} from "@/modules/shared/enum-labels";
import {
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_TONE,
} from "@/modules/shared/tenant-tone";
import { ticketStatusLabel, typeLabel } from "@/modules/tenants/tenant-utils";
import { formatDateTime } from "@vxture-platform/shared";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

/**
 * 时间线事件类型 → 界面文案。
 *
 * **不收进 `enum-labels`。** 那个模块只收值域已成文的枚举，而
 * `support.ticket_comments.event_type` 是**开放集**——没有 CHECK，72_support.sql
 * 第 60 行就写着「comment/status_changed/assigned/reopened/sla_breached/…」，
 * 没有值域契约可立，也就不该拿它冒充。
 *
 * 默认分支原样回显那个码，不编一个「其他」——开放集里没登记的值迟早
 * 会出现，而运营要拿那个码去查日志，藏掉就查不到了。
 *
 * ── 这里原先认错了码（2026-09-21 修）──
 * 抽屉版本认的是 `assign` / `assignment` / `status_change` / `status`，而全仓
 * **没有任何地方写过这四个值**。真正写进 `support.ticket_comments` 的只有：
 *
 *   admin-bff `tickets.router.ts`   comment · assigned · status_changed
 *   `@vxture/service-ticket`（未加载）created · assigned · replied · resolved · closed
 *
 * 于是「指派」和「状态变更」这两类事件从来没被认出来过，一直落到默认分支，在
 * 时间线上显示成英文原始码 `assigned` / `status_changed`。四条死分支看着像在
 * 处理它们，实际一条都没走到过——判死码不能只看有没有 case。
 *
 * 那四个旧码仍然留着当别名：`event_type` 是开放集，存量库里有没有早期行无从
 * 断定（本机库是空的），留着不花钱，去掉才有风险。
 *
 * 写成 hook 而不是纯函数：文案要走 `t()`，而 `t` 只能在组件里拿。
 * 键写成字面量而不是 `t(\`eventType.${x}\`)`：动态键 `lint:message-usage`
 * 扫不到，要等界面上渲染出键路径才发现（同 enum-labels 头注）。
 */
function useTicketEventTypeLabel(): (eventType: string) => string {
  const t = useTranslations("ticketDetail.eventType");
  return (eventType) => {
    switch (eventType) {
      // 回复：router 写 comment，service 写 replied。
      case "comment":
      case "replied":
        return t("comment");
      case "assigned":
      // 以下三行是旧码别名，见头注。
      case "assign":
      case "assignment":
        return t("assign");
      case "status_changed":
      case "status_change":
      case "status":
        return t("statusChange");
      case "resolved":
        return t("resolved");
      case "closed":
        return t("closed");
      case "reopened":
        return t("reopened");
      case "created":
        return t("created");
      default:
        return eventType;
    }
  };
}

/** 时间线事件的正文：几种 payload 形状里挑出能读的那一段，没有就返回 null。 */
function ticketEventBodyText(
  event: TicketCommentRecord,
  statusLabels: Record<TicketStatusInput, string>,
): string | null {
  const payload = event.payload ?? {};
  const candidate =
    payload.body ?? payload.note ?? payload.comment ?? payload.message;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }
  if (typeof payload.status === "string") {
    const label =
      statusLabels[payload.status as TicketStatusInput] ?? payload.status;
    return `→ ${label}`;
  }
  if (typeof payload.assigneeName === "string") {
    return `指派给 ${payload.assigneeName}`;
  }
  return null;
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
      size="lg"
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
  const statusLabels = useTicketStatusLabels();
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
      size="sm"
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
        {/* 顺序取 @shared 的值域本身，不另抄一份：抄一份就会有第二个地方要跟着
            DB CHECK 改，而那正是 `TicketStatusInput` 原先那份手写联合的下场。 */}
        {TICKET_STATUSES.map((value) => (
          <option key={value} value={value}>
            {statusLabels[value]}
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

export function TicketDetailPage({ ticketId }: { ticketId: string }) {
  const locale = useLocale();
  const tShared = useTranslations();
  const priorityLabels = useTicketPriorityLabels();
  const eventTypeLabel = useTicketEventTypeLabel();
  const statusLabels = useTicketStatusLabels();

  const [ticket, setTicket] = useState<SupportTicketRecord | null>(null);
  const [events, setEvents] = useState<TicketCommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const reloadEvents = useCallback(async () => {
    setEvents(await fetchTicketComments(ticketId));
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([fetchTicket(ticketId), fetchTicketComments(ticketId)])
      .then(([detail, list]) => {
        if (cancelled) return;
        setTicket(detail);
        setEvents(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setTicket(null);
        setLoadError(err instanceof Error ? err.message : "工单详情读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  function applyUpdated(updated: SupportTicketRecord) {
    setTicket(updated);
    void reloadEvents();
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
      await reloadEvents();
    } catch (err) {
      setReplyError(
        err instanceof AdminBffError ? err.message : "回复失败，请重试",
      );
    } finally {
      setReplySubmitting(false);
    }
  }

  const backToList = (
    <Button asChild variant="outline">
      <Link href="/tickets">
        <Icon name="arrow-left" size="xs" fallback="placeholder" />
        {tShared("actions.backToList")}
      </Link>
    </Button>
  );

  if (!loading && !ticket) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="chat-circle"
            eyebrow="客户服务"
            title="工单详情"
            description="这张工单不存在，或当前账号无权查看。"
            action={backToList}
          />
        }
      >
        <EmptyState
          title="未找到工单"
          description={loadError ?? "请返回工单列表重新选择。"}
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <PageHeader
          icon="chat-circle"
          eyebrow="客户服务"
          title={ticket ? ticket.title : "工单详情"}
          description={
            ticket
              ? `${ticket.id} · ${ticket.tenantName} · ${ticket.ownerName}`
              : "正在读取工单…"
          }
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              {backToList}
              {ticket ? (
                <>
                  <Button asChild variant="outline">
                    <Link
                      href={`/tenants/${encodeURIComponent(ticket.tenantCode)}`}
                    >
                      <Icon name="buildings" size="xs" fallback="placeholder" />
                      {tShared("actions.viewTenant")}
                    </Link>
                  </Button>
                  <Button variant="outline" onClick={() => setAssignOpen(true)}>
                    <Icon name="medal" size="xs" fallback="placeholder" />
                    指派
                  </Button>
                  <Button variant="outline" onClick={() => setStatusOpen(true)}>
                    <Icon name="settings" size="xs" fallback="placeholder" />
                    改状态
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
      }
    >
      {ticket ? (
        <>
          <DetailSummaryHeader
            icon="ticket"
            title={ticket.title}
            subtitle={`${ticket.tenantName} / ${formatPrincipalNoOr(ticket.tenantCode, "tenant", "—")} · ${typeLabel(ticket.tenantType)}`}
            badges={
              <>
                <StatusBadge tone={TICKET_STATUS_TONE[ticket.status]}>
                  {ticketStatusLabel(ticket.status)}
                </StatusBadge>
                <StatusBadge tone={TICKET_PRIORITY_TONE[ticket.priority]}>
                  {priorityLabels[ticket.priority]}
                </StatusBadge>
                {/* 行业是类目，没有严重度，用朴素 Badge——同列表页的判断。 */}
                <Badge variant="outline">{ticket.industry}</Badge>
              </>
            }
          />

          <section
            className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}
          >
            <DetailSectionHeading icon="list" title="工单信息" />
            <DetailList>
              <DetailRow label="工单编号">{ticket.id}</DetailRow>
              <DetailRow label={tShared("columns.state")}>
                {ticketStatusLabel(ticket.status)}
              </DetailRow>
              <DetailRow label="优先级">
                {priorityLabels[ticket.priority]}
              </DetailRow>
              <DetailRow label="租户">
                {`${ticket.tenantName} / ${formatPrincipalNoOr(ticket.tenantCode, "tenant", "—")}`}
              </DetailRow>
              <DetailRow label="负责人">{ticket.ownerName}</DetailRow>
              <DetailRow label="行业">{ticket.industry}</DetailRow>
              <DetailRow label="地区">{ticket.region}</DetailRow>
              <DetailRow label={tShared("columns.updatedAt")}>
                {formatDateTime(ticket.updatedAt, locale)}
              </DetailRow>
            </DetailList>
          </section>

          <section
            className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}
          >
            <DetailSectionHeading icon="clock" title="处理时间线" />
            {events.length ? (
              <PanelList>
                {events.map((event) => {
                  const bodyText = ticketEventBodyText(event, statusLabels);
                  return (
                    <PanelItem
                      key={event.id}
                      lead={
                        <Icon
                          name="chat-circle"
                          size="sm"
                          fallback="placeholder"
                        />
                      }
                      /* 正文走 main 的 description 而不是 trail：trail 是
                         shrink-0，只放短内容，回复正文会把它撑破。 */
                      main={
                        <TableTitleCell
                          title={
                            <>
                              {eventTypeLabel(event.eventType)} ·{" "}
                              {event.actorName}
                            </>
                          }
                          description={bodyText ?? "—"}
                        />
                      }
                      trail={
                        <span className="truncate text-body-sm text-muted-foreground">
                          {formatDateTime(event.createdAt, locale)}
                        </span>
                      }
                    />
                  );
                })}
              </PanelList>
            ) : (
              <EmptyState
                icon="clock"
                title="暂无时间线记录"
                description="这张工单还没有回复、指派或状态变更。"
              />
            )}
          </section>

          <section
            className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}
          >
            <DetailSectionHeading icon="chat-circle" title="回复工单" />
            <form className="grid gap-sm" onSubmit={handleReply}>
              <Label htmlFor="vx-ticket-reply">回复内容</Label>
              <Textarea
                id="vx-ticket-reply"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                rows={3}
                placeholder="输入回复内容…"
              />
              {replyError ? (
                <p
                  className="text-body-sm font-semibold text-destructive-text"
                  role="alert"
                >
                  {replyError}
                </p>
              ) : null}
              <div>
                <Button
                  type="submit"
                  disabled={replySubmitting || replyBody.trim().length === 0}
                >
                  {replySubmitting ? "处理中…" : "回复"}
                </Button>
              </div>
            </form>
          </section>
        </>
      ) : (
        <EmptyState
          title="正在加载工单详情"
          description="正在读取工单与时间线。"
        />
      )}

      {assignOpen && ticket ? (
        <TicketAssignDialog
          ticket={ticket}
          onClose={() => setAssignOpen(false)}
          onAssigned={(updated) => {
            applyUpdated(updated);
            setAssignOpen(false);
          }}
        />
      ) : null}
      {statusOpen && ticket ? (
        <TicketStatusDialog
          ticket={ticket}
          onClose={() => setStatusOpen(false)}
          onChanged={(updated) => {
            applyUpdated(updated);
            setStatusOpen(false);
          }}
        />
      ) : null}
    </DetailPageTemplate>
  );
}
