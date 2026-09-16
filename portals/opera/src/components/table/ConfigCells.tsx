"use client";
/**
 * ConfigCells.tsx — 表格格子的两种形态：主辅上下、「已配置 ▸」气泡。
 * @package @vxture/opera
 *
 * owner 2026-09-16：列表的核心信息要补齐，但列不能多——相似的两项合成一格上下主辅；
 * 太长的（回调地址、客户端清单、指标键）只露一个摘要，点开贴着格子弹出详情，
 * 不离开列表。
 *
 * ── 气泡里为什么不用 DetailList ──
 * 第一版用了，线上一看就废：气泡默认档 lg 是 18rem（288px），而 `DetailRow` 并排时
 * 名列定宽 12rem（192px），留给值的只剩 24px——一条 URL 每行一个字符，气泡被撑到
 * 2035px 高（owner 2026-09-16 报「布局严重失衡」，实测确认）。
 *
 * 名值对在窄浮层里就不该并排。这里改成**名上值下、值占整行**，并按 FilterPopover
 * 的先例把气泡加宽到 panel-md（32rem）：地址类内容需要的是横向空间，不是更多行。
 */
import { type ReactNode } from "react";
import Link from "next/link";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";

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
  readonly value: ReactNode;
}

/** 摘要作触发器，点开贴着格子弹出「名上值下」清单，底部可带一个去配置的链接。 */
export function ConfigPopover({
  trigger,
  title,
  rows,
  href,
  hrefLabel,
}: {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly rows: readonly ConfigDetail[];
  readonly href?: string;
  readonly hrefLabel?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {trigger}
        </Button>
      </PopoverTrigger>
      {/* 宽度走 panel-md（32rem）而不是气泡默认的 overlay-lg：这里装的是地址与清单，
          横向空间不够就只能靠换行凑，越换越高。高度用到视口剩下的为止，再多才滚。 */}
      <PopoverContent
        width="xl"
        align="start"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-panel-md flex-col gap-md overflow-y-auto"
      >
        <span className="text-label-md">{title}</span>
        <dl className="flex flex-col gap-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-2xs">
              <dt className="text-label-sm text-muted-foreground">
                {row.label}
              </dt>
              <dd className="min-w-0 text-body-sm text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {href ? (
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={href}>{hrefLabel ?? href}</Link>
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** 多条等宽值（地址、客户端 ID、指标键）逐行列出；空时给「—」。 */
export function MonoList({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return <>—</>;
  return (
    <span className="flex flex-col gap-2xs">
      {items.map((item, index) => (
        <span
          key={`${index}-${item}`}
          className="break-all font-mono text-code-sm"
        >
          {item}
        </span>
      ))}
    </span>
  );
}

/** 列表里的更新时间。解析不了就原样给回，不把一个坏时间渲染成「Invalid Date」。 */
export function formatUpdatedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, locale);
}
