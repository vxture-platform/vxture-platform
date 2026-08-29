/**
 * session.aggregator.ts - current-user session aggregator (Identity Platform).
 * @package @vxture/bff-website
 *
 * Aggregates the logged-in user's account info for the /api/me routes. Reads from
 * @vxture/service-account (identity-core User; its UserView already joins
 * account.user_profiles for display_name / avatar_hash / bio / timezone /
 * language). profileUpdatedAt is read straight off account.user_profiles
 * .updated_at via the read-only pool because UserView does not carry it.
 *
 * 2026-08-30: bio / timezone / language used to be stubbed `null` on read and
 * silently dropped on write although the columns have existed since the
 * profile table landed (deploy/database/ddl/10_account.sql). They are live now.
 * `headline` was removed from the API instead: no column in the account schema
 * backs it, and a field that is always null is a lie, not a feature.
 */

import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import {
  AccountService,
  type UpdateProfileInput,
} from "@vxture/service-account";
import {
  ActiveContextService,
  type OrgRole,
} from "@vxture/service-organization";
import type { Pool } from "pg";
import { WEBSITE_BFF_RO_POOL } from "../providers/pg-pool.provider";
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
  private readonly logger = new Logger(SessionAggregator.name);

  constructor(
    @Inject(AccountService)
    private readonly account: AccountService,
    @Inject(ActiveContextService)
    private readonly active: ActiveContextService,
    @Inject(VxConfigService)
    private readonly config: VxConfigService,
    @Inject(WEBSITE_BFF_RO_POOL)
    private readonly pool: Pool,
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

  /**
   * account.user_profiles.updated_at as an ISO string; null when the user has
   * no profile row yet. The timestamp only tells the client how fresh the
   * editable fields are, so a read failure degrades to null instead of failing
   * the whole profile read.
   */
  private async readProfileUpdatedAt(userId: string): Promise<string | null> {
    try {
      const res = await this.pool.query<{ updated_at: Date | string | null }>(
        `select updated_at from account.user_profiles where user_id = $1`,
        [userId],
      );
      const raw = res.rows[0]?.updated_at ?? null;
      if (raw == null) return null;
      return raw instanceof Date ? raw.toISOString() : String(raw);
    } catch (error) {
      this.logger.warn(
        `user_profiles.updated_at read failed for ${userId}: ${String(error)}`,
      );
      return null;
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

  /** Full profile for GET /api/me/profile (every field backed by a real column). */
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
      bio: user.bio ?? null,
      email: user.email,
      phone: user.phone,
      timezone: user.timezone ?? null,
      language: user.language ?? null,
      profileUpdatedAt: await this.readProfileUpdatedAt(userId),
    };
  }

  /**
   * Update profile for PUT /api/me/profile. Persists the fields that have a
   * column behind them: displayName (user_profiles.display_name), email
   * (users.email), bio / timezone / language (user_profiles). username,
   * avatarUrl and phone have their own flows (account change / avatar upload /
   * phone bind) and are ignored here, as before. The repository upsert treats
   * null as "leave unchanged" (coalesce), so a field cannot be cleared to null
   * through this route — send "" to blank it.
   */
  async updateCurrentUserProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<AccountProfileDto | null> {
    const patch: UpdateProfileInput = {};
    if (input.displayName !== undefined) patch.name = input.displayName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.language !== undefined) patch.language = input.language;
    if (Object.keys(patch).length > 0) {
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
