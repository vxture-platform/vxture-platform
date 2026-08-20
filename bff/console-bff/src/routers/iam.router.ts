import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { auditCustomerAction } from "../audit/audit-log";
import {
  ResetMemberPasswordDto,
  UpdateMemberDto,
  UpsertMemberDto,
} from "../dto/member.dto";
import { CreateRoleDto, UpdateRoleDto } from "../dto/role.dto";
import type { RequestContext } from "../types/console.types";

function requireTenantSession(req: Request & RequestContext) {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.tenant) {
    throw new UnauthorizedException("Tenant context is required");
  }

  return { accountId: req.user.id, tenantId: req.tenant.id };
}

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

@Controller("api/iam")
export class IamRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    /** 仅供租户审计写钩子(support.audit_logs INSERT,fire-and-forget)。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("summary")
  async getSummary(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    const summary = await this.sessionAggregator.getIamSummary(
      accountId,
      tenantId,
    );

    return {
      members: summary.totalMembers,
      activeMembers: summary.activeMembers,
      primaryOwners: summary.primaryOwners,
      roles: summary.activeRoles,
    };
  }

  @Get("members")
  async getMembers(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    return this.sessionAggregator.listMembers(accountId, tenantId);
  }

  @Get("members/:memberId")
  async getMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.getMember(
      accountId,
      tenantId,
      memberId,
    );
    if (!member) {
      throw new NotFoundException("Member not found");
    }

    return member;
  }

  @Get("roles")
  async getRoles(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    return this.sessionAggregator.listTenantRoles(accountId, tenantId);
  }

  @Get("permissions")
  async getPermissions(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    return this.sessionAggregator.listTenantPermissions(accountId, tenantId);
  }

  @Post("roles")
  async createRole(
    @Req() req: Request & RequestContext,
    @Body() body: CreateRoleDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const role = await this.sessionAggregator.createRole(
      accountId,
      tenantId,
      body,
    );
    if (!role) {
      throw new NotFoundException("Role could not be created");
    }

    return role;
  }

  @Put("roles/:roleId")
  async updateRole(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
    @Body() body: UpdateRoleDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const role = await this.sessionAggregator.updateRole(
      accountId,
      tenantId,
      roleId,
      body,
    );
    if (!role) {
      throw new NotFoundException("Role not found");
    }

    return role;
  }

  @Delete("roles/:roleId")
  async deleteRole(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const removed = await this.sessionAggregator.deleteRole(
      accountId,
      tenantId,
      roleId,
    );
    if (!removed) {
      throw new NotFoundException("Role not found");
    }

    return { status: "ok" as const };
  }

  // ── 邀请台账(P1 /invitations 落地)────────────────────────────────────────

  @Get("invitations")
  async listInvitations(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);
    return this.sessionAggregator.listInvitations(accountId, tenantId);
  }

  @Post("invitations/:invitationId/revoke")
  async revokeInvitation(
    @Req() req: Request & RequestContext,
    @Param("invitationId") invitationId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const revoked = await this.sessionAggregator.revokeInvitation(
      accountId,
      tenantId,
      invitationId,
    );
    if (!revoked) {
      throw new NotFoundException("Invitation not found or not pending");
    }
    auditCustomerAction(this.pool, req, {
      action: "tenant.invitation.revoke",
      resourceType: "invitation",
      resourceId: invitationId,
    });
    return { status: "ok" as const };
  }

  @Post("members")
  async createMember(
    @Req() req: Request & RequestContext,
    @Body() body: UpsertMemberDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.createMember(
      accountId,
      tenantId,
      body,
    );
    if (!member) {
      throw new NotFoundException("Tenant member could not be created");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.invite",
      resourceType: "member",
      resourceId: member.email ?? member.id,
      after: { role: member.roleCode },
    });

    return member;
  }

  @Post("members/invite")
  async inviteMember(
    @Req() req: Request & RequestContext,
    @Body() body: UpsertMemberDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.inviteMember(
      accountId,
      tenantId,
      body,
    );
    if (!member) {
      throw new NotFoundException("Tenant member could not be invited");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.invite",
      resourceType: "member",
      resourceId: member.email ?? member.id,
      after: { role: member.roleCode },
    });

    return member;
  }

  @Put("members/:memberId")
  async updateMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
    @Body() body: UpdateMemberDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.updateMember(
      accountId,
      tenantId,
      memberId,
      body,
    );
    if (!member) {
      throw new NotFoundException("Member not found");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.update",
      resourceType: "member",
      resourceId: memberId,
      after: { role: member.roleCode, status: member.statusCode },
    });

    return member;
  }

  @Post("members/:memberId/disable")
  async disableMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.disableMember(
      accountId,
      tenantId,
      memberId,
    );
    if (!member) {
      throw new NotFoundException("Member not found");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.disable",
      resourceType: "member",
      resourceId: memberId,
    });

    return member;
  }

  @Post("members/:memberId/reset-password")
  async resetMemberPassword(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
    @Body() body: ResetMemberPasswordDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const reset = await this.sessionAggregator.resetMemberPassword(
      accountId,
      tenantId,
      memberId,
      body.nextPassword,
    );
    if (!reset) {
      throw new NotFoundException("Member not found");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.reset_password",
      resourceType: "member",
      resourceId: memberId,
    });

    return { status: "ok" as const };
  }

  @Delete("members/:memberId")
  async removeMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const removed = await this.sessionAggregator.removeMember(
      accountId,
      tenantId,
      memberId,
    );
    if (!removed) {
      throw new NotFoundException("Member not found");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.remove",
      resourceType: "member",
      resourceId: memberId,
    });

    return { status: "ok" as const };
  }
}
