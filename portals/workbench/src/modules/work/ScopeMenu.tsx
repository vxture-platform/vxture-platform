"use client";

/**
 * Real tenant/workspace transitions with the shared Console panel body.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { useState } from "react";
import {
  useMediaQuery,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelRow,
  ShellScopeButton,
} from "@vxture/design-system";
import {
  TenantPanelOverview,
  TenantScopePicker,
  getTenantPanelCopy,
} from "@vxture/platform-workspace-ui";
import type { WorkData, WorkRuntime } from "../../lib/contracts";
import { buildConsoleEntry } from "../../lib/console-entry";
import { authNavigation } from "../../lib/navigation";

// ============================================================================
// Shared scope composition
// ============================================================================
/**
 * Assemble shared tenant presentation around the current authenticated context.
 * @param props - Validated scope data and public destinations.
 * @returns The organization trigger and its two-level switcher.
 */
export function ScopeMenu({
  data,
  runtime,
}: {
  data: WorkData;
  runtime: WorkRuntime;
}): React.JSX.Element {
  const compactPanels = useMediaQuery("(max-width: 1024px)");
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { scope } = data;
  const copy = getTenantPanelCopy("zh-CN");
  const external = (path: string): void => {
    setOpen(false);
    window.open(
      buildConsoleEntry(data, runtime.consoleUrl, path),
      "_blank",
      "noopener,noreferrer",
    );
  };
  const groups =
    data.scopeOptions.status === "ready"
      ? data.scopeOptions.data.map((option) => ({
          id: option.id,
          name: option.name,
          personal: option.personal,
          identifier: option.identifier,
          workspaces: (
            option.workspaces ??
            (option.id === scope.id && data.workspaces.status === "ready"
              ? data.workspaces.data
              : [])
          ).map((workspace) => ({
            ...workspace,
            isCurrent:
              option.id === scope.id && workspace.id === scope.workspace,
          })),
        }))
      : [];
  const select = (tenantId: string, workspaceId?: string): void => {
    setOpen(false);
    if (tenantId !== scope.id)
      window.location.assign(
        authNavigation("switch-tenant", location.href, {
          tenantId,
          ...(workspaceId ? { workspaceId } : {}),
        }),
      );
    else if (workspaceId && workspaceId !== scope.workspace)
      window.location.assign(
        authNavigation("switch-workspace", location.href, { workspaceId }),
      );
  };
  return (
    <div className="work-scope">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setSwitching(false);
        }}
      >
        <PopoverTrigger asChild>
          <ShellScopeButton
            className="work-scope-trigger"
            icon={scope.personal ? "user" : "buildings"}
            active={open}
            ariaLabel="单位 / 工作空间"
            label={
              <span className="flex min-w-0 items-baseline gap-xs">
                <span className="work-scope-organization truncate">
                  {scope.name}
                </span>
                <span className="work-scope-workspace text-body-sm font-normal text-muted-foreground">
                  / {scope.workspaceName}
                </span>
              </span>
            }
          />
        </PopoverTrigger>
        <ShellPanelContent
          align="start"
          collisionPadding={12}
          className="work-scope-panel"
          aria-label="单位与工作空间"
        >
          <TenantPanelOverview
            name={scope.name}
            personal={scope.personal}
            typeLabel={scope.personal ? copy.personal : copy.organization}
            workspaceName={scope.workspaceName}
            usage={
              data.resources.status === "ready" ? data.resources.data : null
            }
            balanceLabel={
              data.balance.status === "ready" ? data.balance.data : "—"
            }
            monthlyBillLabel={
              data.monthlyBill.status === "ready" ? data.monthlyBill.data : "—"
            }
            billingPeriod={copy.billingPeriod}
            labels={copy.overview}
            onBilling={() => external("billing")}
            onTenantInfo={() => external("tenant")}
          >
            <Popover open={switching} onOpenChange={setSwitching}>
              <PopoverTrigger asChild>
                <div>
                  <ShellPanelRow
                    icon="arrow-left-right"
                    label={copy.switchScope}
                    description={copy.switchScopeHint}
                    onClick={() => setSwitching(true)}
                    active={switching}
                  />
                </div>
              </PopoverTrigger>
              <ShellPanelContent
                side={compactPanels ? "bottom" : "right"}
                align="end"
                collisionPadding={12}
                className="work-scope-panel"
                aria-label="切换组织"
              >
                {data.scopeOptions.status === "error" ? (
                  <p
                    role="status"
                    className="p-md text-body-sm text-muted-foreground"
                  >
                    {data.scopeOptions.message}
                  </p>
                ) : (
                  <TenantScopePicker
                    groups={groups}
                    labels={{
                      organization: copy.organization,
                      personal: copy.personal,
                      defaultWorkspace: copy.defaultWorkspace,
                      enterTenant: copy.enterTenant,
                    }}
                    onSelect={select}
                  />
                )}
                {data.workspaces.status === "error" && (
                  <p
                    role="status"
                    className="p-md text-body-sm text-muted-foreground"
                  >
                    工作空间列表：{data.workspaces.message}
                  </p>
                )}
              </ShellPanelContent>
            </Popover>
          </TenantPanelOverview>
        </ShellPanelContent>
      </Popover>
    </div>
  );
}
