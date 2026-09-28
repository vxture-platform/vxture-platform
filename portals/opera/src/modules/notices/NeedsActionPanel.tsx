"use client";

/**
 * NeedsActionPanel — `/ops/notices` 顶上那一小块「需要处理」。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 2026-09-28 第四批：前三批刻意把信号做全（业务事件巡检、运营动作巡检、维护窗口、
 * 产品生命周期、作业心跳、webhook 死信都会往本平面播通告），这一批让它读得懂。做全
 * 的代价是**一屏几十条**，而其中真正需要有人现在动手的只有几条——所以这一块先答
 * 「现在要我做什么」，下面那张表才答「一共有哪些」。
 *
 * ── 为什么它不跟着筛选走 ──
 * 本件的数据来自收件面（`/api/operator-notices/inbox`），与下面那张表的四项筛选**互不
 * 相干**。跟着筛的话，「需要处理 0 条」会在筛掉它们之后出现，而那正是最不该让人以为
 * 「没事了」的时刻。
 *
 * ── 「全部标记已读」的作用域 ──
 * 按钮标签里带着那个数（`markAll`），而那个数就是铃铛角标的数，也正是 BFF
 * `read-all` 清掉的集合（`PgNoticeRepository.markAllRead`）。三者必须是同一个数：
 * 「全部」摆在一屏筛过的列表旁边会被读成「这一屏」，两种读法差一个数量级。
 * 所以按钮长在这一块里，而**不在**下面那条筛选栏上。
 *
 * ── 只列紧急与重要 ──
 * 「一般」也算未读、也进角标，但它不是「需要处理」。它有多少条写在这一块的描述里，
 * 点「只看未读」到下面的清单去看——不在这里堆成一屏。
 *
 * ── 「去看看」会顺手把那一条标成已读 ──
 * 判据与理由在 `./click-through` 文件头**一处**写着，本件只调用（`onOpen`）。下面那张
 * 表点标题走的是同一份，所以两个面不会在这件事上分头漂移。
 */

import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  PanelCard,
  PanelItem,
  PanelList,
  StatusBadge,
} from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { severityTone, type NoticeSeverity } from "./severity";
import type { ClickThroughNotice } from "./click-through";

/**
 * 收件面回的一条。字段与 `@vxture/service-notice` 的 `OperatorNoticeView` 对齐。
 *
 * 点进去要用的那几个字段从 `ClickThroughNotice` 继承（`id` / `link` / `readAt`）：
 * 抄一遍的话，这一份与那一份会各自漂移，而「点进去要看哪些字段」只该有一个答案。
 * 收件面回的按定义都投到本平面，所以这里没有 `onThisPlane`。
 */
export interface InboxNotice extends ClickThroughNotice {
  readonly severity: NoticeSeverity;
  readonly title: string;
  readonly body: string;
  readonly source: "manual" | "system";
  readonly publishedAt: string;
  readonly createdByName: string | null;
}

export interface NeedsActionPanelProps {
  readonly state: "loading" | "error" | "ready";
  /** 读失败时后端那句话，原样带出——它比「读取失败」有信息。 */
  readonly errorMessage?: string | undefined;
  /** 本平面未读总数（三档都算）。= 铃铛角标 = read-all 清掉的集合。 */
  readonly unread: number;
  /** 未读按三档的分布。 */
  readonly counts: Record<NoticeSeverity, number>;
  /** 紧急 + 重要的未读，已被后端按 limit 截断。 */
  readonly items: readonly InboxNotice[];
  /** 紧急 + 重要的未读总数，可能大于 `items.length`。 */
  readonly urgentTotal: number;
  readonly busy: boolean;
  readonly onMarkRead: (id: string) => void;
  /**
   * 点进一条通告的落地页。**它自己先标已读再跳**——为什么这样算，见
   * `./click-through` 文件头，这里不再复述一遍（复述的那一份迟早与它对不上）。
   */
  readonly onOpen: (notice: InboxNotice) => void;
  readonly onMarkAllRead: () => void;
  /** 把下面那张表切到「只看未读」。 */
  readonly onShowUnread: () => void;
  readonly onRetry: () => void;
}

export function NeedsActionPanel({
  state,
  errorMessage,
  unread,
  counts,
  items,
  urgentTotal,
  busy,
  onMarkRead,
  onOpen,
  onMarkAllRead,
  onShowUnread,
  onRetry,
}: NeedsActionPanelProps) {
  const t = useTranslations("operatorNoticesPage");
  const tShared = useTranslations();
  const locale = useLocale();

  /* 顶缘语气按**最重的那一档未读**染：有紧急就红，只有未读就琥珀，都读完了中性。
     读失败时不染语气——拿不到数的时候摆一个颜色等于报一个没有的结论。 */
  const tone =
    state !== "ready"
      ? "neutral"
      : counts.critical > 0
        ? "danger"
        : unread > 0
          ? "warning"
          : "neutral";

  const description =
    state === "loading"
      ? t("needsAction.loading")
      : state === "error"
        ? (errorMessage ?? t("needsAction.loadFailed"))
        : unread === 0
          ? t("needsAction.summaryNone")
          : t("needsAction.summary", {
              critical: counts.critical,
              warning: counts.warning,
              info: counts.info,
            });

  return (
    <PanelCard
      icon="bell"
      tone={tone}
      title={t("needsAction.title")}
      description={description}
      action={
        state === "ready" ? (
          <span className="flex flex-wrap items-center gap-xs">
            {unread > 0 ? (
              <Button variant="ghost" size="sm" onClick={onShowUnread}>
                {t("needsAction.showUnread", { count: unread })}
              </Button>
            ) : null}
            {/* 0 条时禁用而不是藏起来：藏起来的话，「读完了」与「这个平台没有这个
                功能」在屏幕上长得一样。 */}
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || unread === 0}
              onClick={onMarkAllRead}
            >
              {t("needsAction.markAll", { count: unread })}
            </Button>
          </span>
        ) : null
      }
    >
      {state === "loading" ? (
        <p className="text-body-sm text-muted-foreground">
          {t("needsAction.loading")}
        </p>
      ) : state === "error" ? (
        <EmptyState
          icon="bell"
          title={t("needsAction.loadFailed")}
          description={errorMessage ?? t("needsAction.loadFailedHint")}
          action={
            <Button variant="secondary" onClick={onRetry}>
              {tShared("common.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          {/* 三种「空」说的不是一件事：一条未读都没有 / 只剩「一般」没读 /
              紧急与重要都读完了。写成同一句会让人以为自己漏看了什么。 */}
          {unread === 0
            ? t("needsAction.emptyAll")
            : counts.info > 0
              ? t("needsAction.emptyUrgentWithInfo", { count: counts.info })
              : t("needsAction.emptyUrgent")}
        </p>
      ) : (
        <>
          <PanelList>
            {items.map((notice) => (
              <PanelItem
                key={notice.id}
                lead={
                  <StatusBadge tone={severityTone(notice.severity)}>
                    {t(`severity.${notice.severity}`)}
                  </StatusBadge>
                }
                main={
                  <span className="flex min-w-0 flex-col gap-2xs">
                    <span className="truncate text-label-md">
                      {notice.title}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {notice.body}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {formatDateTime(notice.publishedAt, locale)}
                      {" · "}
                      {/* system 来源没有人，写「系统」而不是「—」——后者会被当成
                          读不到。 */}
                      {notice.source === "system"
                        ? t("systemAuthor")
                        : (notice.createdByName ?? "—")}
                    </span>
                  </span>
                }
                trail={
                  <span className="flex shrink-0 items-center gap-xs">
                    {/* 没有落地页的那条不画这颗钮：点了不动的控件比没有更糟。 */}
                    {notice.link ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpen(notice)}
                      >
                        {t("needsAction.open")}
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => onMarkRead(notice.id)}
                    >
                      {t("needsAction.markOne")}
                    </Button>
                  </span>
                }
              />
            ))}
          </PanelList>
          {urgentTotal > items.length ? (
            <p className="text-body-sm text-muted-foreground">
              {t("needsAction.more", {
                total: urgentTotal,
                shown: items.length,
              })}
            </p>
          ) : null}
        </>
      )}
    </PanelCard>
  );
}
