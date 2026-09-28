"use client";

/* 运营通告 — 发布面 + 本平面的收件面。
 *
 * owner 2026-09-20：「面向客户的由 admin 发布，面向内部运营的由 opera 发布」。
 * 所以**写侧只在这一页**；admin / arche 各自在自己的首页读，读不到写。
 *
 * 与 admin 的「平台公告」不是一回事：那张面向**客户**（按套餐 / 租户类型投放，
 * 客户在 console 看见），能力码 content:announcement.*。这一页面向**运营者**，
 * 能力码 ops:notice.*，两条线互不相干。
 *
 * 撤回走软删：通告已经被人看过、已读关系也落了表，硬删会连带抹掉「谁读过」这个
 * 事实。撤回只是让它退出各平面的列表。
 *
 * ── 第四批（2026-09-28）：读得懂 ──
 * 前三批刻意把信号做全（维护窗口逾期 / 产品生命周期 / 作业心跳 / webhook 死信 /
 * 业务与运营动作巡检都会往本平面播系统通告），于是这一页从「偶尔几条」变成了
 * 「翻不完」。这一批不删任何信号，只让它读得懂，三件事：
 *
 *   ① 顶上一块「需要处理」（`NeedsActionPanel`）。它读的是**收件面**，与下面那张表
 *      的筛选互不相干——跟着筛的话，「需要处理 0 条」会在筛掉它们之后出现，而那正是
 *      最不该让人以为「没事了」的时刻。
 *   ② 四项筛选（严重度 / 来源 / 只看未读 / 关键词）全部**在服务端**生效。在浏览器
 *      里筛当前这一页是个确定的错答案：条数与三档计数只能按已经被截断过的那一段算，
 *      于是「共 37 条」从第 501 条起开始说谎，而没人看得出来。
 *   ③ 严重度那个下拉里带**命中数**（口径「除严重度以外的筛选都算上」），所以勾了
 *      一档之后另两档还报得出数——那排数字才能当入口用。
 *
 * ── 「全部标记已读」为什么不在筛选栏上 ──
 * 它清掉的是**本平面全部未读**（= 外壳铃铛角标的那个数 = BFF `read-all` 的作用域）。
 * 摆在一屏筛过的列表旁边，「全部」会被读成「这一屏」，两种读法差一个数量级。所以它
 * 长在「需要处理」那一块里，标签上带着那个数。
 *
 * ── 点标题就是点进去，顺手把那一条标成已读 ──
 * 判据与理由在 `@/modules/notices/click-through` 文件头**一处**写着，这一页与上面那一块
 * 「需要处理」都只调用它（`openOne`），谁都不再复述一遍。没有落地页的那些标题不做成
 * 可点的——`TableTitleCell` 不给 `onTitleClick` 就是纯文本。
 *
 * ── 严重度用下拉而不是筛选气泡 ──
 * admin 的同一维度用了 `FilterPopover`（多选）。这里跟随 DS 那一件自己的判据与本门户
 * 既有体例（`capability/registry`）：取值只有三个、天天要筛的维度留在工具行做下拉，
 * 气泡只收取值多、偶尔才筛的那些。命中数照样显示在选项后面。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTier,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
} from "@vxture/design-system";
import { useLocale, useTranslations } from "next-intl";
import { FIELD_LABEL_A11Y, FIELD_TIER_TITLE } from "@/lib/form-labels";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useTableLabels } from "@/lib/table";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";
import { formatDateTime } from "@vxture-platform/shared";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";
import { useDebounced } from "@/lib/useDebounced";
import { notifyNoticesChanged } from "@/lib/notice-unread";
import {
  NOTICE_SEVERITIES,
  URGENT_SEVERITIES,
  severityTone,
  type NoticeSeverity,
} from "@/modules/notices/severity";
import {
  NeedsActionPanel,
  type InboxNotice,
} from "@/modules/notices/NeedsActionPanel";
import {
  markReadBlocker,
  openNotice,
  type ClickThroughNotice,
} from "@/modules/notices/click-through";

/** 写操作的能力码，与 BFF 的能力门同名。 */
const MANAGE = "ops:notice.manage";

const PLANES = ["admin", "opera", "arche"] as const;
type Plane = (typeof PLANES)[number];

type Source = "manual" | "system";
const SOURCES: readonly Source[] = ["manual", "system"];

/** 「需要处理」那一块列几条。再多就不是「现在要做什么」，是一张表了。 */
const NEEDS_ACTION_LIMIT = 5;

/**
 * 收件面：只要本平面**未读**里紧急与重要的那些。
 *
 * `unread` 与 `counts` 由同一个响应带回来，所以「需要处理」那一块里的数字与铃铛角标
 * 出自同一次计算，不会各说一个数。
 */
const INBOX_PATH =
  `/api/operator-notices/inbox?scope=all&unread=true` +
  `&severity=${URGENT_SEVERITIES.join(",")}&limit=${NEEDS_ACTION_LIMIT}`;

type SeverityCounts = Record<NoticeSeverity, number>;

const ZERO_COUNTS: SeverityCounts = { info: 0, warning: 0, critical: 0 };

interface OperatorNoticeItem {
  id: string;
  /** 空数组 = 三个平面都看得见。 */
  targetPlanes: Plane[];
  severity: NoticeSeverity;
  title: string;
  body: string;
  link: string | null;
  source: Source;
  publishedAt: string;
  expiresAt: string | null;
  createdByName: string | null;
  createdAt: string;
  /** 本人读过的时刻；null = 未读。只对投放本平面的有意义。 */
  readAt: string | null;
  /** 这条投不投放到 opera。由 BFF 判，前端不自己解 targetPlanes。 */
  onThisPlane: boolean;
}

interface NoticeListResult {
  items: OperatorNoticeItem[];
  total: number;
  matched: number;
  counts: SeverityCounts;
}

interface InboxResult {
  items: InboxNotice[];
  total: number;
  unread: number;
  counts: SeverityCounts;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

interface NoticeForm {
  title: string;
  body: string;
  link: string;
  severity: NoticeSeverity;
  /** 勾选集合。三个都勾 = 全部，提交时收敛成空数组（与 BFF 同一口径）。 */
  planes: Set<Plane>;
  expiresAt: string;
}

function createDefaultForm(): NoticeForm {
  return {
    title: "",
    body: "",
    link: "",
    severity: "info",
    // 默认全选：通告的常态是「三个平面都该知道」，要收窄才动它。
    planes: new Set(PLANES),
    expiresAt: "",
  };
}

function buildPayload(form: NoticeForm) {
  const planes = [...form.planes];
  return {
    title: form.title.trim(),
    body: form.body.trim(),
    link: form.link.trim() || null,
    severity: form.severity,
    // 三个都勾就送空数组——与「没勾任何限制」落成同一种表示，
    // 否则读侧的「空 = 全部」判据会漏掉展开过的那一半。
    targetPlanes: planes.length === PLANES.length ? [] : planes,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  };
}

function formIsValid(form: NoticeForm): boolean {
  return (
    form.title.trim().length > 0 &&
    form.body.trim().length > 0 &&
    // 一个平面都不勾 = 谁也看不到，那不是一条通告。
    form.planes.size > 0
  );
}

/**
 * 「标这一条已读」那一个请求。行操作那颗菜单项与点进去都发这一个。
 *
 * 敲订阅点（`notifyNoticesChanged`）不在这里，在各自的调用点：行操作标完人还在这一页，
 * 还要把两张列表重取；点进去人已经走了，只剩角标需要重取。
 */
function postMarkRead(noticeId: string): Promise<unknown> {
  return api.post(`/api/operator-notices/${noticeId}/read`);
}

/** 后端文案本身就是给人看的，照原样带出。 */
function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

export default function OperatorNoticesPage() {
  const t = useTranslations("operatorNoticesPage");
  const tShared = useTranslations();
  const locale = useLocale();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { can } = useOperatorSession();
  const { toast } = useToast();
  const router = useRouter();
  const canManage = can(MANAGE);

  const [rows, setRows] = useState<OperatorNoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [matched, setMatched] = useState(0);
  const [counts, setCounts] = useState<SeverityCounts>(ZERO_COUNTS);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const [inbox, setInbox] = useState<InboxResult>({
    items: [],
    total: 0,
    unread: 0,
    counts: ZERO_COUNTS,
  });
  const [inboxLoad, setInboxLoad] = useState<LoadState>({ kind: "loading" });

  /* 输入框里的原文与真正下发的关键词分两份，中间隔着防抖：筛选在服务端做，
     不防抖就是每敲一个字符一次请求。 */
  const [keywordInput, setKeywordInput] = useState("");
  const keyword = useDebounced(keywordInput);
  const [severity, setSeverity] = useState<NoticeSeverity | "all">("all");
  const [source, setSource] = useState<Source | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NoticeForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  const filtered =
    keyword.trim() !== "" ||
    severity !== "all" ||
    source !== "all" ||
    unreadOnly;

  /* 四项筛选进查询串：给了才写，没给的那一项一个字都不出现——BFF 那边把
     「给了个空的」与「没给」当同一件事，这里也一样，免得出现一个只在客户端
     存在的第三态。 */
  const listQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (includeExpired) params.set("includeExpired", "true");
    if (severity !== "all") params.set("severity", severity);
    if (source !== "all") params.set("source", source);
    if (unreadOnly) params.set("unread", "true");
    const trimmed = keyword.trim();
    // 线上名是 q，与 admin 侧逐字相同——同一件事在两个平面该叫同一个词。
    if (trimmed) params.set("q", trimmed);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [includeExpired, severity, source, unreadOnly, keyword]);

  const reloadList = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<NoticeListResult>(
        `/api/operator-notices${listQuery}`,
      );
      setRows(data.items);
      setTotal(data.total);
      setMatched(data.matched);
      setCounts(data.counts);
      setLoad({ kind: "ready" });
    } catch (error) {
      // 读失败与「本来就没有」是两件事，空态要能分辨。
      setRows([]);
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : t("loadFailed"),
      });
    }
  }, [listQuery, t]);

  const reloadInbox = useCallback(async () => {
    setInboxLoad({ kind: "loading" });
    try {
      const data = await api.get<InboxResult>(INBOX_PATH);
      setInbox(data);
      setInboxLoad({ kind: "ready" });
    } catch (error) {
      // 角标与「需要处理」都不画数：拿不到数就不报数，画 0 会被读成「都读完了」。
      setInbox({ items: [], total: 0, unread: 0, counts: ZERO_COUNTS });
      setInboxLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : t("loadFailed"),
      });
    }
  }, [t]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  useEffect(() => {
    void reloadInbox();
  }, [reloadInbox]);

  /** 两张列表一起重取：已读状态同时出现在两处，只刷一处会当场互相矛盾。 */
  const reloadBoth = useCallback(async () => {
    await Promise.all([reloadList(), reloadInbox()]);
  }, [reloadList, reloadInbox]);

  const sortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<OperatorNoticeItem>>>
  >(
    () => ({
      title: (r) => r.title,
      severity: (r) => r.severity,
      readAt: (r) => (r.onThisPlane ? (r.readAt ?? "") : null),
      publishedAt: (r) => r.publishedAt,
      expiresAt: (r) => r.expiresAt,
      createdByName: (r) => r.createdByName,
    }),
    [],
  );
  const sort = useTableSort(rows, sortAccessors, {
    columnId: "publishedAt",
    direction: "desc",
  });
  const paged = useListPagination(sort.rows, 20);

  function openCreate() {
    setForm(createDefaultForm());
    setDialogOpen(true);
  }

  function togglePlane(plane: Plane) {
    setForm((f) => {
      const next = new Set(f.planes);
      if (next.has(plane)) next.delete(plane);
      else next.add(plane);
      return { ...f, planes: next };
    });
  }

  function resetFilters() {
    setKeywordInput("");
    setSeverity("all");
    setSource("all");
    setUnreadOnly(false);
    setIncludeExpired(false);
    paged.resetPage();
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/operator-notices", buildPayload(form));
      toast({ tone: "success", title: t("toast.published") });
      setDialogOpen(false);
      // 发布也会改角标：新通告如果投到本平面，本人对它就是未读。
      notifyNoticesChanged();
      await reloadBoth();
    } catch (error) {
      toast({
        tone: "danger",
        title: t("toast.publishFailed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(item: OperatorNoticeItem) {
    setSubmitting(true);
    try {
      await api.delete(`/api/operator-notices/${item.id}`);
      toast({ tone: "success", title: t("toast.withdrawn") });
      notifyNoticesChanged();
      await reloadBoth();
    } catch (error) {
      toast({
        tone: "danger",
        title: t("toast.withdrawFailed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function markRead(noticeId: string) {
    setSubmitting(true);
    try {
      await postMarkRead(noticeId);
      // 角标是这一下唯一的可见证据，所以先通知外壳，再等两张列表回来。
      notifyNoticesChanged();
      await reloadBoth();
    } catch (error) {
      toast({
        tone: "danger",
        title: t("toast.markReadFailed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 点进一条通告：先标已读再跳（判据与理由见 `@/modules/notices/click-through` 文件头）。
   *
   * 注入的标记与上面那个 `markRead` 差两件事，都因为**人已经走了**：不重取这一页的两张
   * 列表（这一段马上卸载），失败只 toast 不拦跳转（角标由 `openNotice` 敲订阅点重取，
   * 它报回来的是库里的真数，所以标失败时角标不会替我们撒谎）。
   */
  function openOne(notice: ClickThroughNotice) {
    openNotice(notice, {
      markRead: (noticeId) =>
        postMarkRead(noticeId).catch((error: unknown) => {
          toast({
            tone: "danger",
            title: t("toast.markReadFailed"),
            ...describeError(error),
          });
        }),
      navigate: (link) => router.push(link),
    });
  }

  async function markAllRead() {
    setSubmitting(true);
    try {
      const result = await api.post<{ marked: number }>(
        "/api/operator-notices/read-all",
      );
      notifyNoticesChanged();
      toast({
        tone: "success",
        // 报「刚才那一下管到了几条」，不是「可见的总条数」：0 条也是合法答案。
        title: t("toast.markAllRead", { count: result.marked }),
      });
      await reloadBoth();
    } catch (error) {
      toast({
        tone: "danger",
        title: t("toast.markReadFailed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * BFF 一次最多取回 `LIST_LIMIT` 条，翻页是在取回来的那一批里做的。
   *
   * `matched` 是库里真正命中的条数（汇总语句算的，不受这个上限影响），所以它可以大于
   * 手上的行数——那时「共 800 条」配着只到得了第 500 条的翻页器，是个**看不出来的
   * 谎**。前三批刻意把信号做全，本平面的通告到得了这个量级，所以这句话不是防御性
   * 措辞，是会真的出现的一屏。说出来，并给出下一步（收窄筛选）。
   */
  const truncated = load.kind === "ready" && matched > rows.length;

  const pagination = (
    <span className="flex w-full flex-col gap-2xs">
      {truncated ? (
        <span className="text-body-sm text-muted-foreground">
          {t("truncated", { matched, shown: rows.length })}
        </span>
      ) : null}
      <ListPagination
        className="w-full"
        currentPage={paged.page}
        pageCount={paged.pageCount}
        total={total}
        filteredTotal={matched}
        pageSize={paged.pageSize}
        onPageSizeChange={paged.onPageSizeChange}
        onPageChange={paged.onPageChange}
      />
    </span>
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description={t("loadingDescription")}
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={tShared("common.loadFailed")}
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reloadList()}>
            {tShared("common.retry")}
          </Button>
        }
      />
    ) : filtered ? (
      <EmptyState
        title={t("noMatch.title")}
        description={t("noMatch.description")}
      />
    ) : (
      <EmptyState
        icon="bell"
        title={t("empty.title")}
        description={t("empty.description")}
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="bell"
            title={t("title")}
            description={t("description")}
          />
        }
        summary={
          <NeedsActionPanel
            state={inboxLoad.kind}
            {...(inboxLoad.kind === "error"
              ? { errorMessage: inboxLoad.message }
              : {})}
            unread={inbox.unread}
            counts={inbox.counts}
            items={inbox.items}
            urgentTotal={inbox.total}
            busy={submitting}
            onMarkRead={(id) => void markRead(id)}
            onOpen={openOne}
            onMarkAllRead={() => void markAllRead()}
            onShowUnread={() => {
              // 把下面那张表切到「只看未读」——「需要处理」里没列出来的那些在那儿。
              setUnreadOnly(true);
              setSeverity("all");
              setIncludeExpired(false);
              paged.resetPage();
            }}
            onRetry={() => void reloadInbox()}
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              matched === total
                ? t("count.all", { total })
                : t("count.filtered", { matched, total })
            }
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.label")}
                  value={keywordInput}
                  onChange={(e) => {
                    setKeywordInput(e.target.value);
                    paged.resetPage();
                  }}
                />
              </InputGroup>
            }
            resetLabel={tShared("filters.reset")}
            onReset={resetFilters}
            actions={
              canManage ? (
                <ActionButton
                  icon="plus"
                  onClick={openCreate}
                  disabled={submitting}
                >
                  {t("actions.publish")}
                </ActionButton>
              ) : null
            }
          >
            <NativeSelect
              wrapperClassName="w-fit"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value as NoticeSeverity | "all");
                paged.resetPage();
              }}
              aria-label={t("filters.severityLabel")}
            >
              <option value="all">{t("filters.allSeverities")}</option>
              {NOTICE_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {/* 命中数跟在名称后面（口径：除严重度以外的筛选都算上），
                      所以勾了一档之后另两档还报得出数。 */}
                  {t("filters.severityOption", {
                    label: t(`severity.${value}`),
                    count: counts[value],
                  })}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={source}
              onChange={(e) => {
                setSource(e.target.value as Source | "all");
                paged.resetPage();
              }}
              aria-label={t("filters.sourceLabel")}
            >
              <option value="all">{t("filters.allSources")}</option>
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {t(`source.${value}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={unreadOnly ? "unread" : "all"}
              onChange={(e) => {
                setUnreadOnly(e.target.value === "unread");
                paged.resetPage();
              }}
              aria-label={t("filters.readLabel")}
            >
              <option value="all">{t("filters.allRead")}</option>
              <option value="unread">{t("filters.unreadOnly")}</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={includeExpired ? "all" : "live"}
              onChange={(e) => {
                setIncludeExpired(e.target.value === "all");
                paged.resetPage();
              }}
              aria-label={t("filters.expiryLabel")}
            >
              <option value="live">{t("filters.live")}</option>
              <option value="all">{t("filters.withExpired")}</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            labels={tableLabels}
            columns={[
              {
                id: "title",
                header: t("columns.notice"),
                sortable: true,
                cell: (r) => (
                  <TableTitleCell
                    icon={r.source === "system" ? "workflow" : "bell"}
                    title={r.title}
                    description={r.body}
                    /* 有落地页才做成可点的标题；没有的那些是纯文本——点不到地方的
                       控件是个死控件。点进去顺手标已读，见文件头那一段。 */
                    {...(r.link ? { onTitleClick: () => openOne(r) } : {})}
                  />
                ),
              },
              {
                id: "readAt",
                header: t("columns.readState"),
                sortable: true,
                width: "xs",
                cell: (r) =>
                  /* 三态，不是两态：投给别的平面的通告在这一页上也列着，但它没有
                     「我读过没有」可言——画成「已读」会是个凭空的答案。 */
                  !r.onThisPlane ? (
                    <span className="text-body-sm text-muted-foreground">
                      {t("readState.offPlane")}
                    </span>
                  ) : r.readAt === null ? (
                    <StatusBadge tone="info">
                      {t("readState.unread")}
                    </StatusBadge>
                  ) : (
                    <span className="text-body-sm text-muted-foreground">
                      {t("readState.read")}
                    </span>
                  ),
              },
              {
                id: "planes",
                header: t("columns.planes"),
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm">
                    {r.targetPlanes.length === 0
                      ? t("allPlanes")
                      : r.targetPlanes.map((p) => t(`planes.${p}`)).join(" · ")}
                  </span>
                ),
              },
              {
                id: "severity",
                header: t("columns.severity"),
                sortable: true,
                width: "xs",
                cell: (r) => (
                  <StatusBadge tone={severityTone(r.severity)}>
                    {t(`severity.${r.severity}`)}
                  </StatusBadge>
                ),
              },
              {
                id: "publishedAt",
                header: t("columns.publishedAt"),
                sortable: true,
                width: "sm",
                cell: (r) => formatDateTime(r.publishedAt, locale),
              },
              {
                id: "expiresAt",
                header: t("columns.expiresAt"),
                sortable: true,
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {/* 不设失效时间就是长期有效,写「—」会被读成"没读到"。 */}
                    {r.expiresAt
                      ? formatDateTime(r.expiresAt, locale)
                      : t("noExpiry")}
                  </span>
                ),
              },
              {
                id: "createdByName",
                header: t("columns.createdBy"),
                sortable: true,
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {/* system 来源没有人,写「系统」而不是「—」——后者会被当成读不到。 */}
                    {r.source === "system"
                      ? t("systemAuthor")
                      : (r.createdByName ?? "—")}
                  </span>
                ),
              },
            ]}
            rows={paged.pageRows}
            {...(sort.sort ? { sort: sort.sort } : {})}
            onSortChange={(next) => {
              sort.onSortChange(next);
              paged.resetPage();
            }}
            rowKey={(r) => r.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={paged.indexStart}
            rowActions={(item: OperatorNoticeItem) => {
              /* 别的平面的通告、以及已经读过的，没有「标记已读」可做。判据不在这里
                 写第二遍——点标题进去时标不标同读这一份（`markReadBlocker`），两处
                 分头改会出现「菜单灰着但点进去还在标」这种看不出来的岔。 */
              const blocker = markReadBlocker(item);
              return (
                <ActionMenu
                  label={t("rowActions.label")}
                  disabled={submitting}
                  items={[
                    {
                      id: "read",
                      label: t("rowActions.markRead"),
                      icon: "check",
                      disabled: submitting || blocker !== null,
                      hint:
                        blocker === "offPlane"
                          ? t("rowActions.markReadOffPlane")
                          : blocker === "alreadyRead"
                            ? t("rowActions.markReadAlready")
                            : undefined,
                      onSelect: () => void markRead(item.id),
                    },
                    ...(canManage
                      ? [
                          {
                            id: "withdraw",
                            label: t("rowActions.withdraw"),
                            icon: "stop" as const,
                            danger: true as const,
                            disabled: submitting,
                            confirm: withLabels({
                              verb: t("withdraw.verb"),
                              target: t("withdraw.target", {
                                title: item.title,
                              }),
                              consequence: t("withdraw.consequence"),
                              onConfirm: () => withdraw(item),
                            }),
                          },
                        ]
                      : []),
                  ]}
                />
              );
            }}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {dialogOpen ? (
        <DialogForm
          size="lg"
          open
          title={t("dialog.title")}
          description={t("dialog.description")}
          submitLabel={t("dialog.submit")}
          submitting={submitting}
          submitDisabled={!formIsValid(form)}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
          onSubmit={(event) => void submitForm(event)}
          cancelLabel={tShared("actions.cancel")}
        >
          <FieldTier
            tier="identity"
            title={FIELD_TIER_TITLE.identity}
            hint={t("dialog.identityHint")}
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel
                  {...FIELD_LABEL_A11Y}
                  required
                  htmlFor="notice-title"
                >
                  {t("dialog.titleLabel")}
                </FieldLabel>
                <Input
                  id="notice-title"
                  value={form.title}
                  maxLength={256}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder={t("dialog.titlePlaceholder")}
                  required
                />
              </Field>
              <Field span="full">
                <FieldLabel
                  {...FIELD_LABEL_A11Y}
                  required
                  htmlFor="notice-body"
                >
                  {t("dialog.bodyLabel")}
                </FieldLabel>
                <Textarea
                  id="notice-body"
                  value={form.body}
                  rows={4}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  placeholder={t("dialog.bodyPlaceholder")}
                  required
                />
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            title={FIELD_TIER_TITLE.details}
            hint={t("dialog.detailsHint")}
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel {...FIELD_LABEL_A11Y} required>
                  {t("dialog.planesLabel")}
                </FieldLabel>
                <span className="flex flex-wrap gap-sm">
                  {PLANES.map((plane) => (
                    <label
                      key={plane}
                      className="inline-flex items-center gap-2xs text-body-sm"
                    >
                      <Checkbox
                        checked={form.planes.has(plane)}
                        aria-label={t(`planes.${plane}`)}
                        onCheckedChange={() => togglePlane(plane)}
                      />
                      {t(`planes.${plane}`)}
                    </label>
                  ))}
                </span>
                {form.planes.size === 0 ? (
                  <FieldDescription>{t("dialog.planesEmpty")}</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="notice-severity">
                  {t("dialog.severityLabel")}
                </FieldLabel>
                <NativeSelect
                  id="notice-severity"
                  value={form.severity}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      severity: e.target.value as NoticeSeverity,
                    }))
                  }
                >
                  {NOTICE_SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {t(`severity.${value}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="notice-expires">
                  {t("dialog.expiresLabel")}
                </FieldLabel>
                <Input
                  id="notice-expires"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, expiresAt: e.target.value }))
                  }
                />
                <FieldDescription>{t("dialog.expiresHint")}</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="advanced"
            title={t("dialog.linkTier")}
            hint={t("dialog.linkHint")}
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel htmlFor="notice-link">
                  {t("dialog.linkLabel")}
                </FieldLabel>
                <Input
                  id="notice-link"
                  value={form.link}
                  maxLength={512}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, link: e.target.value }))
                  }
                  placeholder={t("dialog.linkPlaceholder")}
                />
              </Field>
            </FieldGroup>
          </FieldTier>
        </DialogForm>
      ) : null}
    </>
  );
}
