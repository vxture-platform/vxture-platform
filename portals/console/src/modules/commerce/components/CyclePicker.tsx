"use client";

/**
 * CyclePicker.tsx — 订阅周期选择器（「买多久」）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 形态遵守 owner 2026-08-20 条 3：不是下拉，而是与归属卡同规格的三段式单行
 * （sectionKit 信息行）：日历 icon | 月付/年付 分段切换 | 右对齐起止日期。
 * 年付省额徽章跟在切换器旁，整行占满。
 * 起止日期按「此刻开通」估算——真实周期自服务开通时刻起算
 * （不是收款确认时刻，存在提前续订）。
 */

import { useTranslations } from "next-intl";
import { Icon, SegmentedControl, StatusBadge, cn } from "@vxture/design-system";
import { infoRow, infoRowGlyph, infoRowRight } from "./sectionKit";

export type CycleValue = "month" | "year";

const CYCLE_VALUES: CycleValue[] = ["month", "year"];

/** 本地时区 yyyy-MM-dd（toISOString 会因 UTC 偏移串日）。 */
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 估算周期起止（含首日，止日 = 起日 + 周期 − 1 天）。起点默认此刻;续订传当前订阅的
 * 到期时刻(批 1c:此前续订也按「此刻」算,把一个还剩 20 天的订阅画成明天就换周期)。
 */
function rangeFor(
  cycle: CycleValue,
  startAt?: string | null,
): { start: string; end: string } {
  const parsed = startAt ? new Date(startAt) : null;
  const start =
    parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()
      ? parsed
      : new Date();
  const end = new Date(start);
  if (cycle === "month") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}

export interface CyclePickerProps {
  readonly value: CycleValue;
  readonly onChange: (next: CycleValue) => void;
  /** 年付省额徽章文案（已格式化）；null 时不显示。 */
  readonly yearSavings?: string | null;
  readonly disabled?: boolean;
  /** 周期起点(ISO);续订 = 当前订阅到期时刻,缺省 = 此刻。 */
  readonly startAt?: string | null;
}

export function CyclePicker({
  value,
  onChange,
  yearSavings,
  disabled,
  startAt,
}: CyclePickerProps) {
  const t = useTranslations("subscribePage");
  const label = (c: CycleValue) =>
    t(`cycleToggle.${c === "month" ? "monthly" : "yearly"}`);
  const range = rangeFor(value, startAt);

  return (
    <div className={infoRow}>
      <span
        aria-hidden="true"
        className={cn(
          infoRowGlyph,
          "bg-primary-muted-hover text-primary-hover",
        )}
      >
        <Icon name="calendar" size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-sm">
        <SegmentedControl<CycleValue>
          size="sm"
          ariaLabel={t("confirm.howLong")}
          value={value}
          onChange={onChange}
          items={CYCLE_VALUES.map((cycle) => ({
            value: cycle,
            label: label(cycle),
            ...(disabled ? { disabled: true } : {}),
          }))}
        />
        {value === "year" && yearSavings ? (
          <StatusBadge tone="success">{yearSavings}</StatusBadge>
        ) : null}
      </span>
      <span className={infoRowRight}>
        {range.start} → {range.end}
      </span>
    </div>
  );
}
