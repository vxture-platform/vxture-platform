"use client";

/**
 * TenantPanel - Console tenant context, shared Figma layout and scope switching.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getTenantPanelCopy } from "@vxture/platform-workspace-ui";
import {
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelRow,
  ShellScopeButton,
} from "@vxture/design-system";
import { tenantLogoUrl, type ConsoleQuotaUsage } from "@/api/console-bff";
import type { TenantContext } from "@/entities/console";
import { TenantPanelOverview } from "./TenantPanelOverview";
import { TenantScopePicker, type TenantScopeGroup } from "./TenantScopePicker";

// ============================================================================
// Context and navigation contract
// ============================================================================
export interface TenantPanelProps {
  tenant: TenantContext | null | undefined;
  /** 当前工作空间名；未知时面板显示"默认工作空间"。 */
  workspaceName: string | null;
  /**
   * 我能切过去的工作空间(只含我是活跃成员、且启用中的)。
   * ≤1 项时列表里只剩当前一行,切换入口自然无处可点——功能在,只是无处可切。
   */
  workspaceOptions: {
    id: string;
    name: string;
    isDefault: boolean;
    isCurrent: boolean;
  }[];
  onSwitchWorkspace: (workspaceId: string) => void;
  quotaUsage: ConsoleQuotaUsage | null;
  /** Formatted unpaid amount due for postpaid business only; excludes prepaid orders and paid totals. */
  monthlyBillLabel: string;
  /** Available account balance; unknown values remain an em dash. */
  balanceLabel?: string;
  /** Retained for caller compatibility; subscription plans are not shown here. */
  planName: string | null;
  /**
   * 可切换的租户列表(真列表,批 4):每个租户一行,当前项标出;≤1 项时只剩当前
   * 一行,切换入口自然无处可点(功能在,只是无处可切)。
   */
  tenantOptions: ReadonlyArray<{
    id: string;
    name: string;
    type: "personal" | "organization";
    isCurrent: boolean;
  }>;
  scopeGroups: ReadonlyArray<TenantScopeGroup>;
  onSwitchTenant: (tenantId: string) => void;
  onNavigate: (href: string) => void;
  /** 面板里任何一次跳转都要让 header 上其它弹层一起收起。 */
  onBeforeNavigate?: (() => void) | undefined;
}

// ============================================================================
// Live context adapter and tenant/workspace switching
// ============================================================================
export function TenantPanel({
  tenant,
  workspaceName,
  onSwitchWorkspace,
  quotaUsage,
  monthlyBillLabel,
  balanceLabel = "—",
  scopeGroups,
  onSwitchTenant,
  onNavigate,
  onBeforeNavigate,
}: TenantPanelProps) {
  const t = useTranslations("shell");
  const copy = getTenantPanelCopy(useLocale());
  const [open, setOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  const tenantName = tenant?.name.trim() || t("tenantOrg");
  const tenantTypeLabel =
    tenant?.tenantType === "personal" ? copy.personal : copy.organization;
  const suspended =
    tenant?.status === "suspended" || tenant?.status === "cancelled";

  const go = (href: string) => {
    setOpen(false);
    setScopeOpen(false);
    onBeforeNavigate?.();
    onNavigate(href);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 嵌套的"切换范围"子面板不能比父面板活得久，否则再打开时它还是展开的。
        if (!next) setScopeOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <ShellScopeButton
          className="w-auto max-w-[var(--container-overlay-xl)] hover:w-auto hover:max-w-[var(--container-overlay-xl)] max-sm:w-control-md max-sm:min-w-control-md max-sm:max-w-control-md max-sm:justify-center max-sm:p-0 max-sm:hover:w-control-md max-sm:hover:max-w-control-md max-sm:[&>span]:hidden max-sm:[&>svg:last-child]:hidden"
          icon={tenant?.tenantType === "personal" ? "user" : "buildings"}
          label={
            <span className="flex min-w-0 items-baseline gap-xs">
              <span className="max-w-[var(--container-overlay-sm)] shrink-0 truncate">
                {tenantName}
              </span>
              <span className="truncate text-body-sm font-normal text-muted-foreground">
                / {workspaceName || t("defaultWorkspace")}
              </span>
            </span>
          }
          ariaLabel={t("tenantOrg")}
          active={open}
        />
      </PopoverTrigger>

      <ShellPanelContent
        align="start"
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <TenantPanelOverview
          name={tenantName}
          typeLabel={tenantTypeLabel}
          personal={tenant?.tenantType === "personal"}
          suspendedLabel={suspended ? t("verifySuspended") : undefined}
          workspaceName={workspaceName || t("defaultWorkspace")}
          logoSrc={
            tenant?.logoHash
              ? tenantLogoUrl(tenant.id, tenant.logoHash)
              : undefined
          }
          usage={quotaUsage}
          balanceLabel={balanceLabel}
          monthlyBillLabel={monthlyBillLabel}
          billingPeriod={copy.billingPeriod}
          labels={copy.overview}
          onBilling={() => go("/billing")}
          onTenantInfo={() => go("/tenant")}
        >
          <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
            <PopoverTrigger asChild>
              <div>
                <ShellPanelRow
                  icon="arrow-left-right"
                  label={copy.switchScope}
                  description={copy.switchScopeHint}
                  active={scopeOpen}
                  onClick={() => setScopeOpen((current) => !current)}
                />
              </div>
            </PopoverTrigger>
            <ShellPanelContent
              side="right"
              align="end"
              collisionPadding={12}
              className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
            >
              <TenantScopePicker
                groups={scopeGroups}
                labels={{
                  organization: copy.organization,
                  personal: copy.personal,
                  defaultWorkspace: copy.defaultWorkspace,
                  enterTenant: copy.enterTenant,
                }}
                onSelect={(tenantId, workspaceId) => {
                  setOpen(false);
                  setScopeOpen(false);
                  if (tenantId !== tenant?.id) onSwitchTenant(tenantId);
                  else if (workspaceId) onSwitchWorkspace(workspaceId);
                }}
              />
            </ShellPanelContent>
          </Popover>
        </TenantPanelOverview>
      </ShellPanelContent>
    </Popover>
  );
}
