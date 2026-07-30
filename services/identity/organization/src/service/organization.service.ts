import { Inject, Injectable } from "@nestjs/common";
import { ORGANIZATION_REPOSITORY } from "../tokens";
import type {
  CreateInvitationInput,
  InvitationView,
  OrganizationProfileView,
  OrganizationReadRepository,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  ProvisionedOrg,
  WorkspaceMembershipView,
  WorkspaceView,
} from "../types/organization.types";

/**
 * OrganizationService — identity-core Organization + Workspace + Membership.
 * Owns org/workspace/membership lifecycle. Governance permission *enforcement*
 * (effective roles → permissions, can/assert) is a separate concern (Task 3.2);
 * active-org context / claim shaping is Task 3.3. Owns NO login/session/token.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly repo: OrganizationReadRepository,
  ) {}

  /** Registration primitive (§13.1): personal org + default workspace + owner at both levels. */
  createPersonalOrg(
    userId: string,
    name?: string | null,
  ): Promise<ProvisionedOrg> {
    return this.repo.createPersonalOrg(userId, name);
  }
  createTeamOrg(ownerUserId: string, name: string): Promise<ProvisionedOrg> {
    return this.repo.createTeamOrg(ownerUserId, name);
  }
  /** Keep the user's personal org name in sync with their account/display name. */
  renamePersonalOrg(userId: string, name: string): Promise<boolean> {
    return this.repo.renamePersonalOrg(userId, name);
  }
  getOrgById(orgId: string): Promise<OrgView | null> {
    return this.repo.getOrgById(orgId);
  }
  /** Admin org search by id or name (case-insensitive); limit clamped to [1,50]. */
  searchOrgs(query: string, limit = 10): Promise<OrgView[]> {
    return this.repo.searchOrgs(query, Math.min(Math.max(limit, 1), 50));
  }
  getDefaultWorkspace(orgId: string): Promise<WorkspaceView | null> {
    return this.repo.getDefaultWorkspace(orgId);
  }

  // ── Org profile (§3.2/3.3/3.6) ──
  getOrgProfile(orgId: string): Promise<OrganizationProfileView | null> {
    return this.repo.getOrgProfile(orgId);
  }
  upsertOrgProfile(
    orgId: string,
    input: OrgProfileUpdateInput,
  ): Promise<OrganizationProfileView> {
    return this.repo.upsertOrgProfile(orgId, input);
  }
  getOrgLogo(orgId: string): Promise<OrgLogoRecord | null> {
    return this.repo.getOrgLogo(orgId);
  }
  setOrgLogo(orgId: string, logo: OrgLogoRecord): Promise<void> {
    return this.repo.setOrgLogo(orgId, logo);
  }
  deleteOrgLogo(orgId: string): Promise<void> {
    return this.repo.deleteOrgLogo(orgId);
  }
  listOrgMembershipsForUser(userId: string): Promise<OrgMembershipView[]> {
    return this.repo.listOrgMembershipsForUser(userId);
  }
  listOrgMembers(orgId: string): Promise<OrgMembershipView[]> {
    return this.repo.listOrgMembers(orgId);
  }
  /** Members joined with their user record (for management UIs). */
  listOrgMembersWithUser(orgId: string): Promise<OrgMemberDetail[]> {
    return this.repo.listOrgMembersWithUser(orgId);
  }
  getOrgMemberDetail(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDetail | null> {
    return this.repo.getOrgMemberDetail(orgId, userId);
  }
  /** The fixed global org-scope role catalog (owner/manager/member) with permissions. */
  getOrgRolesCatalog(): Promise<OrgRoleCatalogEntry[]> {
    return this.repo.getOrgRolesCatalog();
  }
  addOrgMember(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView> {
    return this.repo.addOrgMember(orgId, userId, role);
  }
  updateOrgMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView | null> {
    return this.repo.updateOrgMemberRole(orgId, userId, role);
  }
  removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    return this.repo.removeOrgMember(orgId, userId);
  }
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: OrgRole,
  ): Promise<WorkspaceMembershipView> {
    return this.repo.addWorkspaceMember(workspaceId, userId, role);
  }
  createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitation: InvitationView; token: string }> {
    return this.repo.createInvitation(input);
  }
  acceptInvitation(
    token: string,
    userId: string,
  ): Promise<OrgMembershipView | null> {
    return this.repo.acceptInvitation(token, userId);
  }
}
