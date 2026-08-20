import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { VxConfigService } from "@vxture/core-config";
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
  type OrgLogoRecord,
  type OrgMemberDetail,
  type OrgProfileUpdateInput,
  type OrgRole,
  type OrgRoleCatalogEntry,
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
 * capability 派生(owner 2026-08-21 P0 分权;取代旧「有租户全给 5 个」):
 * - 只读运营面(配额/用量)随成员身份即给——成员用产品就该看得到额度;
 * - 商业面(产品订阅/账单/卡券页可见性)随治理权限 tenant.billing.manage
 *   (seed 裁定:仅 owner 持有,manager 刻意不含 billing);
 * - 成员/角色管理面随对应治理权限(tenant.member.manage / tenant.role.assign)。
 * 治理权限经 GovernanceService 回查(identity/040 D-6:capability 不进 token,
 * BFF 回查为主、可缓存);每 (tenant,user) 短 TTL 内存缓存,改角色最迟一分钟生效。
 */
const MEMBER_BASE_CAPABILITIES: Capability[] = ["tenant.quota.read"];
const PERM_TO_CAPABILITIES: Record<string, Capability[]> = {
  "tenant.member.manage": ["tenant.user.manage"],
  "tenant.role.assign": ["tenant.role.manage"],
  "tenant.billing.manage": ["tenant.billing.read", "tenant.subscription.read"],
};
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
      verifiedStatus: null, // KYC §3.4 deferred (skeleton only)
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
      const derived = new Set<Capability>(MEMBER_BASE_CAPABILITIES);
      for (const p of perms) {
        for (const c of PERM_TO_CAPABILITIES[p] ?? []) derived.add(c);
      }
      caps = [...derived];
    } catch {
      caps = [...MEMBER_BASE_CAPABILITIES];
    }
    this.capsCache.set(key, { at: Date.now(), caps });
    return [...caps];
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

  async listMembers(userId: string, orgId?: string): Promise<MemberRecord[]> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    const members = await this.org.listOrgMembersWithUser(resolved.orgId);
    return members.map(toMemberRecord);
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

  async listTenantPermissions(
    userId: string,
    orgId?: string,
  ): Promise<ConsoleTenantPermission[]> {
    const resolved = await this.resolveOrg(userId, orgId);
    if (!resolved) return [];
    const catalog = await this.org.getOrgRolesCatalog();
    const codes = [...new Set(catalog.flatMap((r) => r.permissions))];
    return codes.map(toConsolePermission);
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

  async createMember(
    userId: string,
    orgId: string | undefined,
    input: { email: string; roleCode?: string | null },
  ): Promise<MemberRecord | null> {
    return this.inviteMember(userId, orgId, input);
  }

  /** Invite a member by email (requires org.member.manage). Returns a pending record. */
  async inviteMember(
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
    const role = asOrgRole(input.roleCode ?? "member");
    const { invitation } = await this.org.createInvitation({
      scope: "org",
      organizationId: resolved.orgId,
      targetType: "email",
      target: input.email,
      role,
      createdBy: userId,
    });
    return pendingMemberRecord(invitation.id, input.email, role);
  }

  /** Update a member's role (requires org.role.assign). nickname/remark/status are retired. */
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
    await this.org.updateOrgMemberRole(
      resolved.orgId,
      memberUserId,
      asOrgRole(input.roleCode),
    );
    return this.getMember(userId, orgId, memberUserId);
  }

  async disableMember(
    userId: string,
    orgId: string | undefined,
    memberUserId: string,
  ): Promise<MemberRecord | null> {
    await this.removeMember(userId, orgId, memberUserId);
    return null;
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
    return this.org.removeOrgMember(resolved.orgId, memberUserId);
  }
}

const ORG_ROLES = ["owner", "manager", "member", "readonly", "guest"] as const;
function asOrgRole(value: string): OrgRole {
  if (!ORG_ROLES.includes(value as OrgRole)) {
    throw new BadRequestException(
      "role must be one of owner|manager|member|readonly|guest",
    );
  }
  return value as OrgRole;
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
    roleId: null,
    status: "Invited",
    statusCode: "inactive",
    lastActive: "Invitation sent",
    team: "Workspace",
    joinedAt: new Date().toISOString(),
    isPrimaryOwner: false,
  };
}

function toConsoleRole(e: OrgRoleCatalogEntry): ConsoleTenantRole {
  return {
    id: e.code,
    roleCode: e.code,
    roleName: e.name,
    description: null,
    status: "active",
    isSystem: true,
    permissions: e.permissions.map(toConsolePermission),
  };
}

function toConsolePermission(code: string): ConsoleTenantPermission {
  return {
    id: code,
    permissionCode: code,
    permissionName: code,
    permissionType: "governance",
    description: null,
  };
}
