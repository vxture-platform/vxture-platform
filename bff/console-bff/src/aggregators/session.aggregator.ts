import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
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
  ConsoleOrganizationProfile,
  ConsoleTenantPermission,
  ConsoleTenantRole,
  ConsoleUserProfile,
  ConsoleWorkspaceItem,
  MemberRecord,
  TenantContext,
} from "../types/console.types";

const TENANT_CAPABILITIES = [
  "tenant.user.manage",
  "tenant.role.manage",
  "tenant.subscription.read",
  "tenant.billing.read",
  "tenant.quota.read",
] as const;

const CUSTOM_ROLES_UNSUPPORTED =
  "Custom roles are not supported: roles are a fixed catalog (owner/manager/member)";

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
  ) {}

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
    return toTenantContext(resolved.orgId, resolved.org, resolved.workspace);
  }

  async getTenantContexts(userId: string): Promise<TenantContext[]> {
    const orgs = await this.active.listOrgsForSwitch(userId);
    return orgs.map((o) => ({
      id: o.orgId,
      name: o.name,
      mode: "tenant",
      workspace: "default",
      tenantType: o.type === "organization" ? "organization" : "personal",
      tenantCode: o.orgId,
      status: "active",
    }));
  }

  async getCapabilities(userId: string, orgId?: string) {
    const resolved = await this.resolveOrg(userId, orgId);
    return resolved ? [...TENANT_CAPABILITIES] : [];
  }

  /**
   * Capabilities for an already-resolved request context, with no DB round-trip.
   * In the console middleware chain (Auth → Tenant → Permission) TenantMiddleware
   * has already resolved the active org and 401/403-gated the request before
   * PermissionMiddleware runs, so a present tenant means the org exists — which
   * is the only thing async getCapabilities' ~4-query resolveOrg determines.
   * async getCapabilities is kept for callers that must resolve the org first.
   */
  capabilitiesForContext(hasTenant: boolean) {
    return hasTenant ? [...TENANT_CAPABILITIES] : [];
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
    const members = await this.org.listOrgMembersWithUser(resolved.orgId);
    return {
      totalMembers: members.length,
      activeMembers: members.filter((m) => m.status === "active").length,
      primaryOwners: members.filter((m) => m.role === "owner").length,
      activeRoles: 3,
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
      "org.member.manage",
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
      "org.role.assign",
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
      "org.member.manage",
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
      "org.member.manage",
    );
    return this.org.removeOrgMember(resolved.orgId, memberUserId);
  }
}

const ORG_ROLES = ["owner", "manager", "member"] as const;
function asOrgRole(value: string): OrgRole {
  if (!ORG_ROLES.includes(value as OrgRole)) {
    throw new BadRequestException("role must be one of owner|manager|member");
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
): TenantContext {
  return {
    id: orgId,
    name: org.name,
    mode: "tenant",
    workspace: workspace ?? "default",
    tenantType: org.type === "organization" ? "organization" : "personal",
    tenantCode: orgId,
    tenantNo: org.tenantNo ?? null,
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
    roleId: null,
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
