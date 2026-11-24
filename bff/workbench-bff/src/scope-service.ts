/**
 * Platform membership checks and switcher projections through domain services.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category aggregator
 * @author AI-Generated
 * @date 2026-11-05
 */
import type {
  ActiveContextService,
  OrganizationService,
  GovernanceService,
} from "@vxture/service-organization"; // ⚠️ 跨层引用: delegate live membership decisions to the organization domain.
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: consume the canonical authenticated identity.
import { failure } from "./errors";

// ============================================================================
// Live scope checks and membership-bound switch targets
// ============================================================================
export class ScopeService {
  constructor(
    private readonly active: ActiveContextService,
    private readonly org: OrganizationService,
    private readonly governance?: Pick<GovernanceService, "can">,
  ) {}

  /**
   * Recheck live membership and permission before exposing resource or billing data.
   * @param user - Verified current RP identity.
   * @param permission - Canonical governance read permission.
   * @param tenantOnly - Tenant money must never inherit a workspace-only grant.
   * @returns Nothing when the requested read is permitted.
   * @throws When membership or permission is absent.
   */
  async assertRead(
    user: RpUser,
    permission: string,
    tenantOnly = false,
  ): Promise<void> {
    await this.assertCurrent(user);
    if (
      !this.governance ||
      !(await this.governance.can(
        user.userId,
        {
          orgId: user.activeOrg!,
          ...(!tenantOnly ? { workspaceId: user.activeWorkspace! } : {}),
        },
        permission,
      ))
    ) {
      throw failure(
        403,
        "WORKBENCH_READ_FORBIDDEN",
        "This account cannot view the requested overview",
      );
    }
  }

  async assertCurrent(user: RpUser): Promise<void> {
    if (!user.activeOrg || !user.activeWorkspace)
      throw failure(
        403,
        "WORKBENCH_SCOPE_REQUIRED",
        "Select an accessible workspace",
      );
    const current = await this.active.resolveActiveContext(
      user.userId,
      user.activeOrg,
      user.activeWorkspace,
    );
    // Domain login resolution may fall back; API authorization must not.
    if (
      current?.activeOrg !== user.activeOrg ||
      current.activeWorkspace !== user.activeWorkspace ||
      !current.roles.some((role) => role.startsWith("workspace:"))
    )
      throw failure(
        403,
        "WORKBENCH_SCOPE_FORBIDDEN",
        "Workspace membership is no longer active",
      );
  }

  async organizations(user: RpUser) {
    return Promise.all(
      (await this.active.listOrgsForSwitch(user.userId)).map(async (item) => {
        const [organization, workspaces] = await Promise.all([
          this.org.getOrgById(item.orgId),
          this.org.listWorkspacesForSwitch(item.orgId, user.userId),
        ]);
        return {
          id: item.orgId,
          name:
            organization?.displayName?.trim() ||
            organization?.name ||
            item.name,
          tenantType: item.type,
          identifier: organization?.tenantNo
            ? `T-${organization.tenantNo}`
            : null,
          workspaces: workspaces.map((space) => ({
            id: space.id,
            name: space.name,
            isDefault: space.isDefault,
          })),
        };
      }),
    );
  }

  /**
   * Resolve display metadata from live records rather than stale token names.
   * @param user - Verified identity whose exact membership was checked.
   * @returns The same display-name-first organization projection as Console.
   * @throws When the active organization or workspace is no longer accessible.
   */
  async context(user: RpUser) {
    await this.assertCurrent(user);
    const [organization, spaces] = await Promise.all([
      this.org.getOrgById(user.activeOrg!),
      this.org.listWorkspacesForSwitch(user.activeOrg!, user.userId),
    ]);
    const workspace = spaces.find((space) => space.id === user.activeWorkspace);
    if (!organization || !workspace)
      throw failure(
        403,
        "WORKBENCH_SCOPE_FORBIDDEN",
        "Workspace is no longer accessible",
      );
    return {
      id: organization.id,
      name: organization.displayName?.trim() || organization.name,
      tenantType: organization.type,
      identifier: organization.tenantNo ? `T-${organization.tenantNo}` : null,
      workspace: workspace.id,
      workspaceName: workspace.name,
    };
  }

  async workspaces(user: RpUser) {
    await this.assertCurrent(user);
    return (
      await this.org.listWorkspacesForSwitch(user.activeOrg!, user.userId)
    ).map((item) => ({
      id: item.id,
      name: item.name,
      isDefault: item.isDefault,
    }));
  }

  async canSwitch(
    user: RpUser,
    tenantId?: string,
    workspaceId?: string,
  ): Promise<boolean> {
    if (tenantId) {
      const target = (await this.organizations(user)).find(
        (item) => item.id === tenantId,
      );
      return Boolean(
        target &&
        (!workspaceId ||
          target.workspaces.some((space) => space.id === workspaceId)),
      );
    }
    if (workspaceId)
      return (await this.workspaces(user)).some(
        (item) => item.id === workspaceId,
      );
    return false;
  }
}
