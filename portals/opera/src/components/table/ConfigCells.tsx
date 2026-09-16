"use client";
/**
 * ConfigCells.tsx — 表格格子的三种形态：主辅上下、「摘要 ▸」气泡、日期时间。
 * @package @vxture/opera
 *
 * owner 2026-09-16：列表的核心信息要补齐，但列不能多——相似的两项合成一格上下主辅；
 * 太长的只露一个摘要，点开贴着格子弹出详情，不离开列表。
 *
 * ── 气泡的形态是两轮返工定下来的 ──
 * 一版用 DS `DetailList`：气泡默认档 18rem，而 `DetailRow` 并排时名列定宽 12rem，
 * 值只剩 24px，一条 URL 每行一个字符、气泡被撑到 2035px 高。
 * 二版改成名上值下 + 加宽到 32rem，owner 仍否：「应该整体对齐，label content 同行，
 * 只列几个重点的，一定是一行一条，次要信息可以不显示，也不留去详情页的按钮——
 * 与操作区重复了。」
 *
 * 现在的规矩，调用方必须照办：
 *  - **label 与值同行**，标签列定宽 `w-media-xl`（96px）——定宽才有「整体对齐」，
 *    按内容自适应的话每行的值都从不同位置起头。
 *  - **一行一条**：值是一句话，超出就截断（`title` 兜住全文），不换行、不堆列表。
 *  - **只列重点**：次要字段不进气泡，去详情页看。
 *  - **没有底部按钮**：跳转归行菜单，气泡只负责看。
 */
import { type ReactNode } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@vxture/design-system";
import {
  formatClock,
  formatDateTime,
  formatDay,
  type DateInput,
} from "@vxture-platform/shared";

/** 一格两行：上主、下辅。辅行可以是文字，也可以是一个气泡触发器。 */
export function StackCell({
  main,
  sub,
}: {
  readonly main: ReactNode;
  readonly sub?: ReactNode;
}) {
  return (
    <span className="flex flex-col items-center gap-2xs">
      <span className="text-body-sm">{main}</span>
      {sub ? (
        <span className="text-body-sm text-muted-foreground">{sub}</span>
      ) : null}
    </span>
  );
}

export interface ConfigDetail {
  readonly label: string;
  /** 一句话。太长就截断——**不要**在这里塞多行清单。 */
  readonly value: string;
  /** 等宽显示（地址、ID、键名这类）。 */
  readonly mono?: boolean;
}

/** 摘要作触发器，点开贴着格子弹出「标签 · 值」清单：同行对齐、一行一条。 */
export function ConfigPopover({
  trigger,
  title,
  rows,
}: {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly rows: readonly ConfigDetail[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {trigger}
        </Button>
      </PopoverTrigger>
      {/* 宽度走 panel-md（32rem）而不是气泡默认的 overlay-lg：装的是地址这类横向内容，
          空间不够就只能靠换行凑，越换越高。 */}
      <PopoverContent
        width="xl"
        align="start"
        className="flex w-panel-md flex-col gap-md"
      >
        <span className="text-label-md">{title}</span>
        <dl className="flex flex-col gap-xs">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline gap-md">
              <dt className="w-media-xl shrink-0 text-label-sm text-muted-foreground">
                {row.label}
              </dt>
              <dd
                title={row.value}
                className={
                  row.mono
                    ? "min-w-0 flex-1 truncate font-mono text-code-sm text-foreground"
                    : "min-w-0 flex-1 truncate text-body-sm text-foreground"
                }
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** 列表里的更新时间（单行场合，如状态列的辅行）。 */
export function formatUpdatedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, locale);
}

/**
 * 时间格子：日期为主、时刻为辅（owner 2026-09-16「日期时间列分主辅，日期=年月日，
 * 时间=时分秒」，全平台列表同此）。
 *
 * 空值或非法值只渲染一行 fallback——分成「— / —」两行是把没有值说成了两件事。
 * 日期字段顺序交给 locale（中文年在前、英文月在前），不在这里拼格式。
 */
export function DateCell({
  value,
  locale,
  fallback = "—",
}: {
  readonly value: DateInput;
  readonly locale: string;
  readonly fallback?: string;
}) {
  const day = formatDay(value, locale, "");
  if (day === "") return <span className="text-body-sm">{fallback}</span>;
  return <StackCell main={day} sub={formatClock(value, locale, "")} />;
}
