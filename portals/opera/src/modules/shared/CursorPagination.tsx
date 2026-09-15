"use client";

/**
 * CursorPagination.tsx — 游标列表的分页条:共 N 条 · 第 X / Y 页 · 每页 N 条 · 四颗图标按钮。
 * @package @vxture/opera
 * @layer Presentation
 * @category Modules - Shared
 *
 * ## 为什么不是 `ListPagination`
 *
 * `ListPagination`（DS `Pagination`）是**页码式**的:它渲染 1…N 并允许随机跳页。那要求
 * 数据源能按「第 k 页」取数——offset 能，**keyset 游标不能**。
 *
 * 那条限制不是缺陷，是那个选择本身:游标换来的是**目录被批量开采写入时不跳行、不重复**
 * （runos `catalog-cursor.ts`）。预置台账一次提交就能让目录从 288 涨到 877，offset 的
 * 页边界在两次请求之间会移动几百行。
 *
 * 判据只有一条:
 *
 * > **能随机取第 k 页就用 `ListPagination`，只能顺着走就用这个。**
 *
 * ## 四颗按钮，全图标，没有可见文字
 *
 * 这一点是**与 DS 对齐**，不是另立一套:DS `Pagination` 的上一页/下一页本来就是图标
 * 按钮，传进去的 `previousLabel` / `nextLabel` 是**可访问名不是可见文字**。本件初版用了
 * 可见文字按钮，是偏离;owner 2026-09-13 指出并要求全图标化。
 *
 * 图标取自 DS 字典。`IconName` 是从 `ICON_GROUPS` 推出来的联合类型——**名字写错是编译
 * 错误，不是静默降级**，这点比 `Icon` 的 `fallback` 参数暗示的要好:
 *
 *     caret-double-left   首页      chevron-left    上一页
 *     chevron-right       下一页    caret-double-right  末页
 *
 * owner 点名的是 Phosphor 的 `ArrowLineLeft/Right`（⇤ ⇥），但那两个**不在 DS 那 183 个
 * 策展图标里**，要它就得改 design-ui 并走整条发版链（bump 伞包 + 12 份文档版本号 +
 * ds tag）。裁定:先用 `caret-double`，字形攒到下次 DS 改动一起换——**功能不等图标**。
 *
 * ## 末页能点，是因为上游支持了反向游标
 *
 * 单向 keyset 跳不到末页。runos#100 加了 `?dir=before`:不带游标的 `before` 就是最后
 * 一页，而且每一页同时回 `prevCursor` 与 `nextCursor`，所以**末页不是死胡同**——这正是
 * 它没做成 `?last=true` 特例的原因。位置模型见 `@/lib/cursor-page`。
 *
 * ## 两个 class 写错的记录，以及它们**不是同一种错**
 *
 * 本件初版写了 `text-vx-sm` 和 `gap-3`，两个都是照印象编的。数用量能把它们一起找出来
 * （全仓各 2 次，而那 2 次都是自己写的）——**但数用量只给嫌疑，不给判决**。grep 产物
 * CSS 才分得开:`.text-vx-sm` 产物里 **0 次**（彻底不存在），`.gap-3` 则是生效的，只是
 * 绕开了 DS 的 `--space-*` 标尺。
 *
 * 一个是页面坏了，一个是将来对不齐。混为一谈会让人要么放过真坏的，要么把没坏的当事故查。
 * 本件用命名档 `gap-sm` / `gap-2xs`。
 *
 * 页大小档与 `ListPagination` 一致（10/20/50/100，无 auto，owner 2026-09-02 定）。**每页条数的控件、
 * 按钮尺寸与两组之间的间距也与 DS `Pagination` 一致**（`SegmentedControl` md、`control-md` 按钮、
 * `gap-2xl`）：此前这里是「每页条数」文字 + 下拉框、sm 按钮，同一个运维平台里两种表尾长得不一样
 * （owner 2026-09-15 要求表尾统一）。
 * 改页大小回第一页——游标是「某一行之后」，换了页大小之后它前面看过的行数变了，不回
 * 第一页就会漏行或重复。
 */

import { useTranslations } from "next-intl";
import { Button, Icon, SegmentedControl } from "@vxture/design-system";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type CursorPageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export interface CursorPaginationProps {
  /** 匹配总数——**不是本页条数**。翻页时这个数必须钉住不动。 */
  readonly total: number;
  /** 当前页，1 起。 */
  readonly page: number;
  /** 总页数。空表算一页，不是零页。 */
  readonly pageCount: number;
  readonly pageSize: CursorPageSize;
  readonly onPageSizeChange: (value: CursorPageSize) => void;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** 回第一页。第一页不需要游标。 */
  readonly onFirst: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  /** 跳到最后一页。要上游支持反向游标（runos#100）。 */
  readonly onLast: () => void;
  /** 取数中:四颗全禁用，避免连点把位置推乱。 */
  readonly busy?: boolean;
  readonly className?: string;
}

export function CursorPagination({
  total,
  page,
  pageCount,
  pageSize,
  onPageSizeChange,
  hasPrevious,
  hasNext,
  onFirst,
  onPrevious,
  onNext,
  onLast,
  busy = false,
  className,
}: CursorPaginationProps) {
  const t = useTranslations("pagination");

  /* 四颗按钮形状完全一样，只有图标、可访问名与回调不同——写成一张表，免得四段几乎
     相同的 JSX 各自漂移。禁用条件按**方向**分组:首页与上一页都要求不在第一页，但它们
     不是一件事（第 30 页想回头，点 29 次上一页不是答案）。 */
  const steps = [
    {
      key: "first",
      icon: "caret-double-left",
      label: t("first"),
      run: onFirst,
      blocked: !hasPrevious,
    },
    {
      key: "prev",
      icon: "chevron-left",
      label: t("previous"),
      run: onPrevious,
      blocked: !hasPrevious,
    },
    {
      key: "next",
      icon: "chevron-right",
      label: t("next"),
      run: onNext,
      blocked: !hasNext,
    },
    {
      key: "last",
      icon: "caret-double-right",
      label: t("last"),
      run: onLast,
      blocked: !hasNext,
    },
  ] as const;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-sm ${className ?? ""}`}
    >
      <span className="flex flex-wrap items-center gap-sm text-body-sm text-muted-foreground tabular-nums">
        <span>{t("total", { total })}</span>
        <span>{t("position", { page, pageCount })}</span>
      </span>
      <div className="flex flex-wrap items-center gap-2xl">
        <SegmentedControl<CursorPageSize>
          size="md"
          ariaLabel={t("pageSizeLabel")}
          value={pageSize}
          onChange={onPageSizeChange}
          items={PAGE_SIZE_OPTIONS.map((size) => ({
            value: size,
            label: String(size),
            ariaLabel: t("pageSizeOption", { size }),
          }))}
        />
        <div className="flex items-center gap-2xs">
          {steps.map((step) => (
            <Button
              key={step.key}
              variant="outline"
              size="md"
              aria-label={step.label}
              title={step.label}
              disabled={step.blocked || busy}
              onClick={step.run}
            >
              <Icon name={step.icon} size="sm" aria-hidden="true" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
