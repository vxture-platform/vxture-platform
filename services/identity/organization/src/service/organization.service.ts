import { Inject, Injectable, Logger } from "@nestjs/common";
import { ORGANIZATION_REPOSITORY } from "../tokens";
import type {
  CustomerNotifier,
  CustomerNotifyInput,
} from "./customer-notifier";
import {
  invitationDigest,
  invitationNotice,
  type InvitationTerminalState,
} from "./invitation-notifications";
import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  CreateWorkspaceInput,
  DeclineInvitationResult,
  IncomingInvitation,
  InvitationLocator,
  InvitationLookup,
  InvitationNotifyFacts,
  InvitationView,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMemberStatus,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  OrganizationProfileView,
  OrganizationReadRepository,
  PermissionCatalogEntry,
  ProvisionedOrg,
  RotatedInvitation,
  SubmitTenantVerificationInput,
  TransferOwnerResult,
  UpdateWorkspaceInput,
  WorkspaceDetail,
  WorkspaceMembershipView,
  WorkspaceView,
} from "../types/organization.types";

const DAY_MS = 86_400_000;

/**
 * 一趟巡检最多看多少行。作业那侧不另写一个数字：两处各写一个会让「满了」的判据
 * 静默跑偏，用例钉着「作业不传 limit」。
 */
const DEFAULT_INVITATION_SWEEP_LIMIT = 200;

/**
 * OrganizationService — identity-core Organization + Workspace + Membership.
 * Owns org/workspace/membership lifecycle. Governance permission *enforcement*
 * (effective roles → permissions, can/assert) is a separate concern (Task 3.2);
 * active-org context / claim shaping is Task 3.3. Owns NO login/session/token.
 */
@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly repo: OrganizationReadRepository,
  ) {}

  /**
   * 客户通知（邀请四态，2026-09-29）：装配处 `setCustomerNotifier` 注入；
   * **未注入 = 一条都不发**，此时本服务的行为与加这段之前逐字相同。
   */
  private notifier: CustomerNotifier | null = null;

  setCustomerNotifier(notifier: CustomerNotifier | null): void {
    this.notifier = notifier;
  }

  /**
   * 通知一律 best-effort：业务写**已经提交**，通知失败只记日志、不抛、不回滚。
   * build 延迟求值（与 subscription / order / addon 的 emit 同形，这条纪律不该有
   * 第四种写法）。
   */
  private async emit(
    label: string,
    build: () => Promise<CustomerNotifyInput | null>,
  ): Promise<boolean> {
    if (!this.notifier) return false;
    try {
      const input = await build();
      if (!input) return false;
      await this.notifier.notify(input);
      return true;
    } catch (err) {
      this.logger.warn(`notify ${label} failed — ${String(err)}`);
      return false;
    }
  }

  /**
   * 一次邀请终态通知。发不出去的两种情形**记一行日志**，不静默返回：
   *   `no_tenant`              邀请行的 tenant_id 为 NULL（workspace 作用域的旧邀请），
   *                            没有租户就没有可视码、也没有收件人所属的租户。
   *   `no_recipient_account`   收件人在平台上没有账号——按邮箱邀请一个还没注册的人
   *                            就是这种，站内消息没有收件箱可投。**这不是异常**，
   *                            但它必须留下痕迹：否则「没发」和「发了」在日志里一样。
   * 日志里放摘要而不是邀请 id：那一列是 uuid，日志也是人在读。
   */
  private async notifyInvitation(
    state: InvitationTerminalState,
    facts: InvitationNotifyFacts,
  ): Promise<boolean> {
    if (!this.notifier) return false;
    const outcome = invitationNotice(state, facts);
    if (!outcome.ok) {
      this.logger.log(
        `invitation ${state} not notified (${outcome.gap}) — ` +
          `ref ${invitationDigest(facts.invitationId)}`,
      );
      return false;
    }
    return this.emit(`invitation ${state}`, async () => outcome.input);
  }

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
  /** 个人租户转组织租户(批 5c-2);不可回退。 */
  convertPersonalToOrganization(
    tenantId: string,
    ownerUserId: string,
    name: string,
  ) {
    return this.repo.convertPersonalToOrganization(tenantId, ownerUserId, name);
  }

  /**
   * 注销组织租户(走查 2026-09-05);不可回退。
   *
   * 这条路里的批量撤销**有意不通知**受邀人,三条理由写在仓储那一处
   * (closeTenant 里那段注释),不在这里复述——判据只该有一个落点。
   */
  closeTenant(tenantId: string, ownerUserId: string) {
    return this.repo.closeTenant(tenantId, ownerUserId);
  }

  countOtherActiveMembers(tenantId: string, ownerUserId: string) {
    return this.repo.countOtherActiveMembers(tenantId, ownerUserId);
  }

  /** 改简称(display_name),不碰认证。 */
  setTenantDisplayName(tenantId: string, displayName: string) {
    return this.repo.setTenantDisplayName(tenantId, displayName);
  }

  /** 改租户名;组织租户改名即作废原企业认证(批 5c)。 */
  renameTenant(tenantId: string, name: string) {
    return this.repo.renameTenant(tenantId, name);
  }

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
  /**
   * 撤销一条 pending 邀请,并通知受邀人(2026-09-29)。
   *
   * 对外仍然回布尔——BFF 一侧零改动。通知只在真的改到了行之后发:
   * 仓储那条语句里 `status = 'pending'` 就是 CAS,没改到就没有事实带回来。
   */
  async revokeInvitation(
    invitationId: string,
    tenantId: string,
  ): Promise<boolean> {
    const outcome = await this.repo.revokeInvitation(invitationId, tenantId);
    if (outcome.ok && outcome.notify) {
      await this.notifyInvitation("revoked", outcome.notify);
    }
    return outcome.ok;
  }

  /**
   * Account deletion: revoke every pending invitation the user sent; returns the count.
   *
   * **有意不通知**(2026-09-29):理由写在仓储那一处——借「邀请人撤回了」那条模板
   * 去说「邀请人注销了账号」是偷换,而 owner 没有要那第二条模板。
   */
  revokeInvitationsCreatedBy(userId: string): Promise<number> {
    return this.repo.revokeInvitationsCreatedBy(userId);
  }

  /** Account purge (050-account §7): soft-delete the user's personal tenant. */
  softDeletePersonalOrg(ownerUserId: string): Promise<boolean> {
    return this.repo.softDeletePersonalOrg(ownerUserId);
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
  /** 登录后默认进入的租户(账号信息页「设为默认」);目标非本人活跃成员关系返回 false。 */
  setDefaultOrgForUser(userId: string, orgId: string): Promise<boolean> {
    return this.repo.setDefaultOrgForUser(userId, orgId);
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
  /**
   * 接受邀请,并通知邀请人(2026-09-29)。
   *
   * `notify` 在这里被**剥掉**再返回:这个返回值会一路进路由的响应体,而事实里的
   * 收件人 id 是 uuid。剥的手法是重建成功分支而不是 `delete`——后者改的是同一个
   * 对象,漏一处就还是递出去了。
   */
  async acceptInvitation(
    locator: InvitationLocator,
    userId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<AcceptInvitationResult> {
    const result = await this.repo.acceptInvitation(locator, userId, identity);
    if (!result.ok) return result;
    const { notify, ...rest } = result;
    if (notify) await this.notifyInvitation("accepted", notify);
    return rest;
  }
  listInvitationsForIdentity(
    identity: { email: string | null; userNo: string | null },
    limit?: number,
  ): Promise<IncomingInvitation[]> {
    return this.repo.listInvitationsForIdentity(identity, limit);
  }
  /** 拒绝邀请,并通知邀请人(2026-09-29)。`notify` 同样剥掉再返回。 */
  async declineInvitation(
    invitationId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<DeclineInvitationResult> {
    const result = await this.repo.declineInvitation(invitationId, identity);
    if (!result.ok) return result;
    const { notify, ...rest } = result;
    if (notify) await this.notifyInvitation("declined", notify);
    return rest;
  }

  /**
   * 到期巡检(2026-09-29)：pending ∧ expires_at 已过 → `expired`，并通知邀请人。
   *
   * ── 为什么要写状态,不只发通知 ──
   * 本仓已有答案:订阅到期扫描(`sweepExpiredSubscriptions`)既写 `expired` 也发通知。
   * 照它办,不另起一套。`expired` 此前**全库零写入方**,靠读侧按 expires_at 派生;
   * 派生仍然留着(未被扫到的行照旧显示为已过期),但库里那一列从此说真话。
   *
   * ── 两条上一批学到的纪律 ──
   *   · 存量闸门:`backlogDays` 之外的行**只改状态、不发通知**。首趟不许把历史上
   *     每一条过期邀请都播一遍(加油包与订阅到期都踩过)。闸门只闸通知,不闸状态——
   *     查询没有年龄下限,存量才扫得完。
   *   · 饱和要出声:取数到上限的一趟与繁忙的一趟,在心跳与日志里长得一模一样。
   *
   * CAS 输了(那一行同一瞬间被接受 / 拒绝 / 撤回)就一条都不发。单行出错只记日志,
   * 一趟不中断。未注入 notifier 时**照样改状态**——这一趟的活不只是发通知
   * (与加油包巡检的差别:那一趟除了通知不做别的,所以它可以直接返回)。
   */
  async sweepExpiredInvitations(window: {
    backlogDays: number;
    limit?: number;
  }): Promise<{ expired: number; notified: number; saturated: boolean }> {
    const limit = window.limit ?? DEFAULT_INVITATION_SWEEP_LIMIT;
    const rows = await this.repo.findExpiredInvitationCandidates({ limit });
    /* 一趟之内用同一个「现在」:逐行取会让闸门在同一趟里有两个口径。 */
    const backlogFrom = Date.now() - window.backlogDays * DAY_MS;
    let expired = 0;
    let notified = 0;
    for (const facts of rows) {
      try {
        if (!(await this.repo.markInvitationExpired(facts.invitationId))) {
          continue;
        }
        expired += 1;
        if (facts.expiresAt.getTime() < backlogFrom) continue;
        if (await this.notifyInvitation("expired", facts)) notified += 1;
      } catch (err) {
        this.logger.error(
          `invitation expiry sweep: ${invitationDigest(facts.invitationId)} ` +
            `failed — ${String(err)}`,
        );
      }
    }
    const saturated = rows.length >= limit;
    if (saturated) {
      this.logger.warn(
        `invitation expiry sweep: candidate query hit its cap (${rows.length}) — ` +
          `the tail of this pass was not examined`,
      );
    }
    return { expired, notified, saturated };
  }
  resolveWorkspaceForSession(
    orgId: string,
    userId: string,
    hint?: string | null,
  ) {
    return this.repo.resolveWorkspaceForSession(orgId, userId, hint);
  }
  listWorkspacesForSwitch(orgId: string, userId: string) {
    return this.repo.listWorkspacesForSwitch(orgId, userId);
  }
  listWorkspaceMembersByTenant(tenantId: string) {
    return this.repo.listWorkspaceMembersByTenant(tenantId);
  }
  removeWorkspaceMember(tenantId: string, workspaceId: string, userId: string) {
    return this.repo.removeWorkspaceMember(tenantId, workspaceId, userId);
  }
  getWorkspaceRole(tenantId: string, workspaceId: string, userId: string) {
    return this.repo.getWorkspaceRole(tenantId, workspaceId, userId);
  }
  setMemberDefaultWorkspace(
    tenantId: string,
    userId: string,
    workspaceId: string | null,
  ) {
    return this.repo.setMemberDefaultWorkspace(tenantId, userId, workspaceId);
  }
  listWorkspaces(
    tenantId: string,
    viewerUserId?: string,
  ): Promise<WorkspaceDetail[]> {
    return this.repo.listWorkspaces(tenantId, viewerUserId);
  }
  createWorkspace(input: CreateWorkspaceInput) {
    return this.repo.createWorkspace(input);
  }
  updateWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ) {
    return this.repo.updateWorkspace(tenantId, workspaceId, input);
  }
  setDefaultWorkspace(tenantId: string, workspaceId: string) {
    return this.repo.setDefaultWorkspace(tenantId, workspaceId);
  }
  archiveWorkspace(tenantId: string, workspaceId: string) {
    return this.repo.archiveWorkspace(tenantId, workspaceId);
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
