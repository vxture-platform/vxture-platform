/**
 * Accordion.tsx - 手风琴。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 *
 * 结构照 shadcn 官方 Accordion，取值换成 T2 语义类。条目分隔线走
 * `hairline.field`——线型语义里虚线管"分行 / 分字段"，手风琴的条目是行。
 *
 * 一处刻意省略：上游的展开 / 收起高度动画依赖 tailwind 配置里自定义的
 * `accordion-down/up` keyframes（读 `--radix-accordion-content-height`）。
 * 本仓样式层没有注册这对 keyframes，写上类名只会静默哑火（守卫也会报），
 * 故内容区不做高度动画，箭头旋转仍保留过渡。
 */

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { hairline, interactive } from "../../../styles/recipes";

export type AccordionProps = React.ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Root
>;

export interface AccordionItemProps extends React.ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Item
> {}

export interface AccordionTriggerProps extends React.ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Trigger
> {}

export interface AccordionContentProps extends React.ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Content
> {}

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  function AccordionItem({ className, ...props }, ref) {
    return (
      <AccordionPrimitive.Item
        ref={ref}
        className={cn("border-b last:border-b-0", hairline.field, className)}
        {...props}
      />
    );
  },
);

const AccordionTrigger = React.forwardRef<
  HTMLButtonElement,
  AccordionTriggerProps
>(function AccordionTrigger({ className, children, ...props }, ref) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          "group flex flex-1 items-center justify-between gap-md rounded-sm py-md",
          "text-left text-label-md",
          interactive,
          "hover:underline",
          className,
        )}
        {...props}
      >
        {children}
        <Icon
          name="chevron-down"
          size={16}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground",
            "transition-transform duration-fast ease-standard",
            // ⚠ 用 `group-data-[state=open]`：Radix 发的是 data-state 属性，
            //   `group-data-open:` 编译得出但永远匹配不上。
            "group-data-[state=open]:rotate-180",
          )}
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
});

const AccordionContent = React.forwardRef<
  HTMLDivElement,
  AccordionContentProps
>(function AccordionContent({ className, children, ...props }, ref) {
  return (
    <AccordionPrimitive.Content
      ref={ref}
      className="overflow-hidden text-body-sm"
      {...props}
    >
      <div className={cn("pb-md", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
});

AccordionItem.displayName = AccordionPrimitive.Item.displayName;
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
