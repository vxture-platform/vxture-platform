"use client";

/**
 * useListPagination.ts - 列表页翻页状态：页码 / 每页条数 / 序号起点。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Hooks
 *
 * 与 `Pagination` 配套：那件负责翻页条长什么样，本 hook 负责它背后的状态与
 * 切片。收进 DS 的依据是产品实据——opera 六个清单页与 console 的成员 / 角色
 * 页用的是同一份实现（2026-08-04 之前各存一份拷贝）。
 *
 * 纯客户端切片。接服务端分页时换掉 `pageRows` 的来源即可，其余返回值不变。
 *
 * `"auto"` 档（默认）：按可视高度解析每页行数——探测 `main` 里的首个列表行
 * （表格行或带 `data-list-card` 的行卡），用它的顶缘到视口底的距离除以实测
 * 行高，余量留给表尾。意图是不出现纵向滚动：能显示几行就显示几行，靠翻页
 * 而不是滚动来看下一批。清单页一页只有一张列表，所以探测不需要 ref 接线。
 */

import { useEffect, useMemo, useState } from "react";
import type { PageSizeChoice } from "../components/base/navigation/Pagination";

/** 表尾（翻页条 + 间距）的预留高度；行高兜底值取常规密度的表格行。 */
const FOOTER_RESERVE_PX = 104;
const FALLBACK_ROW_PX = 56;
const MIN_AUTO_ROWS = 3;

/**
 * ⚠ 探测只在**有真实数据行**时才有意义。`DataTable` 的空态是一整行
 * `<tr><td colSpan>`（见 DataTable 的 empty 槽），高度是一屏 EmptyState 的高度，
 * 拿它当行高算出来的档必然砸到 `MIN_AUTO_ROWS` 地板上。
 *
 * 异步取数的清单页首帧就是这个形态：mount 时数据还没到，DOM 里只有那一行空态。
 * 2026-08-07 opera 维护窗口页（opera 第一个异步清单页）实测：945px 视口本可放 6 行，
 * 实际只出 3 行——正是量到了空态行。同步喂 mock 的页面碰不到，所以一直没露头。
 */
function measureAutoRows(): number {
  const probe =
    document.querySelector("main tbody tr") ??
    document.querySelector("main [data-list-card]");
  if (!probe) return 10;
  const rect = probe.getBoundingClientRect();
  const rowHeight = rect.height || FALLBACK_ROW_PX;
  const available = window.innerHeight - rect.top - FOOTER_RESERVE_PX;
  return Math.max(MIN_AUTO_ROWS, Math.floor(available / rowHeight));
}

export interface UseListPaginationReturn<T> {
  readonly page: number;
  readonly pageCount: number;
  /** 选中的档（喂给 `Pagination` 的 pageSize——"auto" 档就是 "auto"）。 */
  readonly pageSize: PageSizeChoice;
  readonly pageRows: readonly T[];
  /** 序号列起点：跨页递进。 */
  readonly indexStart: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: PageSizeChoice) => void;
  /** 筛选条件变化时回第一页。 */
  readonly resetPage: () => void;
}

export function useListPagination<T>(
  filtered: readonly T[],
  initialPageSize: PageSizeChoice = "auto",
): UseListPaginationReturn<T> {
  const [page, setPage] = useState(1);
  const [choice, setChoice] = useState<PageSizeChoice>(initialPageSize);
  const [autoSize, setAutoSize] = useState(10);

  // `hasRows` 进依赖：数据从无到有的那一帧要重量一次，否则异步页永远停在
  // 用空态行算出的地板值上。effect 在 commit 之后跑，那时真实行已经在 DOM 里。
  const hasRows = filtered.length > 0;
  useEffect(() => {
    if (choice !== "auto") return;
    const measure = () => setAutoSize(measureAutoRows());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [choice, hasRows]);

  const pageSize = choice === "auto" ? autoSize : choice;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);

  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  return {
    page: safePage,
    pageCount,
    pageSize: choice,
    pageRows,
    indexStart: (safePage - 1) * pageSize + 1,
    onPageChange: setPage,
    onPageSizeChange: (size: PageSizeChoice) => {
      setChoice(size);
      setPage(1);
    },
    resetPage: () => setPage(1),
  };
}
