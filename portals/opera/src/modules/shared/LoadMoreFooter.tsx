"use client";

/**
 * LoadMoreFooter.tsx — 只能顺序往下读的列表的表尾：已加载 N 条 · 还有更多 / 已到末尾 · 加载更多。
 * @package @vxture/opera
 * @layer Presentation
 * @category Modules - Shared
 *
 * ## 三种表尾，按数据源选，不按页面选
 *
 * | 数据源能做什么                         | 表尾               |
 * | -------------------------------------- | ------------------ |
 * | 能随机取第 k 页（或全量已在内存）      | `ListPagination`   |
 * | 游标，但上游给总数、支持反向游标       | `CursorPagination` |
 * | 游标，**不给总数**、只能往下读         | 本件               |
 *
 * 本件之前，五张表（Atlas 与 Runos 变更记录、Atlas 请求日志、Runos 调用流两张）各写
 * 一遍：一处是整行宽的 secondary 按钮、到底时一句「已经到底了。」，其余四处是左侧
 * 计数 + 右侧 outline 小按钮，文案逐字相同。同一件事长成两种样子，收成这一件。
 *
 * 显式说到没到末尾：「加载完了」与「加载不动了」在界面上长得一样，而前者是答案、
 * 后者是故障。没有总数就不写「共 N 条」——上游没给的数，编一个出来就是编。
 *
 * 版式与 `CursorPagination` 同轴：左侧计数（正文小号、弱色、等宽数字），右侧按钮。
 */

import { useTranslations } from "next-intl";
import { Button } from "@vxture/design-system";

export interface LoadMoreFooterProps {
  /** 已加载的行数（不是总数——上游不给总数）。 */
  readonly loaded: number;
  /** 还有下一段。 */
  readonly hasMore: boolean;
  /** 正在读下一段：按钮禁用并改说「加载中」，避免连点重复追加。 */
  readonly loading: boolean;
  readonly onLoadMore: () => void;
}

export function LoadMoreFooter({
  loaded,
  hasMore,
  loading,
  onLoadMore,
}: LoadMoreFooterProps) {
  const t = useTranslations("pagination");
  const tShared = useTranslations();

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-sm">
      <span className="text-body-sm text-muted-foreground tabular-nums">
        {hasMore
          ? t("loadedMore", { count: loaded })
          : t("loadedEnd", { count: loaded })}
      </span>
      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading ? tShared("common.loading") : tShared("common.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
