import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import type { TransferOwnerRejection } from "@vxture/service-organization";
import {
  RequireCapability,
  SelfScope,
  holdsAnyCapability,
} from "../auth/capability";

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

/**
 * 转让所有权的拒绝原因 → HTTP 语义。分开映射而不是一律 400:
 * `not_owner` 是权限问题(403),其余是请求本身不成立(400)。
 */
const TRANSFER_OWNER_ERRORS: Record<TransferOwnerRejection, () => Error> = {
  not_owner: () => new ForbiddenException("只有当前所有者可以转让所有权"),
  tenant_not_found: () => new NotFoundException("租户不存在"),
  personal_tenant: () => new BadRequestException("个人租户不支持转让所有权"),
  same_user: () => new BadRequestException("不能转让给自己"),
  target_not_member: () =>
    new BadRequestException("目标必须是本租户的在职成员"),
};

@Controller("api/iam")
export class IamRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    /** 仅供租户审计写钩子(support.audit_logs INSERT,fire-and-forget)。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  @RequireCapability("tenant.member.read")
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

  @RequireCapability("tenant.member.read")
  @Get("members")
  async getMembers(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    // 目录对持 member.read 的同事可见;邮箱/手机号只给能管成员的人,其余打码。
    return this.sessionAggregator.listMembers(accountId, tenantId, {
      includeContacts: holdsAnyCapability(req, ["tenant.member.manage"]),
    });
  }

  @RequireCapability("tenant.member.read")
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

  @RequireCapability("tenant.member.read")
  @Get("roles")
  async getRoles(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    return this.sessionAggregator.listTenantRoles(accountId, tenantId);
  }

  @RequireCapability("tenant.member.read")
  @Get("permissions")
  async getPermissions(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);

    return this.sessionAggregator.listTenantPermissions(accountId, tenantId);
  }

  @RequireCapability("tenant.role.assign")
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

  @RequireCapability("tenant.role.assign")
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

  @RequireCapability("tenant.role.assign")
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

  @RequireCapability("tenant.member.manage")
  @Get("invitations")
  async listInvitations(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);
    return this.sessionAggregator.listInvitations(accountId, tenantId);
  }

  @RequireCapability("tenant.member.manage")
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

  @RequireCapability("tenant.member.manage")
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

  @RequireCapability("tenant.member.manage")
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

  @RequireCapability("tenant.role.assign")
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

  @RequireCapability("tenant.member.manage")
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

  @RequireCapability("tenant.member.manage")
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

  @RequireCapability("tenant.member.manage")
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

  /**
   * 转让租户所有权(owner 2026-08-21 裁定,决策 3 批一)。
   *
   * **没有 capability 门**——门是「你就是当前 owner」,由仓储层在同一事务里
   * 校验。所有权转让不该有任何权限授予能够替代它:一个被授予 tenant.role.assign
   * 的 manager 若能转让所有权,那 owner 就不是 owner 了。
   *
   * 拒绝原因逐条映射成不同的 4xx,不合并成一句"操作失败"——转让失败时用户
   * 最需要知道的恰恰是**哪一条**没满足(对方不是成员?自己已不是 owner?)。
   * 无论成败都写审计:被拒的转让尝试本身就是要留痕的事。
   */
  @SelfScope()
  @Post("members/:memberId/transfer-owner")
  async transferOwner(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const result = await this.sessionAggregator.transferTenantOwner(
      accountId,
      tenantId,
      memberId,
    );

    if (!result.ok) {
      auditCustomerAction(this.pool, req, {
        action: "tenant.owner.transfer",
        resourceType: "tenant",
        resourceId: tenantId,
        result: "denied",
        errorCode: result.reason,
        after: { targetUserId: memberId },
      });
      throw TRANSFER_OWNER_ERRORS[result.reason]();
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.owner.transfer",
      resourceType: "tenant",
      resourceId: tenantId,
      before: { ownerUserId: result.previousOwnerUserId },
      after: {
        ownerUserId: result.newOwnerUserId,
        previousOwnerRole: "manager",
      },
    });

    return { status: "ok" as const };
  }
}
