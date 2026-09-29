"use client";

/**
 * TicketsPage.tsx — 我的工单（owner 2026-09-29 裁决，批 2）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * ── 这一页之前不存在 ──
 * 客户在产品里**从来没有过**求助的去处：console 没有工单路由、没有工单模块，
 * 真实的支持渠道是官网上的一个邮箱地址。批 1 在运营侧开出了建单与回复端点
 * （`support.tickets` 那张表在那之前一行都没有），这一页是客户这一侧的第一半。
 *
 * ── 可见范围是租户，不是个人 ──
 * owner 第 1 条裁决：同租户成员都看得见同一批单。所以这一页不挂 capability，
 * 也不按当前登录人过滤——一个同事提的单，另一个同事接手跟进是常态。页面上的
 * 「提交人」因此是一列真实信息，不是废话。
 *
 * ── 结构照 `VouchersPage` ──
 * 页头 → 概览指标 → 清单板块（工具行 + 表格 + 分页）→ 说明板块。表格遵守默认
 * 结构（序号列 + 单操作列 + 分页），列对齐照全站规范（首列左、其余居中），
 * 读失败显影成 Error 态而不是画成「没有工单」。无自造样式层。
 *
 * ── 全页无 uuid ──
 * 工单在客户这一侧只有可视码（`TK-{YYYYMM}-{10}`）：它是行 key、是详情路由的
 * 参数、是印在行上的那串字，也是通知正文里客户读到的那串字。客户端拿到的投影
 * 里根本没有行 id（见 `ConsoleTicket`）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  MetricGridItem,
} from "@vxture/design-system";
import { TICKET_STATUSES, type TicketStatus } from "@vxture-platform/shared";
import { fetchMyTickets, type ConsoleTicket } from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { ListPagination } from "@/components/pagination";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { useDateFormat } from "@/lib/use-date-format";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import {
  buildTicketDetailHref,
  parseTicketCompose,
  type TicketSubject,
} from "@/lib/ticket-compose";
import { isOpenTicket } from "@/lib/ticket-state";
import { TicketComposeDialog } from "./TicketComposeDialog";
import {
  ticketStatusTone,
  useTicketEventPresentation,
  useTicketStatusLabel,
} from "./ticket-labels";

const TICKETS_PAGE_SIZE = 10;

/** 状态筛选：七个状态，外加「全部」与「未结」。默认停在未结。 */
type TicketFilter = TicketStatus | "all" | "unresolved";

export function TicketsPage() {
  const t = useTranslations("tickets.list");
  const tCompose = useTranslations("tickets.compose");
  const statusLabel = useTicketStatusLabel();
  const eventPresentation = useTicketEventPresentation();
  const tableLabels = useTableLabels();
  const { fmtDate, fmtTime } = useDateFormat();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useConsoleSession();

  const [tickets, setTickets] = useState<ConsoleTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<TicketFilter>("unresolved");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(TICKETS_PAGE_SIZE);
  const [copiedNo, setCopiedNo] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState<TicketSubject | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchMyTickets()
      .then((rows) => {
        if (active) setTickets(rows);
      })
      .catch(() => {
        if (!active) return;
        setTickets([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  /* 对象页跳过来的那一下：`?compose=1&aboutType=…&about=…`（拼与拆都在
     `lib/ticket-compose.ts`）。

     依赖是**查询串本身**，不是 `useSearchParams()` 返回的那个对象：对象的引用
     稳不稳定不在我们手上，而它一变这个 effect 就会把客户刚关掉的对话框重新弹
     开——一个关不掉的框。再压一道 ref：同一个查询串只认一次，换一条链接进来
     （另一个对象的求助）才再开一次。 */
  const composeQuery = searchParams?.toString() ?? "";
  const intent = useMemo(
    () => parseTicketCompose(new URLSearchParams(composeQuery)),
    [composeQuery],
  );
  const handledComposeQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!intent.compose || handledComposeQuery.current === composeQuery) return;
    handledComposeQuery.current = composeQuery;
    setComposeSubject(intent.subject);
    setComposeOpen(true);
  }, [intent, composeQuery]);

  useEffect(() => {
    if (!copiedNo) return;
    const timer = window.setTimeout(() => setCopiedNo(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copiedNo]);

  const resetFilters = useCallback(() => {
    setFilter("unresolved");
    setQuery("");
    setPage(1);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (filter === "unresolved" && !isOpenTicket(ticket.status)) return false;
      if (
        filter !== "all" &&
        filter !== "unresolved" &&
        ticket.status !== filter
      )
        return false;
      if (!q) return true;
      // 搜索面：工单码与标题——客户手上就这两样（通知正文里给的也是码）。
      return [ticket.ticketNo, ticket.title].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [tickets, filter, query]);

  const sortAccessors = useMemo(
    () => ({
      ticket: (ticket: ConsoleTicket) => ticket.ticketNo,
      activity: (ticket: ConsoleTicket) =>
        ticket.lastActivityAt
          ? new Date(ticket.lastActivityAt).getTime()
          : null,
      created: (ticket: ConsoleTicket) => new Date(ticket.createdAt).getTime(),
    }),
    [],
  );
  const {
    sort,
    onSortChange,
    rows: sortedTickets,
  } = useTableSort(visible, sortAccessors);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => {
    setPage((p) =>
      Math.min(p, Math.max(1, Math.ceil(visible.length / pageSize))),
    );
  }, [visible.length, pageSize]);
  const pagedTickets = useMemo(
    () => sortedTickets.slice((page - 1) * pageSize, page * pageSize),
    [sortedTickets, page, pageSize],
  );

  const metrics = useMemo<MetricGridItem[]>(() => {
    const unresolved = tickets.filter((ticket) => isOpenTicket(ticket.status));
    const awaiting = tickets.filter((ticket) => ticket.status === "resolved");
    // 读不到就是「—」：读失败时的 0 不是「没有工单」，是「没有数据」。
    const count = (n: number) => (loadFailed ? "—" : String(n));
    return [
      {
        id: "unresolved",
        icon: "chat-dots",
        label: t("metrics.unresolved"),
        value: count(unresolved.length),
        trend: loadFailed ? "" : t("metrics.unresolvedHint"),
      },
      {
        id: "awaiting",
        icon: "seal-check",
        label: t("metrics.awaiting"),
        value: count(awaiting.length),
        trend: loadFailed ? "" : t("metrics.awaitingHint"),
        ...(awaiting.length > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "total",
        icon: "stack",
        label: t("metrics.total"),
        value: count(tickets.length),
        trend: loadFailed ? "" : t("metrics.totalHint"),
      },
    ];
  }, [tickets, t, loadFailed]);

  const openDetail = (ticket: ConsoleTicket) =>
    router.push(buildTicketDetailHref(ticket.ticketNo));

  /** 时间列：日期为主、时间为辅（与卡券 / 账单同一种写法）。 */
  const timeCell = (iso: string | null) =>
    iso ? (
      <span className="flex flex-col items-center tabular-nums">
        <span className="text-foreground">{fmtDate(iso)}</span>
        <span className="text-body-sm text-muted-foreground">
          {fmtTime(iso)}
        </span>
      </span>
    ) : (
      "—"
    );

  const columns: DataTableColumn<ConsoleTicket>[] = [
    {
      id: "ticket",
      sortable: true,
      header: t("table.colTicket"),
      cell: (ticket) => (
        <TableTitleCell
          title={ticket.title}
          /* 单号 + 报单人。报单人不单开一列：它是「这张单是谁的」的附属说明，
             与单号同属一事；另起一列会把表格挤到无用。读不到就不画那一段。 */
          description={
            <span className="flex flex-col gap-3xs">
              <span className="font-mono">{ticket.ticketNo}</span>
              {ticket.reporterName ? (
                <span>
                  {t("table.reporter", { name: ticket.reporterName })}
                </span>
              ) : null}
            </span>
          }
          onTitleClick={() => openDetail(ticket)}
        />
      ),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (ticket) => (
        <StatusBadge tone={ticketStatusTone(ticket.status)}>
          {statusLabel(ticket.status)}
        </StatusBadge>
      ),
    },
    {
      id: "activity",
      sortable: true,
      header: t("table.colActivity"),
      align: "center",
      /* 「最后一次动静」读的是**客户可见**的那条流水的时刻，不是行的 updated_at：
         运营写一条内部备注也会推进 updated_at，而那条动静客户读不到。拿后者当
         这一列的值，客户会看到「刚刚有动静」然后点进去发现时间线一个字没变。 */
      cell: (ticket) => (
        <span className="flex flex-col items-center gap-2xs">
          {timeCell(ticket.lastActivityAt)}
          {ticket.lastActivityEventType ? (
            <Badge variant="outline">
              {eventPresentation(ticket.lastActivityEventType).label}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "created",
      sortable: true,
      header: t("table.colCreated"),
      align: "center",
      cell: (ticket) => timeCell(ticket.createdAt),
    },
  ];

  async function copyTicketNo(ticket: ConsoleTicket) {
    try {
      await navigator.clipboard.writeText(ticket.ticketNo);
      setCopiedNo(ticket.ticketNo);
    } catch {
      // 剪贴板被浏览器拒了（非安全上下文 / 无权限）：码本来就印在行上，不弹错打断。
    }
  }

  function ticketMenuItems(ticket: ConsoleTicket): ActionMenuItem[] {
    return [
      {
        id: "detail",
        label: t("actions.detail"),
        icon: "list-checks",
        onSelect: () => openDetail(ticket),
      },
      {
        id: "copy",
        label:
          copiedNo === ticket.ticketNo
            ? t("actions.copied")
            : t("actions.copy"),
        icon: copiedNo === ticket.ticketNo ? "check" : "copy",
        onSelect: () => void copyTicketNo(ticket),
      },
    ];
  }

  const filtered = query.trim().length > 0 || filter !== "unresolved";

  return (
    <ViewLayout>
      <ViewHeader
        icon="chat-dots"
        title={t("title")}
        description={t("description")}
        action={
          <Button
            size="md"
            onClick={() => {
              setComposeSubject(null);
              setComposeOpen(true);
            }}
          >
            <Icon name="plus" size="xs" fallback="placeholder" />
            <span>{tCompose("open")}</span>
          </Button>
        }
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="chat-dots"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: visible.length })}
            aria-label={t("filters.groupLabel")}
            onReset={resetFilters}
            search={
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("filters.searchPlaceholder")}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={t("filters.searchAriaLabel")}
              />
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as TicketFilter);
                setPage(1);
              }}
              aria-label={t("filters.statusAriaLabel")}
            >
              <option value="unresolved">
                {t("filters.statusUnresolved")}
              </option>
              {/* 七个状态逐条列出，取值与词都来自值域那一份，不在这里另抄一张表。 */}
              {TICKET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
              <option value="all">{t("filters.statusAll")}</option>
            </NativeSelect>
          </FilterBar>

          <DataTable<ConsoleTicket>
            labels={tableLabels}
            columns={columns}
            rows={pagedTickets}
            /* 行 key 用可视码：它 NOT NULL + UNIQUE，而行 id 是 uuid，
               uuid 连 React key 都不许当（owner 铁律）。 */
            rowKey={(ticket) => ticket.ticketNo}
            {...(sort ? { sort } : {})}
            onSortChange={onSortChange}
            leadingSpacer
            loading={loading}
            indexStart={(page - 1) * pageSize + 1}
            rowActions={(ticket) => (
              <span className="inline-flex items-center justify-center">
                <ActionMenu
                  items={ticketMenuItems(ticket)}
                  label={t("actions.menuLabel")}
                />
              </span>
            )}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  icon="chat-dots"
                  title={filtered ? t("table.emptyFiltered") : t("table.empty")}
                  {...(filtered ? {} : { description: t("table.emptyHint") })}
                  action={
                    filtered ? (
                      <Button
                        variant="outline"
                        size="md"
                        onClick={resetFilters}
                      >
                        <Icon name="x" size="xs" fallback="placeholder" />
                        <span>{t("filters.reset")}</span>
                      </Button>
                    ) : (
                      <Button
                        size="md"
                        onClick={() => {
                          setComposeSubject(null);
                          setComposeOpen(true);
                        }}
                      >
                        <Icon name="plus" size="xs" fallback="placeholder" />
                        <span>{tCompose("open")}</span>
                      </Button>
                    )
                  }
                />
              )
            }
            footer={
              <ListPagination
                page={page}
                pageCount={pageCount}
                total={loadFailed ? 0 : visible.length}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                onPageChange={setPage}
              />
            }
          />
        </div>
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
          <SignalList
            items={[
              {
                title: t("notes.scopeTitle"),
                description: t("notes.scopeBody"),
              },
              {
                title: t("notes.noticeTitle"),
                description: t("notes.noticeBody"),
              },
              {
                title: t("notes.closedTitle"),
                description: t("notes.closedBody"),
              },
            ]}
          />
        </SectionBody>
      </PageSection>

      <TicketComposeDialog
        open={composeOpen}
        subject={composeSubject}
        onClose={() => setComposeOpen(false)}
        onCreated={(ticket) => {
          setComposeOpen(false);
          /* 提交完直接去那张单：客户的下一步是看它，不是回到列表里找它。 */
          router.push(buildTicketDetailHref(ticket.ticketNo));
        }}
      />
    </ViewLayout>
  );
}
