/**
 * tabs.tsx - Tabs 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Navigation
 */

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../../utils/cn";
import { iconInset, interactive } from "../../../styles/recipes";

export interface TabsProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Root
> {}

export interface TabsListProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
> {}

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> {}

export interface TabsContentProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Content
> {}

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList({ className, ...props }, ref) {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "inline-flex h-control-lg items-center justify-center rounded-lg bg-accent p-2xs text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  function TabsTrigger({ className, ...props }, ref) {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          cn(
            "relative inline-flex flex-1 items-center justify-center gap-xs whitespace-nowrap",
            "rounded-md border border-transparent px-sm py-2xs text-label-md",
            interactive,
            iconInset,
            // 未选中的标签压到 60% 而不是换成 muted-foreground：同一组标签里
            // 选中与未选中应当是同一种颜色的深浅，换个色号会读成两类东西。
            "text-foreground/60 hover:text-foreground",
            "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-raised",
          ),
          className,
        )}
        {...props}
      />
    );
  },
);

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  function TabsContent({ className, ...props }, ref) {
    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn(
          "mt-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
        {...props}
      />
    );
  },
);

TabsList.displayName = TabsPrimitive.List.displayName;
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
