import { Inject, Injectable } from "@nestjs/common";
import { ORGANIZATION_REPOSITORY } from "../tokens";
import type {
  ActiveOrgContext,
  OrganizationReadRepository,
  OrgSwitchOption,
} from "../types/organization.types";

/**
 * ActiveContextService — shapes the active-org context for access-token claims
 * (docs/design/identity-platform-architecture.md §4: `sub + active_org + active_workspace + roles`).
 * This REPLACES the old getAccountTenantClaims/TokenTenantClaim seam.
 *
 * Shaping only: returns plain context to whatever issues tokens (identity-server,
 * Batch 4/5). Does NOT issue tokens, set cookies, or touch Redis/session.
 * Multi-workspace switching is post-MVP (default workspace only); active-ORG switch
 * is supported via the optional hint + listOrgsForSwitch.
 */
@Injectable()
export class ActiveContextService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly repo: OrganizationReadRepository,
  ) {}

  /**
   * Resolve a user's active-org context. Selection: a valid `activeOrgHint` the user
   * is a member of, else the membership the user marked as default (账号信息页
   * 「设为默认」— 每次登录后默认进入的租户), else the personal org, else the first
   * membership. Returns null if the user has no org membership. `roles` are
   * scope-prefixed governance role codes.
   */
  async resolveActiveContext(
    userId: string,
    activeOrgHint?: string,
  ): Promise<ActiveOrgContext | null> {
    const memberships = await this.repo.listOrgMembershipsForUser(userId);
    if (memberships.length === 0) return null;

    // memberships are ordered personal-first, so [0] is the natural fallback
    // when the user never chose a default (and the chosen default is gone).
    const active =
      (activeOrgHint &&
        memberships.find((m) => m.organizationId === activeOrgHint)) ||
      memberships.find((m) => m.isDefault) ||
      memberships[0]!;

    const roles = [`org:${active.role}`];
    // Default workspace + this user's workspace role in a single round-trip
    // (was two sequential reads). membershipRole is null when the user has no
    // active workspace membership; the workspace is still returned.
    const { workspace, membershipRole } =
      await this.repo.getDefaultWorkspaceWithMembership(
        active.organizationId,
        userId,
      );
    let activeWorkspace: string | null = null;
    let activeWorkspaceName: string | null = null;
    if (workspace) {
      activeWorkspace = workspace.id;
      activeWorkspaceName = workspace.name;
      if (membershipRole) roles.push(`workspace:${membershipRole}`);
    }

    // list-for-user reads carry the joined org snapshot; default to "personal"
    // since every account is provisioned with a personal org (§5.4 unified model).
    return {
      activeOrg: active.organizationId,
      activeOrgType: active.organization?.type ?? "personal",
      activeOrgName: active.organization?.name ?? null,
      activeWorkspace,
      activeWorkspaceName,
      roles,
    };
  }

  /** Orgs the user can switch into (for the active-org switcher, §13.5). */
  async listOrgsForSwitch(userId: string): Promise<OrgSwitchOption[]> {
    const memberships = await this.repo.listOrgMembershipsForUser(userId);
    return memberships
      .filter((m) => m.organization)
      .map((m) => ({
        orgId: m.organizationId,
        name: m.organization!.name,
        type: m.organization!.type,
        role: m.role,
        isDefault: m.isDefault === true,
        logoHash: m.organization!.logoHash ?? null,
      }));
  }
}
