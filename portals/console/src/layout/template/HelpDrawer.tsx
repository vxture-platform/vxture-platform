"use client";

/**
 * HelpDrawer.tsx — 顶栏「?」的侧边抽屉：**我那几张单办到哪了**。
 * @package @vxture/console
 * @layer Presentation
 * @category Layout
 *
 * ── 在这之前「?」是个死控件 ──
 * `ConsoleHeader` 里那颗按钮的 onClick 是 `() => {}`：它有图标、有可访问名、
 * 有 hover 反馈，点下去什么都不发生。owner 2026-09-29 第 5 条裁决把它定成一个
 * 抽屉，所以这一批不是"加一个入口"，是**把一个假按钮变成真的**。
 *
 * ── 它只答一个问题 ──
 * 列**未关闭**的工单 + 各自最后一次动静。不是收件箱、不是会话界面、不放全文。
 * 点任一条进详情页；底部两颗：提交工单 / 查看全部。
 *
 * ── 它**没有已读** ──
 * 这是 owner 第 5 与第 6 条裁决合起来最要紧的一条：已读只存在消息中心一处。
 * 抽屉是**派生视图**（同待办的口径：待办派生自业务状态，也没有已读）。两处都
 * 管已读的后果是客户在一处点掉，另一处还亮着——而他没有任何办法知道该去哪一处
 * 才算真的清掉。所以这个文件里**没有**未读点、没有角标、没有「全部已读」，
 * 也不调 inbox 的任何标已读端点。要加之前先回去读那两条裁决。
 *
 * ── 文档中心的入口不在这里（本批） ──
 * 第 3 条裁决要做 `docs.vxture.com`，它是第七个门户，全仓今天零引用。抽屉顶部
 * 那个「搜索 + 打开文档中心」要等它存在之后再挂——现在挂上去就是一颗指向 404 的
 * 按钮，正是这个文件在修的那种东西。
 */

import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Drawer,
  EmptyState,
  Icon,
  PanelItem,
  PanelList,
  Skeleton,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { ConsoleTicket } from "@/api/console-bff";
import { useDateFormat } from "@/lib/use-date-format";
import {
  TICKETS_PATH,
  buildTicketComposeHref,
  buildTicketDetailHref,
} from "@/lib/ticket-compose";
import {
  useTicketEventPresentation,
  useTicketStatusLabel,
  ticketStatusTone,
} from "@/modules/support/ticket-labels";

export interface HelpDrawerProps {
  readonly onClose: () => void;
  /** 关抽屉再跳（抽屉是入口，不是目的地）。 */
  readonly onNavigate: (href: string) => void;
  /** 未关闭的工单；`null` = 还没读到或读失败（两者由 `failed` 区分）。 */
  readonly tickets: readonly ConsoleTicket[] | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

export function HelpDrawer({
  onClose,
  onNavigate,
  tickets,
  loading,
  failed,
  onRetry,
}: HelpDrawerProps) {
  const t = useTranslations("tickets.drawer");
  const statusLabel = useTicketStatusLabel();
  const presentationOf = useTicketEventPresentation();
  const { fmtDateTime } = useDateFormat();

  const go = (href: string) => {
    onClose();
    onNavigate(href);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      width="lg"
      closeLabel={t("close")}
      title={
        <span className="flex items-center gap-sm">
          <Icon name="help" size="sm" fallback="info" aria-hidden="true" />
          {t("title")}
        </span>
      }
      description={t("description")}
      footer={
        <div className="flex flex-wrap items-center gap-sm">
          <Button size="md" onClick={() => go(buildTicketComposeHref())}>
            <Icon name="plus" size="xs" fallback="placeholder" />
            <span>{t("submit")}</span>
          </Button>
          <Button variant="outline" size="md" onClick={() => go(TICKETS_PATH)}>
            <Icon name="list" size="xs" fallback="placeholder" />
            <span>{t("viewAll")}</span>
          </Button>
        </div>
      }
    >
      {loading && tickets === null ? (
        <div className="flex flex-col gap-sm">
          <Skeleton className="h-icon-2xl w-full rounded-lg" />
          <Skeleton className="h-icon-2xl w-full rounded-lg" />
          <Skeleton className="h-icon-2xl w-full rounded-lg" />
        </div>
      ) : failed ? (
        /* 读失败不画成「你没有工单」：那是最让人放心、也最错的一句话。 */
        <div className="flex flex-col gap-sm">
          <Banner
            tone="danger"
            title={t("failedTitle")}
            description={t("failedDescription")}
          />
          <div>
            <Button
              variant="outline"
              size="md"
              onClick={onRetry}
              disabled={loading}
            >
              <Icon name="refresh" size="xs" fallback="placeholder" />
              <span>{t("retry")}</span>
            </Button>
          </div>
        </div>
      ) : tickets && tickets.length > 0 ? (
        <PanelList>
          {tickets.map((ticket) => {
            /* 「最后一次动静」= 最后一条**客户可见**流水的时刻与种类。没有任何
               可见流水时只说"还没有回应"，不退回去显示 updated_at——那个值会被
               内部备注推进，客户点进来会发现时间线一个字没变。 */
            const activity = ticket.lastActivityEventType
              ? presentationOf(ticket.lastActivityEventType)
              : null;
            const meta =
              activity && ticket.lastActivityAt
                ? t("activity", {
                    what: activity.label,
                    when: fmtDateTime(ticket.lastActivityAt),
                  })
                : t("noActivity");
            return (
              <PanelItem
                key={ticket.ticketNo}
                lead={
                  <Icon
                    name={activity?.icon ?? "clock"}
                    size="sm"
                    fallback="info"
                    aria-hidden="true"
                  />
                }
                main={
                  <TableTitleCell
                    title={ticket.title}
                    layout="stacked"
                    description={
                      <span className="flex flex-col gap-2xs">
                        <span className="font-mono">{ticket.ticketNo}</span>
                        <span>{meta}</span>
                      </span>
                    }
                    onTitleClick={() =>
                      go(buildTicketDetailHref(ticket.ticketNo))
                    }
                  />
                }
                trail={
                  <StatusBadge tone={ticketStatusTone(ticket.status)}>
                    {statusLabel(ticket.status)}
                  </StatusBadge>
                }
              />
            );
          })}
        </PanelList>
      ) : (
        <EmptyState
          icon="seal-check"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      )}
    </Drawer>
  );
}
