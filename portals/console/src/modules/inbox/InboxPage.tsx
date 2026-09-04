"use client";

/**
 * InboxPage.tsx — 「待办与消息」(批 4b,owner 2026-09-04 裁定:待办与消息合并入口、按
 * 消息类型统一)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 一张列表两种类型:**待办**(派生自订单 / 订阅 / 配额 / 邀请 / 加油包真实状态,
 * 不落库、永远置顶、没有已读,处理完才消失)与 **消息**(inbox_messages 落库,有已读)。
 * 筛选:全部 / 待办 / 消息 / 未读(未读只对消息生效)。去重:同一件事有待办时,
 * 「全部」里只显示待办那一条,对应的知情类消息留在「消息」筛选下当历史。
 * `/todos` 保留并跳到 `?filter=todo`。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  Icon,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { useRouter } from "@/lib/i18n/navigation";
import {
  fetchInbox,
  markInboxAllRead,
  markInboxRead,
  type InboxMessage,
} from "@/api/console-bff";
import { formatInboxTime } from "@/lib/inbox-format";
import {
  isCoveredByTodo,
  useDerivedTodos,
  type TodoItem,
} from "@/features/todos/useDerivedTodos";
import { LoadFailedBanner } from "@/components/load/LoadFailed";

const PAGE_SIZE = 20;

type Filter = "all" | "todo" | "message" | "unread";
const FILTERS: Filter[] = ["all", "todo", "message", "unread"];

function parseFilter(raw: string | null): Filter {
  return FILTERS.includes(raw as Filter) ? (raw as Filter) : "all";
}

/** 绝对地址(http/https)= 站外链接;其余按站内路径走本地路由。 */
function isExternalLink(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

/** 追加分页时按 id 去重,后到的不覆盖已有行。 */
function mergeById(
  current: readonly InboxMessage[],
  incoming: readonly InboxMessage[],
): InboxMessage[] {
  const seen = new Set(current.map((m) => m.id));
  return [...current, ...incoming.filter((m) => !seen.has(m.id))];
}

export function InboxPage() {
  const t = useTranslations("inbox");
  const tTodo = useTranslations("todosPage");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState<Filter>(() =>
    parseFilter(searchParams.get("filter")),
  );
  useEffect(() => {
    setFilter(parseFilter(searchParams.get("filter")));
  }, [searchParams]);

  const [items, setItems] = useState<InboxMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const derived = useDerivedTodos();

  /**
   * 请求代次(批 6)。此前没有任何取消守卫:「加载更多」还在飞的时候点重试,
   * 那一页回来会把第 2 页接到刚重置的第 1 页后面——重复行 + React 重复 key。
   * 两次「加载更多」叠在一起同理。代次对不上的响应直接丢弃;合并时再按 id 去重,
   * 兜住服务端游标在同一时间戳上重叠的情形。
   */
  const loadSeq = useRef(0);

  const load = useCallback(async (before: string | null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchInbox({ limit: PAGE_SIZE, before });
      if (seq !== loadSeq.current) return;
      setItems((cur) => (before ? mergeById(cur, page.items) : page.items));
      setNextBefore(page.nextBefore);
      setUnreadCount(page.unreadCount);
      setLoadFailed(false);
    } catch {
      if (seq === loadSeq.current) setLoadFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load, reloadKey]);

  const retry = () => {
    setReloadKey((k) => k + 1);
    derived.reload();
  };

  const changeFilter = (next: Filter) => {
    setFilter(next);
    router.replace(next === "all" ? "/inbox" : `/inbox?filter=${next}`);
  };

  async function open(message: InboxMessage) {
    if (message.readAt === null) {
      try {
        await markInboxRead(message.id);
        setItems((cur) =>
          cur.map((m) =>
            m.id === message.id
              ? { ...m, readAt: new Date().toISOString() }
              : m,
          ),
        );
        setUnreadCount((n) => Math.max(0, n - 1));
      } catch {
        /* 标已读失败不拦跳转 */
      }
    }
    if (!message.link) return;
    // 外链不能走 next-intl 的路由器:它会加语言前缀,`https://…` 变成
    // `/zh-CN/https://…`(公告的 ctaUrl 就可能是绝对地址,库里也没有约束拦它)。
    if (isExternalLink(message.link)) {
      window.open(message.link, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(message.link);
  }

  async function markAll() {
    setError(null);
    try {
      await markInboxAllRead();
      const now = new Date().toISOString();
      setItems((cur) => cur.map((m) => ({ ...m, readAt: m.readAt ?? now })));
      setUnreadCount(0);
    } catch {
      setError(t("markAllFailed"));
    }
  }

  const todos: TodoItem[] =
    filter === "message" || filter === "unread" ? [] : derived.todos;
  const messages = useMemo(() => {
    if (filter === "todo") return [];
    let list = items;
    if (filter === "unread") list = list.filter((m) => m.readAt === null);
    // 「全部」里同一件事只出现一次:有待办就藏起对应的知情类消息。
    if (filter === "all")
      list = list.filter((m) => !isCoveredByTodo(m, derived.todos));
    return list;
  }, [filter, items, derived.todos]);

  const busy = loading || derived.loading;
  const nothing = !busy && todos.length === 0 && messages.length === 0;
  const emptyText =
    filter === "todo"
      ? t("emptyTodo")
      : filter === "unread"
        ? t("allRead")
        : filter === "message"
          ? t("empty")
          : t("emptyAll");

  return (
    <ViewLayout>
      <ViewHeader
        icon="bell"
        title={t("header.title")}
        description={t("header.description")}
      />

      {loadFailed ? <LoadFailedBanner onRetry={retry} retrying={busy} /> : null}
      {derived.partialFailed ? (
        <Banner tone="warning" title={tTodo("loadFailed")} />
      ) : null}
      {error !== null ? <Banner tone="danger" title={error} /> : null}

      <PageSection
        icon="bell"
        level={2}
        title={t("list.title")}
        description={t("list.description")}
        action={
          <SegmentedControl<Filter>
            size="sm"
            ariaLabel={t("filters.label")}
            value={filter}
            onChange={changeFilter}
            items={FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`) }))}
          />
        }
      >
        <div className="flex items-center justify-between gap-md text-body-sm text-muted-foreground">
          <span className="tabular-nums">
            {t("counts", {
              todos: derived.todos.length,
              unread: unreadCount,
            })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || unreadCount === 0}
            onClick={() => void markAll()}
          >
            <Icon name="check" size="xs" fallback="placeholder" />
            <span>{t("markAllRead")}</span>
          </Button>
        </div>

        {nothing ? (
          <p className="p-lg text-center text-body-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : null}

        <ul className="flex flex-col divide-y divide-border">
          {todos.map((todo) => (
            <li
              key={todo.key}
              className="flex items-start justify-between gap-md py-md"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                <span className="flex items-center gap-sm">
                  <StatusBadge tone="warning" dot>
                    {t("todoBadge")}
                  </StatusBadge>
                  <Badge variant="outline">{tTodo(`kind.${todo.kind}`)}</Badge>
                  <span className="min-w-0 truncate text-label-md font-semibold text-foreground">
                    {todo.title}
                  </span>
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {todo.detail}
                </span>
              </span>
              <Button size="sm" onClick={() => router.push(todo.href)}>
                {todo.actionLabel}
              </Button>
            </li>
          ))}
          {messages.map((m) => {
            const unread = m.readAt === null;
            return (
              <li key={m.id}>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-auto w-full items-start justify-start gap-md whitespace-normal py-md text-left"
                  onClick={() => void open(m)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <span className="flex items-center gap-sm">
                      <StatusBadge tone={unread ? "info" : "neutral"} dot>
                        {unread ? t("unreadBadge") : t("readBadge")}
                      </StatusBadge>
                      <Badge variant="outline">{t("messageBadge")}</Badge>
                      <span
                        className={`min-w-0 truncate text-label-md text-foreground ${unread ? "font-semibold" : "font-normal"}`}
                      >
                        {m.title}
                      </span>
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {m.body}
                    </span>
                    <span className="text-body-sm text-content-tertiary tabular-nums">
                      {formatInboxTime(m.createdAt, locale)}
                    </span>
                  </span>
                  {m.link ? (
                    <span className="inline-flex shrink-0 items-center gap-2xs text-body-sm text-muted-foreground">
                      {t("open")}
                      <Icon
                        name="chevron-right"
                        size="xs"
                        fallback="placeholder"
                      />
                    </span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>

        {filter !== "todo" && nextBefore ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="md"
              disabled={loading}
              onClick={() => void load(nextBefore)}
            >
              {loading ? t("loading") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </PageSection>

      <PageSection icon="info" level={2} title={t("notes.title")}>
        <p className="text-body-sm text-muted-foreground">{t("notes.body")}</p>
      </PageSection>
    </ViewLayout>
  );
}
