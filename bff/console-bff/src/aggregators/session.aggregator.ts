import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { VxConfigService } from "@vxture/core-config";
import {
  isGovernancePermissionCode,
  isValidIndustry,
} from "@vxture/core-utils";
import { verificationLevelOf } from "../lib/verification-level";
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
  type InvitationLocator,
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
      gender?: "male" | "female" | "" | null;
      timezone?: string | null;
      language?: string | null;
    },
  ): Promise<ConsoleUserProfile | null> {
    const user = await this.account.updateProfile(userId, {
      name: input.displayName ?? null,
      email: input.email ?? null,
      bio: input.bio ?? null,
      gender: input.gender ?? null,
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
        isDefault: m.isDefault === true,
        logoHash: org.logoHash ?? null,
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
    // 走查(owner 2026-09-05):联系人默认关联所有者。还没有联系人行时,用所有者的
    // 账号资料托底展示(关联 = 所有者);用户保存时才落库成一行。
    const owner =
      p?.contactUserId || p?.contactName
        ? null
        : await this.account.getUserById(org.ownerUserId);
    return {
      tenantId: org.id,
      tenantCode: org.id,
      tenantName: org.name,
      displayName: org.displayName ?? org.name,
      tenantType: org.type === "organization" ? "organization" : "personal",
      status: org.status === "active" ? "active" : "suspended",
      createdAt: org.createdAt ?? null,
      logoHash: p?.logoHash ?? null,
      description: p?.description ?? null,
      industry: p?.industry ?? null,
      scale: p?.scale ?? null,
      website: p?.website ?? null,
      contactName: p?.contactName ?? owner?.name ?? null,
      contactRole: p?.contactRole ?? null,
      contactEmail: p?.contactEmail ?? owner?.email ?? null,
      contactPhone: p?.contactPhone ?? owner?.phone ?? null,
      contactUserId: p?.contactUserId ?? (owner ? org.ownerUserId : null),
      contactGender: p?.contactGender ?? owner?.gender ?? null,
      countryCode: p?.countryCode ?? null,
      address: p?.address ?? null,
      address2: p?.address2 ?? null,
      postalCode: p?.postalCode ?? null,
      // 走查(owner 2026-09-05):填写的联系人默认就是账单接收人;有资料行时以行为准。
      isBillingRecipient: p ? p.isBillingRecipient : true,
      timezone: p?.timezone ?? null,
      language: p?.language ?? null,
      currency: p?.currency ?? null,
      // 反规范化快查列(权威在 kyc.tenant_verifications;admin 审核/console 提交
      // 都会同步回写)——P0 认证提交上线后本字段接真值(2026-08-21)。
      verifiedStatus: org.verificationStatus ?? "unverified",
      // 认证等级(owner 2026-09-06):已认证要分「简易认证」与「实名认证」两档,
      // 光看 verification_status 分不出——方式在 kyc 明细行上,这里一并带出。
      verifiedLevel: verificationLevelOf(
        await this.org.getLatestTenantVerification(org.id),
      ),
      updatedAt: p?.updatedAt ?? null,
    };
  }

  /** Create/update the active org's profile, then return the merged view. */
  async updateCurrentOrganizationProfile(
    userId: string,
    orgId: string | undefined,
    // name 不属于 profile 表(它在 tenancy.tenants 上),故在此就地放宽一格,
    // 不去污染 service-organization 的 OrgProfileUpdateInput(批 5c)。
    input: OrgProfileUpdateInput & {
      name?: string | null;
      displayName?: string | null;
    },
  ): Promise<ConsoleOrganizationProfile | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    // 名称与简称在 tenancy.tenants 上,不在 profile 表里——upsertOrgProfile 碰不到(批 5c)。
    const { name, displayName, contactUserId, ...patch } = input;
    const trimmed = typeof name === "string" ? name.trim() : null;
    if (trimmed && trimmed !== resolved.org.name) {
      await this.org.renameTenant(resolved.org.id, trimmed);
    }
    const trimmedDisplay =
      typeof displayName === "string" ? displayName.trim() : null;
    if (
      trimmedDisplay &&
      trimmedDisplay !== (resolved.org.displayName ?? resolved.org.name)
    ) {
      await this.org.setTenantDisplayName(resolved.org.id, trimmedDisplay);
    }

    // **合并再写**:upsertOrgProfile 是整体覆盖语义(漏掉的字段写 NULL),而页面自
    // 批 5c-1 起只提交改过的字段——不合并的话,保存任何一项都会把其它字段清空。
    const current = await this.org.getOrgProfile(resolved.org.id);
    const merged: OrgProfileUpdateInput = current
      ? (({ logoHash: _l, updatedAt: _u, ...rest }) => rest)(current)
      : {};
    Object.assign(merged, patch);
    // 所属行业只认 core-utils 自定义清单里的码(owner 2026-09-06「先自定义」);空 = 清掉。
    // 历史自由文本留在库里可读可显,但从 console 再写入只能是清单码。
    if (patch.industry && !isValidIndustry(patch.industry)) {
      throw new BadRequestException("invalid_industry");
    }
    // 首次建资料行且没明说时,联系人默认就是账单接收人
    if (!current && merged.isBillingRecipient === undefined) {
      merged.isBillingRecipient = true;
    }

    // 关联成员(走查 2026-09-05):必须是本租户的成员;姓名 / 邮箱 / 电话取自其账号资料
    // (联系人表这三列里姓名与邮箱非空,落库要有值;读侧再实时覆盖)。null = 解除关联。
    if (contactUserId !== undefined) {
      if (contactUserId) {
        const member = await this.org.getOrgMemberDetail(
          resolved.org.id,
          contactUserId,
        );
        if (!member) throw new BadRequestException("contact_user_not_member");
        const linked = await this.account.getUserById(contactUserId);
        merged.contactUserId = contactUserId;
        merged.contactName = linked?.name ?? merged.contactName ?? null;
        merged.contactEmail = linked?.email ?? merged.contactEmail ?? "";
        merged.contactPhone = linked?.phone ?? merged.contactPhone ?? null;
        // 称呼随成员的性别派生(读侧),联系人行自己的值清掉
        merged.contactGender = null;
      } else {
        merged.contactUserId = null;
      }
    }
    await this.org.upsertOrgProfile(resolved.org.id, merged);
    return this.getCurrentOrganizationProfile(userId, orgId);
  }

  /**
   * 个人租户转组织(批 5c-2)。一个事务在仓储层完成:改类型 / 名称 / 认证状态 +
   * 立刻补建这个人的新个人租户。主体码 v4 之后**不换号**,钱、订阅、成员、工作空间
   * 全部原样跟着这一行租户(tenant id 不变),所以不需要清账前置。不可回退。
   */
  async convertCurrentTenantToOrganization(
    userId: string,
    orgId: string | undefined,
    name: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) throw new NotFoundException("tenant_not_found");
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException("name_required");
    const result = await this.org.convertPersonalToOrganization(
      resolved.org.id,
      userId,
      trimmed,
    );
    if (!result.ok) {
      if (result.reason === "tenant_not_found") {
        throw new NotFoundException(result.reason);
      }
      throw new ConflictException(result.reason);
    }
    return {
      tenantId: resolved.org.id,
      name: trimmed,
      tenantNo: result.tenantNo,
      newPersonalTenantId: result.newPersonalTenantId,
      newPersonalTenantNo: result.newPersonalTenantNo,
    };
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
      logoHash: o.logoHash,
      isDefault: o.isDefault,
      workspaceName: meta.get(o.orgId)?.name ?? null,
      workspaceNo: meta.get(o.orgId)?.workspaceNo ?? null,
      status: "active",
    }));
  }

  /** 切换租户前的服务端预检(identity/080 §2.8):目标须在本人可进入的租户内。 */
  async isMemberOf(userId: string, tenantId: string): Promise<boolean> {
    const orgs = await this.active.listOrgsForSwitch(userId);
    return orgs.some((o) => o.orgId === tenantId);
  }

  /**
   * 账号信息页「设为默认」:每次登录后默认进入的租户(owner 2026-09-05)。
   * 目标须是本人的活跃成员关系,否则 404——不是成员的租户设不了默认。
   */
  async setDefaultTenant(userId: string, tenantId: string): Promise<void> {
    const ok = await this.org.setDefaultOrgForUser(userId, tenantId);
    if (!ok) throw new NotFoundException("tenant_not_found");
  }

  /** 本人所在任一租户的标识字节(账号页所在租户列表 / 顶栏面板);非成员或无标识 null。 */
  async getTenantLogoForMember(
    userId: string,
    tenantId: string,
  ): Promise<OrgLogoRecord | null> {
    if (!(await this.isMemberOf(userId, tenantId))) return null;
    return this.org.getOrgLogo(tenantId);
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
    /* 三路一起取。工作空间那一路是 owner 2026-09-09「两层用户只展示了一次」的答复:
       每个人各在哪些工作空间里。一次查完再归组,不逐行往返。 */
    const [members, invitations, byWorkspace] = await Promise.all([
      this.org.listOrgMembersWithUser(resolved.orgId),
      this.org.listInvitations(resolved.orgId),
      this.org.listWorkspaceMembersByTenant(resolved.orgId),
    ]);
    const records = [
      ...members.map((m) => ({
        ...toMemberRecord(m),
        /* 空数组是**真实状态**,不是缺数据:租户成员可以不属于任何工作空间
           (owner 2026-09-09 的第 3 件裁定)。前端据此显示「未加入」而不是「—」。 */
        workspaces: byWorkspace.get(m.userId) ?? [],
      })),
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
        )
        /* 待接受的邀请必然不属于任何工作空间——人还没进来。给空数组而不是省掉
           这个键:两种行形状不一致会让前端到处写 `?.` 兜。 */
        .map((r) => ({ ...r, workspaces: [] })),
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
    input: { email?: string; userNo?: string; roleCode?: string | null },
  ): Promise<MemberRecord | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const role = asAssignableRole(input.roleCode ?? "member");
    const email = normalizeEmail(input.email ?? "");
    if (!email) throw new BadRequestException("email_required");
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
    /* 两条通道二选一：给 email 走邮件链接，给 userNo 走站内直邀。
       两个都不给是 400——不要发一条没有收件人的邀请。 */
    input: { email?: string; userNo?: string; roleCode?: string | null },
  ): Promise<InviteMemberOutcome | null> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.gov.assertCan(
      userId,
      { orgId: resolved.orgId },
      "tenant.member.manage",
    );
    const role = asAssignableRole(input.roleCode ?? "member");

    /* 两条通道（owner 2026-09-09）：
     *   email    —— 发链接，对方可能还没有账号，注册后凭邮箱接受
     *   user_no  —— 目标**必须是平台已有账号**：查不到就直接告诉邀请方号不对，
     *               不要发出一条永远没人能接受的邀请
     * 判据是入参里给了哪一个，不是猜的。 */
    const byUserNo = (input.userNo ?? "").trim().length > 0;
    let target: string;
    let targetUserId: string | null = null;
    if (byUserNo) {
      const found = await this.account.findUserByUserNo(input.userNo!.trim());
      if (!found) throw new NotFoundException("user_not_found");
      target = found.userNo;
      targetUserId = found.id;
    } else {
      target = normalizeEmail(input.email ?? "");
      if (!target) throw new BadRequestException("email_or_user_no_required");
      const existingUser = await this.account.findUserByIdentifier(target);
      targetUserId = existingUser?.id ?? null;
    }

    /* 已是成员就不必再邀。两条通道都要查——按号邀请时我们已经知道是谁，
       按邮箱邀请时只有对方已有账号才查得到。 */
    if (targetUserId) {
      const member = await this.org.getOrgMemberDetail(
        resolved.orgId,
        targetUserId,
      );
      if (member) throw new ConflictException("already_member");
    }

    /* 同一个目标不重复挂 pending。比对要**按通道各比各的**:
       邮箱通道比邮箱、用户号通道比号——混着比会让「同一个人的两种邀请」
       其中一条被误判成重复。 */
    const pending = (await this.org.listInvitations(resolved.orgId)).find(
      (i) =>
        i.status === "pending" &&
        (byUserNo
          ? i.targetType === "user_no" && i.target.trim() === target
          : i.targetType === "email" && i.email.toLowerCase() === target),
    );
    if (pending) throw new ConflictException("invitation_pending");

    const { invitation, token } = await this.org.createInvitation({
      scope: "org",
      organizationId: resolved.orgId,
      targetType: byUserNo ? "user_no" : "email",
      target,
      role,
      createdBy: userId,
    });
    const inviter = await this.account.getUserById(userId);
    return {
      member: pendingMemberRecord(
        invitation.id,
        target,
        role,
        invitation.expiresAt,
        new Date(),
      ),
      invitationId: invitation.id,
      token,
      /* `email` 只在邮箱通道有值:上层拿它决定发不发邮件。按用户号邀请时是空串,
         那条链路不发邮件——站内直接送达,对方在待办里同意。 */
      email: byUserNo ? "" : target,
      targetType: byUserNo ? ("user_no" as const) : ("email" as const),
      targetUserId,
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
        /* 展示用的是 target 不是 email:按用户号发的邀请,email 是空串,
           拿它做展示会让重发后的那一行变成一个没有名字的空位。 */
        rotated.target,
        rotated.roleCode,
        rotated.expiresAt,
        new Date(),
      ),
      /* 重发照原通道走:邮箱通道才发邮件(email 非空),用户号通道只是换了 token,
         对方待办里那条仍然有效。 */
      targetType: rotated.targetType === "user_no" ? "user_no" : "email",
      /* 重发不重新解析被邀请人:这条邀请是谁的在创建时就定了,轮换 token 不改变它。
         站内待办也已经挂好,不需要再挂一次。 */
      targetUserId: null,
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
   * 接受邀请。租户由 token 决定,不看当前活跃租户;**收件人身份须与邀请对得上**
   * ——邮箱通道核邮箱、用户号通道核用户号(仓储层校验,认不出的通道一律拒绝)。成功后清掉能力缓存——对方下一次切进该租户就该按新角色拿能力。
   */
  /**
   * 接受邀请。两条通道走同一个方法,只是定位方式不同:
   *
   *   `{ token }`        邮件链接。
   *   `{ invitationId }` 站内消息里的「同意」——按用户号邀请时没有链接可点。
   *
   * 身份(email + userNo)在这里一次取全:少传一项,对应通道的邀请就永远接受不了。
   * 这是**故意的方向**——`rejectAcceptance` 的 default 是拒绝,不是放行。
   */
  async acceptInvitation(
    userId: string,
    locator: InvitationLocator,
  ): Promise<AcceptInvitationResult> {
    const user = await this.account.getUserById(userId);
    const result = await this.org.acceptInvitation(locator, userId, {
      email: user?.email ?? null,
      userNo: user?.userNo ?? null,
    });
    if (result.ok) {
      this.invalidateCapabilities(userId, result.membership.organizationId);
    }
    return result;
  }

  /* ── 工作空间管理(owner 2026-09-09「把工作空间做成真轴」)──────────────
     门在路由上(`tenant.workspace.manage`),这里只负责把租户解析出来并透传。
     判据(重名 / 默认不可停 / 至少一个 active)全在仓储的 SQL 里,不在这一层重写。 */

  async listWorkspaces(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.listWorkspaces(resolved.orgId);
  }

  /** 我在当前租户能进哪些工作空间(切换器 + 切换预检共用同一份判据)。 */
  async listWorkspacesForSwitch(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.listWorkspacesForSwitch(resolved.orgId, userId);
  }

  async createWorkspace(
    userId: string,
    orgId: string | undefined,
    input: { name: string; description?: string | null; icon?: string | null },
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    /* 建的人以 owner 身份进去:他是这个工作空间的第一个人,而且刚建完就要能管它
       (改名、加人)。工作空间级 owner 只有那 3 个 workspace.* 码,不牵涉租户级权限。 */
    return this.org.createWorkspace({
      tenantId: resolved.orgId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      creatorUserId: userId,
      creatorRoleCode: "owner",
    });
  }

  async updateWorkspace(
    userId: string,
    orgId: string | undefined,
    workspaceId: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      icon?: string | null | undefined;
    },
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.updateWorkspace(resolved.orgId, workspaceId, input);
  }

  async setDefaultWorkspace(
    userId: string,
    orgId: string | undefined,
    workspaceId: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.setDefaultWorkspace(resolved.orgId, workspaceId);
  }

  async archiveWorkspace(
    userId: string,
    orgId: string | undefined,
    workspaceId: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    return this.org.archiveWorkspace(resolved.orgId, workspaceId);
  }

  /**
   * 「我能不能管**这一个**工作空间的人」。
   *
   * 光挂 `@RequireCapability("workspace.member.manage")` 不够,而且不够的方式很隐蔽:
   * 那个码在 `tenant:owner` 是**全租户**的,在 `workspace:manager/owner` 却只来自
   * **当前活跃**工作空间(有效权限 = 租户角色 ∪ 活跃工作空间角色)。于是 A 空间的
   * 管理员切到 A、拿着 A 给的码去改 B 空间的人——能力有,作用域不对。
   *
   * 所以这里按**目标工作空间**再判一次:要么持租户级的 `tenant.workspace.manage`
   * (那是「管这个租户的工作空间」,天然覆盖全部),要么在目标空间里就是 owner/manager。
   */
  private async assertCanManageWorkspaceMembers(
    userId: string,
    orgId: string,
    workspaceId: string,
  ): Promise<void> {
    const tenantWide = await this.gov.can(
      userId,
      { orgId },
      "tenant.workspace.manage",
    );
    if (tenantWide) return;
    const role = await this.org.getWorkspaceRole(orgId, workspaceId, userId);
    if (role === "owner" || role === "manager") return;
    throw new ForbiddenException("workspace_scope_denied");
  }

  /** 把已在租户里的人加进某个工作空间。 */
  async addWorkspaceMemberScoped(
    userId: string,
    orgId: string | undefined,
    workspaceId: string,
    memberUserId: string,
    roleCode: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.assertCanManageWorkspaceMembers(
      userId,
      resolved.orgId,
      workspaceId,
    );
    /* 目标必须已经是租户成员。库里的 fk_workspace_memberships_tenant_member 也挡,
       但那会抛一个 500 的外键错;在这里先判,给的是 404「这个人不在租户里」。 */
    const member = await this.org.getOrgMemberDetail(
      resolved.orgId,
      memberUserId,
    );
    if (!member) throw new NotFoundException("member_not_found");
    await this.org.addWorkspaceMember(
      workspaceId,
      memberUserId,
      asAssignableRole(roleCode),
    );
    this.invalidateCapabilities(memberUserId, resolved.orgId);
    return { ok: true as const };
  }

  /** 把人从某个工作空间移除(不动租户成员关系)。 */
  async removeWorkspaceMemberScoped(
    userId: string,
    orgId: string | undefined,
    workspaceId: string,
    memberUserId: string,
  ) {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return null;
    await this.assertCanManageWorkspaceMembers(
      userId,
      resolved.orgId,
      workspaceId,
    );
    const result = await this.org.removeWorkspaceMember(
      resolved.orgId,
      workspaceId,
      memberUserId,
    );
    if (result.ok) this.invalidateCapabilities(memberUserId, resolved.orgId);
    return result;
  }

  /** 「谁在邀请我」。自视角读——此刻我还不是那些租户的成员,不能要租户权限。 */
  async listIncomingInvitations(userId: string) {
    const user = await this.account.getUserById(userId);
    /* 身份两项都没有 → 不可能有任何邀请指向我。空手查会让 SQL 拿两个 null
       去比,虽然也返回空,但没必要为此打一趟库。 */
    if (!user?.email && !user?.userNo) return [];
    return this.org.listInvitationsForIdentity({
      email: user?.email ?? null,
      userNo: user?.userNo ?? null,
    });
  }

  /** 拒绝邀请。判定沿用接受矩阵——无权接受者亦无权拒绝。 */
  async declineInvitation(userId: string, invitationId: string) {
    const user = await this.account.getUserById(userId);
    return this.org.declineInvitation(invitationId, {
      email: user?.email ?? null,
      userNo: user?.userNo ?? null,
    });
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
  /**
   * 收件邮箱。**只在邮箱通道有值**；按用户号邀请时是空串——上层拿它决定发不发邮件，
   * 空串即不发（站内直接送达，对方在待办里同意）。
   */
  email: string;
  /** 走的哪条通道。决定送达方式，也决定审计里记的是什么。 */
  targetType: "email" | "user_no";
  /**
   * 被邀请人的账号 id。按用户号邀请时**一定有**（查不到号就不会走到这里）；
   * 按邮箱邀请时只有对方已注册才有值——站内待办要挂到这个人头上。
   */
  targetUserId: string | null;
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
    gender?: "male" | "female" | null;
    timezone?: string | null;
    language?: string | null;
    accountChangedAt?: string | null;
    userNo?: string;
    createdAt?: string;
    hasPassword?: boolean;
    deletionRequestedAt?: string | null;
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
    gender: user.gender ?? null,
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
    deletionRequestedAt: user.deletionRequestedAt ?? null,
    hasPassword: user.hasPassword ?? false,
  };
}

function toTenantContext(
  orgId: string,
  org: {
    name: string;
    displayName?: string | null;
    type: string;
    status: string;
    tenantNo?: string;
    logoHash?: string | null;
  },
  workspace: string | null,
  workspaceMeta: { name: string; workspaceNo: string | null } | null = null,
): TenantContext {
  return {
    id: orgId,
    // 简称是日常展示名(侧栏 / 面板 / 标题);没有简称时退到认证名。
    name: org.displayName ?? org.name,
    mode: "tenant",
    // 内部路由用途保留；展示一律用下方 workspaceName/workspaceNo（UUID 禁展示）。
    workspace: workspace ?? "default",
    tenantType: org.type === "organization" ? "organization" : "personal",
    tenantCode: orgId,
    logoHash: org.logoHash ?? null,
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
