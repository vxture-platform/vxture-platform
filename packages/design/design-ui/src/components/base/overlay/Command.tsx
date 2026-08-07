/**
 * Command.tsx - 命令面板族。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Floating
 *
 * 结构照 shadcn 官方 Command（基于 cmdk），取值换成 T2 语义类。过滤、键盘
 * 巡航、选中态全由 cmdk 承担，本件只管皮。
 *
 * ⚠ cmdk 的状态属性与 Radix 不同：条目发的是 `data-selected="true"` /
 *   `data-disabled="true"`（带值，不是 data-state）——选择器必须写
 *   `data-[selected=true]`，写 `data-[state=selected]` 编译得出但永远匹配不上。
 *
 * CommandDialog 复用本仓 Dialog：遮罩、动效、Esc 关闭都不重写一遍。
 */

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { hairline, inlineIcon } from "../../../styles/recipes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogProps,
} from "./Dialog";

export interface CommandProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive
> {}

export interface CommandDialogProps extends DialogProps {
  /** 无障碍标题：面板本身没有可见标题，读屏用户需要它知道弹出的是什么。 */
  readonly title?: string;
  readonly description?: string;
  /**
   * 透传给内层 `Command` 的 props（`shouldFilter` / `loop` / `filter` …）。
   * 单开一个字段而不是散在顶层：顶层 props 整份进 Radix `Dialog`，cmdk 的
   * 参数混在里面会被当成未知 DOM 属性透到元素上，React 会告警且行为失效。
   */
  readonly commandProps?: Omit<CommandProps, "children">;
}

export interface CommandInputProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Input
> {}

export interface CommandListProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.List
> {}

export interface CommandEmptyProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Empty
> {}

export interface CommandGroupProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Group
> {}

export interface CommandItemProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Item
> {}

export interface CommandSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Separator
> {}

const Command = React.forwardRef<HTMLDivElement, CommandProps>(function Command(
  { className, ...props },
  ref,
) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-md bg-popover text-foreground",
        className,
      )}
      {...props}
    />
  );
});

const CommandDialog = ({
  title = "命令面板",
  description = "搜索并执行命令",
  children,
  commandProps,
  ...props
}: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-none">
        {/* 标题只给读屏：可见的"标题"就是输入框本身。 */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command {...commandProps}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  function CommandInput({ className, ...props }, ref) {
    return (
      // 输入行下的实线开的是整个结果区块，走 block 档不走行分隔的虚线。
      <div
        className={cn(
          "flex items-center gap-xs border-b px-md",
          hairline.block,
        )}
        cmdk-input-wrapper=""
      >
        <Icon
          name="search"
          size={16}
          aria-hidden="true"
          className="shrink-0 opacity-muted"
        />
        <CommandPrimitive.Input
          ref={ref}
          className={cn(
            "flex h-control-xl w-full bg-transparent py-sm text-body-sm outline-none",
            "placeholder:text-muted-foreground",
            "disabled:cursor-not-allowed disabled:opacity-disabled",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<HTMLDivElement, CommandListProps>(
  function CommandList({ className, ...props }, ref) {
    return (
      <CommandPrimitive.List
        ref={ref}
        className={cn(
          // 最大高取媒体刻度档（默认密度 192px），列表内部自滚动。
          "max-h-media-3xl overflow-y-auto overflow-x-hidden",
          className,
        )}
        {...props}
      />
    );
  },
);

const CommandEmpty = React.forwardRef<HTMLDivElement, CommandEmptyProps>(
  function CommandEmpty({ className, ...props }, ref) {
    return (
      <CommandPrimitive.Empty
        ref={ref}
        className={cn(
          "py-lg text-center text-body-sm text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

const CommandGroup = React.forwardRef<HTMLDivElement, CommandGroupProps>(
  function CommandGroup({ className, ...props }, ref) {
    return (
      <CommandPrimitive.Group
        ref={ref}
        className={cn(
          "overflow-hidden p-2xs text-foreground",
          // 组标题是 cmdk 渲染的内部节点，只能从外面用属性选择器够到。
          "[&_[cmdk-group-heading]]:px-sm [&_[cmdk-group-heading]]:py-xs",
          "[&_[cmdk-group-heading]]:text-label-sm [&_[cmdk-group-heading]]:text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  function CommandItem({ className, ...props }, ref) {
    return (
      <CommandPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center gap-xs rounded-sm px-sm py-xs text-body-sm outline-none transition-colors",
          inlineIcon,
          // ⚠ cmdk 发的是带值属性：data-selected="true" / data-disabled="true"。
          "data-[selected=true]:bg-accent data-[selected=true]:text-foreground",
          "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-disabled",
          className,
        )}
        {...props}
      />
    );
  },
);

const CommandSeparator = React.forwardRef<
  HTMLDivElement,
  CommandSeparatorProps
>(function CommandSeparator({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Separator
      ref={ref}
      className={cn("-mx-2xs my-2xs h-px bg-border", className)}
      {...props}
    />
  );
});

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-body-sm tracking-widest opacity-subtle",
        className,
      )}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

Command.displayName = CommandPrimitive.displayName;
CommandDialog.displayName = "CommandDialog";
CommandList.displayName = CommandPrimitive.List.displayName;
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;
CommandGroup.displayName = CommandPrimitive.Group.displayName;
CommandItem.displayName = CommandPrimitive.Item.displayName;
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
