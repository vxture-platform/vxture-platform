/**
 * breadcrumb.tsx - Breadcrumb 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Navigation
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon } from "../../../icons";

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {}

export interface BreadcrumbListProps extends React.OlHTMLAttributes<HTMLOListElement> {}

export interface BreadcrumbItemProps extends React.LiHTMLAttributes<HTMLLIElement> {}

export interface BreadcrumbLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly asChild?: boolean;
}

export interface BreadcrumbPageProps extends React.HTMLAttributes<HTMLSpanElement> {}

export interface BreadcrumbSeparatorProps extends React.HTMLAttributes<HTMLSpanElement> {}

export interface BreadcrumbEllipsisProps extends React.HTMLAttributes<HTMLSpanElement> {}

const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  function Breadcrumb({ ...props }, ref) {
    return <nav ref={ref} aria-label="breadcrumb" {...props} />;
  },
);

const BreadcrumbList = React.forwardRef<HTMLOListElement, BreadcrumbListProps>(
  function BreadcrumbList({ className, ...props }, ref) {
    return (
      <ol
        ref={ref}
        className={cn(
          "flex flex-wrap items-center gap-xs break-words text-body-sm text-muted-foreground sm:gap-sm",
          className,
        )}
        {...props}
      />
    );
  },
);

const BreadcrumbItem = React.forwardRef<HTMLLIElement, BreadcrumbItemProps>(
  function BreadcrumbItem({ className, ...props }, ref) {
    return (
      <li
        ref={ref}
        className={cn("inline-flex items-center gap-xs", className)}
        {...props}
      />
    );
  },
);

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  function BreadcrumbLink({ asChild, className, ...props }, ref) {
    const Comp = asChild ? Slot : "a";
    return (
      <Comp
        ref={ref}
        className={cn(
          "rounded-sm transition-colors duration-fast ease-standard",
          "hover:text-foreground",
          interactive,
          className,
        )}
        {...props}
      />
    );
  },
);

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
  function BreadcrumbPage({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        role="link"
        aria-disabled="true"
        aria-current="page"
        className={cn("font-normal text-foreground", className)}
        {...props}
      />
    );
  },
);

const BreadcrumbSeparator = React.forwardRef<
  HTMLSpanElement,
  BreadcrumbSeparatorProps
>(function BreadcrumbSeparator({ children, className, ...props }, ref) {
  return (
    <span
      ref={ref}
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-icon-sm", className)}
      {...props}
    >
      {children ?? <Icon name="chevron-right" size={16} />}
    </span>
  );
});

const BreadcrumbEllipsis = React.forwardRef<
  HTMLSpanElement,
  BreadcrumbEllipsisProps
>(function BreadcrumbEllipsis({ className, ...props }, ref) {
  return (
    <span
      ref={ref}
      role="presentation"
      aria-hidden="true"
      className={cn(
        "flex size-control-lg items-center justify-center",
        className,
      )}
      {...props}
    >
      <Icon name="placeholder" size={16} />
      <span className="sr-only">More</span>
    </span>
  );
});

Breadcrumb.displayName = "Breadcrumb";
BreadcrumbList.displayName = "BreadcrumbList";
BreadcrumbItem.displayName = "BreadcrumbItem";
BreadcrumbLink.displayName = "BreadcrumbLink";
BreadcrumbPage.displayName = "BreadcrumbPage";
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis";

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
