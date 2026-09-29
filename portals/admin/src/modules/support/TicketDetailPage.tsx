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
  Banner,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
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
  useToast,
} from "@vxture/design-system";
import {
  AdminBffError,
  addTicketInternalNote,
  addTicketReply,
  assignTicket,
  changeTicketStatus,
  closeTicket,
  fetchTicket,
  fetchTicketComments,
} from "@/api/admin-bff";
import type { TicketStatusInput } from "@/api/admin-bff";
import type {
  SupportTicketRecord,
  TicketCommentRecord,
} from "@/entities/console";
import {
  CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
  TICKET_EVENT_INTERNAL_NOTE,
  TICKET_EVENT_REPLY,
  TICKET_STATUSES,
} from "@vxture-platform/shared";
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

/** 留言上限与写路径同口径（BFF 的 requireTicketText）。 */
const MESSAGE_MAX = 10000;
/** 关闭说明上限，同 BFF 的 `reason exceeds 1000 characters`。 */
const CLOSE_REASON_MAX = 1000;

/**
 * 这一条客户看得见吗。
 *
 * **判据只有一份**，在 `@vxture-platform/shared` 的
 * `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES`——客户面的读取按它过滤，运营面这块徽标
 * 按同一份显示。所以屏幕上写的「客户可见」与客户实际读到的，是同一个集合算出来
 * 的同一个答案；这里不另抄一张表，抄了就会有一天两边不一样，而不一样的那天
 * 没有任何症状：运营看到「客户看不到」，客户那边照样读到了。
 *
 * 那份值域是**白名单**：没登记的 `event_type` 一律算看不见（`event_type` 是开放集，
 * 将来必然冒出新词）。于是新词在这块徽标上显示成「客户看不到」，而客户面的过滤
 * 也确实把它滤掉了——两边仍然一致。
 */
function isCustomerVisibleEvent(eventType: string): boolean {
  return (CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[]).includes(
    eventType,
  );
}

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
      /* `comment` 归**客户自己发的言**（运营写的正式回复现在是 `reply`）。
         这个词此前标成「回复」，那是运营也写 comment 的时代留下的——两种人写进
         同一个词里，时间线上就分不出这句话是谁说的。 */
      case "comment":
        return t("comment");
      case TICKET_EVENT_REPLY:
      // `replied` 是 @vxture/service-ticket（未加载那份）的写法，留着当别名。
      case "replied":
        return t("reply");
      case TICKET_EVENT_INTERNAL_NOTE:
        return t("internalNote");
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

/**
 * ── 为什么是两个组件、两个板块，而不是一个输入框加一个「仅内部」勾选框 ──
 *
 * 勾选框是这件事最容易设错的形状：它平时不显眼、默认值是个静默的决定、而且**写
 * 完之后从屏幕上看不出当时勾没勾**。设错的代价不对称——把内部判断当成回复发给
 * 客户，是不可撤回的（`support.ticket_comments` 由 BEFORE UPDATE 触发器封成
 * 仅追加，改不了也删不掉）。
 *
 * 所以两件事在屏幕上从头到尾都是分开的：各有自己的板块、图标、可见性徽标、
 * 输入框、占位提示、按钮文字、按钮样式（回复是主按钮，备注是 outline）和
 * 提交后的提示语。**没有任何一个控件同时属于两者**，所以也没有「设错的那一个
 * 控件」。要发错，得在写完之后按下另一个板块里那颗字面写着别的事的按钮。
 *
 * 代码里也不合并：两个函数各自 import 自己那一个写入端点，
 * `grep addTicketReply` / `grep addTicketInternalNote` 各只有一处落点。
 * 合并成一个 `audience` 参数省下的是几十行 JSX，换来的是「读代码的人要先追一个
 * 参数才知道这颗按钮发给谁」——这一处不值得换。
 */
function CustomerReplyComposer({
  ticketId,
  onPosted,
}: {
  ticketId: string;
  onPosted: () => void;
}) {
  const t = useTranslations("ticketDetail.reply");
  const tAudience = useTranslations("ticketAudience");
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    try {
      await addTicketReply(ticketId, text);
      setBody("");
      /* 提交后立刻说清刚才那一下发给了谁。追加不可撤回，所以这句提示是运营
         唯一一次「诶不对」的机会，必须当场出现、且带上读者。 */
      toast({ tone: "success", title: t("success") });
      onPosted();
    } catch (err) {
      setError(err instanceof AdminBffError ? err.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
      <DetailSectionHeading
        icon="paperplane-tilt"
        title={t("title")}
        titleSuffix={
          <StatusBadge tone="info" icon="eye">
            {tAudience("customerVisible")}
          </StatusBadge>
        }
        description={t("description")}
      />
      <form className="grid gap-sm" onSubmit={handleSubmit}>
        <Field>
          <FieldLabel htmlFor="vx-ticket-reply">{t("label")}</FieldLabel>
          <Textarea
            id="vx-ticket-reply"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={MESSAGE_MAX}
            placeholder={t("placeholder")}
          />
        </Field>
        <FieldError>{error}</FieldError>
        <div>
          <Button
            type="submit"
            disabled={submitting || body.trim().length === 0}
          >
            <Icon name="paperplane-tilt" size="xs" fallback="placeholder" />
            {submitting ? t("pending") : t("submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function InternalNoteComposer({
  ticketId,
  onPosted,
}: {
  ticketId: string;
  onPosted: () => void;
}) {
  const t = useTranslations("ticketDetail.note");
  const tAudience = useTranslations("ticketAudience");
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    try {
      await addTicketInternalNote(ticketId, text);
      setBody("");
      toast({ tone: "success", title: t("success") });
      onPosted();
    } catch (err) {
      setError(err instanceof AdminBffError ? err.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
      <DetailSectionHeading
        icon="eye-slash"
        title={t("title")}
        titleSuffix={
          <StatusBadge tone="warning" icon="eye-slash">
            {tAudience("internalOnly")}
          </StatusBadge>
        }
        description={t("description")}
      />
      <form className="grid gap-sm" onSubmit={handleSubmit}>
        <Field>
          <FieldLabel htmlFor="vx-ticket-internal-note">
            {t("label")}
          </FieldLabel>
          <Textarea
            id="vx-ticket-internal-note"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={MESSAGE_MAX}
            placeholder={t("placeholder")}
          />
        </Field>
        <FieldError>{error}</FieldError>
        <div>
          {/* outline 而不是主按钮：一张工单上主动作是回复客户，备注是旁注。
              两颗按钮长得不一样，也是「这两颗不是一颗」的一半。 */}
          <Button
            type="submit"
            variant="outline"
            disabled={submitting || body.trim().length === 0}
          >
            <Icon name="lock" size="xs" fallback="placeholder" />
            {submitting ? t("pending") : t("submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * 关闭工单。
 *
 * ── 为什么这里不是 `DestructiveButton` + 一句后果 ──
 * 本门户终局动作的默认形状是那一件（按钮 + `ConfirmDestructive`），但它收不了
 * 输入，而**关闭必须带一句说明**（BFF 缺 `reason` 直接 400）。于是用的是本门户
 * 另一条同样成文的形状：**带必填理由的终局对话框**——订单页驳回申报、作废订单
 * 走的就是这一条，那两处也是「不可逆 + 必须写清为什么」。对话框自己的提交键就是
 * 那道确认，而且它比一句 yes/no 更严：不写理由按不下去。
 *
 * ── 那句说明**客户会读到** ──
 * BFF 把 `reason` 写进 `status_changed` 的 payload.note，而 `status_changed` 在
 * 客户可见白名单里。所以这个输入框和「回复客户」那个框顶着同一枚徽标——它确实
 * 是同一件事：写下去客户就看得到。运营最容易在这里把内部原因（「这客户老是反复
 * 提同一件事」）当成结案备注写进去。
 */
function TicketCloseDialog({
  ticket,
  onClose,
  onClosed,
}: {
  ticket: SupportTicketRecord;
  onClose: () => void;
  onClosed: (updated: SupportTicketRecord) => void;
}) {
  const t = useTranslations("ticketDetail.close");
  const tAudience = useTranslations("ticketAudience");
  const tForm = useTranslations("ticketDetail.form");
  const tShared = useTranslations();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      onClosed(await closeTicket(ticket.id, reason.trim()));
    } catch (err) {
      /* 409 是运营真会撞到的那一档（单子已经被别人关了，或者是撤销掉的），
         那一句得是中文的人话，不是 BFF 的英文短句。其余照原样回显——上游说得
         比我猜得准。 */
      setError(
        err instanceof AdminBffError
          ? err.status === 409
            ? t("alreadyFinal")
            : err.message
          : t("failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      size="lg"
      title={t("title")}
      description={t.rich("description", {
        title: ticket.title,
        b: (chunks) => <strong>{chunks}</strong>,
      })}
      submitLabel={t("submit")}
      cancelLabel={tShared("actions.cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
      onSubmit={handleSubmit}
    >
      {/* 后果写在最上面，不挂在字段旁边：它要在人动手之前就被读到。 */}
      <Banner tone="warning" title={t("consequence")} />
      <Field>
        <FieldLabel
          htmlFor="vx-ticket-close-reason"
          required
          requiredLabel={tForm("required")}
          hint={t("reasonHint")}
          hintLabel={tForm("hintLabel")}
        >
          {t("reasonLabel")}{" "}
          <StatusBadge tone="info" icon="eye">
            {tAudience("customerVisible")}
          </StatusBadge>
        </FieldLabel>
        <Textarea
          id="vx-ticket-close-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={CLOSE_REASON_MAX}
          placeholder={t("reasonPlaceholder")}
          autoFocus
        />
      </Field>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
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
      {/* 这个「备注」**不带客户可见徽标，是对的**：它写进 `assigned` 事件的
          payload.note，而 `assigned` 刻意不在 CUSTOMER_VISIBLE_TICKET_EVENT_TYPES
          里（值域头注：指派带着坐席姓名与内部分工，那是我们的排班不是客户的事）。
          受理人 ID / 名称同理。本屏的规矩是「客户会读到的字段自己说出来」，
          读不到的不加标——加了就等于把徽标变成装饰，客户可见那几处也就不再有分量。 */}
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

/**
 * 变更工单状态。
 *
 * ── 这里的「说明」客户会读到 ──
 * BFF 把它写进 `status_changed` 的 payload.note，而 `status_changed` 在
 * `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 里——和关闭说明是同一条路、同一个读者。
 *
 * 所以它带的是和关闭说明**同样的两个记号**：标签里的「客户可见」徽标，和一句
 * 说明客户会读到它。原先它只写着「备注」，而这一屏其余地方已经把运营教成了
 * 「带标的才发给客户」：一个不带标、又叫「备注」的框，读起来就是内部那一档。
 * 于是内部判断会从这扇门漏出去——而漏出去的那一下不报错、不可撤回
 * （`support.ticket_comments` 由触发器封成仅追加）。
 *
 * 徽标与说明是两个独立的记号，不是一个说两遍：徽标一眼扫到，说明讲清后果。
 * 少哪一个都行不通——只有徽标的话「客户可见」到底意味着什么要靠猜，只有说明的话
 * 它藏在 hint 里，而人是不点 hint 的。
 */
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
  const t = useTranslations("ticketDetail.statusDialog");
  const tForm = useTranslations("ticketDetail.form");
  const tAudience = useTranslations("ticketAudience");
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
      setError(err instanceof AdminBffError ? err.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      size="sm"
      title={t("title")}
      description={t.rich("description", {
        title: ticket.title,
        b: (chunks) => <strong>{chunks}</strong>,
      })}
      submitLabel={t("submit")}
      cancelLabel={tShared("actions.cancel")}
      submitting={submitting}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel
          htmlFor="vx-ticket-status"
          required
          requiredLabel={tForm("required")}
          hint={t("closeHint")}
          hintLabel={tForm("hintLabel")}
        >
          {t("statusLabel")}
        </FieldLabel>
        <NativeSelect
          id="vx-ticket-status"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as TicketStatusInput)
          }
        >
          {/* 顺序取 @shared 的值域本身，不另抄一份：抄一份就会有第二个地方要跟着
              DB CHECK 改，而那正是 `TicketStatusInput` 原先那份手写联合的下场。
              **减掉 `closed`**：关闭有自己的动作和自己的确认框（见页头那颗
              DestructiveButton），留在这个下拉里就是同一个后果的第二扇门，
              而这扇门不问一句。 */}
          {TICKET_STATUSES.filter((value) => value !== "closed").map(
            (value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ),
          )}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel
          htmlFor="vx-ticket-status-note"
          hint={t("noteHint")}
          hintLabel={tForm("hintLabel")}
        >
          {t("noteLabel")}{" "}
          <StatusBadge tone="info" icon="eye">
            {tAudience("customerVisible")}
          </StatusBadge>
        </FieldLabel>
        <Textarea
          id="vx-ticket-status-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder={t("notePlaceholder")}
        />
      </Field>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
}

export function TicketDetailPage({ ticketId }: { ticketId: string }) {
  const locale = useLocale();
  const tShared = useTranslations();
  const tPage = useTranslations("ticketDetail");
  const tClose = useTranslations("ticketDetail.close");
  const tAudience = useTranslations("ticketAudience");
  const priorityLabels = useTicketPriorityLabels();
  const eventTypeLabel = useTicketEventTypeLabel();
  const statusLabels = useTicketStatusLabels();
  const { toast } = useToast();

  const [ticket, setTicket] = useState<SupportTicketRecord | null>(null);
  const [events, setEvents] = useState<TicketCommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

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
                  {/* 关闭不埋在七个状态值的下拉里：它对客户是终局，而下拉里的
                      七个值长得一模一样、点中哪个都不问一句。它自己的那道门在
                      `TicketCloseDialog` 里，后果那一句说的是**客户那边会怎样**，
                      不是库里会怎样。

                      **已关闭的单上这颗按钮照旧出现**，而不是藏掉。想藏，但藏不
                      了：投影把七个状态压成四个，`resolved` / `cancelled` /
                      `reopened` 全都归进 `closed`（admin-bff 的
                      `normalizeTicketStatus`）。按这一列藏，会把「已解决、正等着
                      结单」和「刚被重新打开」这两种最需要这颗按钮的单一起藏掉。
                      按一个分不出这件事的值去藏控件，比多出一颗按钮糟——真关第二
                      次时 BFF 回 409，对话框照实说。 */}
                  <Button variant="outline" onClick={() => setCloseOpen(true)}>
                    <Icon name="lock" size="xs" fallback="placeholder" />
                    {tClose("action")}
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
            <DetailSectionHeading
              icon="clock"
              title={tPage("timeline.title")}
              description={tPage("timeline.description")}
            />
            {events.length ? (
              <PanelList>
                {events.map((event) => {
                  const bodyText = ticketEventBodyText(event, statusLabels);
                  /* 已经写下去的那些，也得一眼看出客户读不读得到——否则运营只能
                     靠回忆判断某句内部判断当时是发出去了还是留在了内部。
                     记号放在**最左边那条轨道**上（lead），一列扫下来就是答案；
                     徽标再用文字说一遍，不让一个图标独自承担这件事。 */
                  const visible = isCustomerVisibleEvent(event.eventType);
                  return (
                    <PanelItem
                      key={event.id}
                      lead={
                        <Icon
                          name={visible ? "eye" : "eye-slash"}
                          size="sm"
                          fallback="placeholder"
                        />
                      }
                      /* 正文走 main 的 description 而不是 trail：trail 是
                         shrink-0，只放短内容，回复正文会把它撑破。 */
                      main={
                        <TableTitleCell
                          title={`${eventTypeLabel(event.eventType)} · ${event.actorName}`}
                          /* 徽标走 `titleSuffix` 而不是塞进 `title`：这一件的
                             主行是**截断**的（inline 档），把一枚标挤进去会先
                             切掉事件名本身；`titleSuffix` 是它给标留的槽，
                             换行时整体下沉、不切主信息（见件的 props 注释）。 */
                          titleSuffix={
                            <StatusBadge
                              tone={visible ? "info" : "warning"}
                              icon={visible ? "eye" : "eye-slash"}
                            >
                              {visible
                                ? tAudience("customerVisible")
                                : tAudience("internalOnly")}
                            </StatusBadge>
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
                title={tPage("timeline.emptyTitle")}
                description={tPage("timeline.emptyDescription")}
              />
            )}
          </section>

          {/* 原先这里只有一个「回复工单」，写什么都会发给客户，而运营本来就需要
              记内部判断——没有内部备注的地方，内部判断就只能写进回复里。
              两件事各占一个板块，顺序是「先给客户的，再给自己的」。 */}
          <CustomerReplyComposer
            ticketId={ticketId}
            onPosted={() => void reloadEvents()}
          />
          <InternalNoteComposer
            ticketId={ticketId}
            onPosted={() => void reloadEvents()}
          />
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
      {closeOpen && ticket ? (
        <TicketCloseDialog
          ticket={ticket}
          onClose={() => setCloseOpen(false)}
          onClosed={(updated) => {
            applyUpdated(updated);
            setCloseOpen(false);
            toast({ tone: "success", title: tClose("success") });
          }}
        />
      ) : null}
    </DetailPageTemplate>
  );
}
