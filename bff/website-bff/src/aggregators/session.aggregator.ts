/**
 * session.aggregator.ts - current-user session aggregator (Identity Platform).
 * @package @vxture/bff-website
 *
 * Aggregates the logged-in user's account info for the /api/me routes. Reads from
 * @vxture/service-account (identity-core User). The new minimal model has no rich
 * profile table yet (headline/bio/avatar/timezone/language) — those fields are
 * stubbed null until a profile store lands; name/email are the live editable bits.
 */

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import { AccountService } from "@vxture/service-account";
import {
  ActiveContextService,
  type OrgRole,
} from "@vxture/service-organization";
import type {
  AccountProfileDto,
  AuthUserDto,
  UpdateProfileDto,
} from "../types/auth.types";

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  manager: "Manager",
  member: "Member",
  readonly: "Read-only",
  guest: "Guest",
};

@Injectable()
export class SessionAggregator {
  constructor(
    @Inject(AccountService)
    private readonly account: AccountService,
    @Inject(ActiveContextService)
    private readonly active: ActiveContextService,
    @Inject(VxConfigService)
    private readonly config: VxConfigService,
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

  /**
   * Resolve the caller's active-org role + tenant type for the header badges.
   * Falls back to a personal/member view when the user has no membership or an
   * org lookup fails — /api/me must never break on org-context errors.
   */
  private async resolveOrgBadges(userId: string): Promise<{
    role: OrgRole;
    tenantType: "individual" | "company";
    organizationName: string | null;
  }> {
    const fallback = {
      role: "member" as OrgRole,
      tenantType: "individual" as const,
      organizationName: null,
    };
    try {
      const ctx = await this.active.resolveActiveContext(userId);
      if (!ctx?.activeOrg) return fallback;
      // resolveActiveContext already carries the org snapshot (type/name, from
      // its listOrgMembershipsForUser join) and the active-org role (roles[0] =
      // `org:${role}`). Derive the badges from it instead of re-querying
      // getOrgById + getOrgMemberDetail (two redundant round-trips on the /api/me
      // session-heartbeat path).
      const orgRole = ctx.roles
        .find((r) => r.startsWith("org:"))
        ?.slice("org:".length);
      const role = (orgRole as OrgRole | undefined) ?? "member";
      const isCompany = ctx.activeOrgType === "organization";
      return {
        role,
        tenantType: isCompany ? "company" : "individual",
        organizationName: isCompany ? ctx.activeOrgName : null,
      };
    } catch {
      return fallback;
    }
  }

  /** Basic info for GET /api/me (header menu: identity + avatar + role/tenant badges). */
  async getCurrentUser(userId: string): Promise<AuthUserDto | null> {
    const user = await this.account.getUserById(userId);
    if (!user) return null;
    const badges = await this.resolveOrgBadges(userId);
    return {
      id: user.id,
      name: user.name ?? user.account,
      displayName: user.name ?? null,
      username: user.account,
      email: user.email ?? `${user.account}@local.vxture`,
      phone: user.phone,
      picture: this.pictureFor(user),
      role: badges.role,
      roleLabel: ORG_ROLE_LABELS[badges.role],
      tenantType: badges.tenantType,
      organizationName: badges.organizationName,
      // "Verified" in the minimal model = an active account (logged-in via the
      // central IdP). Drives the header auth-status tag (已认证 / 未认证).
      personalVerified: user.status === "active",
      organizationVerified: badges.tenantType === "company",
    };
  }

  /** Full profile for GET /api/me/profile (rich fields stubbed in the MVP model). */
  async getCurrentUserProfile(
    userId: string,
  ): Promise<AccountProfileDto | null> {
    const user = await this.account.getUserById(userId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.account,
      displayName: user.name,
      avatarUrl: this.pictureFor(user),
      headline: null,
      bio: null,
      email: user.email,
      phone: user.phone,
      timezone: null,
      language: null,
      profileUpdatedAt: null,
    };
  }

  /**
   * Update profile for PUT /api/me/profile. Only name (displayName) and email are
   * persisted in the minimal model; other fields are accepted but ignored.
   */
  async updateCurrentUserProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<AccountProfileDto | null> {
    const patch: { name?: string | null; email?: string | null } = {};
    if (input.displayName !== undefined) patch.name = input.displayName;
    if (input.email !== undefined) patch.email = input.email;
    if (patch.name !== undefined || patch.email !== undefined) {
      const updated = await this.account.updateProfile(userId, patch);
      if (!updated) return null;
    }
    return this.getCurrentUserProfile(userId);
  }

  /**
   * Change password for PUT /api/me/password. Throws 401 when the current
   * password is wrong (preserving the previous router contract).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<void> {
    const ok = await this.account.changePassword(
      userId,
      currentPassword,
      nextPassword,
    );
    if (!ok) {
      throw new UnauthorizedException("Current password is incorrect");
    }
  }
}
