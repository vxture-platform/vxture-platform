"use client";

/**
 * DatePicker.tsx - 日期选择。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 上游把 date picker 当组合示例（Button + Popover + Calendar）不出成品件，
 * 这里落成 pattern。展示格式用 Intl.DateTimeFormat("zh-CN")——格式化是平台
 * 自带的能力，不为一行日期引 date-fns。
 *
 * onValueChange 会收到 undefined：再点已选中的那天是取消选择，这是日历的
 * 原生语义，吞掉它调用方就做不出"可清空"的字段。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { Button } from "../../base/form/Button";
import { Calendar } from "../../base/display/Calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../base/overlay/Popover";

export interface DatePickerProps {
  readonly value?: Date;
  readonly onValueChange?: (value?: Date) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

const formatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });

export function DatePicker({
  value,
  onValueChange,
  placeholder = "选择日期",
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("justify-start", className)}
        >
          <Icon name="calendar" size={16} data-icon="inline-start" />
          {value ? (
            formatter.format(value)
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-none">
        <Calendar
          mode="single"
          {...(value !== undefined ? { selected: value } : {})}
          onSelect={(next) => {
            onValueChange?.(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
