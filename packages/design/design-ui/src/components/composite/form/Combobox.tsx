"use client";

/**
 * Combobox.tsx - 可搜索单选。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 上游把 combobox 当组合示例（Button + Popover + Command）不出成品件，代价是
 * 每个产品自己拼一遍、开合状态与选中回显各写各的。这里落成 pattern，API 零业务：
 * 条目只有 value / label / disabled 三个形状字段，受控值走 value / onValueChange。
 *
 * 触发器宽度不定死，由调用方 className 给；浮层宽度跟触发器对齐——那是
 * Radix 在运行时量出来的值（--radix-popover-trigger-width），走 style 不走类名。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { Button } from "../../base/form/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../base/overlay/Popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../base/overlay/Command";

export interface ComboboxItem {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly disabled?: boolean;
}

export interface ComboboxProps {
  readonly items: readonly ComboboxItem[];
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function Combobox({
  items,
  value,
  onValueChange,
  placeholder = "请选择",
  searchPlaceholder = "搜索…",
  emptyText = "没有匹配项",
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = items.find((item) => item.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between", className)}
        >
          {selected ? (
            selected.label
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <Icon name="chevron-down" size={16} className="opacity-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-none"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  // label 是 string 时并入检索词，否则只按 value 过滤。
                  {...(typeof item.label === "string"
                    ? { keywords: [item.label] }
                    : {})}
                  {...(item.disabled !== undefined
                    ? { disabled: item.disabled }
                    : {})}
                  onSelect={(next) => {
                    onValueChange?.(next);
                    setOpen(false);
                  }}
                >
                  {item.label}
                  <Icon
                    name="check"
                    size={16}
                    className={cn(
                      "ml-auto",
                      item.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
