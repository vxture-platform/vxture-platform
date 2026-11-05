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
  ) {}

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
    return (await this.active.listOrgsForSwitch(user.userId)).map((item) => ({
      id: item.orgId,
      name: item.name,
      tenantType: item.type,
    }));
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
    if (tenantId)
      return (await this.organizations(user)).some(
        (item) => item.id === tenantId,
      );
    if (workspaceId)
      return (await this.workspaces(user)).some(
        (item) => item.id === workspaceId,
      );
    return false;
  }
}
