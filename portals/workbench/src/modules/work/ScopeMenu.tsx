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
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelRow,
  ShellScopeButton,
} from "@vxture/design-system";
import {
  TenantPanelOverview,
  TenantScopePicker,
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
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { scope } = data;
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
          workspaces:
            option.id === scope.id && data.workspaces.status === "ready"
              ? data.workspaces.data.map((workspace) => ({
                  ...workspace,
                  isCurrent: workspace.id === scope.workspace,
                }))
              : [],
        }))
      : [];
  const select = (tenantId: string, workspaceId?: string): void => {
    setOpen(false);
    if (tenantId !== scope.id)
      window.location.assign(
        authNavigation("switch-tenant", location.href, { tenantId }),
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
                <span className="truncate">{scope.name}</span>
                <span className="work-scope-workspace text-body-sm font-normal text-muted-foreground">
                  / {scope.workspaceName}
                </span>
              </span>
            }
          />
        </PopoverTrigger>
        <ShellPanelContent
          align="start"
          className="work-scope-panel"
          aria-label={switching ? "切换单位与工作空间" : "单位与工作空间"}
        >
          {switching ? (
            <div className="flex flex-col gap-md">
              <ShellPanelRow
                icon="arrow-left"
                label="返回单位概览"
                onClick={() => setSwitching(false)}
              />
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
                    organization: "组织租户",
                    personal: "个人租户",
                    defaultWorkspace: "登录后默认进入",
                    enterTenant: "进入此单位选择工作空间",
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
            </div>
          ) : (
            <TenantPanelOverview
              name={scope.name}
              personal={scope.personal}
              typeLabel={scope.personal ? "个人租户" : "组织租户"}
              workspaceName={scope.workspaceName}
              usage={
                data.resources.status === "ready" ? data.resources.data : null
              }
              balanceLabel={
                data.balance.status === "ready" ? data.balance.data : "—"
              }
              monthlyBillLabel="—"
              billingPeriod="本月后付费应付"
              labels={{
                resources: "资源",
                storage: "存储容量",
                aiCredits: "AI 点数",
                pointsUnit: "点",
                unavailable: "暂时无法读取用量",
                totalQuota: "总配额",
                usageSummary: (percent, used) => `已使用 ${used} · ${percent}%`,
                billing: "账务",
                accountBalance: "账户余额",
                balanceHint: "可用于后续业务支出",
                monthlyBill: "本月账单",
                tenantInfo: "单位信息",
                tenantInfoHint: "在控制台查看与管理",
              }}
              onBilling={() => external("billing")}
              onTenantInfo={() => external("tenant")}
            >
              <ShellPanelRow
                icon="arrow-left-right"
                label="切换单位与工作空间"
                onClick={() => setSwitching(true)}
              />
            </TenantPanelOverview>
          )}
        </ShellPanelContent>
      </Popover>
    </div>
  );
}
