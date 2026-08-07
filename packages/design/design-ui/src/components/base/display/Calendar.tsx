/**
 * Calendar.tsx - 日历。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 Calendar（react-day-picker v9+ classNames API），取值换成
 * T2 语义类。classNames 的 key 逐个对过安装版（v10）的 UI / DayFlag /
 * SelectionState 枚举——v8 时代的 caption / head_row 那套 key 在 v9+ 全部改名，
 * 写错的 key 静默不生效，正是本仓最防的缺陷类。
 *
 * 选中态不走 classNames 的 selected / range_* key：range 中段的格子会同时带
 * selected 与 range_middle 两个 key 的类，谁盖谁取决于产物里的 CSS 顺序——
 * 这里照 shadcn v4 的思路换成自定义 DayButton，直接读 modifiers 按条件拼类，
 * 冲突由 cn（tailwind-merge）确定性裁决。
 *
 * 导航钮引 Button 的 ghost / icon-sm 档样式函数；箭头换成本仓 Icon
 * （上游 Chevron 是内置 svg polygon，不跟随图标体系）。
 */

import * as React from "react";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { cn } from "../../../utils/cn";
import { Icon, type IconName } from "../../../icons";
import { interactive } from "../../../styles/recipes";
import { buttonVariants } from "../form/Button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const CHEVRON_ICONS: Record<"up" | "down" | "left" | "right", IconName> = {
  up: "chevron-up",
  down: "chevron-down",
  left: "chevron-left",
  right: "chevron-right",
};

function CalendarDayButton({
  day: _day,
  modifiers,
  className,
  ...props
}: DayButtonProps) {
  const selectedSingle =
    modifiers["selected"] &&
    !modifiers["range_start"] &&
    !modifiers["range_end"] &&
    !modifiers["range_middle"];
  return (
    <button
      className={cn(
        "flex size-control-lg items-center justify-center rounded-md text-body-sm",
        interactive,
        "hover:bg-accent",
        // 今天的高亮只在未选中时出现——两个背景同时命中就要赌 CSS 顺序。
        modifiers["today"] && !modifiers["selected"] && "bg-accent",
        selectedSingle && "bg-primary text-primary-foreground hover:bg-primary",
        // 范围端点保持实心，向范围内侧取消圆角，与中段连成一条色带。
        modifiers["range_start"] &&
          "rounded-r-none bg-primary text-primary-foreground hover:bg-primary",
        modifiers["range_end"] &&
          "rounded-l-none bg-primary text-primary-foreground hover:bg-primary",
        modifiers["range_start"] && modifiers["range_end"] && "rounded-md",
        modifiers["range_middle"] &&
          "rounded-none bg-primary-muted text-primary-muted-foreground hover:bg-primary-muted",
        className,
      )}
      {...props}
    />
  );
}

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-md", className)}
      classNames={{
        months: "relative flex flex-col gap-md sm:flex-row",
        month: "flex w-full flex-col gap-sm",
        // 导航钮绝对定位到两个角，月份标题因此可以稳居中。
        nav: "absolute inset-x-none top-none flex w-full items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon-md" }),
          "text-muted-foreground",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon-md" }),
          "text-muted-foreground",
        ),
        month_caption: "flex h-control-md items-center justify-center",
        caption_label: "text-label-md",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-control-lg text-label-sm font-normal text-muted-foreground",
        week: "mt-xs flex w-full",
        day: "relative p-none text-center",
        outside: "text-muted-foreground",
        disabled: "text-muted-foreground opacity-disabled",
        hidden: "invisible",
        footer: "pt-sm text-body-sm text-muted-foreground",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) => (
          <Icon
            name={CHEVRON_ICONS[orientation ?? "left"]}
            size={16}
            className={cn(chevronClassName)}
          />
        ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
