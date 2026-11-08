/**
 * Customer account-center projection and session orchestration.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
// ⚠️ 跨层引用: Delegate customer profile and security reads to the account domain.
import {
  AccountService,
  type UpdateProfileInput,
} from "@vxture/service-account";
import type { CustomerSessionContext } from "./realm-session.service";
import { OidcService } from "./oidc.service";

// ============================================================================
// Account projection
// ============================================================================

@Injectable()
export class CustomerSelfService {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(OidcService) private readonly oidc: OidcService,
  ) {}

  /** Return only the fields owned by the customer account center. */
  getProfile({ user }: CustomerSessionContext) {
    return {
      id: user.id,
      realm: "customer" as const,
      account: user.account,
      userNo: user.userNo,
      name: user.name,
      bio: user.bio ?? null,
      gender: user.gender ?? null,
      timezone: user.timezone ?? null,
      language: user.language ?? null,
      avatarHash: user.avatarHash,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  /** Return contact verification and available login methods without provider subjects. */
  async getSecurity(context: CustomerSessionContext) {
    const identities = await this.accounts.listIdentitiesByUser(context.userId);
    const user = context.user;
    return {
      email: user.email,
      emailVerified: user.emailVerified ?? false,
      phone: user.phone,
      phoneVerified: user.phoneVerified ?? false,
      hasPassword: user.hasPassword ?? false,
      accountLoginEnabled: !(user.accountLoginDisabled ?? false),
      emailLoginEnabled: !(user.emailLoginDisabled ?? false),
      identities: identities.map(({ provider, connectedAt }) => ({
        provider,
        connectedAt,
      })),
    };
  }

  /**
   * Apply a bounded profile patch; contacts and credentials require separate proof flows.
   * @param context - Validated customer context.
   * @param body - Untrusted JSON patch.
   * @returns Updated public profile.
   * @throws {BadRequestException} For unknown fields or invalid values.
   * @throws {NotFoundException} If the account no longer exists.
   */
  async updateProfile(context: CustomerSessionContext, body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("invalid_profile");
    }
    const limits: Record<string, number> = {
      name: 100,
      bio: 1000,
      gender: 6,
      timezone: 100,
      language: 35,
    };
    const entries = Object.entries(body);
    if (
      !entries.length ||
      entries.some(
        ([key, value]) =>
          !Object.hasOwn(limits, key) ||
          typeof value !== "string" ||
          value.length > limits[key]!,
      )
    )
      throw new BadRequestException("invalid_profile");
    const patch = Object.fromEntries(entries) as UpdateProfileInput;
    if (
      patch.gender !== undefined &&
      !["", "male", "female"].includes(patch.gender ?? "")
    ) {
      throw new BadRequestException("invalid_gender");
    }
    const user = await this.accounts.updateProfile(context.userId, patch);
    if (!user) throw new NotFoundException("customer_not_found");
    return this.getProfile({ ...context, user });
  }

  // ============================================================================
  // Security activity
  // ============================================================================

  /** Return a bounded login history without accepting a caller-supplied user identifier. */
  getLoginHistory(context: CustomerSessionContext) {
    return this.accounts.listLoginHistory(context.userId, 20);
  }

  /** Mark the requesting session in the customer's active device list. */
  async getSessions(context: CustomerSessionContext) {
    const sessions = await this.accounts.listSessions(context.userId);
    return sessions.map((session) => ({
      ...session,
      current: session.sid === context.sid,
    }));
  }

  /** End only a session owned by the authenticated customer. */
  async revokeSession(context: CustomerSessionContext, sid: string) {
    if (!sid || sid.length > 200)
      throw new BadRequestException("invalid_session");
    const revoked = await this.oidc.endCustomerSession(context.userId, sid);
    return { ok: true as const, revoked, current: sid === context.sid };
  }
}
