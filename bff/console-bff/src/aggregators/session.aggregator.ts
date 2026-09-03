import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { VxConfigService } from "@vxture/core-config";
import { isGovernancePermissionCode } from "@vxture/core-utils";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import {
  AccountService,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  type AvatarMime,
} from "@vxture/service-account";
import type {
  AuthSessionRecord,
  IdentityRecord,
  LastLoginRecord,
  LoginHistoryEntry,
} from "@vxture/service-account";
import {
  ActiveContextService,
  GovernanceService,
  OrganizationService,
  type AcceptInvitationResult,
  type InvitationLookup,
  type OrgLogoRecord,
  type OrgMemberDetail,
  type OrgMemberStatus,
  type OrgProfileUpdateInput,
  type OrgRole,
  type OrgRoleCatalogEntry,
  type OrgView,
  type PermissionCatalogEntry,
  type RotatedInvitation,
  type TransferOwnerResult,
} from "@vxture/service-organization";
import type {
  Capability,
  ConsoleOrganizationProfile,
  ConsoleTenantPermission,
  ConsoleTenantRole,
  ConsoleUserProfile,
  ConsoleWorkspaceItem,
  MemberRecord,
  TenantContext,
} from "../types/console.types";

/**
 * capability 派生(2026-09-04 批 0a 权限配置体系;取代 2026-08-21 的手写映射表):
 * 能力 = 成员在当前租户的**有效治理权限码本身**(access.role_permissions →
 * GovernanceService 回查),不再经一张 BFF 私有的 PERM_TO_CAPABILITIES 翻译——
 * 读侧码(`*.read`)与商业面细分码已进目录,五角色矩阵写在 seed / 迁移里,
 * 「谁能看哪页」由数据说了算。治理权限经 GovernanceService 回查(identity/040 D-6:
 * capability 不进 token,BFF 回查为主、可缓存);每 (tenant,user) 短 TTL 内存缓存,
 * 改角色最迟一分钟生效。回查失败给只读保底(用产品的人至少看得到额度),绝不放大权限。
 */
const FALLBACK_CAPABILITIES: Capability[] = ["tenant.quota.read"];
const CAPS_CACHE_TTL_MS = 60_000;

const CUSTOM_ROLES_UNSUPPORTED =
  "Custom roles are not supported: roles are a fixed catalog (owner/manager/member/readonly/guest)";

/**
 * SessionAggregator (Identity Platform). Org/workspace/membership + governance
 * RBAC are sourced from @vxture/service-organization; the user from
 * @vxture/service-account. Org KYC profile and per-tenant custom roles are
 * retired in the new model — those surfaces are minimal/read-only stubs.
 */
@Injectable()
export class SessionAggregator {
  constructor(
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(GovernanceService) private readonly gov: GovernanceService,
    @Inject(ActiveContextService) private readonly active: ActiveContextService,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
    /** 直查 tenancy.workspaces 取名称+可视码（identity 服务未暴露 workspace_no；
     * 与 subscription.router 的 resolveDefaultWorkspace 同一通道与理由）。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  /** Default-workspace 名称 + 可视码 per tenant——UUID 禁展示（owner 2026-08-20），
   *  前端选择器只允许拿这里的 name/workspace_no。 */
  private async defaultWorkspaceMeta(
    tenantIds: string[],
  ): Promise<Map<string, { name: string; workspaceNo: string | null }>> {
    if (tenantIds.length === 0) return new Map();
    const res = await this.pool.query<{
      tenant_id: string;
      name: string;
      workspace_no: string | null;
    }>(
      `select tenant_id, name, workspace_no::text as workspace_no
         from tenancy.workspaces
        where tenant_id = any($1) and is_default and deleted_at is null`,
      [tenantIds],
    );
    return new Map(
      res.rows.map((r) => [
        r.tenant_id,
        { name: r.name, workspaceNo: r.workspace_no },
      ]),
    );
  }

  /** Versioned platform avatar URL for a user, or null when no custom avatar. */
  private pictureFor(user: {
    id: string;
    avatarHash: string | null;
  }): string | null {
    if (!user.avatarHash) return null;
    const issuer = this.config.auth.OIDC_ISSUER.replace(/\/$/, "");
    return `${issuer}/avatar/usr_${user.id}?v=${user.avatarHash}`;
  }

  /** Resolve the caller's active org (id + view); null when the user has none. */
  private async resolveOrg(userId: string, orgId?: string) {
    const ctx = await this.active.resolveActiveContext(userId, orgId);
    if (!ctx?.activeOrg) return null;
    const org = await this.org.getOrgById(ctx.activeOrg);
    return org
      ? { orgId: ctx.activeOrg, org, workspace: ctx.activeWorkspace }
      : null;
  }

  async getCurrentUser(userId: string, orgId?: string) {
    const user = await this.account.getUserById(userId);
    if (!user) return null;
    let roleLabel = "Authenticated User";
    if (orgId) {
      const member = await this.org.getOrgMemberDetail(orgId, userId);
      if (member) {
        roleLabel =
          member.role === "owner"
            ? "Owner"
            : member.role === "manager"
              ? "Manager"
              : "Member";
      }
    }
    return {
      id: user.id,
      name: user.name ?? user.account,
      displayName: user.name ?? null,
      email: user.email ?? `${user.account}@local.vxture`,
      roleLabel,
      username: user.account,
      phone: user.phone,
      picture: this.pictureFor(user),
    };
  }

  async getCurrentUserProfile(
    userId: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.getUserById(userId);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async updateCurrentUserProfile(
    userId: string,
    input: {
      displayName?: string | null;
      email?: string | null;
      bio?: string | null;
      timezone?: string | null;
      language?: string | null;
    },
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.updateProfile(userId, {
      name: input.displayName ?? null,
      email: input.email ?? null,
      bio: input.bio ?? null,
      timezone: input.timezone ?? null,
      language: input.language ?? null,
    });
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async changeCurrentUserPhone(
    userId: string,
    newPhone: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.changePhone(userId, newPhone);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async changeCurrentUserEmail(
    userId: string,
    newEmail: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.changeEmail(userId, newEmail);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async markCurrentUserEmailVerified(
    userId: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.markEmailVerified(userId);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async markCurrentUserPhoneVerified(
    userId: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.markPhoneVerified(userId);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async setAccountLoginEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.setAccountLoginEnabled(userId, enabled);
    return user ? toUserProfile(user, this.pictureFor(user)) : null;
  }

  async changeCurrentUserUsername(
    userId: string,
    newUsername: string,
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.changeUsername(userId, newUsername);
    if (!user) return null;
    // Keep the personal tenant's display name following the account (owner
    // 2026-07-30): only the personal tenant, never a team/organization tenant.
    await this.org.renamePersonalOrg(userId, user.account);
    return toUserProfile(user, this.pictureFor(user));
  }

  /** Store/replace the caller's avatar (bytes already validated); returns picture URL. */
  async setCurrentUserAvatar(
    userId: string,
    data: Buffer,
    contentType: AvatarMime,
  ): Promise<{ picture: string }> {
    const hash = createHash("sha256").update(data).digest("hex");
    await this.account.setAvatar(userId, {
      data,
      contentType,
      hash,
      source: "upload",
    });
    const issuer = this.config.auth.OIDC_ISSUER.replace(/\/$/, "");
    return { picture: `${issuer}/avatar/usr_${userId}?v=${hash}` };
  }

  /** Remove the caller's custom avatar (falls back to the frontend default). */
  async deleteCurrentUserAvatar(userId: string): Promise<void> {
    await this.account.deleteAvatar(userId);
  }

  getUserIdentities(userId: string): Promise<IdentityRecord[]> {
    return this.account.listIdentitiesByUser(userId);
  }

  /** Unbind a federated identity (by provider) from the caller. */
  removeUserIdentity(userId: string, provider: string): Promise<void> {
    return this.account.removeIdentity(userId, provider);
  }

  getUserLastLogin(userId: string): Promise<LastLoginRecord | null> {
    return this.account.getLastLogin(userId);
  }

  getUserLoginHistory(
    userId: string,
    limit = 20,
  ): Promise<LoginHistoryEntry[]> {
    return this.account.listLoginHistory(userId, limit);
  }

  getUserSessions(userId: string): Promise<AuthSessionRecord[]> {
    return this.account.listSessions(userId);
  }

  /** The tenants/workspaces the user belongs to, with role (§1.6/§4.1). */
  async getMyWorkspaces(
    userId: string,
    activeOrgId?: string,
  ): Promise<ConsoleWorkspaceItem[]> {
    const memberships = await this.org.listOrgMembershipsForUser(userId);
    const items: ConsoleWorkspaceItem[] = [];
    for (const m of memberships) {
      const org = m.organization;
      if (!org) continue;
      const ws = await this.org.getDefaultWorkspace(org.id);
      items.push({
        tenantId: org.id,
        tenantName: org.name,
        tenantType: org.type === "organization" ? "organization" : "personal",
        role: m.role,
        workspaceId: ws?.id ?? null,
        workspaceName: ws?.name ?? null,
        isCurrent: org.id === activeOrgId,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
      });
    }
    return items;
  }

  revokeUserSession(userId: string, sid: string): Promise<boolean> {
    return this.account.revokeSession(userId, sid);
  }

  async getCurrentOrganizationProfile(
    userId: string,
    orgId?: string,
  ): Promise<ConsoleOrganizationProfile | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    const { org } = resolved;
    const p = await this.org.getOrgProfile(org.id);
    return {
      tenantId: org.id,
      tenantCode: org.id,
      tenantName: org.name,
      displayName: org.name,
      tenantType: org.type === "organization" ? "organization" : "personal",
      status: org.status === "active" ? "active" : "suspended",
      createdAt: org.createdAt ?? null,
      logoHash: p?.logoHash ?? null,
      description: p?.description ?? null,
      industry: p?.industry ?? null,
      scale: p?.scale ?? null,
      website: p?.website ?? null,
      contactName: p?.contactName ?? null,
      contactRole: p?.contactRole ?? null,
      contactEmail: p?.contactEmail ?? null,
      contactPhone: p?.contactPhone ?? null,
      countryCode: p?.countryCode ?? null,
      address: p?.address ?? null,
      postalCode: p?.postalCode ?? null,
      isBillingRecipient: p?.isBillingRecipient ?? false,
      timezone: p?.timezone ?? null,
      language: p?.language ?? null,
      currency: p?.currency ?? null,
      // 反规范化快查列(权威在 kyc.tenant_verifications;admin 审核/console 提交
      // 都会同步回写)——P0 认证提交上线后本字段接真值(2026-08-21)。
      verifiedStatus: org.verificationStatus ?? "unverified",
      updatedAt: p?.updatedAt ?? null,
    };
  }

  /** Create/update the active org's profile, then return the merged view. */
  async updateCurrentOrganizationProfile(
    userId: string,
    orgId: string | undefined,
    input: OrgProfileUpdateInput,
  ): Promise<ConsoleOrganizationProfile | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.org.upsertOrgProfile(resolved.org.id, input);
    return this.getCurrentOrganizationProfile(userId, orgId);
  }

  /** Store/replace the active org's logo (bytes already validated). */
  async setCurrentOrgLogo(
    userId: string,
    orgId: string | undefined,
    data: Buffer,
    contentType: AvatarMime,
  ): Promise<{ logoHash: string }> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) throw new BadRequestException("no_active_org");
    const hash = createHash("sha256").update(data).digest("hex");
    await this.org.setOrgLogo(resolved.org.id, { data, contentType, hash });
    return { logoHash: hash };
  }

  /** Load the active org's logo bytes; null when none. */
  async getCurrentOrgLogo(
    userId: string,
    orgId?: string,
  ): Promise<OrgLogoRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.getOrgLogo(resolved.org.id);
  }

  /** Remove the active org's logo. */
  async deleteCurrentOrgLogo(userId: string, orgId?: string): Promise<void> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return;
    await this.org.deleteOrgLogo(resolved.org.id);
  }

  async changeCurrentUserPassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
  ) {
    const ok = await this.account.changePassword(
      userId,
      currentPassword,
      nextPassword,
    );
    if (!ok) {
      throw new UnauthorizedException("Current password is incorrect");
    }
  }

  /**
   * Self-service initial password setup for a user with no existing credential
   * (phone/social-only registrant). No old password to verify. Throws 400 if
   * the caller already has a password (must use `changeCurrentUserPassword`).
   */
  async setCurrentUserInitialPassword(
    userId: string,
    nextPassword: string,
  ): Promise<void> {
    await this.account.setInitialPassword(userId, nextPassword);
  }

  async getTenantContext(
    userId: string,
    orgId?: string,
  ): Promise<TenantContext> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) {
      return {
        id: `platform:${userId}`,
        name: "Vxture Platform",
        mode: "platform",
        workspace: "PLATFORM",
      };
    }
    // 不在此富化 workspace 名称/可视码：本方法被 TenantMiddleware 每请求调用，
    // 展示字段由 withWorkspaceMeta 在展示端点按需补齐。
    return toTenantContext(resolved.orgId, resolved.org, resolved.workspace);
  }

  /** 展示端点用：补齐 workspaceName / workspaceNo（UUID 禁展示的替代物）。 */
  async withWorkspaceMeta(tenant: TenantContext): Promise<TenantContext> {
    if (tenant.mode !== "tenant") return tenant;
    const meta = await this.defaultWorkspaceMeta([tenant.id]);
    const m = meta.get(tenant.id) ?? null;
    return {
      ...tenant,
      workspaceName: m?.name ?? null,
      workspaceNo: m?.workspaceNo ?? null,
    };
  }

  async getTenantContexts(userId: string): Promise<TenantContext[]> {
    const orgs = await this.active.listOrgsForSwitch(userId);
    const meta = await this.defaultWorkspaceMeta(orgs.map((o) => o.orgId));
    return orgs.map((o) => ({
      id: o.orgId,
      name: o.name,
      mode: "tenant" as const,
      workspace: "default",
      tenantType:
        o.type === "organization"
          ? ("organization" as const)
          : ("personal" as const),
      tenantCode: o.orgId,
      workspaceName: meta.get(o.orgId)?.name ?? null,
      workspaceNo: meta.get(o.orgId)?.workspaceNo ?? null,
      status: "active",
    }));
  }

  /** (tenant,user) → caps 短 TTL 缓存(middleware 每请求命中内存,不打 DB)。 */
  private readonly capsCache = new Map<
    string,
    { at: number; caps: Capability[] }
  >();

  /**
   * 按成员实际治理权限派生 capability(P0 分权)。降级原则:回查失败给
   * 只读保底(MEMBER_BASE),绝不放大权限。
   */
  async capabilitiesFor(
    userId: string,
    tenantId: string,
  ): Promise<Capability[]> {
    const key = `${tenantId}:${userId}`;
    const hit = this.capsCache.get(key);
    if (hit && Date.now() - hit.at < CAPS_CACHE_TTL_MS) return [...hit.caps];
    let caps: Capability[];
    try {
      const perms = await this.gov.getEffectivePermissions(userId, {
        orgId: tenantId,
      });
      // 只认目录里登记过的码:库里若混进未知码(手工 SQL / 旧数据),不让它流到前端。
      caps = [...new Set(perms.filter(isGovernancePermissionCode))];
    } catch {
      caps = [...FALLBACK_CAPABILITIES];
    }
    this.capsCache.set(key, { at: Date.now(), caps });
    return [...caps];
  }

  /**
   * 角色变更后立刻作废该 (tenant,user) 的 capability 缓存。
   * 不清的话最长 60s 内前端仍按旧能力集渲染——入口还在,点下去才 403,
   * 这在「刚被降权」这个场景里格外像 bug。
   */
  private invalidateCapabilities(userId: string, tenantId: string): void {
    this.capsCache.delete(`${tenantId}:${userId}`);
  }

  async getCapabilities(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    return this.capabilitiesFor(userId, resolved.orgId);
  }

  async getIamSummary(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) {
      return {
        totalMembers: 0,
        activeMembers: 0,
        primaryOwners: 0,
        activeRoles: 0,
      };
    }
    const [members, catalog] = await Promise.all([
      this.org.listOrgMembersWithUser(resolved.orgId),
      this.org.getOrgRolesCatalog(),
    ]);
    return {
      totalMembers: members.length,
      activeMembers: members.filter((m) => m.status === "active").length,
      primaryOwners: members.filter((m) => m.role === "owner").length,
      activeRoles: catalog.length,
    };
  }

  /**
   * 成员目录。`includeContacts=false`(持 tenant.member.read 但无 member.manage 的
   * 普通成员 / 只读成员)时邮箱与手机号打码——目录对同事可见,联系方式只给管理者。
   */
  async listMembers(
    userId: string,
    orgId?: string,
    opts: { includeContacts?: boolean } = {},
  ): Promise<MemberRecord[]> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    // 目录 = 在册成员(active + suspended)+ 待接受的邀请(Invited 行,id = 邀请 id)。
    // 此前邀请只在发出的那一刻回一条 pending 记录,刷新即消失,页面上的「已邀请」
    // 筛选与计数从来没有真数据可数。
    const [members, invitations] = await Promise.all([
      this.org.listOrgMembersWithUser(resolved.orgId),
      this.org.listInvitations(resolved.orgId),
    ]);
    const records = [
      ...members.map(toMemberRecord),
      ...invitations
        .filter((i) => i.status === "pending")
        .map((i) =>
          pendingMemberRecord(
            i.id,
            i.email,
            i.roleCode,
            i.expiresAt,
            i.createdAt,
          ),
        ),
    ];
    return opts.includeContacts === false
      ? records.map(redactContacts)
      : records;
  }

  async getMember(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
  ): Promise<MemberRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    const m = await this.org.getOrgMemberDetail(resolved.orgId, memberUserId);
    return m ? toMemberRecord(m) : null;
  }

  async listTenantRoles(
    userId: string,
    orgId?: string,
  ): Promise<ConsoleTenantRole[]> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    const catalog = await this.org.getOrgRolesCatalog();
    return catalog.map(toConsoleRole);
  }

  /** 权限目录全树(板块 → 页面 → 操作码),角色页据此画矩阵;按 sort 升序。 */
  async listTenantPermissions(
    userId: string,
    orgId?: string,
  ): Promise<ConsoleTenantPermission[]> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    const catalog = await this.org.listPermissionCatalog();
    return catalog.map(toConsolePermission);
  }

  // ── Custom roles retired: roles are a fixed global catalog (owner/manager/member) ──
  async createRole(
    _userId: string,
    _orgId: string | undefined,
    _input: unknown,
  ): Promise<ConsoleTenantRole | null> {
    throw new BadRequestException(CUSTOM_ROLES_UNSUPPORTED);
  }
  async updateRole(
    _userId: string,
    _orgId: string | undefined,
    _roleId: string,
    _input: unknown,
  ): Promise<ConsoleTenantRole | null> {
    throw new BadRequestException(CUSTOM_ROLES_UNSUPPORTED);
  }
  async deleteRole(
    _userId: string,
    _orgId: string | undefined,
    _roleId: string,
  ): Promise<boolean> {
    throw new BadRequestException(CUSTOM_ROLES_UNSUPPORTED);
  }

  /**
   * 「新增成员」= 把一个**已有账号**按邮箱直接加进租户(批 2 定义;此前与邀请是
   * 同一条路径,两个按钮做同一件事)。账号不存在 → 404 `account_not_found`,
   * 页面据此引导改走邀请;已是成员 → 409 `already_member`。
   */
  async addExistingMember(
    userId: string,
    orgId: string | undefined,
    input: { email: string; roleCode?: string | null },
  ): Promise<MemberRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const role = asAssignableRole(input.roleCode ?? "member");
    const email = normalizeEmail(input.email);
    const user = await this.account.findUserByIdentifier(email);
    if (!user) throw new NotFoundException("account_not_found");
    const existing = await this.org.getOrgMemberDetail(resolved.orgId, user.id);
    if (existing) throw new ConflictException("already_member");
    await this.org.addOrgMember(resolved.orgId, user.id, role);
    this.invalidateCapabilities(user.id, resolved.orgId);
    return this.getMember(userId, orgId, user.id);
  }

  // ── 邀请台账(P1 /invitations 落地;读写同 member.manage 门)──────────────
  async listInvitations(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    return this.org.listInvitations(resolved.orgId);
  }

  async revokeInvitation(
    userId: string,
    orgId: string | undefined,
    invitationId: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return false;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    return this.org.revokeInvitation(invitationId, resolved.orgId);
  }

  /**
   * 邀请成员(member.manage)。返回待接受记录 + 一次性 token(路由层据此发邮件
   * 并回一条可复制的链接)。已是成员 → 409 `already_member`;该邮箱已有待接受的
   * 邀请 → 409 `invitation_pending`(去邀请管理页重发或撤销,不再插第二行)。
   */
  async inviteMember(
    userId: string,
    orgId: string | undefined,
    input: { email: string; roleCode?: string | null },
  ): Promise<InviteMemberOutcome | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const role = asAssignableRole(input.roleCode ?? "member");
    const email = normalizeEmail(input.email);
    const existingUser = await this.account.findUserByIdentifier(email);
    if (existingUser) {
      const member = await this.org.getOrgMemberDetail(
        resolved.orgId,
        existingUser.id,
      );
      if (member) throw new ConflictException("already_member");
    }
    const pending = (await this.org.listInvitations(resolved.orgId)).find(
      (i) => i.status === "pending" && i.email.toLowerCase() === email,
    );
    if (pending) throw new ConflictException("invitation_pending");

    const { invitation, token } = await this.org.createInvitation({
      scope: "org",
      organizationId: resolved.orgId,
      targetType: "email",
      target: email,
      role,
      createdBy: userId,
    });
    const inviter = await this.account.getUserById(userId);
    return {
      member: pendingMemberRecord(
        invitation.id,
        email,
        role,
        invitation.expiresAt,
        new Date(),
      ),
      invitationId: invitation.id,
      token,
      email,
      roleCode: role,
      expiresAt: invitation.expiresAt,
      tenantName: resolved.org.name,
      inviterName: inviter?.name ?? inviter?.account ?? "",
      inviterLanguage: inviter?.language ?? null,
    };
  }

  /** 重发邀请 = 轮换 token(旧链接失效)并顺延有效期;只对 pending 行有效。 */
  async resendInvitation(
    userId: string,
    orgId: string | undefined,
    invitationId: string,
  ): Promise<InviteMemberOutcome | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const rotated: RotatedInvitation | null =
      await this.org.rotateInvitationToken(invitationId, resolved.orgId);
    if (!rotated) return null;
    const inviter = await this.account.getUserById(userId);
    return {
      member: pendingMemberRecord(
        invitationId,
        rotated.email,
        rotated.roleCode,
        rotated.expiresAt,
        new Date(),
      ),
      invitationId,
      token: rotated.token,
      email: rotated.email,
      roleCode: rotated.roleCode,
      expiresAt: rotated.expiresAt,
      tenantName: resolved.org.name,
      inviterName: inviter?.name ?? inviter?.account ?? "",
      inviterLanguage: inviter?.language ?? null,
    };
  }

  /** 接受页预览:按 token 看这封邀请是谁、进哪个租户、什么角色、还有效没有。 */
  lookupInvitation(token: string): Promise<InvitationLookup | null> {
    return this.org.getInvitationByToken(token);
  }

  /**
   * 接受邀请。租户由 token 决定,不看当前活跃租户;受邀邮箱须与账号邮箱一致
   * (仓储层校验)。成功后清掉能力缓存——对方下一次切进该租户就该按新角色拿能力。
   */
  async acceptInvitation(
    userId: string,
    token: string,
  ): Promise<AcceptInvitationResult> {
    const user = await this.account.getUserById(userId);
    const result = await this.org.acceptInvitation(
      token,
      userId,
      user?.email ?? null,
    );
    if (result.ok) {
      this.invalidateCapabilities(userId, result.membership.organizationId);
    }
    return result;
  }

  /**
   * 改成员角色(role.assign)。三条保护:owner 的角色只能经「转让所有权」变更;
   * 不能给别人 owner(同一理由);不能改自己的角色(把自己降级等于把租户锁在
   * 一个没人能管的状态)。
   */
  async updateMember(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
    input: { roleCode?: string | null },
  ): Promise<MemberRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    if (!input.roleCode) {
      return this.getMember(userId, orgId, memberUserId);
    }
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.role.assign",
    );
    const role = asAssignableRole(input.roleCode);
    assertNotOwner(resolved.org, memberUserId, "owner_role_locked");
    if (memberUserId === userId) {
      throw new BadRequestException("self_protected");
    }
    const updated = await this.org.updateOrgMemberRole(
      resolved.orgId,
      memberUserId,
      role,
    );
    if (!updated) return null;
    this.invalidateCapabilities(memberUserId, resolved.orgId);
    return this.getMember(userId, orgId, memberUserId);
  }

  /**
   * 停用 / 恢复成员(member.manage)。停用是打标不是删行:成员的订单、用量、
   * 审计足迹都还在,恢复即回到原角色。owner 与本人不可停用。
   */
  async setMemberStatus(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
    status: OrgMemberStatus,
  ): Promise<MemberRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    assertNotOwner(resolved.org, memberUserId, "owner_protected");
    if (memberUserId === userId) {
      throw new BadRequestException("self_protected");
    }
    const updated = await this.org.setOrgMemberStatus(
      resolved.orgId,
      memberUserId,
      status,
    );
    if (!updated) return null;
    this.invalidateCapabilities(memberUserId, resolved.orgId);
    return this.getMember(userId, orgId, memberUserId);
  }

  /**
   * 转让租户所有权(owner 2026-08-21 裁定,决策 3 批一)。
   *
   * **刻意不调 `gov.assertCan`**:能替代「你是 owner」的权限点是不该存在的。
   * 判定全部下沉到仓储层的同一事务(含 `for update` 锁),这里只做租户解析。
   */
  async transferTenantOwner(
    userId: string,
    orgId: string | undefined,
    targetUserId: string,
  ): Promise<TransferOwnerResult> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return { ok: false, reason: "tenant_not_found" };
    const result = await this.org.transferOrgOwner(
      resolved.orgId,
      userId,
      targetUserId,
    );
    // capability 是按角色派生并缓存 60s 的;转让后原 owner 的能力集立刻变了,
    // 不清缓存的话他在最长 60s 内仍能看到 owner 专属入口(点下去才 403)。
    if (result.ok) {
      this.invalidateCapabilities(userId, resolved.orgId);
      this.invalidateCapabilities(targetUserId, resolved.orgId);
    }
    return result;
  }

  async resetMemberPassword(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
    nextPassword: string,
  ): Promise<boolean> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return false;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const member = await this.org.getOrgMemberDetail(
      resolved.orgId,
      memberUserId,
    );
    if (!member) return false;
    await this.account.setPassword(memberUserId, nextPassword);
    return true;
  }

  /** 解除关联(member.manage)。owner 与本人不可解除——owner 先转让,本人无「退出」动作。 */
  async removeMember(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
  ): Promise<boolean> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return false;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    assertNotOwner(resolved.org, memberUserId, "owner_protected");
    if (memberUserId === userId) {
      throw new BadRequestException("self_protected");
    }
    const removed = await this.org.removeOrgMember(
      resolved.orgId,
      memberUserId,
    );
    if (removed) this.invalidateCapabilities(memberUserId, resolved.orgId);
    return removed;
  }
}

/** 邀请 / 加人 / 改角色的产出:待接受记录 + 一次性 token + 发邮件要的材料。 */
export interface InviteMemberOutcome {
  member: MemberRecord;
  invitationId: string;
  token: string;
  email: string;
  roleCode: string;
  expiresAt: Date;
  tenantName: string;
  inviterName: string;
  inviterLanguage: string | null;
}

/**
 * 可经邀请 / 加人 / 改角色赋予的角色:owner 不在其列——所有权只能经「转让」
 * 变更(owner 2026-08-21 裁定),任何权限授予都不该能造出第二个 owner。
 */
const ASSIGNABLE_ROLES = ["manager", "member", "readonly", "guest"] as const;
function asAssignableRole(value: string): OrgRole {
  if (value === "owner") throw new BadRequestException("owner_role_locked");
  if (!ASSIGNABLE_ROLES.includes(value as (typeof ASSIGNABLE_ROLES)[number])) {
    throw new BadRequestException(
      "role must be one of manager|member|readonly|guest",
    );
  }
  return value as OrgRole;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value: string): string {
  const email = (value ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new BadRequestException("invalid_email");
  return email;
}

/** owner 保护:对租户 owner 的停用 / 解除 / 改角色一律拒——先转让所有权。 */
function assertNotOwner(
  org: OrgView,
  memberUserId: string,
  code: "owner_protected" | "owner_role_locked",
): void {
  if (org.ownerUserId === memberUserId) throw new BadRequestException(code);
}

/**
 * When the username may next be changed: null = now (never changed, or the
 * 30-day cooldown has elapsed), otherwise the ISO timestamp it unlocks.
 */
function usernameChangeableAt(accountChangedAt?: string | null): string | null {
  if (!accountChangedAt) return null;
  const next =
    new Date(accountChangedAt).getTime() +
    USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() >= next ? null : new Date(next).toISOString();
}

function toUserProfile(
  user: {
    id: string;
    account: string;
    email: string | null;
    emailVerified?: boolean;
    phone: string;
    phoneVerified?: boolean;
    accountLoginDisabled?: boolean;
    name: string | null;
    status?: string;
    bio?: string | null;
    timezone?: string | null;
    language?: string | null;
    accountChangedAt?: string | null;
    userNo?: string;
    createdAt?: string;
    hasPassword?: boolean;
  },
  picture: string | null,
): ConsoleUserProfile {
  return {
    id: user.id,
    username: user.account,
    usernameChangeableAt: usernameChangeableAt(user.accountChangedAt),
    displayName: user.name,
    picture,
    avatarUrl: null,
    bio: user.bio ?? null,
    email: user.email,
    emailVerified: user.emailVerified ?? false,
    phone: user.phone,
    phoneVerified: user.phoneVerified ?? false,
    accountLoginDisabled: user.accountLoginDisabled ?? false,
    timezone: user.timezone ?? null,
    language: user.language ?? null,
    profileUpdatedAt: null,
    userNo: user.userNo ?? null,
    accountCreatedAt: user.createdAt ?? null,
    accountStatus: user.status ?? null,
    hasPassword: user.hasPassword ?? false,
  };
}

function toTenantContext(
  orgId: string,
  org: { name: string; type: string; status: string; tenantNo?: string },
  workspace: string | null,
  workspaceMeta: { name: string; workspaceNo: string | null } | null = null,
): TenantContext {
  return {
    id: orgId,
    name: org.name,
    mode: "tenant",
    // 内部路由用途保留；展示一律用下方 workspaceName/workspaceNo（UUID 禁展示）。
    workspace: workspace ?? "default",
    tenantType: org.type === "organization" ? "organization" : "personal",
    tenantCode: orgId,
    tenantNo: org.tenantNo ?? null,
    workspaceName: workspaceMeta?.name ?? null,
    workspaceNo: workspaceMeta?.workspaceNo ?? null,
    status: org.status,
  };
}

function toMemberRecord(d: OrgMemberDetail): MemberRecord {
  return {
    id: d.userId,
    accountId: d.userId,
    name: d.name ?? d.account,
    username: d.account,
    avatarUrl: null,
    email: d.email ?? `${d.account}@local.vxture`,
    phone: d.phone,
    role: d.role,
    roleCode: d.role,
    // 角色目录以 code 为对外键(全局目录,UUID 禁展示)——编辑预填靠它,
    // 此前写死 null 导致成员编辑弹窗角色下拉恒空(2026-08-21 修)。
    roleId: d.role,
    status: d.status === "active" ? "Active" : "Suspended",
    statusCode: d.status === "active" ? "active" : "banned",
    lastActive: "—",
    team: "Workspace",
    joinedAt: d.joinedAt.toISOString(),
    isPrimaryOwner: d.role === "owner",
  };
}

function pendingMemberRecord(
  invitationId: string,
  email: string,
  role: string,
  expiresAt: Date,
  createdAt: Date,
): MemberRecord {
  return {
    id: invitationId,
    accountId: "",
    name: email,
    username: email,
    avatarUrl: null,
    email,
    phone: null,
    role,
    roleCode: role,
    roleId: role,
    status: "Invited",
    statusCode: "inactive",
    lastActive: "—",
    team: "Workspace",
    joinedAt: createdAt.toISOString(),
    isPrimaryOwner: false,
    invitationExpiresAt: expiresAt.toISOString(),
  };
}

/** 邮箱打码:保留首字符与域名;手机号保留前 3 后 4。 */
function redactContacts(m: MemberRecord): MemberRecord {
  const at = m.email.indexOf("@");
  const email =
    at > 0 ? `${m.email.slice(0, 1)}***${m.email.slice(at)}` : "***";
  const phone =
    m.phone && m.phone.length >= 7
      ? `${m.phone.slice(0, 3)}****${m.phone.slice(-4)}`
      : m.phone
        ? "****"
        : null;
  return { ...m, email, phone };
}

function toConsoleRole(e: OrgRoleCatalogEntry): ConsoleTenantRole {
  return {
    id: e.code,
    roleCode: e.code,
    roleName: e.name,
    description: null,
    status: "active",
    isSystem: true,
    // 角色行只带它持有的操作码;层级信息由 listTenantPermissions 的目录全树提供。
    permissions: e.permissions.map((code) =>
      toConsolePermission({
        code,
        name: code,
        type: "api",
        parentCode: null,
        routePath: null,
        category: null,
        sort: 999,
      }),
    ),
  };
}

function toConsolePermission(
  e: PermissionCatalogEntry,
): ConsoleTenantPermission {
  return {
    id: e.code,
    permissionCode: e.code,
    permissionName: e.name,
    permissionType: e.type,
    description: null,
    parentCode: e.parentCode,
    routePath: e.routePath,
    category: e.category,
    sort: e.sort,
  };
}
