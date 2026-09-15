"use client";
/**
 * ConfigCells.tsx — 表格格子的两种形态：主辅上下、「已配置 ▸」气泡。
 * @package @vxture/opera
 *
 * owner 2026-09-16：列表的核心信息要补齐，但列不能多——相似的两项合成一格上下主辅；
 * 太长的（回调地址、客户端清单、指标键）只露一个摘要，点开贴着格子弹出详情，
 * 不离开列表。
 */
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  Button,
  DetailList,
  DetailRow,
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

/** 摘要作触发器，点开贴着格子弹出「标签 · 值」清单，底部可带一个去配置的链接。 */
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
      <PopoverContent align="start" className="flex flex-col gap-sm">
        <span className="text-label-md">{title}</span>
        <DetailList>
          {rows.map((row) => (
            <DetailRow key={row.label} label={row.label}>
              {row.value}
            </DetailRow>
          ))}
        </DetailList>
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
        <Fragment key={`${index}-${item}`}>
          <span className="font-mono text-code-sm break-all">{item}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** 列表里的更新时间。解析不了就原样给回，不把一个坏时间渲染成「Invalid Date」。 */
export function formatUpdatedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, locale);
}
