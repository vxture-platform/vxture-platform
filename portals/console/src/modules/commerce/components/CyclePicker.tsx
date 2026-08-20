"use client";

/**
 * CyclePicker.tsx — 订阅周期选择器（「买多久」）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 形态对齐 WorkspacePicker：一行 = 日历图标 + 周期名（年付时附省额徽章）+
 * 右对齐的起止日期，整行占满；点击下拉切换 月付/年付。
 * 起止日期按「此刻开通」估算——真实周期自服务开通时刻起算
 * （owner 2026-08-20：不是收款确认时刻，存在提前续订）。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  StatusBadge,
} from "@vxture/design-system";

export type CycleValue = "month" | "year";

const CYCLE_VALUES: CycleValue[] = ["month", "year"];

/** 本地时区 yyyy-MM-dd（toISOString 会因 UTC 偏移串日）。 */
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 以当前时刻为起点估算周期起止（含首日，止日 = 起日 + 周期 − 1 天）。 */
function rangeFor(cycle: CycleValue): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start);
  if (cycle === "month") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}

export interface CyclePickerProps {
  readonly value: CycleValue;
  readonly onChange: (next: CycleValue) => void;
  /** 每周期的价格展示（如「¥4,999 / 年」）；null 时不显示。 */
  readonly priceOf?: (cycle: CycleValue) => string | null;
  /** 年付省额徽章文案（已格式化）；null 时不显示。 */
  readonly yearSavings?: string | null;
  readonly disabled?: boolean;
}

export function CyclePicker({
  value,
  onChange,
  priceOf,
  yearSavings,
  disabled,
}: CyclePickerProps) {
  const t = useTranslations("subscribePage");
  const label = (c: CycleValue) =>
    t(`cycleToggle.${c === "month" ? "monthly" : "yearly"}`);
  const range = rangeFor(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-auto w-full justify-start gap-md px-md py-sm text-left font-normal"
        >
          <span
            aria-hidden="true"
            className="flex size-control-md shrink-0 items-center justify-center rounded-lg bg-primary-muted-hover text-primary-hover"
          >
            <Icon name="calendar" size="sm" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-sm">
            <span className="text-label-md text-foreground">
              {label(value)}
            </span>
            {value === "year" && yearSavings ? (
              <StatusBadge tone="success">{yearSavings}</StatusBadge>
            ) : null}
          </span>
          <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
            {range.start} → {range.end}
          </span>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            <Icon name="chevron-down" size="sm" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width)"
      >
        {CYCLE_VALUES.map((cycle) => {
          const price = priceOf?.(cycle) ?? null;
          return (
            <DropdownMenuItem
              key={cycle}
              onSelect={() => onChange(cycle)}
              className="gap-md py-sm"
            >
              <span className="flex min-w-0 flex-1 items-center gap-sm">
                <span className="text-label-md text-foreground">
                  {label(cycle)}
                </span>
                {cycle === "year" && yearSavings ? (
                  <StatusBadge tone="success">{yearSavings}</StatusBadge>
                ) : null}
              </span>
              {price ? (
                <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
                  {price}
                </span>
              ) : null}
              {cycle === value ? (
                <span className="shrink-0 text-primary" aria-hidden="true">
                  <Icon name="check" size="sm" />
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
