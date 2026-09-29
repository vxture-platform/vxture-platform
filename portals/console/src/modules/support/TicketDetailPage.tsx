"use client";

/**
 * TicketDetailPage.tsx — 一张工单，客户视角：能读全文、能回复的**唯一**一处。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-29 第 5 与第 6 条裁决合起来是三层分工，这一页是第三层：
 *   · 消息中心答「有没有新动静」（落库、有已读、点开跳到这里）；
 *   · 顶栏「?」抽屉答「我那几张单办到哪了」（派生、无已读、点开跳到这里）；
 *   · **这一页**是读全文与回复的地方。上面两处都只是入口。
 *
 * ── 时间线上三种东西必须一眼分得开 ──
 * 客户自己说的话、我们的正式回复、进度变化，在屏幕上是三种画法（左侧轨道的
 * 图标与语气底、主行的事件名、以及正文的呈现）。判据**只有 `event_type`**，
 * 与"这条给谁看"同一个判据；不看 `actor_type`（那是代理值：客户重开工单产生的
 * `status_changed` 的 actor 也是客户）。分类那一份在 `ticket-labels.ts`。
 *
 * ── 这里不需要、也不做第二道可见性过滤 ──
 * 客户可见的判据是 `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES`（白名单、绑参），
 * 由**读侧**执行并由 `lint:ticket-visibility` 机械盯着。前端再滤一遍就是第二份
 * 判据，而两份判据必然有一天不一样；真正的风险不是"前端漏滤"，是"两处各有一份
 * 而没人知道哪份说话"。前端要守的是另一件：别渲染契约里没有的字段。
 *
 * ── 收尾了的单：不摆一个灰着不说话的框 ──
 * `closed` / `cancelled` 的回复框不画成禁用输入框（那是"这一格坏了"的样子），
 * 改成一句说明加一个真去处。`resolved` **仍然可回复**——客户收到的通知原话就是
 * 「如果问题还在，在那里回复一句，我们接着处理」，页面把框关掉就是当面失信。
 * 三档的判据在 `lib/ticket-state.ts` 一处，带测试。
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  DetailList,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Icon,
  PanelItem,
  PanelList,
  Skeleton,
  StatusBadge,
  TableTitleCell,
  Textarea,
  toneSurfaceClasses,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  fetchMyTicket,
  reopenMyTicket,
  replyToMyTicket,
  type ConsoleTicketDetail,
  type ConsoleTicketEvent,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { PageSection, SectionBody } from "@/layout/shell";
import { useDateFormat } from "@/lib/use-date-format";
import { TICKETS_PATH } from "@/lib/ticket-compose";
import { canReplyToTicket } from "@/lib/ticket-state";
import {
  ticketStatusTone,
  useTicketEventPresentation,
  useTicketStatusLabel,
} from "./ticket-labels";

/** 与运营侧写入路径的 `requireTicketText(…, 10000)` 同口径。 */
const MESSAGE_MAX = 10_000;

/**
 * 「我方认为已解决」。这一档**仍然可回复**，而回一句会让单子回到处理中
 * （BFF 的 `addReply` 在 resolved 上顺手把状态改回 `reopened`），所以屏幕上要
 * 提前说清这件事。分档判据在 `lib/ticket-state.ts`，这里只需要认出这一个值。
 */
const RESOLVED_STATUS = "resolved";

/**
 * 时间线。
 *
 * key 用**下标**：客户侧的流水投影里没有 id（行 id 是 uuid，而 uuid 连 React key
 * 都不许当），而这条时间线是仅追加、按 created_at 升序、永不重排的——同一次取数
 * 里下标就是稳定的身份。不拿 `createdAt` 当 key：同一毫秒里两条流水会撞。
 */
function TicketTimeline({ events }: { readonly events: ConsoleTicketEvent[] }) {
  const t = useTranslations("tickets.detail");
  const statusLabel = useTicketStatusLabel();
  const presentationOf = useTicketEventPresentation();
  const { fmtDateTime } = useDateFormat();

  if (events.length === 0) {
    return (
      <EmptyState
        icon="clock"
        title={t("timeline.emptyTitle")}
        description={t("timeline.emptyDescription")}
      />
    );
  }

  return (
    <PanelList>
      {events.map((event, index) => {
        const presentation = presentationOf(event.eventType);
        /* 状态事件的正文分两段：落点（→ 处理中）是结构化的，运营写的那句说明
           （关闭原因 / 处理说明）在 body 里。两段都要，缺一段就只剩半句话。 */
        const statusLine =
          event.status !== null
            ? t("timeline.movedTo", { status: statusLabel(event.status) })
            : null;
        const lines = [statusLine, event.body].filter((line): line is string =>
          Boolean(line && line.trim()),
        );
        /* 客户自己那条不印回他自己的名字：他知道那是自己说的，印上去只是噪音。
           运营那条要有名字——客户在跟一个人说话，不是跟一个系统。 */
        const who =
          presentation.kind === "customer"
            ? presentation.label
            : event.actorName.trim()
              ? `${presentation.label} · ${event.actorName}`
              : presentation.label;
        return (
          <PanelItem
            key={index}
            lead={
              <span
                className={`inline-flex size-icon-xl shrink-0 items-center justify-center rounded-lg ${toneSurfaceClasses[presentation.tone]}`}
              >
                <Icon
                  name={presentation.icon}
                  size="sm"
                  fallback="info"
                  aria-hidden="true"
                />
              </span>
            }
            main={
              <TableTitleCell
                title={who}
                titleSuffix={
                  presentation.kind === "status" ? (
                    <Badge variant="outline">{t("timeline.progressTag")}</Badge>
                  ) : undefined
                }
                layout="stacked"
                description={
                  lines.length > 0 ? (
                    <span className="flex flex-col gap-2xs whitespace-pre-wrap">
                      {lines.map((line, lineIndex) => (
                        <span key={lineIndex}>{line}</span>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            }
            trail={
              <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
                {fmtDateTime(event.createdAt)}
              </span>
            }
          />
        );
      })}
    </PanelList>
  );
}

/**
 * 把后端的拒绝翻成客户读得懂、且**两种语言都对**的一句话。
 *
 * 不直接回显 `err.message`：BFF 那几句拒绝是中文字面量（「工单已结束，请先重新
 * 打开再继续」），原样印出来会让英文界面上冒出中文。所以按状态码映射到词条，
 * 与 `ReviewDialog` 处理 409 同一做法。
 *
 * 409 在这条线上只有一种含义：**手上这一帧的状态已经过期了**——另一个同事刚回了
 * 一句、或者运营刚把单关掉（工单是租户级的，同一张单会有别人同时在动）。所以
 * 这句话要指向"重新读一遍"，而不是"你写错了"。
 */
function useTicketWriteError(): (err: unknown, fallback: string) => string {
  const t = useTranslations("tickets.detail.errors");
  return (err, fallback) => {
    if (err instanceof ConsoleBffError) {
      if (err.status === 409) return t("stale");
      if (err.status === 404) return t("gone");
    }
    return fallback;
  };
}

/**
 * 重新打开一张已结束的单。**必须写一句「为什么还没好」**（BFF 缺 `reason` 直接
 * 400），所以它是带必填理由的对话框，不是一句 yes/no 的确认。
 *
 * 那句话**客户和我们都读得到**：BFF 把它写进 `status_changed` 的 payload.note，
 * 而 `status_changed` 在客户可见白名单里。它和回复框里的字是同一种东西。
 */
function TicketReopenDialog({
  ticketNo,
  onClose,
  onReopened,
}: {
  readonly ticketNo: string;
  readonly onClose: () => void;
  readonly onReopened: () => void;
}) {
  const t = useTranslations("tickets.detail.reopen");
  const translateError = useTicketWriteError();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await reopenMyTicket(ticketNo, reason.trim());
      onReopened();
    } catch (err) {
      setError(translateError(err, t("failed")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      size="sm"
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      cancelLabel={t("cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <Field>
        <FieldLabel htmlFor="vx-ticket-reopen-reason">{t("label")}</FieldLabel>
        <Textarea
          id="vx-ticket-reopen-reason"
          value={reason}
          rows={4}
          maxLength={MESSAGE_MAX}
          placeholder={t("placeholder")}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
}

/**
 * 回复框，或者「这张单已经结束」那句说明加一颗「重新打开」。
 *
 * 两种形态互斥，由**状态**一个判据决定（`canReplyToTicket`），所以它们长在同一个
 * 组件里：拆成两个组件会让"什么时候画哪个"变成调用点的判断，而调用点只有一处。
 *
 * **这一个判据两侧同时成立**：BFF 那边回复一张已结束的单回 409、重新打开一张还
 * 活着的单也回 409（`tickets.router.ts` 的 `isTerminal`），所以"回复"与"重新打开"
 * 恰好互补——屏幕上永远只出现一个入口，而那个入口永远是后端会接受的那一个。
 * 这不是巧合，是两侧用的同一组值（`lib/ticket-state.ts` 的注释写了这件事）。
 */
function TicketReplyBox({
  ticketNo,
  status,
  onPosted,
}: {
  readonly ticketNo: string;
  readonly status: string;
  readonly onPosted: () => void;
}) {
  const t = useTranslations("tickets.detail.reply");
  const translateError = useTicketWriteError();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);

  const canReply = canReplyToTicket(status);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await replyToMyTicket(ticketNo, text);
      setBody("");
      onPosted();
    } catch (err) {
      setError(translateError(err, t("failed")));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canReply) {
    /* 不画禁用输入框：一个灰着的框读起来是「这一格坏了」。说明一句 + 一颗真按钮
       ——「重新打开」是后端在这个状态下唯一会接受的写入，所以它就是这里该有的
       那个动作，不是"另提一张"（那会把前后经过断成两张单）。 */
    return (
      <SectionBody>
        <Banner
          tone="info"
          title={t("finishedTitle")}
          description={t("finishedDescription")}
        />
        <div className="flex flex-wrap gap-sm">
          <Button size="md" onClick={() => setReopenOpen(true)}>
            <Icon name="undo" size="xs" fallback="placeholder" />
            <span>{t("finishedAction")}</span>
          </Button>
        </div>
        {reopenOpen ? (
          <TicketReopenDialog
            ticketNo={ticketNo}
            onClose={() => setReopenOpen(false)}
            onReopened={() => {
              setReopenOpen(false);
              onPosted();
            }}
          />
        ) : null}
      </SectionBody>
    );
  }

  return (
    <SectionBody>
      {/* 「已解决」这一档要提前说清后果：回一句会让这张单回到处理中。客户收到的
          通知原话就是这么写的，页面上不重复承诺、只说清机制。 */}
      {status === RESOLVED_STATUS ? (
        <Banner
          tone="info"
          title={t("resolvedTitle")}
          description={t("resolvedDescription")}
        />
      ) : null}
      <form
        className="flex flex-col gap-sm"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Field>
          <FieldLabel htmlFor="vx-ticket-reply">{t("label")}</FieldLabel>
          <Textarea
            id="vx-ticket-reply"
            value={body}
            rows={4}
            maxLength={MESSAGE_MAX}
            placeholder={t("placeholder")}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <FieldError>{error}</FieldError>
        <div className="flex flex-wrap gap-sm">
          <Button
            type="submit"
            size="md"
            disabled={submitting || body.trim().length === 0}
          >
            <Icon name="paperplane-tilt" size="xs" fallback="placeholder" />
            <span>{submitting ? t("pending") : t("submit")}</span>
          </Button>
        </div>
      </form>
    </SectionBody>
  );
}

export function TicketDetailPage() {
  const t = useTranslations("tickets.detail");
  const tList = useTranslations("tickets.list");
  const statusLabel = useTicketStatusLabel();
  const { fmtDateTime } = useDateFormat();
  const router = useRouter();
  /* 路由参数是**可视码**（`/tickets/TK-202609-0000000001`）。地址栏是展示面，
     uuid 不出现在这里；`ticket_no` 是 NOT NULL + UNIQUE，够当地址。 */
  const params = useParams<{ ticketNo: string }>();
  const ticketNo = params?.ticketNo ?? "";

  const [ticket, setTicket] = useState<ConsoleTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!ticketNo) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setNotFound(false);
    fetchMyTicket(ticketNo)
      .then((detail) => {
        if (active) setTicket(detail);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setTicket(null);
        /* 404 与「读挂了」是两件事，画法也该不一样：前者是这张单不属于本租户
           （或码打错了），重试一百次也一样；后者重试有意义。 */
        if (err instanceof ConsoleBffError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticketNo, reloadKey]);

  const backButton = (
    <Button
      variant="outline"
      size="md"
      onClick={() => router.push(TICKETS_PATH)}
    >
      <Icon name="arrow-left" size="xs" fallback="placeholder" />
      <span>{t("backToList")}</span>
    </Button>
  );

  if (notFound) {
    return (
      <ViewLayout>
        <ViewHeader
          icon="chat-dots"
          title={t("notFoundTitle")}
          description={t("notFoundDescription")}
          action={backButton}
        />
        <EmptyState
          icon="warning"
          title={t("notFoundTitle")}
          description={t("notFoundHint")}
        />
      </ViewLayout>
    );
  }

  if (!ticket) {
    return (
      <ViewLayout>
        <ViewHeader
          icon="chat-dots"
          title={t("loadingTitle")}
          description={ticketNo}
          action={backButton}
        />
        {loadFailed ? (
          <LoadFailedBanner onRetry={reload} retrying={loading} />
        ) : (
          <div className="flex flex-col gap-sm">
            <Skeleton className="h-icon-2xl w-media-2xl" />
            <Skeleton className="h-media-lg w-full" />
          </div>
        )}
      </ViewLayout>
    );
  }

  const canReply = canReplyToTicket(ticket.status);

  return (
    <ViewLayout>
      <ViewHeader
        icon="chat-dots"
        title={ticket.title}
        description={t("headerMeta", {
          code: ticket.ticketNo,
          created: fmtDateTime(ticket.createdAt),
        })}
        secondary={
          <StatusBadge tone={ticketStatusTone(ticket.status)}>
            {statusLabel(ticket.status)}
          </StatusBadge>
        }
        action={backButton}
      />

      {loadFailed ? (
        <LoadFailedBanner onRetry={reload} retrying={loading} />
      ) : null}

      <PageSection icon="list" level={2} title={t("facts.title")}>
        <SectionBody>
          <DetailList>
            <DetailRow label={t("facts.code")}>
              <span className="font-mono">{ticket.ticketNo}</span>
            </DetailRow>
            <DetailRow label={t("facts.status")}>
              {statusLabel(ticket.status)}
            </DetailRow>
            <DetailRow label={t("facts.createdAt")}>
              {fmtDateTime(ticket.createdAt)}
            </DetailRow>
            <DetailRow label={t("facts.lastActivityAt")}>
              {ticket.lastActivityAt ? fmtDateTime(ticket.lastActivityAt) : "—"}
            </DetailRow>
          </DetailList>
        </SectionBody>
      </PageSection>

      <PageSection
        icon="file-text"
        level={2}
        title={t("problem.title")}
        description={t("problem.description")}
      >
        <SectionBody>
          {/* 建单时写下的那段话（`support.tickets.description`），不是一条流水，
              所以它有自己的板块而不是混进时间线的第一条。 */}
          <p className="whitespace-pre-wrap text-body-md text-foreground">
            {ticket.description.trim() || "—"}
          </p>
        </SectionBody>
      </PageSection>

      <PageSection
        icon="clock"
        level={2}
        title={t("timeline.title")}
        description={t("timeline.description")}
      >
        <SectionBody>
          <TicketTimeline events={ticket.events} />
        </SectionBody>
      </PageSection>

      <PageSection
        icon={canReply ? "paperplane-tilt" : "info"}
        level={2}
        title={canReply ? t("reply.title") : t("reply.finishedSectionTitle")}
        description={
          canReply ? t("reply.description") : t("reply.finishedSectionHint")
        }
      >
        <TicketReplyBox
          ticketNo={ticket.ticketNo}
          status={ticket.status}
          onPosted={reload}
        />
      </PageSection>

      <PageSection icon="info" level={2} title={tList("notes.title")}>
        <SectionBody>
          <p className="text-body-sm text-muted-foreground">
            {tList("notes.noticeBody")}
          </p>
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
