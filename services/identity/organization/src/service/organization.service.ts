import { Inject, Injectable } from "@nestjs/common";
import { ORGANIZATION_REPOSITORY } from "../tokens";
import type {
  AcceptInvitationResult,
  SubmitTenantVerificationInput,
  CreateInvitationInput,
  InvitationLookup,
  InvitationView,
  OrgMemberStatus,
  RotatedInvitation,
  OrganizationProfileView,
  OrganizationReadRepository,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  PermissionCatalogEntry,
  ProvisionedOrg,
  TransferOwnerResult,
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

  // ── 邀请台账(P1 /invitations 落地)────────────────────────────────────────
  listInvitations(tenantId: string) {
    return this.repo.listInvitations(tenantId);
  }
  revokeInvitation(invitationId: string, tenantId: string) {
    return this.repo.revokeInvitation(invitationId, tenantId);
  }

  // ── 组织实名认证(owner 2026-08-21 P0;审核在 admin 侧,本面只提交/读)────
  getLatestTenantVerification(tenantId: string) {
    return this.repo.getLatestTenantVerification(tenantId);
  }
  listTenantVerifications(tenantId: string) {
    return this.repo.listTenantVerifications(tenantId);
  }
  submitTenantVerification(input: SubmitTenantVerificationInput) {
    return this.repo.submitTenantVerification(input);
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
  listPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
    return this.repo.listPermissionCatalog();
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

  /**
   * 转让组织租户所有权。权限判定在仓储层的同一事务里做(校验调用者就是当前
   * owner),不在这里预判——预判与写入之间的窗口正是并发转让能钻的缝。
   */
  transferOrgOwner(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnerResult> {
    return this.repo.transferOrgOwner(orgId, fromUserId, toUserId);
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
    userEmail: string | null,
  ): Promise<AcceptInvitationResult> {
    return this.repo.acceptInvitation(token, userId, userEmail);
  }
  getInvitationByToken(token: string): Promise<InvitationLookup | null> {
    return this.repo.getInvitationByToken(token);
  }
  rotateInvitationToken(
    invitationId: string,
    tenantId: string,
  ): Promise<RotatedInvitation | null> {
    return this.repo.rotateInvitationToken(invitationId, tenantId);
  }
  /** 停用 / 恢复成员(两级 membership 同步);owner 保护在调用方(BFF 聚合器)做。 */
  setOrgMemberStatus(
    orgId: string,
    userId: string,
    status: OrgMemberStatus,
  ): Promise<OrgMembershipView | null> {
    return this.repo.setOrgMemberStatus(orgId, userId, status);
  }
}
