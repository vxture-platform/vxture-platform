/**
 * Collapsible.tsx - 折叠区。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 *
 * 结构照 shadcn 官方 Collapsible：上游本就不带任何样式——它只提供"展开 / 收起"
 * 的状态与无障碍语义，外观完全由调用方决定。与 Accordion 的分工：Accordion 管
 * 一组互斥 / 并列的条目并自带条目样式，Collapsible 只管一块内容的开合。
 */

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

export type CollapsibleProps = React.ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.Root
>;

export interface CollapsibleTriggerProps extends React.ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.CollapsibleTrigger
> {}

export interface CollapsibleContentProps extends React.ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.CollapsibleContent
> {}

const Collapsible = CollapsiblePrimitive.Root;

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
