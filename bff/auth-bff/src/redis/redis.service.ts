/**
 * redis.service.ts - Redis client for the OIDC IdP (central session + auth code +
 * login challenge + access-token blacklist).
 * @package @vxture/bff-auth
 *
 * Opaque refresh tokens now live in the realm refresh store (TokenService:
 * session.refresh_tokens for tenants, admin.operator_refresh_token for operators),
 * not Redis. Redis key namespace:
 *   {prefix}blacklist:{jti}            → revoked access token (jti)
 *   {prefix}oidc:code:{code}           → OIDC authorization code (TTL set by caller, single-use)
 *   {prefix}oidc:login:{challenge}     → parked authorize request (TTL 10min)
 *   {prefix}sess:{sid} (+ :org)        → OIDC central session + per-client active_org
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { buildAccessTokenBlacklistKey } from "@vxture/core-auth";
import { VxConfigService } from "@vxture/core-config";
import Redis from "ioredis";

// ============================================================================
// Types
// ============================================================================

/** OIDC authorization code payload (vx:oidc:code:{code}, single-use; TTL set by caller). */
export interface OidcAuthCodePayload {
  clientId: string;
  sub: string;
  sid: string;
  realm: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  nonce?: string | undefined;
  activeOrg?: string | undefined;
  /** RFC 8176 amr snapshot — carried code → access token (operator realm). */
  amr?: string[] | undefined;
  authTime: number;
}

/** Base TTL for a parked authorize request (login_challenge). Generous so a user
 *  filling the login page doesn't lose it; the social round-trip re-anchors it
 *  separately (extendOidcLoginChallenge) since provider login+consent is slower. */
const LOGIN_CHALLENGE_TTL_SECONDS = 1200;

/** Parked OIDC authorize request under a login_challenge (vx:oidc:login:{challenge}). */
export interface OidcLoginChallenge {
  clientId: string;
  realm: string;
  redirectUri: string;
  scope: string;
  state?: string | undefined;
  codeChallenge: string;
  nonce?: string | undefined;
  /** active-org hint carried from the authorize request. */
  orgHint?: string | undefined;
}

/**
 * Inbound-broker OAuth state (vx:oauth:state:{state}, ~10min, single-use GETDEL).
 * CSRF guard for the social round-trip; carries the parked login_challenge so the
 * callback can resume the original OIDC authorize after resolving the user.
 */
export interface OauthStatePayload {
  providerCode: string;
  /** the provider callback redirect_uri (must match the one used at exchangeCode) */
  redirectUri: string;
  /** the parked OIDC authorize request to resume on success */
  loginChallenge: string;
}

/**
 * Pending social→phone binding (vx:oauth:bind:{token}, ~10min, single-use).
 * Issued when an upstream returns no phone (e.g. Google): the user must bind a
 * verified phone before the account is resolved/created. Holds the provider
 * profile snapshot + the login_challenge to resume after binding.
 */
export interface OauthBindPayload {
  providerCode: string;
  providerSubject: string;
  email?: string | undefined;
  /** Whether the provider asserts the email is verified (e.g. Google). */
  emailVerified?: boolean | undefined;
  name: string;
  avatar?: string | undefined;
  loginChallenge: string;
}

/**
 * Pending operator MFA challenge (vx:rp:operator:mfa_pending:{token}, ~300s,
 * single-use). Written after the operator's first factor succeeds when a second
 * factor is required (identity-platform-operator.md §3.2); carries the consumed
 * login_challenge snapshot so Step2 can resume the authorize and issue the code.
 */
export interface OperatorMfaPending {
  operatorId: string;
  /** login_challenge snapshot — resume authorize after the second factor. */
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string | undefined;
  codeChallenge: string;
  nonce?: string | undefined;
  /** First factor already cleared (password | email_otp | phone_otp). */
  factor1Method: string;
  /** Failed second-factor attempts on this pending challenge. */
  attempts: number;
  /** Required policy but nothing enrolled → must enroll before verifying. */
  enrollRequired: boolean;
  /** High-privilege: only a WebAuthn passkey satisfies the second factor. */
  webauthnRequired: boolean;
  /** Absolute expiry (epoch seconds). */
  expiresAt: number;
}

/** OIDC central session record (vx:sess:{sid}); per-client active_org lives in vx:sess:{sid}:org. */
export interface OidcCentralSession {
  sub: string;
  realm: string;
  authMethod: string;
  /** RFC 8176 amr (factors cleared) — carried into the access token (§4). */
  amr?: string[] | undefined;
  createdAt: number;
  lastActiveAt: number;
  absExpiresAt: number;
}

// ============================================================================
// RedisService
// ============================================================================

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private prefix!: string;

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const {
      REDIS_URL,
      REDIS_HOST,
      REDIS_PORT,
      REDIS_PASSWORD,
      REDIS_DB,
      REDIS_KEY_PREFIX,
    } = this.config.redis;

    this.prefix = REDIS_KEY_PREFIX ?? "vx:";

    this.client = REDIS_URL
      ? new Redis(REDIS_URL, { lazyConnect: true })
      : new Redis({
          host: REDIS_HOST ?? "localhost",
          port: REDIS_PORT ?? 6379,
          password: REDIS_PASSWORD,
          db: REDIS_DB,
          lazyConnect: true,
        });

    this.client.on("error", (err: Error) => {
      this.logger.warn(`Redis connection error: ${err.message}`);
    });

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.error(`Redis initial connection failed: ${String(err)}`);
      throw new ServiceUnavailableException("Auth session store unavailable");
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(`Redis quit failed: ${String(err)}`);
    }
  }

  private requireReadyClient(): Redis {
    if (this.client.status !== "ready") {
      throw new ServiceUnavailableException("Auth session store unavailable");
    }
    return this.client;
  }

  // ─── jti blacklist (access-token revocation) ──────────────────────────────

  async addToBlacklist(jti: string, ttlSeconds: number): Promise<void> {
    const client = this.requireReadyClient();
    const key = buildAccessTokenBlacklistKey(this.prefix, jti);
    try {
      await client.setex(key, ttlSeconds, "1");
    } catch (err) {
      this.logger.error(`addToBlacklist failed: ${String(err)}`);
      throw new ServiceUnavailableException("Access token revocation failed");
    }
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const client = this.requireReadyClient();
    const key = buildAccessTokenBlacklistKey(this.prefix, jti);
    try {
      const result = await client.exists(key);
      return result === 1;
    } catch (err) {
      this.logger.error(`isBlacklisted check failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "Access token revocation check failed",
      );
    }
  }

  // ─── OIDC: authorization code (vx:oidc:code, single-use) ──────────────────

  async storeOidcAuthCode(
    code: string,
    payload: OidcAuthCodePayload,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:code:${code}`;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(`storeOidcAuthCode failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC authorization code persistence failed",
      );
    }
  }

  async consumeOidcAuthCode(code: string): Promise<OidcAuthCodePayload | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:code:${code}`;
    try {
      const raw = await client.getdel(key);
      return raw ? (JSON.parse(raw) as OidcAuthCodePayload) : null;
    } catch (err) {
      this.logger.error(`consumeOidcAuthCode failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC authorization code verification failed",
      );
    }
  }

  // ─── operator password reset (admin-delegated, single-use, B9-P1b-β) ──────
  //   {prefix}operator:pwreset:{token} → { operatorId }. Short TTL, getdel single-use.
  //   {prefix}operator:pwreset:by-op:{operatorId} → current token (invalidation
  //   pointer, TD-017 §③ hardening / PR #609 security review): a token minted
  //   for an operator that ALREADY has one outstanding immediately invalidates
  //   the older one. Without this, completing reset with a later-mailed token
  //   left an earlier, still-live token silently valid until its own TTL —
  //   letting anyone holding an old mailed link overwrite a password the
  //   operator just (believed they) secured.

  async storeOperatorPasswordReset(
    token: string,
    operatorId: string,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}operator:pwreset:${token}`;
    const ownerKey = `${this.prefix}operator:pwreset:by-op:${operatorId}`;
    try {
      const priorToken = await client.get(ownerKey);
      if (priorToken) {
        await client.del(`${this.prefix}operator:pwreset:${priorToken}`);
      }
      await client.setex(key, ttlSeconds, JSON.stringify({ operatorId }));
      await client.setex(ownerKey, ttlSeconds, token);
    } catch (err) {
      this.logger.error(`storeOperatorPasswordReset failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_reset_persistence_failed",
      );
    }
  }

  /**
   * Single-use consume: returns the operatorId or null (unknown/expired/replayed).
   * Also clears the by-op invalidation pointer IF it still points at this exact
   * token (never clobbers a newer pointer written by a reissue that raced in).
   */
  async consumeOperatorPasswordReset(token: string): Promise<string | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}operator:pwreset:${token}`;
    try {
      const raw = await client.getdel(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { operatorId?: string };
      const operatorId =
        typeof parsed.operatorId === "string" ? parsed.operatorId : null;
      if (operatorId) {
        const ownerKey = `${this.prefix}operator:pwreset:by-op:${operatorId}`;
        const current = await client.get(ownerKey);
        if (current === token) {
          await client.del(ownerKey);
        }
      }
      return operatorId;
    } catch (err) {
      this.logger.error(`consumeOperatorPasswordReset failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_reset_verification_failed",
      );
    }
  }

  // ─── operator self-service contact change (email/phone re-verify, TD-017 §③) ──
  //   {prefix}operator:contact:{operatorId}:{targetType} → { newValue, code, attempts }.
  //   Code sent to the NEW address; verify consumes on match, else counts attempts.

  async storeOperatorContactChange(
    operatorId: string,
    targetType: "email" | "phone",
    newValue: string,
    code: string,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}operator:contact:${operatorId}:${targetType}`;
    try {
      await client.setex(
        key,
        ttlSeconds,
        JSON.stringify({ newValue, code, attempts: 0 }),
      );
    } catch (err) {
      this.logger.error(`storeOperatorContactChange failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_contact_persistence_failed",
      );
    }
  }

  /**
   * Verify a submitted code against the pending contact change. Returns the new
   * value on match (and deletes the pending record), null on no-pending/mismatch.
   * Caps attempts (deletes after 5 wrong tries → forces a fresh code request).
   */
  async verifyOperatorContactChange(
    operatorId: string,
    targetType: "email" | "phone",
    code: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}operator:contact:${operatorId}:${targetType}`;
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        newValue?: string;
        code?: string;
        attempts?: number;
      };
      if (parsed.code === code && typeof parsed.newValue === "string") {
        await client.del(key);
        return parsed.newValue;
      }
      const attempts = (parsed.attempts ?? 0) + 1;
      if (attempts >= 5) {
        await client.del(key);
      } else {
        const ttl = await client.ttl(key);
        await client.setex(
          key,
          ttl > 0 ? ttl : 1,
          JSON.stringify({ ...parsed, attempts }),
        );
      }
      return null;
    } catch (err) {
      this.logger.error(`verifyOperatorContactChange failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_contact_verification_failed",
      );
    }
  }

  // ─── OIDC: login challenge (parked authorize request) ─────────────────────

  async storeOidcLoginChallenge(
    challenge: string,
    payload: OidcLoginChallenge,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:login:${challenge}`;
    try {
      await client.setex(
        key,
        LOGIN_CHALLENGE_TTL_SECONDS,
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger.error(`storeOidcLoginChallenge failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC login challenge persistence failed",
      );
    }
  }

  /**
   * Refresh a parked login challenge's TTL (best-effort). Used by the social
   * round-trip to re-anchor the challenge to the (slower) provider login+consent
   * window so it doesn't expire before the callback. Returns false when the
   * challenge has already expired/been consumed, so the caller can surface a
   * clean "re-login" prompt instead of a confusing post-callback failure.
   */
  async extendOidcLoginChallenge(
    challenge: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:login:${challenge}`;
    try {
      return (await client.expire(key, ttlSeconds)) === 1;
    } catch (err) {
      this.logger.error(`extendOidcLoginChallenge failed: ${String(err)}`);
      return false;
    }
  }

  async consumeOidcLoginChallenge(
    challenge: string,
  ): Promise<OidcLoginChallenge | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:login:${challenge}`;
    try {
      const raw = await client.getdel(key);
      return raw ? (JSON.parse(raw) as OidcLoginChallenge) : null;
    } catch (err) {
      this.logger.error(`consumeOidcLoginChallenge failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC login challenge verification failed",
      );
    }
  }

  async peekOidcLoginChallenge(
    challenge: string,
  ): Promise<OidcLoginChallenge | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:login:${challenge}`;
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as OidcLoginChallenge) : null;
    } catch {
      return null;
    }
  }

  // ─── OAuth inbound broker: state (CSRF) + pending phone-bind ──────────────

  async storeOauthState(
    state: string,
    payload: OauthStatePayload,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oauth:state:${state}`;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(`storeOauthState failed: ${String(err)}`);
      throw new ServiceUnavailableException("OAuth state persistence failed");
    }
  }

  async consumeOauthState(state: string): Promise<OauthStatePayload | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oauth:state:${state}`;
    try {
      const raw = await client.getdel(key);
      return raw ? (JSON.parse(raw) as OauthStatePayload) : null;
    } catch (err) {
      this.logger.error(`consumeOauthState failed: ${String(err)}`);
      throw new ServiceUnavailableException("OAuth state verification failed");
    }
  }

  async storeOauthBind(
    token: string,
    payload: OauthBindPayload,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oauth:bind:${token}`;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(`storeOauthBind failed: ${String(err)}`);
      throw new ServiceUnavailableException("OAuth bind persistence failed");
    }
  }

  async consumeOauthBind(token: string): Promise<OauthBindPayload | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oauth:bind:${token}`;
    try {
      const raw = await client.getdel(key);
      return raw ? (JSON.parse(raw) as OauthBindPayload) : null;
    } catch (err) {
      this.logger.error(`consumeOauthBind failed: ${String(err)}`);
      throw new ServiceUnavailableException("OAuth bind verification failed");
    }
  }

  // ─── operator MFA pending (two-step login, single-use) ────────────────────

  private operatorMfaPendingKey(token: string): string {
    return `${this.prefix}rp:operator:mfa_pending:${token}`;
  }

  /** Store (or overwrite, e.g. attempt bump) a pending operator MFA challenge. */
  async storeOperatorMfaPending(
    token: string,
    payload: OperatorMfaPending,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    try {
      await client.setex(
        this.operatorMfaPendingKey(token),
        ttlSeconds,
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger.error(`storeOperatorMfaPending failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator MFA challenge persistence failed",
      );
    }
  }

  /** Read a pending operator MFA challenge without consuming it; null if gone. */
  async getOperatorMfaPending(
    token: string,
  ): Promise<OperatorMfaPending | null> {
    const client = this.requireReadyClient();
    try {
      const raw = await client.get(this.operatorMfaPendingKey(token));
      return raw ? (JSON.parse(raw) as OperatorMfaPending) : null;
    } catch (err) {
      this.logger.error(`getOperatorMfaPending failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator MFA challenge lookup failed",
      );
    }
  }

  /** Delete a pending operator MFA challenge (on success / lockout / expiry). */
  async deleteOperatorMfaPending(token: string): Promise<void> {
    const client = this.requireReadyClient();
    try {
      await client.del(this.operatorMfaPendingKey(token));
    } catch (err) {
      this.logger.error(`deleteOperatorMfaPending failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator MFA challenge deletion failed",
      );
    }
  }

  // ─── operator WebAuthn registration challenge (single-use, 60s) ───────────

  private operatorWebauthnChallengeKey(operatorId: string): string {
    return `${this.prefix}rp:operator:webauthn_reg:${operatorId}`;
  }

  /** Park a WebAuthn registration challenge for an operator (anti-replay). */
  async storeOperatorWebauthnChallenge(
    operatorId: string,
    challenge: string,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    try {
      await client.setex(
        this.operatorWebauthnChallengeKey(operatorId),
        ttlSeconds,
        challenge,
      );
    } catch (err) {
      this.logger.error(
        `storeOperatorWebauthnChallenge failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        "operator WebAuthn challenge persistence failed",
      );
    }
  }

  /** Consume (read + delete) the WebAuthn challenge; null if missing/expired. */
  async consumeOperatorWebauthnChallenge(
    operatorId: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    try {
      return await client.getdel(this.operatorWebauthnChallengeKey(operatorId));
    } catch (err) {
      this.logger.error(
        `consumeOperatorWebauthnChallenge failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        "operator WebAuthn challenge verification failed",
      );
    }
  }

  private operatorWebauthnAuthChallengeKey(operatorId: string): string {
    return `${this.prefix}rp:operator:webauthn_auth:${operatorId}`;
  }

  /** Park a WebAuthn authentication (assertion) challenge (anti-replay, 60s). */
  async storeOperatorWebauthnAuthChallenge(
    operatorId: string,
    challenge: string,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    try {
      await client.setex(
        this.operatorWebauthnAuthChallengeKey(operatorId),
        ttlSeconds,
        challenge,
      );
    } catch (err) {
      this.logger.error(
        `storeOperatorWebauthnAuthChallenge failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        "operator WebAuthn challenge persistence failed",
      );
    }
  }

  /** Consume (read + delete) the WebAuthn assertion challenge. */
  async consumeOperatorWebauthnAuthChallenge(
    operatorId: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    try {
      return await client.getdel(
        this.operatorWebauthnAuthChallengeKey(operatorId),
      );
    } catch (err) {
      this.logger.error(
        `consumeOperatorWebauthnAuthChallenge failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException(
        "operator WebAuthn challenge verification failed",
      );
    }
  }

  // ─── OIDC: central session (sid) + per-client active_org ──────────────────

  private sessionKey(sid: string): string {
    return `${this.prefix}sess:${sid}`;
  }

  private sessionActiveOrgKey(sid: string): string {
    return `${this.prefix}sess:${sid}:org`;
  }

  /**
   * 建立中央会话。TTL 就是**总时效**——IdP 侧不再有"空闲"这个概念。
   *
   * 原先这里取 `min(idle, abs)`，而 idle 恒小于 abs，于是 abs 从未生效、会话变成
   * 一个固定寿命；配套的 `touchOidcSession` 又全仓零调用点，所以活跃用户照样被踢。
   * 在场判断已移到门户（`startIdleWatcher`，由真实交互事件驱动）。
   */
  async createOidcSession(
    sid: string,
    session: OidcCentralSession,
    absTtlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = this.sessionKey(sid);
    const ttl = absTtlSeconds;
    try {
      await client.hset(key, {
        sub: session.sub,
        realm: session.realm,
        authMethod: session.authMethod,
        amr: JSON.stringify(session.amr ?? []),
        createdAt: String(session.createdAt),
        lastActiveAt: String(session.lastActiveAt),
        absExpiresAt: String(session.absExpiresAt),
      });
      await client.expire(key, ttl);
    } catch (err) {
      this.logger.error(`createOidcSession failed: ${String(err)}`);
      throw new ServiceUnavailableException("OIDC session persistence failed");
    }
  }

  /** Read a central session; null if missing/expired. */
  async getOidcSession(sid: string): Promise<OidcCentralSession | null> {
    const client = this.requireReadyClient();
    try {
      const h = await client.hgetall(this.sessionKey(sid));
      if (!h || !h.sub) return null;
      return {
        sub: h.sub,
        realm: h.realm ?? "",
        authMethod: h.authMethod ?? "",
        amr: h.amr ? (JSON.parse(h.amr) as string[]) : [],
        createdAt: Number(h.createdAt),
        lastActiveAt: Number(h.lastActiveAt),
        absExpiresAt: Number(h.absExpiresAt),
      };
    } catch (err) {
      this.logger.error(`getOidcSession failed: ${String(err)}`);
      throw new ServiceUnavailableException("OIDC session lookup failed");
    }
  }

  /** Set the active_org for a (sid, clientId); aligns the org map TTL to the session. */
  async setOidcActiveOrg(
    sid: string,
    clientId: string,
    orgId: string,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = this.sessionActiveOrgKey(sid);
    try {
      await client.hset(key, clientId, orgId);
      const ttl = await client.ttl(this.sessionKey(sid));
      if (ttl > 0) await client.expire(key, ttl);
    } catch (err) {
      this.logger.error(`setOidcActiveOrg failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC active_org persistence failed",
      );
    }
  }

  /** Get the active_org for a (sid, clientId); null if none. */
  async getOidcActiveOrg(
    sid: string,
    clientId: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    try {
      return (
        (await client.hget(this.sessionActiveOrgKey(sid), clientId)) ?? null
      );
    } catch (err) {
      this.logger.error(`getOidcActiveOrg failed: ${String(err)}`);
      throw new ServiceUnavailableException("OIDC active_org lookup failed");
    }
  }

  /** List clients with a session-scoped active_org under sid (for end_session enumeration). */
  async getOidcSessionClients(sid: string): Promise<string[]> {
    const client = this.requireReadyClient();
    try {
      return await client.hkeys(this.sessionActiveOrgKey(sid));
    } catch (err) {
      this.logger.error(`getOidcSessionClients failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC session client lookup failed",
      );
    }
  }

  /** Destroy a central session (and its per-client active_org map). */
  async deleteOidcSession(sid: string): Promise<void> {
    const client = this.requireReadyClient();
    try {
      await client.del(this.sessionKey(sid), this.sessionActiveOrgKey(sid));
    } catch (err) {
      this.logger.error(`deleteOidcSession failed: ${String(err)}`);
      throw new ServiceUnavailableException("OIDC session deletion failed");
    }
  }
}
