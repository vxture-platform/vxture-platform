/**
 * oidc.service.ts - OIDC IdP orchestration (Identity Platform).
 * @package @vxture/bff-auth
 * @description
 *   OIDC IdP endpoints over the new model. Login is delegated to AuthnService
 *   (service-account credentials), the active-org context to ActiveContextService
 *   (service-organization), and token minting to TokenService (RS256 access with
 *   sub+active_org+active_workspace+roles; opaque refresh in session.refresh_tokens).
 *   The legacy HS256/tenant/entitlement path is retired.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import { AccountService, type UserView } from "@vxture/service-account";
import { ActiveContextService } from "@vxture/service-organization";
import {
  authMethodToAmr,
  PgOidcClientRepository,
  PgOperatorAuditRepository,
  PgOperatorRepository,
  PgSigningKeyRepository,
  type OidcClientConfig,
  type OidcClientInfo,
  type OperatorView,
} from "@vxture/service-iam";
import { RedisService, type OidcLoginChallenge } from "../redis/redis.service";
import { AuthnService } from "../authn/authn.service";
import { UserOnboardingService } from "../authn/user-onboarding.service";
import { LoginAttemptRepository } from "../token/login-attempt.repository";
import { TokenService } from "../token/token.service";
import { OidcKeyService, type OidcJwk } from "./oidc-key.service";
import { OperatorLoginGuard } from "./operator-login-guard.service";
import {
  OperatorMfaService,
  type TotpEnrollment,
} from "./operator-mfa.service";
import { OperatorWebauthnService } from "./operator-webauthn.service";
import { OperatorAnomalyService } from "./operator-anomaly.service";
import { TenantLoginGuard } from "../authn/tenant-login-guard.service";
import { AppScopeResolver } from "./app-scope.resolver";
import {
  TokenExchangeService,
  TOKEN_EXCHANGE_GRANT_TYPE,
  TOKEN_EXCHANGE_ISSUED_TOKEN_TYPE,
  type TokenExchangeRequest,
} from "./token-exchange.service";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/** Operator two-step login: pending MFA challenge TTL + failed-attempt cap. */
const OPERATOR_MFA_PENDING_TTL_SECONDS = 300;
const OPERATOR_MFA_MAX_ATTEMPTS = 5;
/**
 * Single-use authorization code lifetime. Was 60s, which is fine for normal
 * flows (code → immediate redirect → exchange in <1s) but too short for an
 * operator's first enroll-on-login: the completion returns recovery codes that
 * the user reads/saves BEFORE the browser redirects to the RP callback, so the
 * code can be minted-but-unexchanged for well over a minute → invalid_grant.
 * 300s comfortably covers that and is still within RFC 6749 §4.1.2 (≤600s
 * recommended); the code stays single-use + PKCE-bound, so the longer max
 * window is low-risk.
 */
const OIDC_AUTH_CODE_TTL_SECONDS = 300;
/** Step-up re-auth credential lifetime (short; high-risk action freshness). */
const OPERATOR_STEPUP_TTL_SECONDS = 300;
/** Operator realm OIDC client id (aud of operator tokens incl. step-up). */
const OPERATOR_CLIENT_ID = "admin";

/** Result of /token — the OIDC token response body. */
export interface OidcTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  id_token: string;
  scope: string;
}

/** Result of the token-exchange grant (RFC 8693) — a distinct, smaller shape. */
export interface OidcTokenExchangeResponse {
  access_token: string;
  issued_token_type: typeof TOKEN_EXCHANGE_ISSUED_TOKEN_TYPE;
  token_type: "Bearer";
  expires_in: number;
}

export interface OidcClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OidcAuthCodeGrant {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface OidcRefreshGrant {
  refreshToken: string;
  scope?: string | undefined;
}

export interface OidcAuthorizeRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string | undefined;
  codeChallenge: string;
  codeChallengeMethod: string;
  nonce?: string | undefined;
  prompt?: string | undefined;
  /** active-org hint (legacy param name tenant_hint maps here). */
  tenantHint?: string | undefined;
}

export type OidcAuthorizeResult =
  | { kind: "redirect"; location: string }
  | { kind: "login"; loginChallenge: string; realm: string };

export interface OidcPasswordLoginInput {
  loginChallenge: string;
  identifier: string;
  password: string;
  /** Cloudflare Turnstile token (verified for both tenant and operator realms). */
  turnstileToken?: string | undefined;
  /** Resolved client IP (operator rate-limiting + Turnstile remoteip + audit). */
  clientIp?: string | undefined;
  /** User-Agent (operator audit). */
  userAgent?: string | undefined;
}

export interface OidcPhoneLoginInput {
  loginChallenge: string;
  phone: string;
  code: string;
  clientIp?: string | undefined;
  userAgent?: string | undefined;
}

export interface OidcEmailLoginInput {
  loginChallenge: string;
  email: string;
  code: string;
  clientIp?: string | undefined;
  userAgent?: string | undefined;
}

export interface OidcLoginCompletion {
  sid: string;
  realm: string;
  sessionMaxAge: number;
  redirectTo: string;
}

/**
 * Step1 outcome when the operator's first factor passed but a second factor is
 * required (identity-platform-operator.md §3.2). No session is established yet;
 * the client completes Step2 at /oidc/authorize/mfa/verify with `mfaToken`.
 */
export interface OidcMfaChallenge {
  status: "mfa_required";
  mfaToken: string;
  /** Registered second factors usable now; empty when enrollment is required. */
  methods: string[];
  /** Required policy but nothing enrolled → run enroll-on-login before verify. */
  enrollRequired: boolean;
  /** Which factor the enroll ceremony must register (null when already enrolled). */
  enrollFactor: "totp" | "webauthn" | null;
}

/** Interactive-login result: a completed login, or an MFA continuation. */
export type OidcLoginResult = OidcLoginCompletion | OidcMfaChallenge;

/**
 * Completion of an enroll-on-login (TOTP) flow: a normal login completion plus
 * the freshly-issued recovery codes, surfaced ONCE for the UI to display.
 */
export interface OidcEnrollCompletion extends OidcLoginCompletion {
  recoveryCodes: string[];
}

/** Snapshot fields needed to resume an authorize and issue the code. */
interface OperatorAuthorizeSnapshot {
  redirectUri: string;
  scope: string;
  state?: string | undefined;
  codeChallenge: string;
  nonce?: string | undefined;
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
    @Inject(PgSigningKeyRepository)
    private readonly signingKeys: PgSigningKeyRepository,
    @Inject(PgOidcClientRepository)
    private readonly clients: PgOidcClientRepository,
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(PgOperatorAuditRepository)
    private readonly operatorAudit: PgOperatorAuditRepository,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(ActiveContextService)
    private readonly activeContext: ActiveContextService,
    @Inject(AuthnService) private readonly authn: AuthnService,
    @Inject(UserOnboardingService)
    private readonly onboarding: UserOnboardingService,
    @Inject(LoginAttemptRepository)
    private readonly loginAttempts: LoginAttemptRepository,
    @Inject(TokenService) private readonly token: TokenService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OperatorLoginGuard)
    private readonly operatorGuard: OperatorLoginGuard,
    @Inject(OperatorMfaService)
    private readonly operatorMfa: OperatorMfaService,
    @Inject(OperatorWebauthnService)
    private readonly operatorWebauthn: OperatorWebauthnService,
    @Inject(OperatorAnomalyService)
    private readonly operatorAnomaly: OperatorAnomalyService,
    @Inject(TenantLoginGuard)
    private readonly tenantGuard: TenantLoginGuard,
    @Inject(AppScopeResolver)
    private readonly appScope: AppScopeResolver,
    @Inject(TokenExchangeService)
    private readonly tokenExchangeSvc: TokenExchangeService,
  ) {}

  /** OIDC discovery document (/.well-known/openid-configuration). */
  buildDiscoveryDocument(): Record<string, unknown> {
    const issuer = this.config.auth.OIDC_ISSUER;
    return {
      issuer,
      authorization_endpoint: `${issuer}/oidc/authorize`,
      token_endpoint: `${issuer}/oidc/token`,
      userinfo_endpoint: `${issuer}/oidc/userinfo`,
      jwks_uri: `${issuer}/oidc/jwks`,
      end_session_endpoint: `${issuer}/oidc/end_session`,
      revocation_endpoint: `${issuer}/oidc/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        TOKEN_EXCHANGE_GRANT_TYPE,
      ],
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: [this.keys.algorithm],
      subject_types_supported: ["public"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
      scopes_supported: ["openid", "profile", "email", "phone"],
      claims_supported: [
        "sub",
        "iss",
        "aud",
        "exp",
        "iat",
        "jti",
        "sid",
        "userType",
        "name",
        "preferred_username",
        "picture",
        "phone",
        "phone_verified",
        "email",
        "email_verified",
        "account_status",
        "active_org",
        "active_org_type",
        "active_org_name",
        "active_workspace",
        "active_workspace_name",
        "roles",
      ],
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    };
  }

  /** JWKS = active env key merged with publishable appoidc.signing_keys rows, deduped by kid. */
  async getJwks(): Promise<{ keys: OidcJwk[] }> {
    const byKid = new Map<string, OidcJwk>();
    for (const k of this.keys.getJwks().keys) {
      byKid.set(k.kid, k);
    }
    for (const raw of await this.signingKeys.listPublishableJwks()) {
      const kid = (raw as { kid?: string }).kid;
      if (kid && !byKid.has(kid)) {
        byKid.set(kid, raw as unknown as OidcJwk);
      }
    }
    return { keys: [...byKid.values()] };
  }

  // ─── /userinfo, /revoke, /end_session ─────────────────────────────────────

  /** UserInfo — verify the IdP access_token and return profile claims. */
  async userinfo(accessToken: string): Promise<Record<string, unknown>> {
    let claims: Record<string, unknown>;
    try {
      claims = this.keys.verify(accessToken);
    } catch {
      throw new UnauthorizedException("invalid_token");
    }
    const sub = String(claims.sub ?? "");
    const id = stripSubPrefix(sub);

    if (sub.startsWith("opr_")) {
      const operator = await this.operators.findById(id);
      if (!operator) {
        throw new UnauthorizedException("invalid_token");
      }
      // email is required by some RPs (e.g. Cloudflare Access rejects logins
      // without it). Operators are admin-provisioned, so treat email as verified.
      return {
        sub,
        name: operator.username,
        ...(operator.email
          ? { email: operator.email, email_verified: true }
          : {}),
      };
    }

    const user = await this.account.getUserById(id);
    if (!user) {
      throw new UnauthorizedException("invalid_token");
    }
    return {
      sub,
      name: user.name ?? user.account,
      ...(user.avatarHash
        ? {
            picture: `${this.config.auth.OIDC_ISSUER}/avatar/usr_${user.id}?v=${user.avatarHash}`,
          }
        : {}),
      phone_number: user.phone,
      phone_number_verified: true,
      email: user.email ?? undefined,
      email_verified: user.email != null ? false : undefined,
    };
  }

  /**
   * Revoke a token (RFC 7009). access_token → blacklist its jti; refresh_token →
   * revoke its session chain in the realm store that holds it (identity.* or
   * admin.operator_refresh_token). Always succeeds.
   */
  async revoke(token: string, hint?: string): Promise<void> {
    if (hint === "refresh_token") {
      await this.token.revokeRefreshToken(token);
      return;
    }
    try {
      const claims = this.keys.verify(token);
      const jti = claims.jti ? String(claims.jti) : null;
      const exp = typeof claims.exp === "number" ? claims.exp : null;
      if (jti) {
        const ttl = exp
          ? Math.max(1, exp - Math.floor(Date.now() / 1000))
          : 900;
        await this.redis.addToBlacklist(jti, ttl);
      }
    } catch {
      await this.token.revokeRefreshToken(token);
    }
  }

  /** End the central session, revoke its refresh chain, and back-channel-logout RPs. */
  async endSession(
    sid: string | undefined,
    postLogoutRedirectUri?: string,
    state?: string,
  ): Promise<string | null> {
    let clientIds: string[] = [];
    if (sid) {
      const session = await this.redis.getOidcSession(sid);
      clientIds = await this.redis.getOidcSessionClients(sid);
      await this.redis.deleteOidcSession(sid);
      await this.token.revokeSession(sid);
      if (session) {
        await this.sendBackChannelLogouts(sid, session.sub, clientIds);
      }
    }
    if (!postLogoutRedirectUri) return null;
    // Open-redirect guard: only redirect to a post_logout_redirect_uri registered
    // by one of the session's clients (origin+path match; query like ?client= ok).
    if (
      !(await this.isRegisteredPostLogout(postLogoutRedirectUri, clientIds))
    ) {
      return null;
    }
    return state
      ? this.appendParams(postLogoutRedirectUri, { state })
      : postLogoutRedirectUri;
  }

  /** Public client branding (name/display/logo) for the login + post-logout surfaces; no secrets. */
  async getClientInfo(clientId: string): Promise<OidcClientInfo | null> {
    return this.clients.getPublicClientInfo(clientId);
  }

  /** True if uri matches (origin+path) a registered post_logout of any session client. */
  private async isRegisteredPostLogout(
    uri: string,
    clientIds: string[],
  ): Promise<boolean> {
    const req = parseUrlOrNull(uri);
    if (!req) return false;
    for (const clientId of clientIds) {
      const client = await this.clients.findEnabledByClientId(clientId);
      for (const reg of client?.postLogoutRedirectUris ?? []) {
        const r = parseUrlOrNull(reg);
        if (r && r.origin === req.origin && r.pathname === req.pathname) {
          return true;
        }
      }
    }
    return false;
  }

  private async sendBackChannelLogouts(
    sid: string,
    sub: string,
    clientIds: string[],
  ): Promise<void> {
    await Promise.all(
      clientIds.map(async (clientId) => {
        const client = await this.clients.findEnabledByClientId(clientId);
        if (!client?.backChannelLogoutUri) return;
        const logoutToken = this.keys.sign(
          {
            sid,
            events: {
              "http://schemas.openid.net/event/backchannel-logout": {},
            },
          },
          { audience: client.clientId, subject: sub, expiresInSec: 120 },
        );
        try {
          await fetch(client.backChannelLogoutUri, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ logout_token: logoutToken }).toString(),
          });
        } catch {
          // Best-effort.
        }
      }),
    );
  }

  // ─── /authorize ─────────────────────────────────────────────────────────

  async authorize(
    req: OidcAuthorizeRequest,
    sid: string | undefined,
  ): Promise<OidcAuthorizeResult> {
    const client = await this.clients.findEnabledByClientId(req.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    if (!client.redirectUris.includes(req.redirectUri)) {
      throw new BadRequestException("invalid_redirect_uri");
    }
    if (req.responseType !== "code") {
      return this.errorRedirect(req, "unsupported_response_type");
    }
    if (req.codeChallengeMethod !== "S256" || !req.codeChallenge) {
      return this.errorRedirect(req, "invalid_request");
    }
    const requested = req.scope.split(/\s+/).filter(Boolean);
    if (!requested.every((s) => client.allowedScopes.includes(s))) {
      return this.errorRedirect(req, "invalid_scope");
    }

    const session = sid ? await this.redis.getOidcSession(sid) : null;
    const hasUsableSession = Boolean(session && session.realm === client.realm);

    if (!hasUsableSession) {
      if (req.prompt === "none") {
        return this.errorRedirect(req, "login_required");
      }
      const challenge = randomUUID();
      await this.redis.storeOidcLoginChallenge(challenge, {
        clientId: client.clientId,
        realm: client.realm,
        redirectUri: req.redirectUri,
        scope: req.scope,
        state: req.state,
        codeChallenge: req.codeChallenge,
        nonce: req.nonce,
        orgHint: req.tenantHint,
      });
      return { kind: "login", loginChallenge: challenge, realm: client.realm };
    }

    const activeOrg = await this.resolveActiveOrg(
      sid as string,
      client.clientId,
      session!.sub,
      client.realm,
      req.tenantHint,
    );
    const code = await this.issueAuthCode({
      client,
      sub: session!.sub,
      sid: sid as string,
      realm: client.realm,
      redirectUri: req.redirectUri,
      scope: req.scope,
      codeChallenge: req.codeChallenge,
      nonce: req.nonce,
      activeOrg,
    });
    return {
      kind: "redirect",
      location: this.appendParams(req.redirectUri, {
        code,
        ...(req.state ? { state: req.state } : {}),
      }),
    };
  }

  /**
   * Resolve the active_org for (sid, client). Honors an org hint / stored value
   * (else the user's personal org), via ActiveContextService. Persists the choice.
   */
  private async resolveActiveOrg(
    sid: string,
    clientId: string,
    sub: string,
    realm: string,
    orgHint?: string,
  ): Promise<string | null> {
    if (realm !== "customer") return null;
    const userId = stripSubPrefix(sub);
    const stored = await this.redis.getOidcActiveOrg(sid, clientId);
    const hint = orgHint ?? stored ?? undefined;
    const ctx = await this.activeContext.resolveActiveContext(userId, hint);
    const chosen = ctx?.activeOrg ?? null;
    if (chosen && chosen !== stored) {
      await this.redis.setOidcActiveOrg(sid, clientId, chosen);
    }
    return chosen;
  }

  /** Mint a single-use authorization code bound to the session + PKCE challenge. */
  async issueAuthCode(input: {
    client: OidcClientConfig;
    sub: string;
    sid: string;
    realm: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    nonce?: string | undefined;
    activeOrg: string | null;
    amr?: string[] | undefined;
  }): Promise<string> {
    const code = randomUUID();
    await this.redis.storeOidcAuthCode(
      code,
      {
        clientId: input.client.clientId,
        sub: input.sub,
        sid: input.sid,
        realm: input.realm,
        redirectUri: input.redirectUri,
        scope: input.scope,
        codeChallenge: input.codeChallenge,
        nonce: input.nonce,
        activeOrg: input.activeOrg ?? undefined,
        amr: input.amr,
        authTime: Math.floor(Date.now() / 1000),
      },
      OIDC_AUTH_CODE_TTL_SECONDS,
    );
    return code;
  }

  /**
   * Interactive password login against a parked login_challenge. Tenant logins
   * complete directly; an operator login may return an `mfa_required`
   * continuation when a second factor is owed (§3.2).
   */
  async completeLoginWithPassword(
    input: OidcPasswordLoginInput,
  ): Promise<OidcLoginResult> {
    const challenge = await this.redis.consumeOidcLoginChallenge(
      input.loginChallenge,
    );
    if (!challenge) {
      throw new BadRequestException("invalid_login_challenge");
    }
    const client = await this.clients.findEnabledByClientId(challenge.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }

    if (challenge.realm === "workforce") {
      return this.completeOperatorLogin(input, challenge, client);
    }
    if (challenge.realm !== "customer") {
      throw new BadRequestException("unsupported_realm");
    }

    // Tenant-surface Turnstile (env-gated via CF_TURNSTILE_ENABLED), before
    // touching credentials. The accounts password form solves a fresh token
    // per attempt; phone-code login is gated separately at send time.
    await this.tenantGuard.verifyTurnstile(
      input.turnstileToken,
      input.clientIp ?? "unknown",
    );

    const user = await this.authn.loginWithPassword(
      input.identifier,
      input.password,
    );
    if (!user) {
      await this.recordTenantAttempt({
        identifier: input.identifier,
        authMethod: "password",
        result: "bad_credentials",
        ipAddress: input.clientIp,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("invalid_credentials");
    }
    await this.recordTenantAttempt({
      userId: user.id,
      identifier: input.identifier,
      authMethod: "password",
      result: "success",
      ipAddress: input.clientIp,
      userAgent: input.userAgent,
    });
    return this.finishTenantLogin(user.id, client, challenge, "password");
  }

  /** Interactive phone-code login (tenant realm only; login == registration for new phones). */
  async completeLoginWithPhone(
    input: OidcPhoneLoginInput,
  ): Promise<OidcLoginCompletion> {
    const challenge = await this.redis.consumeOidcLoginChallenge(
      input.loginChallenge,
    );
    if (!challenge) {
      throw new BadRequestException("invalid_login_challenge");
    }
    if (challenge.realm !== "customer") {
      throw new BadRequestException("unsupported_realm");
    }
    const client = await this.clients.findEnabledByClientId(challenge.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }

    let user;
    try {
      ({ user } = await this.authn.loginWithPhoneCode(input.phone, input.code));
    } catch (err) {
      await this.recordTenantAttempt({
        identifier: input.phone,
        authMethod: "phone",
        result: "invalid_phone_code",
        ipAddress: input.clientIp,
        userAgent: input.userAgent,
      });
      throw err;
    }
    await this.recordTenantAttempt({
      userId: user.id,
      identifier: input.phone,
      authMethod: "phone",
      result: "success",
      ipAddress: input.clientIp,
      userAgent: input.userAgent,
    });
    return this.finishTenantLogin(user.id, client, challenge, "phone");
  }

  /**
   * Interactive email-code login (tenant realm only). Login-only — never
   * registers (D-CB): an email that maps to no account yields 404
   * email_not_registered (vs 401 for a bad code), so the UI can tell the user
   * to register by phone first.
   */
  async completeLoginWithEmail(
    input: OidcEmailLoginInput,
  ): Promise<OidcLoginCompletion> {
    const challenge = await this.redis.consumeOidcLoginChallenge(
      input.loginChallenge,
    );
    if (!challenge) {
      throw new BadRequestException("invalid_login_challenge");
    }
    if (challenge.realm !== "customer") {
      throw new BadRequestException("unsupported_realm");
    }
    const client = await this.clients.findEnabledByClientId(challenge.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }

    const user = await this.authn.loginWithEmailCode(input.email, input.code);
    if (!user) {
      await this.recordTenantAttempt({
        identifier: input.email,
        authMethod: "email",
        result: "email_not_registered",
        ipAddress: input.clientIp,
        userAgent: input.userAgent,
      });
      throw new NotFoundException("email_not_registered");
    }
    await this.recordTenantAttempt({
      userId: user.id,
      identifier: input.email,
      authMethod: "email",
      result: "success",
      ipAddress: input.clientIp,
      userAgent: input.userAgent,
    });
    return this.finishTenantLogin(user.id, client, challenge, "email");
  }

  /**
   * Complete a tenant login for an ALREADY-resolved user — social login (upstream
   * OAuth verified the identity) or the post-bind-phone tail. Consumes the parked
   * challenge and runs the shared tenant tail; no credential check here (the caller
   * owns authentication). See docs/design/identity-platform-account.md §5/§7.
   */
  async completeLoginWithUser(
    loginChallenge: string,
    userId: string,
    authMethod: string,
    options?: {
      ipAddress?: string | undefined;
      userAgent?: string | undefined;
    },
  ): Promise<OidcLoginCompletion> {
    const challenge =
      await this.redis.consumeOidcLoginChallenge(loginChallenge);
    if (!challenge) {
      throw new BadRequestException("invalid_login_challenge");
    }
    if (challenge.realm !== "customer") {
      throw new BadRequestException("unsupported_realm");
    }
    const client = await this.clients.findEnabledByClientId(challenge.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    // Social/bind-tail: the caller owns authentication, so this is a success
    // record by definition. ipAddress/userAgent are supplied by the caller
    // (the social controller extracts them from its own HTTP request — the
    // upstream OAuth redirect itself carries neither).
    await this.recordTenantAttempt({
      userId,
      identifier: userId,
      authMethod,
      result: "success",
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
    });
    return this.finishTenantLogin(userId, client, challenge, authMethod);
  }

  /**
   * Resume a parked OIDC challenge using an already-established central session
   * (vx_sid). Used by the accounts login page for cross-tab session detection:
   * when a user logs in via another RP while the login page is open in other tabs,
   * those tabs call this to auto-complete the OIDC flow without re-authenticating.
   * Returns the RP redirect URL on success, null if no usable session exists.
   */
  async resumeWithExistingSession(
    loginChallenge: string,
    sid: string,
  ): Promise<string | null> {
    // Peek first to avoid destroying the challenge if the session is invalid.
    const peeked = await this.redis.peekOidcLoginChallenge(loginChallenge);
    if (!peeked) return null;

    const session = await this.redis.getOidcSession(sid);
    if (!session || session.realm !== peeked.realm) return null;

    const client = await this.clients.findEnabledByClientId(peeked.clientId);
    if (!client) return null;

    // Atomic consume — another tab may have won this race; that's fine.
    const challenge =
      await this.redis.consumeOidcLoginChallenge(loginChallenge);
    if (!challenge) return null;

    const activeOrg = await this.resolveActiveOrg(
      sid,
      client.clientId,
      session.sub,
      client.realm,
      challenge.orgHint,
    );

    const code = await this.issueAuthCode({
      client,
      sub: session.sub,
      sid,
      realm: client.realm,
      redirectUri: challenge.redirectUri,
      scope: challenge.scope,
      codeChallenge: challenge.codeChallenge,
      nonce: challenge.nonce,
      activeOrg,
    });

    return this.appendParams(challenge.redirectUri, {
      code,
      ...(challenge.state ? { state: challenge.state } : {}),
    });
  }

  /**
   * Shared tail for tenant-realm interactive logins: ensure a personal org (PLG),
   * establish the central session, persist active_org, and issue the code.
   */
  private async finishTenantLogin(
    userId: string,
    client: OidcClientConfig,
    challenge: OidcLoginChallenge,
    authMethod: string,
  ): Promise<OidcLoginCompletion> {
    let ctx = await this.activeContext.resolveActiveContext(
      userId,
      challenge.orgHint,
    );
    if (!ctx) {
      // PLG + self-heal: the onboarding ensemble (user-onboarding.service —
      // the single checklist file) provisions the personal org and backfills
      // any missing associated rows (loyalty baseline, ...).
      await this.onboarding.ensureOnboarded(userId);
      ctx = await this.activeContext.resolveActiveContext(
        userId,
        challenge.orgHint,
      );
    }
    const activeOrg = ctx?.activeOrg ?? null;

    const now = Math.floor(Date.now() / 1000);
    // IdP 侧只剩总时效一个钟；在场判断在门户（见 identity-sdk/idle.ts）。
    const absTtl = this.config.auth.OIDC_SESSION_ABS_TTL;
    const sid = randomUUID();
    await this.redis.createOidcSession(
      sid,
      {
        sub: `usr_${userId}`,
        realm: "customer",
        authMethod,
        createdAt: now,
        lastActiveAt: now,
        absExpiresAt: now + absTtl,
      },
      absTtl,
    );
    if (activeOrg) {
      await this.redis.setOidcActiveOrg(sid, client.clientId, activeOrg);
    }

    const code = await this.issueAuthCode({
      client,
      sub: `usr_${userId}`,
      sid,
      realm: "customer",
      redirectUri: challenge.redirectUri,
      scope: challenge.scope,
      codeChallenge: challenge.codeChallenge,
      nonce: challenge.nonce,
      activeOrg,
    });

    return {
      sid,
      realm: "customer",
      sessionMaxAge: absTtl,
      redirectTo: this.appendParams(challenge.redirectUri, {
        code,
        ...(challenge.state ? { state: challenge.state } : {}),
      }),
    };
  }

  /**
   * Operator (admin.operator_account) first-factor (password) login. On success,
   * resolve the MFA obligation (§2.2): if no second factor is owed, establish the
   * operator session + code immediately (unchanged behaviour); otherwise park an
   * mfa_pending challenge and return an `mfa_required` continuation for Step2.
   */
  private async completeOperatorLogin(
    input: OidcPasswordLoginInput,
    challenge: OidcLoginChallenge,
    client: OidcClientConfig,
  ): Promise<OidcLoginResult> {
    // Operator-realm hardening (D-X): rate-limit by IP+identifier, then verify
    // the admin-surface Turnstile (no-op until CF_TURNSTILE_ENABLED), before
    // touching credentials.
    const ip = input.clientIp ?? "unknown";
    this.operatorGuard.assertWithinRateLimit(ip, input.identifier);
    await this.operatorGuard.verifyTurnstile(input.turnstileToken, ip);

    const operator = await this.operators.authenticateOperator(
      input.identifier,
      input.password,
    );
    if (!operator) {
      this.operatorGuard.recordFailure(ip, input.identifier);
      await this.recordOperatorAttempt({
        identifier: input.identifier,
        authMethod: "password",
        result: "bad_credential",
        ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }
    this.operatorGuard.recordSuccess(ip, input.identifier);

    const { decision, methods } = await this.operatorMfa.resolveLoginMfa(
      operator.id,
    );
    if (!decision.mfaRequired) {
      // No second factor owed → finish as before (today's seed: optional +
      // unenrolled → not required, so password-only operators are unaffected).
      const completion = await this.finishOperatorSession(
        operator,
        client,
        challenge,
        "password",
      );
      // Anomaly check before recording this success (so history excludes it).
      await this.operatorAnomaly.evaluateLogin(
        operator.id,
        ip,
        input.userAgent,
      );
      await this.recordOperatorAttempt({
        operatorId: operator.id,
        identifier: input.identifier,
        authMethod: "password",
        result: "success",
        ip,
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: operator.id,
        action: "OperatorLogin",
        result: "success",
        resourceId: operator.id,
        ip,
        userAgent: input.userAgent,
        metadata: { amr: ["pwd"] },
      });
      return completion;
    }

    await this.recordOperatorAttempt({
      operatorId: operator.id,
      identifier: input.identifier,
      authMethod: "password",
      result: "mfa_required",
      ip,
      userAgent: input.userAgent,
    });
    const mfaToken = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.redis.storeOperatorMfaPending(
      mfaToken,
      {
        operatorId: operator.id,
        clientId: client.clientId,
        redirectUri: challenge.redirectUri,
        scope: challenge.scope,
        state: challenge.state,
        codeChallenge: challenge.codeChallenge,
        nonce: challenge.nonce,
        factor1Method: "password",
        attempts: 0,
        enrollRequired: decision.enrollRequired,
        webauthnRequired: decision.webauthnRequired,
        expiresAt: now + OPERATOR_MFA_PENDING_TTL_SECONDS,
      },
      OPERATOR_MFA_PENDING_TTL_SECONDS,
    );
    return {
      status: "mfa_required",
      mfaToken,
      methods,
      enrollRequired: decision.enrollRequired,
      enrollFactor: decision.enrollFactor,
    };
  }

  /**
   * Step2 of operator login: verify the second factor against a pending MFA
   * challenge and, on success, establish the operator session + code from the
   * parked authorize snapshot. Missing/expired token → mfa_session_expired;
   * wrong code → 401 (attempt burned); attempt cap → 401 mfa_locked.
   */
  async completeOperatorMfa(input: {
    mfaToken: string;
    method: string;
    code: string;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<OidcLoginCompletion> {
    const ip = input.clientIp ?? "unknown";
    const pending = await this.redis.getOperatorMfaPending(input.mfaToken);
    const now = Math.floor(Date.now() / 1000);
    if (!pending || pending.expiresAt <= now) {
      if (pending) await this.redis.deleteOperatorMfaPending(input.mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    if (pending.enrollRequired) {
      // Nothing enrolled to verify against — the client must run the enroll-on-
      // login ceremony first (P2.3+), then retry.
      throw new BadRequestException("mfa_enrollment_required");
    }
    if (pending.webauthnRequired) {
      // High-privilege operator: only a WebAuthn passkey is accepted (§2.1).
      throw new BadRequestException("webauthn_required");
    }

    const ok = await this.operatorMfa.verifySecondFactor({
      operatorId: pending.operatorId,
      method: input.method,
      code: input.code,
    });
    if (!ok) {
      const attempts = pending.attempts + 1;
      const locked = attempts >= OPERATOR_MFA_MAX_ATTEMPTS;
      await this.recordOperatorAttempt({
        operatorId: pending.operatorId,
        identifier: "",
        authMethod: input.method,
        result: locked ? "locked" : "mfa_failed",
        ip,
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: pending.operatorId,
        action: "MfaVerify",
        result: "failure",
        resourceId: pending.operatorId,
        errorCode: locked ? "mfa_locked" : "invalid_mfa_code",
        ip,
        userAgent: input.userAgent,
        metadata: { method: input.method },
      });
      // Failure-spike alert (counts include the failure just recorded).
      await this.operatorAnomaly.evaluateFailureSpike(
        pending.operatorId,
        ip,
        input.userAgent,
      );
      if (locked) {
        await this.redis.deleteOperatorMfaPending(input.mfaToken);
        throw new UnauthorizedException("mfa_locked");
      }
      await this.redis.storeOperatorMfaPending(
        input.mfaToken,
        { ...pending, attempts },
        Math.max(1, pending.expiresAt - now),
      );
      throw new UnauthorizedException("invalid_mfa_code");
    }

    await this.redis.deleteOperatorMfaPending(input.mfaToken);
    const operator = await this.operators.findById(pending.operatorId);
    if (!operator) {
      throw new BadRequestException("invalid_grant");
    }
    const client = await this.clients.findEnabledByClientId(pending.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    const authMethod = `${pending.factor1Method}+${input.method}`;
    const completion = await this.finishOperatorSession(
      operator,
      client,
      pending,
      authMethod,
    );
    await this.operatorAnomaly.evaluateLogin(operator.id, ip, input.userAgent);
    await this.recordOperatorAttempt({
      operatorId: operator.id,
      identifier: operator.username,
      authMethod: input.method,
      result: "success",
      ip,
      userAgent: input.userAgent,
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "MfaVerify",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { method: input.method },
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "OperatorLogin",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { amr: authMethodToAmr(authMethod) },
    });
    return completion;
  }

  /**
   * Step2 (WebAuthn) — begin: issue assertion options for the pending operator's
   * registered passkeys. Bound to the mfa_pending context; no session yet.
   */
  async beginOperatorWebauthnAuth(
    mfaToken: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const pending = await this.redis.getOperatorMfaPending(mfaToken);
    if (!pending || pending.expiresAt <= Math.floor(Date.now() / 1000)) {
      if (pending) await this.redis.deleteOperatorMfaPending(mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    if (pending.enrollRequired) {
      throw new BadRequestException("mfa_enrollment_required");
    }
    return this.operatorWebauthn.createAuthenticationOptions(
      pending.operatorId,
    );
  }

  /**
   * Step2 (WebAuthn) — verify the assertion against the pending challenge and, on
   * success, establish the operator session + code. Wrong/failed assertion burns
   * an attempt (cap → mfa_locked); a clone/rollback is rejected. Mirrors
   * completeOperatorMfa, with method "webauthn".
   */
  async completeOperatorWebauthn(input: {
    mfaToken: string;
    response: AuthenticationResponseJSON;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<OidcLoginCompletion> {
    const ip = input.clientIp ?? "unknown";
    const pending = await this.redis.getOperatorMfaPending(input.mfaToken);
    const now = Math.floor(Date.now() / 1000);
    if (!pending || pending.expiresAt <= now) {
      if (pending) await this.redis.deleteOperatorMfaPending(input.mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    if (pending.enrollRequired) {
      throw new BadRequestException("mfa_enrollment_required");
    }

    const ok = await this.operatorWebauthn.verifyAuthentication(
      pending.operatorId,
      input.response,
    );
    if (!ok) {
      const attempts = pending.attempts + 1;
      const locked = attempts >= OPERATOR_MFA_MAX_ATTEMPTS;
      await this.recordOperatorAttempt({
        operatorId: pending.operatorId,
        identifier: "",
        authMethod: "webauthn",
        result: locked ? "locked" : "mfa_failed",
        ip,
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: pending.operatorId,
        action: "MfaVerify",
        result: "failure",
        resourceId: pending.operatorId,
        errorCode: locked ? "mfa_locked" : "invalid_webauthn_assertion",
        ip,
        userAgent: input.userAgent,
        metadata: { method: "webauthn" },
      });
      if (locked) {
        await this.redis.deleteOperatorMfaPending(input.mfaToken);
        throw new UnauthorizedException("mfa_locked");
      }
      await this.redis.storeOperatorMfaPending(
        input.mfaToken,
        { ...pending, attempts },
        Math.max(1, pending.expiresAt - now),
      );
      throw new UnauthorizedException("invalid_mfa_code");
    }

    await this.redis.deleteOperatorMfaPending(input.mfaToken);
    const operator = await this.operators.findById(pending.operatorId);
    if (!operator) {
      throw new BadRequestException("invalid_grant");
    }
    const client = await this.clients.findEnabledByClientId(pending.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    const authMethod = `${pending.factor1Method}+webauthn`;
    const completion = await this.finishOperatorSession(
      operator,
      client,
      pending,
      authMethod,
    );
    await this.recordOperatorAttempt({
      operatorId: operator.id,
      identifier: operator.username,
      authMethod: "webauthn",
      result: "success",
      ip,
      userAgent: input.userAgent,
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "MfaVerify",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { method: "webauthn" },
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "OperatorLogin",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { amr: authMethodToAmr(authMethod) },
    });
    return completion;
  }

  /**
   * Enroll-on-login Step (WebAuthn): registration options for the pending
   * operator's first passkey (high-privilege bootstrap, §2.1). Bound to
   * mfa_pending; no session yet.
   */
  async beginOperatorWebauthnEnrollment(
    mfaToken: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const pending = await this.redis.getOperatorMfaPending(mfaToken);
    if (!pending || pending.expiresAt <= Math.floor(Date.now() / 1000)) {
      if (pending) await this.redis.deleteOperatorMfaPending(mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    return this.operatorWebauthn.createRegistrationOptionsForOperator(
      pending.operatorId,
    );
  }

  /**
   * Enroll-on-login confirm (WebAuthn): a verified registration both registers
   * the passkey AND proves possession, so the login completes. No recovery codes
   * are issued (a webauthn-required operator must not have a non-passkey bypass).
   * Failed attestation burns an attempt (cap → mfa_locked).
   */
  async confirmOperatorWebauthnEnrollment(input: {
    mfaToken: string;
    response: RegistrationResponseJSON;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<OidcLoginCompletion> {
    const ip = input.clientIp ?? "unknown";
    const pending = await this.redis.getOperatorMfaPending(input.mfaToken);
    const now = Math.floor(Date.now() / 1000);
    if (!pending || pending.expiresAt <= now) {
      if (pending) await this.redis.deleteOperatorMfaPending(input.mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }

    try {
      await this.operatorWebauthn.verifyRegistrationForOperator(
        pending.operatorId,
        input.response,
      );
    } catch {
      const attempts = pending.attempts + 1;
      const locked = attempts >= OPERATOR_MFA_MAX_ATTEMPTS;
      await this.recordOperatorAttempt({
        operatorId: pending.operatorId,
        identifier: "",
        authMethod: "webauthn",
        result: locked ? "locked" : "mfa_failed",
        ip,
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: pending.operatorId,
        action: "MfaEnroll",
        result: "failure",
        resourceId: pending.operatorId,
        errorCode: locked ? "mfa_locked" : "webauthn_verification_failed",
        ip,
        userAgent: input.userAgent,
        metadata: { method: "webauthn" },
      });
      if (locked) {
        await this.redis.deleteOperatorMfaPending(input.mfaToken);
        throw new UnauthorizedException("mfa_locked");
      }
      await this.redis.storeOperatorMfaPending(
        input.mfaToken,
        { ...pending, attempts },
        Math.max(1, pending.expiresAt - now),
      );
      throw new UnauthorizedException("invalid_mfa_code");
    }

    await this.redis.deleteOperatorMfaPending(input.mfaToken);
    const operator = await this.operators.findById(pending.operatorId);
    if (!operator) {
      throw new BadRequestException("invalid_grant");
    }
    const client = await this.clients.findEnabledByClientId(pending.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    const authMethod = `${pending.factor1Method}+webauthn`;
    const completion = await this.finishOperatorSession(
      operator,
      client,
      pending,
      authMethod,
    );
    await this.recordOperatorAttempt({
      operatorId: operator.id,
      identifier: operator.username,
      authMethod: "webauthn",
      result: "success",
      ip,
      userAgent: input.userAgent,
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "MfaEnroll",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { method: "webauthn" },
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "OperatorLogin",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { amr: authMethodToAmr(authMethod) },
    });
    return completion;
  }

  /**
   * Enroll-on-login Step (TOTP): stage a fresh secret for the pending operator
   * and return the QR material. Bound to the mfa_pending context so an
   * unauthenticated operator can enroll mid-login (§3.2). No session yet.
   */
  async beginOperatorTotpEnrollment(mfaToken: string): Promise<TotpEnrollment> {
    const pending = await this.redis.getOperatorMfaPending(mfaToken);
    if (!pending || pending.expiresAt <= Math.floor(Date.now() / 1000)) {
      if (pending) await this.redis.deleteOperatorMfaPending(mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    if (pending.webauthnRequired) {
      // High-privilege: must enroll a passkey, not TOTP (§2.1).
      throw new BadRequestException("webauthn_required");
    }
    return this.operatorMfa.beginTotpEnrollment(pending.operatorId);
  }

  /**
   * Enroll-on-login confirm (TOTP): the first valid code enables TOTP AND
   * satisfies the second factor, so the login completes (session + code). Wrong
   * code burns an attempt (cap → mfa_locked), mirroring completeOperatorMfa.
   */
  async confirmOperatorTotpEnrollment(input: {
    mfaToken: string;
    code: string;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<OidcEnrollCompletion> {
    const ip = input.clientIp ?? "unknown";
    const pending = await this.redis.getOperatorMfaPending(input.mfaToken);
    const now = Math.floor(Date.now() / 1000);
    if (!pending || pending.expiresAt <= now) {
      if (pending) await this.redis.deleteOperatorMfaPending(input.mfaToken);
      throw new BadRequestException("mfa_session_expired");
    }
    if (pending.webauthnRequired) {
      throw new BadRequestException("webauthn_required");
    }

    const result = await this.operatorMfa.confirmTotpEnrollment(
      pending.operatorId,
      input.code,
    );
    if (!result.ok) {
      const attempts = pending.attempts + 1;
      const locked = attempts >= OPERATOR_MFA_MAX_ATTEMPTS;
      await this.recordOperatorAttempt({
        operatorId: pending.operatorId,
        identifier: "",
        authMethod: "totp",
        result: locked ? "locked" : "mfa_failed",
        ip,
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: pending.operatorId,
        action: "MfaEnroll",
        result: "failure",
        resourceId: pending.operatorId,
        errorCode: locked ? "mfa_locked" : "invalid_mfa_code",
        ip,
        userAgent: input.userAgent,
        metadata: { method: "totp" },
      });
      if (locked) {
        await this.redis.deleteOperatorMfaPending(input.mfaToken);
        throw new UnauthorizedException("mfa_locked");
      }
      await this.redis.storeOperatorMfaPending(
        input.mfaToken,
        { ...pending, attempts },
        Math.max(1, pending.expiresAt - now),
      );
      throw new UnauthorizedException("invalid_mfa_code");
    }

    await this.redis.deleteOperatorMfaPending(input.mfaToken);
    const operator = await this.operators.findById(pending.operatorId);
    if (!operator) {
      throw new BadRequestException("invalid_grant");
    }
    const client = await this.clients.findEnabledByClientId(pending.clientId);
    if (!client) {
      throw new BadRequestException("invalid_client");
    }
    const authMethod = `${pending.factor1Method}+totp`;
    const completion = await this.finishOperatorSession(
      operator,
      client,
      pending,
      authMethod,
    );
    await this.recordOperatorAttempt({
      operatorId: operator.id,
      identifier: operator.username,
      authMethod: "totp",
      result: "success",
      ip,
      userAgent: input.userAgent,
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "MfaEnroll",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { method: "totp" },
    });
    await this.recordOperatorAudit({
      operatorId: operator.id,
      action: "OperatorLogin",
      result: "success",
      resourceId: operator.id,
      ip,
      userAgent: input.userAgent,
      metadata: { amr: authMethodToAmr(authMethod) },
    });
    return { ...completion, recoveryCodes: result.recoveryCodes };
  }

  /**
   * Shared tail for operator logins: establish the operator central session
   * (host-only vx_sid_op) and issue the authorization code from the authorize
   * snapshot. `authMethod` records the factor(s) cleared → carried as `amr` on
   * the session + code → access token (§4).
   */
  private async finishOperatorSession(
    operator: OperatorView,
    client: OidcClientConfig,
    snap: OperatorAuthorizeSnapshot,
    authMethod: string,
  ): Promise<OidcLoginCompletion> {
    const now = Math.floor(Date.now() / 1000);
    // Operator plane uses shorter session TTLs than tenant (§2.3): idle ≤ 30min,
    // absolute ≤ 8h.
    // 同上；运营面与客户面的差别现在体现在门户的闲置阈值（30min vs 4h），不在这里。
    const absTtl = this.config.auth.OPERATOR_SESSION_ABS_TTL;
    const sid = randomUUID();
    const sub = `opr_${operator.id}`;
    const amr = authMethodToAmr(authMethod);
    await this.redis.createOidcSession(
      sid,
      {
        sub,
        realm: "workforce",
        authMethod,
        amr,
        createdAt: now,
        lastActiveAt: now,
        absExpiresAt: now + absTtl,
      },
      absTtl,
    );

    const code = await this.issueAuthCode({
      client,
      sub,
      sid,
      realm: "workforce",
      redirectUri: snap.redirectUri,
      scope: snap.scope,
      codeChallenge: snap.codeChallenge,
      nonce: snap.nonce,
      activeOrg: null,
      amr,
    });

    return {
      sid,
      realm: "workforce",
      sessionMaxAge: absTtl,
      redirectTo: this.appendParams(snap.redirectUri, {
        code,
        ...(snap.state ? { state: snap.state } : {}),
      }),
    };
  }

  /**
   * Issue a short-lived operator step-up credential (P4.2). Verifies a freshly
   * presented second factor (TOTP) for an ALREADY-authenticated operator and, on
   * success, mints a short-lived RS256 step-up JWT (aud=admin, sub=opr_<id>,
   * stepup=true) the operator RP verifies before high-risk writes. operatorId is
   * supplied by the trusted caller (admin-bff, from the RP session) — never a
   * browser body. Returns null on a bad code (caller maps to 401).
   */
  async issueOperatorStepUp(input: {
    operatorId: string;
    method: "totp";
    code: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ stepUpToken: string; expiresIn: number } | null> {
    if (!this.keys.isReady()) {
      throw new BadRequestException("temporarily_unavailable");
    }
    const ok = await this.operatorMfa.verifySecondFactor({
      operatorId: input.operatorId,
      method: input.method,
      code: input.code,
    });
    if (!ok) {
      await this.recordOperatorAttempt({
        operatorId: input.operatorId,
        identifier: "",
        authMethod: input.method,
        result: "mfa_failed",
        ip: input.ip ?? "unknown",
        userAgent: input.userAgent,
      });
      await this.recordOperatorAudit({
        operatorId: input.operatorId,
        action: "StepUp",
        result: "failure",
        resourceId: input.operatorId,
        errorCode: "invalid_mfa_code",
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { method: input.method },
      });
      return null;
    }

    const stepUpToken = this.keys.sign(
      { stepup: true, userType: "operator", amr: ["otp"] },
      {
        audience: OPERATOR_CLIENT_ID,
        subject: `opr_${input.operatorId}`,
        expiresInSec: OPERATOR_STEPUP_TTL_SECONDS,
      },
    );
    await this.recordOperatorAudit({
      operatorId: input.operatorId,
      action: "StepUp",
      result: "success",
      resourceId: input.operatorId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { method: input.method },
    });
    return { stepUpToken, expiresIn: OPERATOR_STEPUP_TTL_SECONDS };
  }

  // ─── operator audit (best-effort: never break a login) ─────────────────────

  /** Append an operator_login_attempt row; failures are logged, not thrown. */
  /** Customer-realm login audit (session.login_attempts); best-effort. */
  private async recordTenantAttempt(input: {
    userId?: string | null;
    identifier: string;
    authMethod: string;
    result: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    try {
      await this.loginAttempts.record(input);
    } catch (err) {
      this.logger.warn(`login_attempt write failed: ${String(err)}`);
    }
  }

  private async recordOperatorAttempt(input: {
    operatorId?: string | null;
    identifier: string;
    authMethod: string;
    result: string;
    ip: string;
    userAgent?: string | undefined;
  }): Promise<void> {
    try {
      await this.operatorAudit.recordLoginAttempt({
        operatorId: input.operatorId ?? null,
        identifier: input.identifier,
        authMethod: input.authMethod,
        result: input.result,
        ipAddress: input.ip,
        userAgent: input.userAgent ?? null,
      });
    } catch (err) {
      this.logger.warn(`operator_login_attempt write failed: ${String(err)}`);
    }
  }

  /** Append a support.audit_log (actor_type=operator) row; best-effort. */
  private async recordOperatorAudit(input: {
    operatorId: string;
    action: string;
    result: string;
    resourceId: string;
    errorCode?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<void> {
    try {
      await this.operatorAudit.recordAuditEvent({
        operatorId: input.operatorId,
        action: input.action,
        result: input.result,
        resourceId: input.resourceId,
        errorCode: input.errorCode ?? null,
        ipAddress: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      this.logger.warn(`operator audit_log write failed: ${String(err)}`);
    }
  }

  private errorRedirect(
    req: OidcAuthorizeRequest,
    error: string,
  ): OidcAuthorizeResult {
    return {
      kind: "redirect",
      location: this.appendParams(req.redirectUri, {
        error,
        ...(req.state ? { state: req.state } : {}),
      }),
    };
  }

  private appendParams(url: string, params: Record<string, string>): string {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  // ─── /token ───────────────────────────────────────────────────────────────

  private async authClient(
    creds: OidcClientCredentials,
  ): Promise<OidcClientConfig> {
    const client = await this.clients.authenticateClient(
      creds.clientId,
      creds.clientSecret,
    );
    if (!client) {
      throw new UnauthorizedException("invalid_client");
    }
    return client;
  }

  /**
   * token-exchange grant (T1, product_210 §3) → a distinct, smaller S2S
   * token response. The caller authenticates as itself (client_secret_basic/
   * _post, same as the other grants); TokenExchangeService derives the
   * caller's product identity from its client row and does the OBO/service
   * context resolution + D2 coverage gate + claim assembly + signing.
   */
  async tokenExchange(
    creds: OidcClientCredentials,
    req: TokenExchangeRequest,
  ): Promise<OidcTokenExchangeResponse> {
    if (!this.keys.isReady()) {
      throw new BadRequestException("temporarily_unavailable");
    }
    const client = await this.authClient(creds);
    const result = await this.tokenExchangeSvc.exchange(
      { clientId: client.clientId, productCode: client.productCode },
      req,
    );
    return {
      access_token: result.accessToken,
      issued_token_type: TOKEN_EXCHANGE_ISSUED_TOKEN_TYPE,
      token_type: "Bearer",
      expires_in: result.expiresIn,
    };
  }

  /** authorization_code grant → token response. */
  async tokenWithAuthCode(
    creds: OidcClientCredentials,
    grant: OidcAuthCodeGrant,
  ): Promise<OidcTokenResponse> {
    if (!this.keys.isReady()) {
      throw new BadRequestException("temporarily_unavailable");
    }
    const client = await this.authClient(creds);

    const payload = await this.redis.consumeOidcAuthCode(grant.code);
    if (!payload) {
      throw new BadRequestException("invalid_grant");
    }
    if (
      payload.clientId !== client.clientId ||
      payload.redirectUri !== grant.redirectUri
    ) {
      throw new BadRequestException("invalid_grant");
    }
    if (!verifyPkceS256(grant.codeVerifier, payload.codeChallenge)) {
      throw new BadRequestException("invalid_grant");
    }

    const { accessToken, idToken } = await this.issueAccessAndId({
      client,
      sub: payload.sub,
      sid: payload.sid,
      realm: payload.realm,
      scope: payload.scope,
      activeOrg: payload.activeOrg ?? null,
      nonce: payload.nonce,
      authTime: payload.authTime,
      amr: payload.amr,
    });
    const refreshToken = await this.token.issueRefreshToken({
      userId: stripSubPrefix(payload.sub),
      sessionId: payload.sid,
      clientId: client.clientId,
      // operator → admin.operator_refresh_token; tenant → session.refresh_tokens.
      realm: payload.realm,
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: client.accessTokenTtl,
      refresh_token: refreshToken,
      id_token: idToken,
      scope: payload.scope,
    };
  }

  /** refresh_token grant → rotated token response (reuse detection revokes the chain). */
  async tokenWithRefresh(
    creds: OidcClientCredentials,
    grant: OidcRefreshGrant,
  ): Promise<OidcTokenResponse> {
    if (!this.keys.isReady()) {
      throw new BadRequestException("temporarily_unavailable");
    }
    const client = await this.authClient(creds);

    let rotated;
    try {
      rotated = await this.token.rotateRefreshToken(grant.refreshToken);
    } catch {
      throw new BadRequestException("invalid_grant");
    }
    if (rotated.clientId !== client.clientId) {
      throw new BadRequestException("invalid_grant");
    }
    const session = await this.redis.getOidcSession(rotated.sessionId);
    if (!session) {
      throw new BadRequestException("invalid_grant");
    }
    const activeOrg =
      (await this.redis.getOidcActiveOrg(rotated.sessionId, client.clientId)) ??
      null;
    const scope = grant.scope ?? client.allowedScopes.join(" ");

    const { accessToken, idToken } = await this.issueAccessAndId({
      client,
      sub: session.sub,
      sid: rotated.sessionId,
      realm: session.realm,
      scope,
      activeOrg,
      authTime: Math.floor(Date.now() / 1000),
      amr: session.amr,
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: client.accessTokenTtl,
      refresh_token: rotated.refreshToken,
      id_token: idToken,
      scope,
    };
  }

  /**
   * Assemble + sign the access_token (new claims via TokenService) and the id_token.
   * Refresh issuance/rotation is handled by the caller (per grant).
   */
  private async issueAccessAndId(input: {
    client: OidcClientConfig;
    sub: string;
    sid: string;
    realm: string;
    scope: string;
    activeOrg: string | null;
    nonce?: string | undefined;
    authTime: number;
    amr?: string[] | undefined;
  }): Promise<{ accessToken: string; idToken: string }> {
    const { client, sub, sid, realm } = input;
    const userId = stripSubPrefix(sub);
    const userType = realm === "workforce" ? "operator" : "tenant_user";

    let accessToken: string;
    // Profile claims mirrored into the id_token. Cloudflare Access reads the
    // email from the id_token (not /userinfo), so an operator login without it
    // fails with "User email was not returned".
    let idProfile: Record<string, unknown> = {};
    if (realm === "workforce") {
      const operator = await this.operators.findById(userId);
      if (!operator) {
        throw new BadRequestException("invalid_grant");
      }
      idProfile = {
        name: operator.username,
        ...(operator.email
          ? { email: operator.email, email_verified: true }
          : {}),
      };
      accessToken = this.token.issueAccessToken({
        sub,
        audience: client.clientId,
        sessionId: sid,
        roles: [],
        userType,
        ttlSeconds: client.accessTokenTtl,
        extra: {
          account_status: operator.status,
          operator_role: operator.roleCode,
          dataScope: "global",
          scope: input.scope,
          ...(input.amr && input.amr.length > 0 ? { amr: input.amr } : {}),
        },
      });
    } else {
      const ctx = await this.activeContext.resolveActiveContext(
        userId,
        input.activeOrg ?? undefined,
      );
      // Cross-domain RPs (e.g. umbra) read identity from the access_token — they
      // cannot reach the IdP DB the way same-origin BFFs do — so release the
      // human-identity claims here (contract §8). Loaded once per token mint.
      const user = await this.account.getUserById(userId);
      const activeOrgId = ctx?.activeOrg ?? input.activeOrg ?? null;
      const activeWorkspaceId = ctx?.activeWorkspace ?? null;
      const requestedScopes = new Set(input.scope.split(/\s+/).filter(Boolean));
      // Subscription claims are workspace-scoped in the new model (ADR-11: the
      // workspace is the cost center that holds subscriptions), derived from the
      // subscription's plan_version -> plan_component -> product (§8).
      const appScopeClaims = activeWorkspaceId
        ? await this.appScope.resolveClaims(activeWorkspaceId, requestedScopes)
        : {};
      accessToken = this.token.issueAccessToken({
        sub,
        audience: client.clientId,
        sessionId: sid,
        activeOrg: activeOrgId,
        activeOrgType: ctx?.activeOrgType ?? null,
        activeOrgName: ctx?.activeOrgName ?? null,
        activeWorkspace: ctx?.activeWorkspace ?? null,
        activeWorkspaceName: ctx?.activeWorkspaceName ?? null,
        roles: ctx?.roles ?? [],
        userType,
        ttlSeconds: client.accessTokenTtl,
        extra: {
          scope: input.scope,
          ...buildTenantIdentityClaims(
            user,
            input.scope,
            this.config.auth.OIDC_ISSUER,
          ),
          ...appScopeClaims,
        },
      });
    }

    const idToken = this.keys.sign(
      {
        sid,
        ...idProfile,
        ...(input.nonce ? { nonce: input.nonce } : {}),
        auth_time: input.authTime,
        userType,
      },
      { audience: client.clientId, subject: sub, expiresInSec: 300 },
    );

    return { accessToken, idToken };
  }
}

/**
 * Human-identity claims released into a tenant user's access_token, per the RP
 * integration contract (identity-platform-ruyin-contract.md §8).
 * Cross-domain RPs read identity from the verified access_token (they do not call
 * /userinfo and have no IdP DB access), so the account anchors — account_status,
 * email/email_verified, phone/phone_verified — ride the token as app context,
 * while the display fields (name, preferred_username) are gated behind the
 * `profile` scope. email/phone appear only when set. `picture` is intentionally
 * omitted: the identity-core user has no avatar field. Exported for unit tests.
 */
export function buildTenantIdentityClaims(
  user: UserView | null,
  scope: string,
  avatarBaseUrl?: string,
): Record<string, unknown> {
  if (!user) return {};
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  const claims: Record<string, unknown> = { account_status: user.status };
  if (scopes.has("profile")) {
    claims.name = user.name ?? user.account;
    claims.preferred_username = user.account;
    // picture only when a custom/imported avatar exists; absent → frontend
    // default. Versioned URL (?v=<hash>) = "change avatar = change URL".
    if (user.avatarHash && avatarBaseUrl) {
      claims.picture = `${avatarBaseUrl}/avatar/usr_${user.id}?v=${user.avatarHash}`;
    }
  }
  if (user.email) {
    claims.email = user.email;
    claims.email_verified = false;
  }
  if (user.phone) {
    claims.phone = user.phone;
    claims.phone_verified = true;
  }
  return claims;
}

/** usr_<id> / opr_<id> → <id>. Exported for unit tests. */
export function stripSubPrefix(sub: string): string {
  const i = sub.indexOf("_");
  return i >= 0 ? sub.slice(i + 1) : sub;
}

/** PKCE S256 verification. Exported for unit tests. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

/** Parse a URL, returning null instead of throwing on malformed input. */
function parseUrlOrNull(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}
