"use client";

/**
 * TenantPanelOverview.tsx - Shared tenant panel composition from the Figma design.
 * @package @vxture/platform-workspace-ui
 * @layer Infrastructure
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { ReactNode } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Icon,
  Progress,
  ShellPanelRow,
  ShellPanelSection,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vxture/design-system";
import { fmtCount, formatBytes } from "./format-metrics";

// ============================================================================
// Presentation contract
// ============================================================================
interface UsageMetric {
  used: number;
  limit: number;
}

export interface TenantPanelOverviewProps {
  name: string;
  typeLabel: string;
  personal?: boolean;
  suspendedLabel?: string | undefined;
  workspaceName: string;
  identifier?: ReactNode;
  logoSrc?: string | undefined;
  usage: { storage: UsageMetric; aiCredit: UsageMetric } | null;
  balanceLabel: string;
  /** Unpaid amount due for postpaid business only; unknown values remain an em dash. */
  monthlyBillLabel: string;
  billingPeriod: string;
  labels: {
    resources: string;
    storage: string;
    aiCredits: string;
    pointsUnit: string;
    unavailable: string;
    totalQuota: string;
    usageSummary: (percent: string, used: string) => string;
    billing: string;
    accountBalance: string;
    balanceHint: string;
    monthlyBill: string;
    tenantInfo: string;
    tenantInfoHint: string;
  };
  onBilling: () => void;
  onTenantInfo: () => void;
  children: ReactNode;
}

// ============================================================================
// Resource rows: left identity, right value, meter and caption
// ============================================================================
function ResourceRow({
  storage = false,
  label,
  metric,
  labels,
}: {
  storage?: boolean;
  label: string;
  metric: UsageMetric | null;
  labels: TenantPanelOverviewProps["labels"];
}): React.JSX.Element {
  const known =
    metric !== null &&
    Number.isFinite(metric.used) &&
    Number.isFinite(metric.limit) &&
    metric.used >= 0 &&
    metric.limit >= 0;
  const percent =
    known && metric.limit > 0 ? (metric.used / metric.limit) * 100 : 0;
  const formatted = known
    ? storage
      ? formatBytes(metric.limit)
      : fmtCount(metric.limit)
    : "—";
  const [amount, byteUnit] = storage
    ? formatted.split(" ")
    : [formatted, undefined];
  const unit = known ? (storage ? byteUnit : labels.pointsUnit) : undefined;
  const used = known
    ? storage
      ? formatBytes(metric.used)
      : `${fmtCount(metric.used)} ${labels.pointsUnit}`
    : "—";

  return (
    <div
      className="flex items-center gap-xs px-sm py-sm"
      data-tenant-resource={storage ? "storage" : "ai"}
    >
      <span
        className="flex w-icon-sm shrink-0 items-center justify-center text-muted-foreground"
        aria-hidden="true"
      >
        <Icon name={storage ? "database" : "sparkles"} size="sm" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <span className="truncate text-label-md text-foreground">{label}</span>
        <span className="text-body-sm text-muted-foreground">workspace</span>
      </div>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              tabIndex={0}
              aria-label={label}
              data-tenant-resource-value
              className="flex w-5/12 min-w-0 flex-col gap-2xs rounded-sm text-right outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-baseline justify-end gap-2xs tabular-nums">
                <span className="text-lg font-medium text-foreground">
                  {amount}
                </span>
                {unit && (
                  <span className="text-body-sm text-muted-foreground">
                    {unit}
                  </span>
                )}
              </div>
              <Progress
                value={known ? Math.min(100, Math.max(0, percent)) : undefined}
                aria-label={label}
                className="h-2xs"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            sideOffset={12}
            collisionPadding={12}
            avoidCollisions
            sticky="always"
            data-tenant-resource-tooltip
            className="text-body-sm font-normal"
          >
            {known ? (
              <div className="flex flex-col gap-2xs">
                <span>
                  {labels.totalQuota} {formatted}
                  {!storage && ` ${labels.pointsUnit}`}
                </span>
                <span>
                  {labels.usageSummary(String(Math.round(percent)), used)}
                </span>
              </div>
            ) : (
              labels.unavailable
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ============================================================================
// Shared panel body; callers supply navigation and scope switching
// ============================================================================
/**
 * Render the same tenant panel body in Console and Work.
 * @param props - Localized content, account metrics and navigation callbacks.
 * @returns Tenant identity, resource and billing sections with caller-owned switching.
 */
export function TenantPanelOverview(
  props: Readonly<TenantPanelOverviewProps>,
): React.JSX.Element {
  const { labels } = props;
  return (
    <div className="flex flex-col gap-md" data-tenant-overview>
      <div className="flex items-center gap-md px-sm">
        {props.logoSrc ? (
          <Avatar
            key={props.logoSrc}
            className="size-control-lg shrink-0 rounded-md"
          >
            <AvatarImage src={props.logoSrc} alt={props.name} />
            <AvatarFallback className="rounded-md">
              <Icon name={props.personal ? "user" : "buildings"} size="lg" />
            </AvatarFallback>
          </Avatar>
        ) : (
          <span
            className="flex size-control-lg shrink-0 items-center justify-center text-foreground"
            aria-hidden="true"
          >
            <Icon name={props.personal ? "user" : "buildings"} size="lg" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <div className="flex items-center justify-between gap-xs">
            <span
              className="truncate text-label-lg text-foreground"
              title={props.name}
            >
              {props.name}
            </span>
            {props.suspendedLabel ? (
              <StatusBadge tone="warning">{props.suspendedLabel}</StatusBadge>
            ) : (
              <Badge
                variant="outline"
                className="shrink-0 rounded-full text-label-sm font-normal"
              >
                {props.typeLabel}
              </Badge>
            )}
          </div>
          <span
            className="truncate text-body-sm text-muted-foreground"
            title={props.workspaceName}
          >
            {props.workspaceName}
          </span>
          {props.identifier && (
            <span className="text-body-sm text-muted-foreground">
              {props.identifier}
            </span>
          )}
        </div>
      </div>
      <ShellPanelSection title={labels.resources} divided={false}>
        <ResourceRow
          label={labels.aiCredits}
          metric={props.usage?.aiCredit ?? null}
          labels={labels}
        />
        <ResourceRow
          storage
          label={labels.storage}
          metric={props.usage?.storage ?? null}
          labels={labels}
        />
      </ShellPanelSection>
      <ShellPanelSection title={labels.billing}>
        <ShellPanelRow
          icon="credit-card"
          label={labels.accountBalance}
          description={labels.balanceHint}
          value={
            <span className="text-lg font-medium text-foreground">
              {props.balanceLabel}
            </span>
          }
          chevron={false}
          onClick={props.onBilling}
          className="py-sm"
        />
        <ShellPanelRow
          icon="receipt"
          label={labels.monthlyBill}
          description={props.billingPeriod}
          value={
            <span className="text-lg font-medium text-foreground">
              {props.monthlyBillLabel}
            </span>
          }
          chevron={false}
          onClick={props.onBilling}
          className="py-sm"
        />
      </ShellPanelSection>
      <ShellPanelSection>
        <ShellPanelRow
          icon="buildings"
          label={labels.tenantInfo}
          description={labels.tenantInfoHint}
          onClick={props.onTenantInfo}
        />
        {props.children}
      </ShellPanelSection>
    </div>
  );
}
