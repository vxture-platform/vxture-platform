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
import { PageSection, SectionBody } from "@/layout/shell";
import { isExternalLink, mergeById } from "@/lib/inbox-list";
import { useRouter } from "@/lib/i18n/navigation";
import {
  fetchInbox,
  deleteInboxMessage,
  markInboxAllRead,
  markInboxRead,
  type InboxMessage,
} from "@/api/console-bff";
import { formatInboxTime } from "@/lib/inbox-format";
import {
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
  /* 正在删的那几条:按 id 记而不是一个全局 busy——同时删两条时，
     一个全局标志会让两个按钮一起变灰，看不出是哪条在动。 */
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());

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

  /**
   * 删除一条消息（软删）。
   *
   * 乐观移除：先从列表里拿掉，失败再放回去并报错。这一步的判断依据是——删除是
   * 幂等的、后端不会因为重复请求出错，而「点了没反应」比「删错了要撤回」更常见
   * 也更烦人。
   *
   * 未读的那条被删掉时，本地未读数要跟着减：角标与列表必须对得上，否则会出现
   * 「角标 3 条未读、点进去一条也没有」。
   */
  async function remove(m: InboxMessage) {
    if (deleting.has(m.id)) return;
    setDeleting((cur) => new Set(cur).add(m.id));
    const snapshot = items;
    const wasUnread = m.readAt === null;
    setItems((cur) => cur.filter((x) => x.id !== m.id));
    if (wasUnread) setUnreadCount((n) => Math.max(0, n - 1));
    try {
      await deleteInboxMessage(m.id);
    } catch {
      setItems(snapshot);
      if (wasUnread) setUnreadCount((n) => n + 1);
      setError(t("deleteFailed"));
    } finally {
      setDeleting((cur) => {
        const next = new Set(cur);
        next.delete(m.id);
        return next;
      });
    }
  }

  const todos: TodoItem[] =
    filter === "message" || filter === "unread" ? [] : derived.todos;
  const messages = useMemo(() => {
    if (filter === "todo") return [];
    let list = items;
    if (filter === "unread") list = list.filter((m) => m.readAt === null);
    /* owner 2026-09-09:**没删除的全部显示**。
       此前「全部」这一档会把「已有对应待办」的知情类消息藏起来（去重），
       但那条规则让人无法确认「那条通知到底来没来」——待办是派生的、会消失，
       消息是落库的凭据。要去重就在待办那一侧做，不要让消息凭空少一条。 */
    return list;
  }, [filter, items]);

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
              /* 删除键**在主按钮之外**:整行本身是个 Button（点开消息），
                 把删除嵌进去就是按钮套按钮——HTML 不允许，浏览器会拆开，
                 点删除会落到外层的「打开」上。并排放，两个动作各自独立。 */
              <li key={m.id} className="flex items-start gap-2xs">
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-auto min-w-0 flex-1 items-start justify-start gap-md whitespace-normal py-md text-left"
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mt-md shrink-0 text-muted-foreground"
                  aria-label={t("delete", { title: m.title })}
                  disabled={deleting.has(m.id)}
                  onClick={() => void remove(m)}
                >
                  <Icon name="trash" size="xs" fallback="placeholder" />
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
        <SectionBody>
          <p className="text-body-sm text-muted-foreground">
            {t("notes.body")}
          </p>
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
