/**
 * Realm session validation for the identity platform.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-06
 */
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
// ⚠️ 跨层引用: Use the public service or configuration API for identity orchestration.
import { PgOperatorRepository, type OperatorView } from "@vxture/service-iam";
// ⚠️ 跨层引用: Use the public service or configuration API for identity orchestration.
import {
  AccountService,
  CustomerMfaRepository,
  type UserView,
} from "@vxture/service-account";
import { SessionService } from "../authn/session.service";
import { RedisService, type OidcCentralSession } from "../redis/redis.service";

export type IdentityRealm = "customer" | "workforce";

/**
 * Check that a subject belongs to the declared identity namespace.
 * @param realm - Server-controlled realm.
 * @param sub - Subject being authenticated.
 * @returns Whether both values identify the same supported realm.
 */
export function realmSubjectMatches(realm: string, sub: string): boolean {
  const prefix =
    realm === "customer" ? "usr_" : realm === "workforce" ? "opr_" : null;
  return (
    prefix !== null && sub.startsWith(prefix) && sub.length > prefix.length
  );
}

/**
 * Bind workforce authority to the current credentials, factors and policy.
 * @param session - Stored central authorization.
 * @param operator - Fresh, active workforce identity from its own repository.
 * @returns Whether this exact authentication is still authorized.
 */
export function operatorSessionCurrent(
  session: OidcCentralSession,
  operator: OperatorView | null,
): boolean {
  return (
    !!operator?.authenticationVersion &&
    session.realm === "workforce" &&
    session.sub === `opr_${operator.id}` &&
    session.authenticationVersion === operator.authenticationVersion &&
    operator.mfaEnrolled === true &&
    /\+(totp|recovery|webauthn)$/.test(session.authMethod) &&
    (!operator.webauthnRequired || session.authMethod.endsWith("+webauthn")) &&
    Number.isFinite(session.absExpiresAt) &&
    session.absExpiresAt > Math.floor(Date.now() / 1000)
  );
}

export interface CustomerSessionContext {
  sid: string;
  userId: string;
  user: UserView;
}

// ============================================================================
// Realm-specific authorization
// ============================================================================

@Injectable()
export class RealmSessionService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CustomerMfaRepository)
    private readonly factors: CustomerMfaRepository,
  ) {}

  /**
   * Authorize operator self-service using its own session and account store.
   * @param sid - Operator central-session cookie.
   * @returns Active operator identifier.
   * @throws {UnauthorizedException} For absent, expired, wrong-realm or disabled identities.
   */
  async requireOperator(sid: string | undefined): Promise<string> {
    if (!sid) throw new UnauthorizedException("operator_session_required");
    const session = await this.redis.getOidcSession(sid);
    if (
      !session ||
      session.realm !== "workforce" ||
      !/\+(totp|recovery|webauthn)$/.test(session.authMethod) ||
      !realmSubjectMatches(session.realm, session.sub) ||
      !Number.isFinite(session.absExpiresAt) ||
      session.absExpiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("operator_session_required");
    }
    const operatorId = session.sub.slice("opr_".length);
    // The repository excludes disabled accounts and inactive operator roles.
    if (
      !operatorSessionCurrent(
        session,
        await this.operators.findById(operatorId),
      )
    ) {
      throw new UnauthorizedException("operator_session_required");
    }
    return operatorId;
  }
  /**
   * Resolve the customer cookie against both central-session authorities.
   * @param sid - Customer central-session cookie.
   * @returns Customer identity and profile, without crossing into workforce.
   * @throws {UnauthorizedException} When either authority or the account rejects access.
   */
  async requireCustomer(
    sid: string | undefined,
  ): Promise<CustomerSessionContext> {
    if (!sid) throw new UnauthorizedException("customer_session_required");
    const cached = await this.redis.getOidcSession(sid);
    if (
      !cached ||
      cached.realm !== "customer" ||
      !realmSubjectMatches(cached.realm, cached.sub) ||
      !Number.isFinite(cached.absExpiresAt) ||
      cached.absExpiresAt <= Math.floor(Date.now() / 1000)
    )
      throw new UnauthorizedException("customer_session_required");
    const durable = await this.sessions.get(sid);
    const userId = cached.sub.slice("usr_".length);
    if (!durable || durable.realm !== "customer" || durable.userId !== userId) {
      throw new UnauthorizedException("customer_session_required");
    }
    const user = await this.accounts.getUserById(userId);
    if (!user || !["active", "deleting"].includes(user.status)) {
      throw new UnauthorizedException("customer_session_required");
    }
    if (
      (await this.factors.read(userId)) &&
      !/\+(totp|recovery)$/.test(cached.authMethod)
    )
      throw new UnauthorizedException("customer_mfa_required");
    return { sid, userId, user };
  }
}
