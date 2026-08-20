/**
 * governance.controller.ts — org/membership management (§13.4), guarded by the
 * RS256 access-token guard and enforced via two-level RBAC (GovernanceService).
 *
 * D-T: the identity authority owns org/workspace/membership data, so it exposes
 * the management API; the console UI consumes it. Authorization is per-handler
 * (assertCan) on the caller's role in the target org.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ActiveContextService,
  GovernanceService,
  OrganizationService,
  type OrgRole,
} from "@vxture/service-organization";
import { AccessTokenGuard } from "../authn/access-token.guard";
import { CurrentUser, type CurrentUserCtx } from "../authn/current-user";

const ORG_ROLES = ["owner", "manager", "member", "readonly", "guest"] as const;
function asOrgRole(value: unknown): OrgRole {
  if (typeof value !== "string" || !ORG_ROLES.includes(value as OrgRole)) {
    throw new BadRequestException(
      "role must be one of owner|manager|member|readonly|guest",
    );
  }
  return value as OrgRole;
}

@Controller()
@UseGuards(AccessTokenGuard)
export class GovernanceController {
  constructor(
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(GovernanceService) private readonly gov: GovernanceService,
    @Inject(ActiveContextService) private readonly active: ActiveContextService,
  ) {}

  /** Create a team org (caller becomes owner; default workspace + owner@both). */
  @Post("orgs")
  @HttpCode(HttpStatus.OK)
  async createOrg(
    @CurrentUser() me: CurrentUserCtx,
    @Body() body: { name?: string },
  ): Promise<{
    orgId: string;
    name: string;
    type: string;
    workspaceId: string;
  }> {
    if (!body.name) throw new BadRequestException("name is required");
    const { org, workspace } = await this.org.createTeamOrg(
      me.userId,
      body.name,
    );
    return {
      orgId: org.id,
      name: org.name,
      type: org.type,
      workspaceId: workspace.id,
    };
  }

  /** Orgs the caller belongs to (for the active-org switcher). */
  @Get("orgs")
  async listOrgs(@CurrentUser() me: CurrentUserCtx) {
    return { orgs: await this.active.listOrgsForSwitch(me.userId) };
  }

  /** Invite a member (requires tenant.member.manage). Returns the invite token. */
  @Post("orgs/:orgId/invitations")
  @HttpCode(HttpStatus.OK)
  async invite(
    @CurrentUser() me: CurrentUserCtx,
    @Param("orgId") orgId: string,
    @Body() body: { targetType?: string; target?: string; role?: string },
  ): Promise<{ invitationId: string; token: string }> {
    await this.gov.assertCan(me.userId, { orgId }, "tenant.member.manage");
    if (!body.target) throw new BadRequestException("target is required");
    const role = asOrgRole(body.role);
    const targetType = body.targetType === "phone" ? "phone" : "email";
    const { invitation, token } = await this.org.createInvitation({
      scope: "org",
      organizationId: orgId,
      targetType,
      target: body.target,
      role,
      createdBy: me.userId,
    });
    return { invitationId: invitation.id, token };
  }

  /** Accept an invitation as the caller. */
  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() me: CurrentUserCtx,
    @Body() body: { token?: string },
  ): Promise<{ organizationId: string; role: string }> {
    if (!body.token) throw new BadRequestException("token is required");
    const membership = await this.org.acceptInvitation(body.token, me.userId);
    if (!membership) {
      throw new BadRequestException("invalid_or_expired_invitation");
    }
    return { organizationId: membership.organizationId, role: membership.role };
  }

  /** List org members (any authenticated caller). */
  @Get("orgs/:orgId/members")
  async members(@Param("orgId") orgId: string) {
    return { members: await this.org.listOrgMembers(orgId) };
  }

  /** Change a member's org role (requires tenant.role.assign). */
  @Patch("orgs/:orgId/members/:userId/role")
  async setRole(
    @CurrentUser() me: CurrentUserCtx,
    @Param("orgId") orgId: string,
    @Param("userId") userId: string,
    @Body() body: { role?: string },
  ): Promise<{ organizationId: string; userId: string; role: string }> {
    await this.gov.assertCan(me.userId, { orgId }, "tenant.role.assign");
    const role = asOrgRole(body.role);
    const membership = await this.org.updateOrgMemberRole(orgId, userId, role);
    if (!membership) throw new BadRequestException("member_not_found");
    return {
      organizationId: membership.organizationId,
      userId: membership.userId,
      role: membership.role,
    };
  }

  /** Remove a member (requires tenant.member.manage). */
  @Delete("orgs/:orgId/members/:userId")
  async removeMember(
    @CurrentUser() me: CurrentUserCtx,
    @Param("orgId") orgId: string,
    @Param("userId") userId: string,
  ): Promise<{ removed: boolean }> {
    await this.gov.assertCan(me.userId, { orgId }, "tenant.member.manage");
    const removed = await this.org.removeOrgMember(orgId, userId);
    return { removed };
  }
}
