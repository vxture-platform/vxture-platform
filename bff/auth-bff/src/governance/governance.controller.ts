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
import { AccountService } from "@vxture/service-account";
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
    @Inject(AccountService) private readonly account: AccountService,
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

  /**
   * Accept an invitation as the caller. 邮箱邀请只能由该邮箱对应的账号接受
   * (仓储层校验),所以这里要把接受人的邮箱一起递进去;拒绝原因原样作 message,
   * 调用方按码给文案。
   *
   * ── 这个面**不发客户通知**,是决定不是漏(2026-09-29)──
   * 接受邀请会给邀请人发一条 `tenant.invitation_accepted`。发不发的总开关是
   * `OrganizationService.setCustomerNotifier`,由**装配处**打开:console-bff 的
   * services/customer-notifications.wiring.ts 打开一次(接受 / 拒绝 / 撤销),
   * platform-api 的 notifications/customer-notifications.wiring.ts 打开一次
   * (到期巡检)。**auth-bff 一处都没有**,所以经本端点接受的邀请,邀请人一句话也
   * 收不到——而且不会报错:未注入 = 静默不发,那是那个接口刻意的默认。
   *
   * ── 权威面是 console-bff 的 `POST /api/iam/invitations/accept` ──
   *   · 客户端只走它:portals/console/src/api/console-bff.ts 的两处接受调用指的都是
   *     那一条,本端点今天**零调用方**(2026-09-29 全仓搜过 `invitations/accept`)。
   *   · 接受是一条会长出两级成员关系、会发通知、会进客户收件箱的写路径。这种路径该
   *     只有一个落点:两个面都能写,以后问「这一次接受为什么没发通知」就得先去查是谁
   *     调的,而那是一个查不出来的问题(两个面的日志不在一起)。
   *
   * ── 为什么 auth-bff 有了分发器,这个面**仍然**不发 ──
   * 2026-09-29 起 auth-bff 装了一个通知分发器(src/notifications/customer-notifications.wiring.ts
   * 连带 package.json 的 @vxture/service-notification),理由与邀请无关:十四条账号安全通知里
   * 有七条的写入方只在本进程(邮件重置令牌改密、运营锁定 / 解锁 / 下线全部会话、没见过的
   * 设备登录)。那个 provider **只**调 `AccountService.setCustomerNotifier`,**故意没调**
   * `OrganizationService` 的那一个。
   *
   * 所以「依赖装不上」这条旧理由已经不成立了,但结论没变,换成了上面那一条:一条会发通知的
   * 写路径该只有一个落点。挂上 OrganizationService 等于给一个零调用方的端点偷偷开第二通知源,
   * 而下一次问「这一次接受为什么没发通知」时又得先查是谁调的。
   *
   * ── 真要启用这个面,按顺序做两件事 ──
   *   ① 在那个 wiring 里加一行 `orgs.setCustomerNotifier(dispatcher)`,并给它的用例加一条
   *      断言——漏挂不报错,tsc、守卫、boot-smoke 都不会有任何意见(本仓最常见的缺陷就是
   *      「做了没接」);
   *   ② 把这段注释改成「两个面都发」,并说清同一条邀请为什么不会被发两次。
   * 在那之前:接受请收在 console-bff 那一条上,本端点保持沉默。
   */
  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() me: CurrentUserCtx,
    @Body() body: { token?: string },
  ): Promise<{ organizationId: string; role: string }> {
    if (!body.token) throw new BadRequestException("token is required");
    const user = await this.account.getUserById(me.userId);
    /* 身份凭据两项都要给:邮箱通道核 email、用户号通道核 userNo。
       少给一项,对应通道的邀请就永远接受不了——rejectAcceptance 的 default 是拒绝,
       所以这是「打不开」而不是「放行」,方向是安全的,但仍是个 bug。 */
    const result = await this.org.acceptInvitation(
      { token: body.token },
      me.userId,
      {
        email: user?.email ?? null,
        userNo: user?.userNo ?? null,
      },
    );
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return {
      organizationId: result.membership.organizationId,
      role: result.membership.role,
    };
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
