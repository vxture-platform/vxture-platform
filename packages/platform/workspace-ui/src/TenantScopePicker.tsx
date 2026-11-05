"use client";

/**
 * TenantScopePicker.tsx - Figma tenant groups with directly selectable workspaces.
 * @package @vxture/platform-workspace-ui
 * @layer Infrastructure
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { Badge, Icon, ShellPanelRow } from "@vxture/design-system";

// ============================================================================
// Presentation contract
// ============================================================================
export interface TenantScopeGroup {
  id: string;
  name: string;
  identifier?: string | undefined;
  personal: boolean;
  workspaces: ReadonlyArray<{
    id: string;
    name: string;
    isDefault: boolean;
    isCurrent: boolean;
  }>;
}

export interface TenantScopePickerProps {
  groups: ReadonlyArray<TenantScopeGroup>;
  labels: {
    organization: string;
    personal: string;
    defaultWorkspace: string;
    enterTenant: string;
  };
  onSelect: (tenantId: string, workspaceId?: string) => void;
}

// ============================================================================
// Grouped tenant headers and workspace rows
// ============================================================================
/**
 * Render the shared scope picker without owning session-switching behavior.
 * @param props - Available groups, localized labels and a selection callback.
 * @returns Tenant identity groups followed by their accessible workspaces.
 */
export function TenantScopePicker({
  groups,
  labels,
  onSelect,
}: Readonly<TenantScopePickerProps>): React.JSX.Element {
  return (
    <div className="flex flex-col" data-tenant-scope-picker>
      {groups.map((group, index) => (
        <section
          key={group.id}
          aria-label={group.name}
          className={`flex flex-col gap-sm ${index > 0 ? "mt-md border-t border-border pt-md" : ""}`}
        >
          <div className="flex items-center gap-md px-sm py-xs">
            <span
              className="flex size-control-sm shrink-0 items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <Icon name={group.personal ? "user" : "buildings"} size="lg" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-xs">
                <span
                  className="truncate text-label-md text-foreground"
                  title={group.name}
                >
                  {group.name}
                </span>
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-2xs rounded-full px-xs text-label-sm font-normal"
                >
                  <Icon
                    name={group.personal ? "user" : "buildings"}
                    size="xs"
                  />
                  {group.personal ? labels.personal : labels.organization}
                </Badge>
              </div>
              {group.identifier && (
                <span className="text-body-sm text-muted-foreground">
                  {group.identifier}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2xs pl-md">
            {group.workspaces.length > 0 ? (
              group.workspaces.map((workspace) => (
                <ShellPanelRow
                  key={workspace.id}
                  icon="folder"
                  label={workspace.name}
                  description={
                    workspace.isDefault ? labels.defaultWorkspace : undefined
                  }
                  active={workspace.isCurrent}
                  chevron={false}
                  className={
                    workspace.isCurrent
                      ? "bg-primary-muted text-primary-muted-foreground"
                      : undefined
                  }
                  value={
                    workspace.isCurrent ? (
                      <span className="flex size-icon-sm items-center justify-center rounded-full border border-current">
                        <Icon name="check" size="xs" />
                      </span>
                    ) : undefined
                  }
                  onClick={() => {
                    if (!workspace.isCurrent) onSelect(group.id, workspace.id);
                  }}
                />
              ))
            ) : (
              <ShellPanelRow
                icon="arrow-right"
                label={labels.enterTenant}
                chevron={false}
                onClick={() => onSelect(group.id)}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
