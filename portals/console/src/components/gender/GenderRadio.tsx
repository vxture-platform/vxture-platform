"use client";

/**
 * GenderRadio — 性别三选一(男 / 女 / 未设定)的单选组,账号页与租户主管理员共用。
 * @package @vxture/console
 * @layer Application
 * @category Component
 *
 * 走查(owner 2026-09-05):性别跟在名字后面同一行,用圆点单选组直接给三个选项;
 * 账号基本信息与租户主管理员同构。空值用 "unset" 当单选项的值(Radix 的 Item 不接受
 * 空串),对外仍是 "" | "male" | "female"。
 */

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@vxture/design-system";

export type GenderValue = "" | "male" | "female";

const ITEMS: readonly {
  value: "male" | "female" | "unset";
  key: GenderValue;
}[] = [
  { value: "male", key: "male" },
  { value: "female", key: "female" },
  { value: "unset", key: "" },
];

export function GenderRadio({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  readonly value: GenderValue;
  readonly onChange: (next: GenderValue) => void;
  readonly labels: {
    readonly male: string;
    readonly female: string;
    readonly unset: string;
  };
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
      {ITEMS.map((item) => (
        <label
          key={item.value}
          htmlFor={`${id}-${item.value}`}
          className="flex cursor-pointer items-center gap-xs text-body-md text-foreground"
        >
          <RadioGroupItem id={`${id}-${item.value}`} value={item.value} />
          <span>{labels[item.key === "" ? "unset" : item.key]}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** 展示态文字。 */
export function genderLabel(
  value: GenderValue | null | undefined,
  labels: {
    readonly male: string;
    readonly female: string;
    readonly unset: string;
  },
): string {
  return value === "male"
    ? labels.male
    : value === "female"
      ? labels.female
      : labels.unset;
}
