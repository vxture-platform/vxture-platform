"use client";

/**
 * ReviewsPage — 客户评价列表（运营总览「客户评价」三卡的下钻）。
 *
 * 三卡答「平均几分」，这一页答「客户到底说了什么」。所以**默认只列带留言的**：
 * 纯分数已经在卡上汇总过，逐条再列一遍只是噪声；要看全部可以切「全部评价」。
 *
 * 分数用 DS `Rating` 的只读态呈现，不在这里手搓星星——admin 首页此前那个本地
 * `RatingStars` 就是这条路走歪过一次的证据，已随本批删掉。
 *
 * 某一项没评时画「—」而不是 0 颗星：0 分是最差评，「还没评」不是。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  DataTable,
  EmptyState,
  FilterBar,
  Rating,
  SegmentedControl,
  Section,
  ListPageTemplate,
  MetricGrid,
} from "@vxture/design-system";
import { PageHeader } from "@/modules/shared/PageHeader";
import { useTableLabels } from "@/modules/shared/table";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { PageSize } from "@/modules/shared/PageSizePicker";
import { fetchReviewList } from "@/api/admin-bff";
import type { ReviewListItem } from "@/api/admin-bff";
import { formatNumber } from "@/modules/tenants/tenant-utils";
import { formatDay, formatClock } from "@vxture-platform/shared";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

/** DS 件内文案默认英文托底，调用点必须传中文（05 §3.1）。 */
const RATING_LABELS = {
  optionTemplate: "{score} 分，共 {max} 分",
  roleDescription: "评分",
  valueTemplate: "{value} 分，共 {max} 分",
  emptyLabel: "未评分",
};

function ScoreCell({ value, label }: { value: number | null; label: string }) {
  // 没评这一项 → 「—」。画 0 颗星会被读成最差评。
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Rating
      readOnly
      size="sm"
      value={value}
      aria-label={label}
      labels={RATING_LABELS}
    />
  );
}

/** 三项均分与条数，按当前这一页的行算——页面上看到什么就统计什么。 */
function summarize(items: readonly ReviewListItem[]) {
  const avg = (pick: (item: ReviewListItem) => number | null) => {
    const scored = items.map(pick).filter((v): v is number => v !== null);
    return scored.length === 0
      ? null
      : scored.reduce((sum, v) => sum + v, 0) / scored.length;
  };
  return {
    product: avg((item) => item.productScore),
    price: avg((item) => item.priceScore),
    service: avg((item) => item.serviceScore),
  };
}

export function ReviewsPage() {
  const locale = useLocale();
  const tableLabels = useTableLabels();

  const [withComment, setWithComment] = useState<"comment" | "all">("comment");
  const [items, setItems] = useState<ReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchReviewList({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      withComment: withComment === "comment",
    })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setItems([]);
        setTotal(0);
        // 读失败要显影，不能把它画成「还没有评价」——那是两件事。
        setLoadError(
          cause instanceof Error ? cause.message : "评价列表读取失败",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, withComment]);

  const summary = useMemo(() => summarize(items), [items]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <ListPageTemplate
      className="w-full "
      header={
        <PageHeader
          icon="star"
          title="客户评价"
          description="客户给产品、价格与服务打的分，以及他们留下的话。"
        />
      }
      summary={
        <MetricGrid
          loading={loading}
          aria-label="本页评价均分"
          columns={3}
          items={[
            {
              id: "product",
              icon: "medal",
              label: "产品评价",
              help: "本页这些评价里，评了产品这一项的均分。",
              value:
                summary.product === null ? "—" : summary.product.toFixed(1),
              tags: ["本页口径"],
            },
            {
              id: "price",
              icon: "credit-card",
              label: "价格评价",
              help: "本页这些评价里，评了价格这一项的均分。",
              value: summary.price === null ? "—" : summary.price.toFixed(1),
              tags: ["本页口径"],
            },
            {
              id: "service",
              icon: "star",
              label: "服务评价",
              help: "本页这些评价里，评了服务这一项的均分。",
              value:
                summary.service === null ? "—" : summary.service.toFixed(1),
              tags: ["本页口径"],
            },
          ]}
        />
      }
      table={
        <Section
          title="评价明细"
          icon="table"
          level={2}
          description={`共 ${formatNumber(total)} 条${withComment === "comment" ? "带留言的评价" : "评价"}。`}
          action={
            <SegmentedControl
              ariaLabel="评价范围"
              value={withComment}
              onChange={(next) => {
                setWithComment(next);
                setPage(1);
              }}
              items={[
                {
                  value: "comment" as const,
                  label: "有留言",
                  icon: "chat-circle",
                },
                { value: "all" as const, label: "全部评价", icon: "table" },
              ]}
            />
          }
        >
          <FilterBar
            view="list"
            onViewChange={() => {}}
            aria-label="评价筛选"
            count={formatNumber(items.length)}
          />
          <DataTable
            labels={tableLabels}
            columns={[
              {
                id: "tenant",
                header: "客户",
                cell: (item) => (
                  <span className="inline-flex flex-col gap-2xs">
                    <span>{item.tenantName}</span>
                    <span className="font-mono text-body-sm text-muted-foreground">
                      {formatPrincipalNoOr(item.tenantNo, "tenant", "—")}
                    </span>
                  </span>
                ),
              },
              {
                id: "product",
                header: "产品",
                cell: (item) => item.productName,
              },
              {
                id: "productScore",
                // 与上一列「产品」区分:那一列是产品名,这一列是分。两列同名会读撞。
                header: "产品评分",
                cell: (item) => (
                  <ScoreCell value={item.productScore} label="产品评分" />
                ),
              },
              {
                id: "priceScore",
                header: "价格评分",
                cell: (item) => (
                  <ScoreCell value={item.priceScore} label="价格评分" />
                ),
              },
              {
                id: "serviceScore",
                header: "服务评分",
                cell: (item) => (
                  <ScoreCell value={item.serviceScore} label="服务评分" />
                ),
              },
              {
                id: "comment",
                header: "留言",
                // 留言是这一页的主角，给它最宽的一列；过长靠 CSS 截断，不在数据层切。
                cell: (item) =>
                  item.comment ? (
                    <span className="block max-w-media-3xl">
                      {item.comment}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                id: "createdAt",
                header: "评价时间",
                cell: (item) => (
                  <span className="inline-flex flex-col gap-2xs">
                    <span>{formatDay(item.createdAt, locale)}</span>
                    <span className="text-body-sm text-muted-foreground">
                      {formatClock(item.createdAt, locale)}
                    </span>
                  </span>
                ),
              },
            ]}
            rows={items}
            rowKey={(item) => `${item.tenantNo}-${item.createdAt}`}
            indexStart={(page - 1) * pageSize + 1}
            loading={loading}
            empty={
              <EmptyState
                icon="star"
                title={loadError ? "评价列表读取失败" : "还没有评价"}
                description={
                  loadError ??
                  (withComment === "comment"
                    ? "目前还没有人留下文字评价。切到「全部评价」看只打了分的那些。"
                    : "客户在订阅页评价之后，这里会逐条列出来。")
                }
              />
            }
          />
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
        </Section>
      }
    />
  );
}
