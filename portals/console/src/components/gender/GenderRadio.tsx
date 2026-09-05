"use client";

/**
 * GenderRadio / GenderMark — 性别三选一(♂ / ♀ / 未设定),账号页与租户主管理员共用。
 * @package @vxture/console
 * @layer Application
 * @category Component
 *
 * 走查(owner 2026-09-05):性别跟在名字后面同一行,用圆点单选组直接给三个选项;
 * **显示用性别符号,不显示文字**(♂ ♀ 是 Unicode 字形,DS 图标库没有这两枚;文字只进
 * aria-label / title)。空值用 "unset" 当单选项的值(Radix 的 Item 不接受空串),对外
 * 仍是 "" | "male" | "female";展示态未设定时不画任何符号。
 */

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@vxture/design-system";

export type GenderValue = "" | "male" | "female";

export interface GenderLabels {
  readonly male: string;
  readonly female: string;
  readonly unset: string;
}

const SYMBOL: Record<Exclude<GenderValue, "">, string> = {
  male: "♂",
  female: "♀",
};

const ITEMS: readonly {
  value: "male" | "female" | "unset";
  key: GenderValue;
}[] = [
  { value: "male", key: "male" },
  { value: "female", key: "female" },
  { value: "unset", key: "" },
];

/** 展示态:♂ / ♀ 符号,未设定不画。文字只进无障碍名。 */
export function GenderMark({
  value,
  labels,
  className,
}: {
  readonly value: GenderValue | null | undefined;
  readonly labels: GenderLabels;
  readonly className?: string;
}) {
  if (value !== "male" && value !== "female") return null;
  return (
    <span
      role="img"
      aria-label={labels[value]}
      title={labels[value]}
      className={className ?? "text-body-lg leading-none text-muted-foreground"}
    >
      {SYMBOL[value]}
    </span>
  );
}

export function GenderRadio({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  readonly value: GenderValue;
  readonly onChange: (next: GenderValue) => void;
  readonly labels: GenderLabels;
  readonly ariaLabel: string;
}) {
  const id = useId();
  return (
    <RadioGroup
      value={value === "" ? "unset" : value}
      onValueChange={(next) =>
        onChange(next === "male" || next === "female" ? next : "")
      }
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-md"
    >
      {ITEMS.map((item) => {
        const text = item.key === "" ? labels.unset : labels[item.key];
        return (
          <label
            key={item.value}
            htmlFor={`${id}-${item.value}`}
            title={text}
            className="flex cursor-pointer items-center gap-xs text-body-lg leading-none text-foreground"
          >
            <RadioGroupItem
              id={`${id}-${item.value}`}
              value={item.value}
              aria-label={text}
            />
            <span aria-hidden="true">
              {item.key === "" ? "—" : SYMBOL[item.key]}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
