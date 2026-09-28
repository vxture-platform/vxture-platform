"use client";

/**
 * SystemNoticesSection — 运营通告的读侧。
 *
 * 发布面在 opera（owner 2026-09-20：「面向内部运营的由 opera 发布」），admin 只读。
 *
 * 两个档共用本件：
 *   digest（待办页 S2）  owner 定的规则：**当天已读 + 所有未读**，列最近十条，无筛选
 *   all   （/messages）  全部，带筛选 + 三档计数 + 翻页
 *
 * ── 为什么「当天已读」也要显示 ──
 * 只列未读的话，刚点过「知道了」的那条会当场消失，运营者会以为自己点错了。留到
 * 当天结束是个温和的过渡：今天看过的还在，明天自然清场。
 *
 * ── 第四批（2026-09-28）：筛选与计数 ──
 * 前三批刻意把信号做全（客户通知镜像 + 业务巡检 + 运营动作巡检 + 十二类待办），
 * 于是这一页从「偶尔几条」变成了「翻不完」。这一批不删信号，只让它读得懂：
 *
 *   · **筛选全在服务端**。四项（严重度 / 来源 / 只看未读 / 关键词）随查询串下去，
 *     库里 WHERE 掉。在浏览器里筛当前这一页是个确定的错答案——第 3 页筛出来的
 *     「紧急 2 条」只是第 3 页的两条，而人会把它读成全部。
 *   · **三档计数的口径是「除严重度以外的筛选都算上」**。勾了「紧急」之后「重要」
 *     那一档还报得出数，那排数字才能当入口用；跟着严重度走的话它会退化成当前筛选
 *     的回声（另两档恒 0）。口径在服务包一处定，这里只画。
 *   · **多选的进气泡，单值的进下拉**。严重度可以同时看两档 → `FilterPopover`
 *     （它还能把命中数显示在选项后面）；来源与「只看未读」各只有一个值 → `NativeSelect`。
 *     把单值控件塞进多选气泡，会造出「两个都勾 = 一个都不勾」这种要人先想一轮的状态。
 *   · 「全部标记已读」**不在这一页**：它在铃铛抽屉里，作用域是本平面全部未读。筛过的
 *     列表上那个词会被读成「这一屏」，两种读法差一个数量级。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  Button,
  EmptyState,
  FactList,
  FilterBar,
  FilterPopover,
  Input,
  NativeSelect,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type { Fact, FilterValue, StatusBadgeTone } from "@vxture/design-system";
import {
  fetchOperatorNotices,
  markOperatorNoticeRead,
  type OperatorNoticeCounts,
} from "@/api/admin-bff";
import type { OperatorNoticeItem } from "@/api/admin-bff";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { PageSize } from "@/modules/shared/PageSizePicker";
import { formatNumber } from "@/modules/tenants/tenant-utils";
import { formatDay, formatClock } from "@vxture-platform/shared";

type NoticeSeverity = OperatorNoticeItem["severity"];
type NoticeSource = OperatorNoticeItem["source"];

/** 三档的顺序：重的在前。气泡里的选项与下面那排计数同一个顺序。 */
const SEVERITIES: readonly NoticeSeverity[] = ["critical", "warning", "info"];
const SOURCES: readonly NoticeSource[] = ["manual", "system"];

/** 摘要档列多少条。翻页只在 /messages 上，摘要档是一眼扫完的东西。 */
const DIGEST_LIMIT = 10;

/**
 * 关键词防抖。
 *
 * 筛选在服务端做，所以每敲一个字都是一次请求。300ms 是「打完一个词」与「等得住」
 * 之间的常用取值；不防抖时搜「退款执行」会发出四次请求，而前三次的结果只会先后
 * 闪过一遍。
 */
const KEYWORD_DEBOUNCE_MS = 300;

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `info` 走中性而不是绿——`success` 的语义是**达成了一件事**，而「一般」不是。
 * 与 opera 发布页、维护窗口页同一取舍。
 */
function severityTone(severity: NoticeSeverity): StatusBadgeTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

export function SystemNoticesSection({
  scope = "digest",
}: {
  readonly scope?: "digest" | "all";
}) {
  const t = useTranslations("systemNotices");
  const locale = useLocale();
  const router = useRouter();
  const isAll = scope === "all";

  const [items, setItems] = useState<OperatorNoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [counts, setCounts] = useState<OperatorNoticeCounts>({
    info: 0,
    warning: 0,
    critical: 0,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* 筛选态。四项各自独立，**任一项一动就回第一页**——不回的话，第 3 页上收紧一档
     会得到一屏空白，而屏幕上没有任何东西说明「你现在在第 3 页，而筛完只有 1 页」。 */
  const [severities, setSeverities] = useState<readonly NoticeSeverity[]>([]);
  const [source, setSource] = useState<NoticeSource | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  /* 输入框里的原文与真正下发的关键词分两份：中间隔着防抖。只留一份的话，防抖
     期间输入框会跟着上一次的请求回滚一个字。 */
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
    }, KEYWORD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const hasFilters =
    severities.length > 0 || source !== "all" || unreadOnly || keyword !== "";

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchOperatorNotices({
        scope,
        limit: isAll ? pageSize : DIGEST_LIMIT,
        offset: isAll ? (page - 1) * pageSize : 0,
        // 摘要档不带筛选：那一段是「今天该看的」，不是一个可调的视图。
        ...(isAll
          ? {
              severities,
              ...(source === "all" ? {} : { source }),
              unreadOnly,
              keyword,
            }
          : {}),
      });
      setItems(result.items);
      setTotal(result.total);
      setUnread(result.unread);
      setCounts(result.counts);
    } catch (cause) {
      setItems([]);
      setTotal(0);
      setUnread(0);
      setCounts({ info: 0, warning: 0, critical: 0 });
      // 读失败要显影，不能画成「没有消息」——那是两件事。
      setLoadError(
        cause instanceof Error ? cause.message : t("states.errorFallback"),
      );
    } finally {
      setLoading(false);
    }
  }, [
    scope,
    isAll,
    page,
    pageSize,
    severities,
    source,
    unreadOnly,
    keyword,
    t,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const markRead = async (notice: OperatorNoticeItem) => {
    // 先本地置已读再发请求：这一步没有失败代价（重标幂等），等一圈往返
    // 才变灰会让人以为没点上。失败时下次 reload 自会纠正。
    setItems((prev) =>
      prev.map((item) =>
        item.id === notice.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnread((prev) => Math.max(0, prev - 1));
    try {
      await markOperatorNoticeRead(notice.id);
    } catch {
      await reload();
    }
  };

  /** 点开一条：先标已读再跳——去了别的页面这一段就卸载了，放在后面等于不做。 */
  const openNotice = (notice: OperatorNoticeItem) => {
    if (!notice.link) return;
    if (notice.readAt === null) void markRead(notice);
    router.push(notice.link);
  };

  const severityLabel = useCallback(
    (severity: NoticeSeverity) => t(`severity.${severity}`),
    [t],
  );

  /** 气泡里的严重度维度。命中数就是服务端那三个计数（口径见文件头）。 */
  const severityFacets = useMemo(
    () => [
      {
        id: "severity",
        label: t("filters.severityLabel"),
        options: SEVERITIES.map((severity) => ({
          value: severity,
          label: severityLabel(severity),
          count: counts[severity],
        })),
      },
    ],
    [t, severityLabel, counts],
  );

  const severityValue: FilterValue = useMemo(
    () => ({ severity: [...severities] }),
    [severities],
  );

  /** 三档各有多少条。与气泡里的命中数同一组数，所以两处永远一致。 */
  const summaryFacts: readonly Fact[] = SEVERITIES.map((severity) => ({
    label: severityLabel(severity),
    value: formatNumber(counts[severity]),
    tone: severityTone(severity),
  }));

  const resetFilters = () => {
    setSeverities([]);
    setSource("all");
    setUnreadOnly(false);
    setKeywordInput("");
    setKeyword("");
    setPage(1);
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Section
      title={isAll ? t("all.title") : t("digest.title")}
      icon="bell"
      level={2}
      description={
        isAll
          ? t("all.description")
          : unread > 0
            ? t("digest.descriptionUnread", { unread: formatNumber(unread) })
            : t("digest.description")
      }
      action={
        isAll ? (
          <ActionButton
            variant="outline"
            icon="arrow-left"
            onClick={() => router.push("/ops-todos")}
          >
            {t("actions.backToTodos")}
          </ActionButton>
        ) : (
          <ActionButton
            variant="outline"
            icon="arrow-right"
            onClick={() => router.push("/messages")}
          >
            {t("actions.viewAll")}
          </ActionButton>
        )
      }
    >
      {isAll ? (
        <FilterBar
          aria-label={t("filters.ariaLabel")}
          count={t("filters.count", { count: formatNumber(total) })}
          search={
            <Input
              type="search"
              className="min-w-media-2xl grow basis-0 max-w-panel-sm"
              placeholder={t("filters.searchPlaceholder")}
              aria-label={t("filters.searchAriaLabel")}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
            />
          }
          onReset={resetFilters}
          resetLabel={t("filters.reset")}
        >
          <NativeSelect
            wrapperClassName="w-fit basis-media-xl"
            aria-label={t("filters.unreadAriaLabel")}
            value={unreadOnly ? "unread" : "all"}
            onChange={(event) => {
              setUnreadOnly(event.target.value === "unread");
              setPage(1);
            }}
          >
            <option value="all">{t("filters.unreadAll")}</option>
            <option value="unread">{t("filters.unreadOnly")}</option>
          </NativeSelect>
          <NativeSelect
            wrapperClassName="w-fit basis-media-xl"
            aria-label={t("filters.sourceAriaLabel")}
            value={source}
            onChange={(event) => {
              setSource(event.target.value as NoticeSource | "all");
              setPage(1);
            }}
          >
            <option value="all">{t("filters.sourceAll")}</option>
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`source.${value}`)}
              </option>
            ))}
          </NativeSelect>
          <FilterPopover
            facets={severityFacets}
            value={severityValue}
            /* 已选几项**不写进 label**：FilterPopover 自己在触发钮右侧画一颗角标
               （`data-slot="filter-popover-count"`），再拼进文字就是同一个数报两遍。
               用件的契约只在用它本身时生效——这一条是读了它的实现才知道的。 */
            label={t("filters.severityLabel")}
            confirmLabel={t("filters.confirm")}
            clearLabel={t("filters.clear")}
            emptyLabel={t("filters.noOptions")}
            onChange={(next) => {
              setSeverities((next.severity ?? []) as readonly NoticeSeverity[]);
              setPage(1);
            }}
          />
        </FilterBar>
      ) : null}

      {/* 三档计数排在列表之上：先答「有多少、多重」，再答「具体是哪些」。
          读失败时不画——拿不到数就不报数，报一排 0 会被读成「一条都没有」。 */}
      {isAll && !loadError ? <FactList facts={summaryFacts} /> : null}

      {loading ? (
        <EmptyState
          icon="bell"
          title={t("states.loadingTitle")}
          description={t("states.loadingDescription")}
        />
      ) : loadError ? (
        <EmptyState
          icon="bell"
          title={t("states.errorTitle")}
          description={loadError}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {t("actions.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        /* 三种「没有」分开说：筛出来的空、全量的空、摘要档的空。合成一句的话，
           筛过头的人会以为库里真的什么都没有，然后去查后端。 */
        <EmptyState
          icon="bell"
          title={
            hasFilters
              ? t("states.emptyFilteredTitle")
              : isAll
                ? t("states.emptyAllTitle")
                : t("states.emptyDigestTitle")
          }
          description={
            hasFilters
              ? t("states.emptyFilteredDescription")
              : isAll
                ? t("states.emptyAllDescription")
                : t("states.emptyDigestDescription")
          }
          {...(hasFilters
            ? {
                action: (
                  <Button variant="secondary" onClick={resetFilters}>
                    {t("filters.reset")}
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((notice) => {
            const isUnread = notice.readAt === null;
            return (
              <li
                key={notice.id}
                className="flex items-start gap-md rounded-md border p-md"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <span className="flex flex-wrap items-center gap-xs">
                    <StatusBadge tone={severityTone(notice.severity)}>
                      {severityLabel(notice.severity)}
                    </StatusBadge>
                    {/* 未读用一个明确的字，不靠加粗——加粗在一屏都是新消息时
                        反而看不出哪条是新的。 */}
                    {isUnread ? (
                      <StatusBadge tone="info">{t("unread")}</StatusBadge>
                    ) : null}
                    <span className="font-medium">{notice.title}</span>
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {notice.body}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {formatDay(notice.publishedAt, locale)}{" "}
                    {formatClock(notice.publishedAt, locale)} ·{" "}
                    {/* system 来源没有人，写「系统」而不是「—」——后者会被当成读不到。 */}
                    {notice.source === "system"
                      ? t("source.system")
                      : (notice.createdByName ?? "—")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-xs">
                  {notice.link ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openNotice(notice)}
                    >
                      {t("actions.open")}
                    </Button>
                  ) : null}
                  {isUnread ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void markRead(notice)}
                    >
                      {t("actions.gotIt")}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {isAll && !loading && !loadError && total > 0 ? (
        <ListPagination
          currentPage={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
          onPageChange={setPage}
        />
      ) : null}
    </Section>
  );
}
