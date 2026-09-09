import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { VxConfigService } from "@vxture/core-config";
import { MailService } from "@vxture/core-mail";
import type { NotificationDispatcher } from "@vxture/service-notification";
import { CUSTOMER_NOTIFIER } from "../services/customer-notifications.wiring";
import {
  SessionAggregator,
  type InviteMemberOutcome,
} from "../aggregators/session.aggregator";
import { auditCustomerAction } from "../audit/audit-log";
import {
  AcceptInvitationDto,
  UpsertWorkspaceDto,
  ResetMemberPasswordDto,
  UpdateMemberDto,
  UpsertMemberDto,
} from "../dto/member.dto";
import { CreateRoleDto, UpdateRoleDto } from "../dto/role.dto";
import {
  invitationMailLocale,
  renderInvitationMail,
} from "../services/invitation-mail";
import type { RequestContext } from "../types/console.types";
import type {
  AcceptInvitationRejection,
  WorkspaceRejection,
  TransferOwnerRejection,
} from "@vxture/service-organization";
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

/**
 * 接受邀请的拒绝原因 → HTTP 语义。message 就是原因码,接受页按码给文案——
 * 「链接失效」「已被撤销」「你登录的不是受邀邮箱」是三件用户要做不同事的事。
 */
/**
 * 工作空间写动作的拒绝理由 → HTTP。穷尽 `Record`:仓储加一个理由而这里忘了映射,
 * **编译不过**,不会静默落到某个兜底档。
 */
const WORKSPACE_ERRORS: Record<WorkspaceRejection, (reason: string) => Error> =
  {
    not_found: (reason) => new NotFoundException(reason),
    /* 409 而不是 400:请求本身没错,是当前状态与它冲突(同名的已经存在)。 */
    name_taken: (reason) => new ConflictException(reason),
    default_locked: (reason) => new ConflictException(reason),
    last_active: (reason) => new ConflictException(reason),
    archived: (reason) => new ConflictException(reason),
    not_empty: (reason) => new ConflictException(reason),
    /* 两条建工作空间的闸门(owner 2026-09-10)。都用 409 而不是 403:
       请求本身没错、权限也没问题,是**当前状态**不允许——个人租户结构上只有一个,
       组织租户的多空间还在规划中。403 会让人去找管理员要权限,而没有人能给。 */
    personal_single_workspace: (reason) => new ConflictException(reason),
    planned: (reason) => new ConflictException(reason),
  };

const ACCEPT_INVITATION_ERRORS: Record<
  AcceptInvitationRejection,
  (reason: string) => Error
> = {
  not_found: (reason) => new NotFoundException(reason),
  expired: (reason) => new BadRequestException(reason),
  revoked: (reason) => new BadRequestException(reason),
  already_accepted: (reason) => new ConflictException(reason),
  email_mismatch: (reason) => new ForbiddenException(reason),
  /* 按用户号邀请、但接受的人不是那个号。与 email_mismatch 同档:
     403 而不是 404——「这个邀请存在,但不是给你的」，说清楚才好换个账号登录。 */
  user_mismatch: (reason) => new ForbiddenException(reason),
  /* target_type 认不出来。库里那一列没有 CHECK 约束,脏数据或某个没接完的通道
     都可能落到这里;对用户是「这个邀请用不了」,对我们是该看日志的信号。
     用 400 不用 500:请求本身没错,是这条邀请的数据不可用。 */
  unknown_target: (reason) => new BadRequestException(reason),
};

@Controller("api/iam")
export class IamRouter {
  private readonly logger = new Logger(IamRouter.name);

  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    /** 仅供租户审计写钩子(support.audit_logs INSERT,fire-and-forget)。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
    /** 站内送达走统一分发器:按收件人语言渲染 + 记 notification_logs。 */
    @Inject(CUSTOMER_NOTIFIER)
    private readonly notifier: NotificationDispatcher,
  ) {}

  /** 邀请链接:CONSOLE_BASE_URL + 语言前缀(console 路由 localePrefix=always)+ 接受页。 */
  private inviteLink(token: string, language: string | null): string {
    const base = this.config.platform.CONSOLE_BASE_URL.replace(/\/$/, "");
    const locale = invitationMailLocale(language);
    return `${base}/${locale}/accept-invitation?token=${encodeURIComponent(token)}`;
  }

  /**
   * 发邀请邮件。发送失败**不让邀请失败**:邀请已经建好、链接已经生成,页面上
   * 给「复制链接」兜底,只把 emailSent=false 报回去让邀请人知道要手动转交。
   */
  private async sendInvitationMail(
    outcome: InviteMemberOutcome,
    link: string,
  ): Promise<boolean> {
    const rendered = renderInvitationMail({
      locale: invitationMailLocale(outcome.inviterLanguage),
      tenantName: outcome.tenantName,
      inviterName: outcome.inviterName,
      roleCode: outcome.roleCode,
      link,
      expiresAt: outcome.expiresAt,
    });
    try {
      await this.mail.send({
        to: outcome.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `invitation mail to ${outcome.email} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * 按通道送达邀请。
   *
   * `email`   —— 发邮件 + 一次性链接（`emailSent=false` 时前端出「复制链接」兜底）。
   * `user_no` —— **不发邮件、不给链接**：目标是平台已有账号，站内落一条消息，
   *              对方在「待办与消息」里点「同意」即加入（owner 2026-09-09）。
   *
   * 用户号通道为什么不给链接：给了就等于开一条「转发即可加入」的旁路，
   * 而这条通道的全部意义就是「只有那个号本人能接受」。仓储层的
   * `rejectAcceptance` 会拦住转发者，但前端不该先把它递出去。
   */
  private async deliverInvitation(
    outcome: InviteMemberOutcome,
    tenantId: string,
  ) {
    if (outcome.targetType === "user_no") {
      await this.notifyInviteeInApp(outcome, tenantId);
      return {
        member: outcome.member,
        invitationId: outcome.invitationId,
        email: "",
        roleCode: outcome.roleCode,
        /* 不给链接:这条通道靠站内消息送达。前端据此不出「复制链接」弹窗。 */
        inviteLink: null,
        emailSent: false,
        deliveredInApp: true,
        expiresAt: outcome.expiresAt.toISOString(),
      };
    }
    const inviteLink = this.inviteLink(outcome.token, outcome.inviterLanguage);
    const emailSent = await this.sendInvitationMail(outcome, inviteLink);
    return {
      member: outcome.member,
      invitationId: outcome.invitationId,
      email: outcome.email,
      roleCode: outcome.roleCode,
      inviteLink,
      emailSent,
      deliveredInApp: false,
      expiresAt: outcome.expiresAt.toISOString(),
    };
  }

  /**
   * 站内送达:往被邀请人的收件箱落一条 `tenant.invitation`。
   *
   * **走统一分发器,不自己写 INSERT。** 最初这里是一条手写 SQL,三处都是错的:
   * 标题正文写死中文(收件人可能是 en-US)、不记 `notification_logs`、
   * 链接指向 `/invitations/:id`——那个地址会跳到**邀请人**的邀请台账,
   * 被邀请人既看不懂也没权限。
   *
   * 三个非默认开关各自的理由见 `NotifyInput`:
   *   `exactRecipients` 只发被邀请人——默认会把 owner 并进来,而 owner 多半就是
   *                     发出邀请的那个人。
   *   `mandatory`       这条消息**就是**邀请本身,被偏好开关吞掉的话邀请人会收到
   *                     「已送达」而对方那边什么也没有。
   *   `inboxOnly`       前端明说了「不发邮件」,那句话必须是真的。
   *
   * 与邮件同一条纪律——**best-effort**:邀请行已经落库,送达失败只记日志、不回滚。
   * 邀请人那边仍然看得到这条 pending,可以重发。去重键(收件人 × 模板 × 业务引用)
   * 保证重发不会在对方收件箱里堆出第二条。
   */
  private async notifyInviteeInApp(
    outcome: InviteMemberOutcome,
    tenantId: string,
  ) {
    if (!outcome.targetUserId) return;
    try {
      await this.notifier.notify({
        /* tenant_id 由调用方给,**不按租户名去查**:`tenancy.tenants.name` 没有
           唯一索引(查过 pg_index),按名字 join 可能挑错租户。 */
        tenantId,
        templateCode: "tenant.invitation",
        reference: { type: "invitation", id: outcome.invitationId },
        params: {
          tenantName: outcome.tenantName,
          inviterName: outcome.inviterName,
          roleName: outcome.roleCode,
          expiresAt: outcome.expiresAt.toISOString().slice(0, 10),
        },
        exactRecipients: [outcome.targetUserId],
        mandatory: true,
        inboxOnly: true,
        /* 「同意 / 拒绝」两个按钮长在收件箱那一条上,点开就在原地——
           不另开一页,也就不需要把邀请 ID 放进地址栏。 */
        link: "/inbox",
      });
    } catch (err) {
      this.logger.warn(
        `in-app invitation notice for ${outcome.invitationId} failed: ${String(err)}`,
      );
    }
  }

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
    /* 角色定义变更直接改变「谁能做什么」（owner 2026-09-08）。此前只记了「成员被
       授予角色」，没记「角色本身被改了权限」——前者可查后者不可查，追责链是断的。
       权限码入 after：复盘时要答的正是「那时这个角色能做什么」。 */
    auditCustomerAction(this.pool, req, {
      action: "tenant.role.create",
      resourceType: "role",
      resourceId: role.roleCode ?? role.id,
      after: { roleName: role.roleName, permissions: role.permissions },
    });

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
    auditCustomerAction(this.pool, req, {
      action: "tenant.role.update",
      resourceType: "role",
      resourceId: role.roleCode ?? role.id,
      after: { roleName: role.roleName, permissions: role.permissions },
    });

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
    auditCustomerAction(this.pool, req, {
      action: "tenant.role.delete",
      resourceType: "role",
      resourceId: roleId,
    });

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
  @Post("invitations/:invitationId/resend")
  async resendInvitation(
    @Req() req: Request & RequestContext,
    @Param("invitationId") invitationId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const outcome = await this.sessionAggregator.resendInvitation(
      accountId,
      tenantId,
      invitationId,
    );
    if (!outcome) {
      throw new NotFoundException("Invitation not found or not pending");
    }
    const delivered = await this.deliverInvitation(outcome, tenantId);
    auditCustomerAction(this.pool, req, {
      action: "tenant.invitation.resend",
      resourceType: "invitation",
      resourceId: invitationId,
      after: { email: outcome.email, emailSent: delivered.emailSent },
    });
    return delivered;
  }

  /**
   * 接受页预览 / 接受:只认登录态,不看当前活跃租户(见 auth-context-paths)。
   * 租户由 token 决定——受邀人此刻活跃的多半是自己的个人租户。
   */
  @SelfScope()
  @Get("invitations/lookup")
  async lookupInvitation(@Query("token") token?: string) {
    if (!token) throw new BadRequestException("token is required");
    const found = await this.sessionAggregator.lookupInvitation(token);
    if (!found) throw new NotFoundException("not_found");
    return {
      id: found.id,
      tenantName: found.tenantName,
      email: found.email,
      roleCode: found.roleCode,
      status: found.status,
      expiresAt: found.expiresAt.toISOString(),
      inviterName: found.inviterName,
    };
  }

  // ── 工作空间管理(owner 2026-09-09「把工作空间做成真轴」)────────────────
  //
  // 门用**已有的** `tenant.workspace.manage`(owner / manager 持有),不新增权限码:
  // 「管这个租户的工作空间」正是这个码的字面意思,再造一个新码只会让权限树多一层
  // 谁也说不清与它的差别。
  //
  // 读那条例外,用 `tenant.member.read`:普通成员要看得见自己在哪些工作空间里,
  // 那不是管理动作。

  @RequireCapability("tenant.member.read")
  @Get("workspaces")
  async listWorkspaces(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);
    const rows = await this.sessionAggregator.listWorkspaces(
      accountId,
      tenantId,
    );
    if (!rows) throw new NotFoundException("Tenant context is required");
    return rows.map((w) => ({
      id: w.id,
      /* 对外给可视码,不给 uuid(§11 v4 三号解耦:界面与地址栏只出现可视码)。 */
      workspaceNo: w.workspaceNo,
      name: w.name,
      description: w.description,
      icon: w.icon,
      isDefault: w.isDefault,
      /* 我的默认落点。与 isDefault(租户级、影响所有人)分开给——
         前端要把两个动作并排画出来,合成一个字段就看不出差别了。 */
      isMyDefault: w.isMyDefault,
      status: w.status,
      memberCount: w.memberCount,
      createdAt: w.createdAt.toISOString(),
    }));
  }

  /**
   * 我能进哪些工作空间(切换器 + 切换预检共用)。
   *
   * 门只到 `tenant.member.read`?**不,连这个都不要**——「我自己能进哪儿」是
   * 自视角的事实。但它挂在租户上下文里,所以仍走 requireTenantSession。
   *
   * 路径放在 `workspaces/mine` 而不是 `workspaces?scope=mine`:两条读的**判据不同**
   * (管理视角含停用的、我的视角只含我是成员的),不是同一份数据的过滤。
   */
  @SelfScope()
  @Get("workspaces/mine")
  async listMyWorkspaces(@Req() req: Request & RequestContext) {
    const { accountId, tenantId } = requireTenantSession(req);
    const rows = await this.sessionAggregator.listWorkspacesForSwitch(
      accountId,
      tenantId,
    );
    if (!rows) throw new NotFoundException("Tenant context is required");
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      isDefault: w.isDefault,
    }));
  }

  /**
   * 我的默认工作空间(个人偏好)。
   *
   * `@SelfScope()` 而不是任何能力门:改的是我自己那一行成员记录,
   * 与「管这个租户的工作空间」无关——一个普通成员也该能选自己登录后落在哪。
   *
   * 与 `POST workspaces/:id/default` 分得清:那个是**租户级**默认,影响所有人。
   * 路径也刻意不同形(mine vs :id/default),不然两个动作看起来像同一个的两种写法。
   */
  @SelfScope()
  @Post("workspaces/mine/default")
  async setMyDefaultWorkspace(
    @Req() req: Request & RequestContext,
    @Body() body: { workspaceId?: string | null },
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const result = await this.sessionAggregator.setMyDefaultWorkspace(
      accountId,
      tenantId,
      body?.workspaceId ?? null,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);
    return { ok: true };
  }

  @RequireCapability("tenant.workspace.manage")
  @Post("workspaces")
  async createWorkspace(
    @Req() req: Request & RequestContext,
    @Body() body: UpsertWorkspaceDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const name = (body.name ?? "").trim();
    if (!name) throw new BadRequestException("name is required");
    const result = await this.sessionAggregator.createWorkspace(
      accountId,
      tenantId,
      { name, description: body.description ?? null, icon: body.icon ?? null },
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.create",
      resourceType: "workspace",
      resourceId: result.workspace.id,
      after: { name: result.workspace.name },
    });
    return {
      id: result.workspace.id,
      workspaceNo: result.workspace.workspaceNo,
      name: result.workspace.name,
    };
  }

  @RequireCapability("tenant.workspace.manage")
  @Put("workspaces/:workspaceId")
  async updateWorkspace(
    @Req() req: Request & RequestContext,
    @Param("workspaceId") workspaceId: string,
    @Body() body: UpsertWorkspaceDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    /* 三项各自可选,但**全都没给**就是一次空写:与其静默成功,不如说清楚。 */
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.icon === undefined
    ) {
      throw new BadRequestException("nothing to update");
    }
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException("name is required");
    }
    const result = await this.sessionAggregator.updateWorkspace(
      accountId,
      tenantId,
      workspaceId,
      body,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.update",
      resourceType: "workspace",
      resourceId: workspaceId,
      after: { name: body.name ?? null },
    });
    return { ok: true };
  }

  @RequireCapability("tenant.workspace.manage")
  @Post("workspaces/:workspaceId/default")
  async setDefaultWorkspace(
    @Req() req: Request & RequestContext,
    @Param("workspaceId") workspaceId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const result = await this.sessionAggregator.setDefaultWorkspace(
      accountId,
      tenantId,
      workspaceId,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.set_default",
      resourceType: "workspace",
      resourceId: workspaceId,
    });
    return { ok: true };
  }

  /**
   * 把已在租户里的人加进某个工作空间 / 从某个工作空间移除。
   *
   * 门是**两级**的:能力门 `workspace.member.manage` 只回答「我有没有这个能力」,
   * 作用域由 aggregator 的 assertCanManageWorkspaceMembers 再判一次——那个码在
   * `tenant:owner` 是全租户的,在 `workspace:manager/owner` 却只来自**当前活跃**
   * 工作空间,光靠能力门,A 空间的管理员就能管 B 空间的人。
   *
   * 这也是这三个 `workspace.*` 码第一次真的有门:此前它们在 BFF 与门户里
   * 一个消费方都没有。
   */
  @RequireCapability("workspace.member.manage")
  @Post("workspaces/:workspaceId/members")
  async addWorkspaceMember(
    @Req() req: Request & RequestContext,
    @Param("workspaceId") workspaceId: string,
    @Body() body: { userId?: string; roleCode?: string },
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    if (!body?.userId) throw new BadRequestException("userId is required");
    const result = await this.sessionAggregator.addWorkspaceMemberScoped(
      accountId,
      tenantId,
      workspaceId,
      body.userId,
      body.roleCode ?? "member",
    );
    if (!result) throw new NotFoundException("Tenant context is required");

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.member_add",
      resourceType: "workspace",
      resourceId: workspaceId,
      after: { userId: body.userId, role: body.roleCode ?? "member" },
    });
    return { ok: true };
  }

  @RequireCapability("workspace.member.manage")
  @Delete("workspaces/:workspaceId/members/:memberUserId")
  async removeWorkspaceMember(
    @Req() req: Request & RequestContext,
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId") memberUserId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const result = await this.sessionAggregator.removeWorkspaceMemberScoped(
      accountId,
      tenantId,
      workspaceId,
      memberUserId,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.member_remove",
      resourceType: "workspace",
      resourceId: workspaceId,
      after: { userId: memberUserId },
    });
    return { ok: true };
  }

  /** 停用。**不是删**——订阅 / 订单 / 配额池 / 用量都挂着 workspace_id。 */
  @RequireCapability("tenant.workspace.manage")
  @Post("workspaces/:workspaceId/archive")
  async archiveWorkspace(
    @Req() req: Request & RequestContext,
    @Param("workspaceId") workspaceId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const result = await this.sessionAggregator.archiveWorkspace(
      accountId,
      tenantId,
      workspaceId,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    if (!result.ok) throw WORKSPACE_ERRORS[result.reason](result.reason);

    auditCustomerAction(this.pool, req, {
      action: "tenant.workspace.archive",
      resourceType: "workspace",
      resourceId: workspaceId,
    });
    return { ok: true };
  }

  /**
   * 「谁在邀请我」。**自视角读**——此刻我还不是那些租户的成员,所以不能挂任何
   * 租户能力门;`@SelfScope()` 表达的正是「作用域是我自己」。
   *
   * 返回里没有 token、没有目标串:目标就是本人,重复展示自己的邮箱/用户号没有
   * 信息量;token 是邮件通道的凭证,不该从这条读路径漏出去。
   */
  @SelfScope()
  @Get("invitations/incoming")
  async listIncomingInvitations(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const rows = await this.sessionAggregator.listIncomingInvitations(
      req.user.id,
    );
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      roleCode: row.roleCode,
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * 拒绝邀请。与接受同一张判定矩阵:一条我无权接受的邀请也不该由我拒绝,
   * 否则任何人都能替别人把邀请回绝掉。
   */
  @SelfScope()
  @Post("invitations/:invitationId/decline")
  async declineInvitation(
    @Req() req: Request & RequestContext,
    @Param("invitationId") invitationId: string,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const result = await this.sessionAggregator.declineInvitation(
      req.user.id,
      invitationId,
    );
    if (!result.ok)
      throw ACCEPT_INVITATION_ERRORS[result.reason](result.reason);
    return { ok: true };
  }

  @SelfScope()
  @Post("invitations/accept")
  async acceptInvitation(
    @Req() req: Request & RequestContext,
    @Body() body: AcceptInvitationDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    /* token 优先:它是显式凭证。两者都没有才是真的无法定位。 */
    const locator = body.token
      ? { token: body.token }
      : body.invitationId
        ? { invitationId: body.invitationId }
        : null;
    if (!locator) {
      throw new BadRequestException("token or invitationId is required");
    }
    const result = await this.sessionAggregator.acceptInvitation(
      req.user.id,
      locator,
    );
    if (!result.ok)
      throw ACCEPT_INVITATION_ERRORS[result.reason](result.reason);
    return {
      tenantId: result.membership.organizationId,
      tenantName: result.tenantName,
      role: result.membership.role,
    };
  }

  /** 「新增成员」= 把已有账号按邮箱直接加进租户;账号不存在 → 404 account_not_found。 */
  @RequireCapability("tenant.member.manage")
  @Post("members")
  async createMember(
    @Req() req: Request & RequestContext,
    @Body() body: UpsertMemberDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.addExistingMember(
      accountId,
      tenantId,
      body,
    );
    if (!member) {
      throw new NotFoundException("Tenant member could not be created");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.add",
      resourceType: "member",
      resourceId: member.id,
      after: { role: member.roleCode, email: member.email },
    });

    return member;
  }

  /**
   * 按用户号查人(邀请前确认「是不是这个人」)。
   *
   * 门与邀请同一个:只有能邀请的人才查得动——这是个**用户枚举面**(号是 10 位可视码,
   * 认识规则就能穷举)。返回里联系方式一律遮蔽,查不到只说查不到,不区分
   * 「没这个号」与「这个号被停用了」。
   */
  @RequireCapability("tenant.member.manage")
  @Get("users/by-no/:userNo")
  async lookupUserByNo(
    @Req() req: Request & RequestContext,
    @Param("userNo") userNo: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);
    const result = await this.sessionAggregator.lookupUserByNo(
      accountId,
      tenantId,
      userNo,
    );
    if (!result) throw new NotFoundException("Tenant context is required");
    return result;
  }

  @RequireCapability("tenant.member.manage")
  @Post("members/invite")
  async inviteMember(
    @Req() req: Request & RequestContext,
    @Body() body: UpsertMemberDto,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const outcome = await this.sessionAggregator.inviteMember(
      accountId,
      tenantId,
      body,
    );
    if (!outcome) {
      throw new NotFoundException("Tenant member could not be invited");
    }
    const delivered = await this.deliverInvitation(outcome, tenantId);

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.invite",
      resourceType: "invitation",
      resourceId: outcome.invitationId,
      after: {
        email: outcome.email,
        role: outcome.roleCode,
        emailSent: delivered.emailSent,
      },
    });

    return delivered;
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

  /** 停用:打标不删行,恢复走 /enable。owner 与本人 400(owner_protected / self_protected)。 */
  @RequireCapability("tenant.member.manage")
  @Post("members/:memberId/disable")
  async disableMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.setMemberStatus(
      accountId,
      tenantId,
      memberId,
      "suspended",
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
  @Post("members/:memberId/enable")
  async enableMember(
    @Req() req: Request & RequestContext,
    @Param("memberId") memberId: string,
  ) {
    const { accountId, tenantId } = requireTenantSession(req);

    const member = await this.sessionAggregator.setMemberStatus(
      accountId,
      tenantId,
      memberId,
      "active",
    );
    if (!member) {
      throw new NotFoundException("Member not found");
    }

    auditCustomerAction(this.pool, req, {
      action: "tenant.member.enable",
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
