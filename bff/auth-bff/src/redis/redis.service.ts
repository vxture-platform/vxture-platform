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
/**
 * 挂起补齐的时效（30 分钟）。比授权码的 300 秒宽得多——这段时间是**人在填表**，
 * 不是机器在换码；卡在这一步超过半小时，让他从应用重新发起登录更干净。
 */
const PENDING_PROFILE_TTL_SECONDS = 1800;

/** Parked OIDC authorize request under a login_challenge (vx:oidc:login:{challenge}). */
/**
 * 挂起的回跳意图（vx:oidc:pending-profile:{sid}，单次 GETDEL）。
 * 补齐完成后据此发授权码、拼回跳 URL——字段就是 issueAuthCode + appendParams 要的那些。
 */
export interface PendingProfileCompletion {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string | undefined;
  codeChallenge: string;
  nonce?: string | undefined;
  sub: string;
  activeOrg?: string | null | undefined;
}

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
  /** 工作空间提示。交互式登录时要跨过登录页带到发码那一刻,所以存进挑战里。 */
  workspaceHint?: string | undefined;
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

/**
 * 运营者中央会话的一行（在线会话页的数据源）。时间是秒级 epoch，与中央会话同单位。
 * `clients` = 这个会话给哪些 client 发过令牌（登录过哪几个平台）。
 */
export interface OperatorCentralSession {
  sid: string;
  sub: string;
  authMethod: string;
  amr: string[];
  createdAt: number;
  absExpiresAt: number;
  clients: string[];
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

  // ─── OIDC: pending profile completion (注册补齐挂起) ───────────────────────

  /**
   * 新账号注册后、补齐之前挂起的回跳意图（owner 2026-09-08）。
   *
   * 为什么不能先发授权码再让人填表：授权码 TTL 只有 300 秒
   * （OIDC_AUTH_CODE_TTL_SECONDS），而补齐要填账号名、显示名、邮箱三项——填慢一点
   * 码就过期，用户填完反而登不进去。所以会话照常建立（补齐页要靠它认身份），
   * **码留到补齐完成那一刻再发**，这里只挂起发码所需的那点上下文。
   *
   * 键挂在 sid 上：补齐页带的是会话 cookie，除了 sid 没有别的东西可认。
   */
  async storePendingProfileCompletion(
    sid: string,
    payload: PendingProfileCompletion,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:pending-profile:${sid}`;
    try {
      await client.setex(
        key,
        PENDING_PROFILE_TTL_SECONDS,
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger.error(`storePendingProfileCompletion failed: ${String(err)}`);
      throw new ServiceUnavailableException("pending_profile_store_failed");
    }
  }

  /** 单次消费：补齐提交成功后取出并删除，重复提交拿不到第二张码。 */
  async consumePendingProfileCompletion(
    sid: string,
  ): Promise<PendingProfileCompletion | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:pending-profile:${sid}`;
    try {
      const raw = await client.getdel(key);
      return raw ? (JSON.parse(raw) as PendingProfileCompletion) : null;
    } catch (err) {
      this.logger.error(
        `consumePendingProfileCompletion failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException("pending_profile_read_failed");
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

  /**
   * 读挑战但不消耗，Redis 故障照实抛 503。
   *
   * 与 peekOidcLoginChallenge 的区别只在故障：那一个给跨标签页探测用，吞错返回 null
   * 无妨；交互登录进门用这一个——把 Redis 故障说成「挑战不存在」，登录页会把人当作
   * 会话失效送走。
   */
  async readOidcLoginChallenge(
    challenge: string,
  ): Promise<OidcLoginChallenge | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}oidc:login:${challenge}`;
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as OidcLoginChallenge) : null;
    } catch (err) {
      this.logger.error(`readOidcLoginChallenge failed: ${String(err)}`);
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
   * 活跃工作空间的 (sid → clientId → workspaceId) 映射键。
   *
   * 与 org 那把**分开两个键**,不是合成一个 hash:两级各自按应用切换
   * (在 console 切工作空间,不该动 website 那边的任何东西),分开存让每一级的
   * 生命周期与失效各归各的。
   */
  private sessionActiveWorkspaceKey(sid: string): string {
    return `${this.prefix}sess:${sid}:ws`;
  }

  /**
   * 这个中央会话给哪些 client 发过令牌。
   *
   * **与 `:org` 分开是必须的**，不是洁癖：`:org` 只在 customer realm 写入，
   * 把它当客户端清单用，workforce 会话就永远是一份空清单——后端通道登出一次都发
   * 不出去，回跳白名单也永远校验失败。两件事、两个 key。
   */
  private sessionClientsKey(sid: string): string {
    return `${this.prefix}sess:${sid}:clients`;
  }

  /**
   * 运营者（workforce realm）中央会话的索引：有序集合，成员 sid，分值 absExpiresAt。
   *
   * 「谁在线」只能从中央会话回答：刷新令牌链会被并发刷新的重放判定整条吊销，而会话本身
   * 仍在、静默 SSO 照样放行——拿令牌表判在线，登录着的人会显示成不在线。
   */
  private operatorSessionIndexKey(): string {
    return `${this.prefix}opr:sessions`;
  }

  /** 索引上线前已存在的会话补录过一次的标记（补录成功后才写）。 */
  private operatorSessionIndexedKey(): string {
    return `${this.prefix}opr:sessions:indexed`;
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
    if (session.realm === "workforce") {
      try {
        await client.zadd(
          this.operatorSessionIndexKey(),
          session.absExpiresAt,
          sid,
        );
      } catch (err) {
        /* 进不了索引不该挡住登录；代价是在线会话页漏掉这一个，所以留 error 日志。 */
        this.logger.error(`operator session index add failed: ${String(err)}`);
      }
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

  /**
   * 记住这个 (sid, clientId) 选中的工作空间;TTL 跟着会话。
   *
   * 与 active_org 同形,但**失败不抛**:工作空间选择是个便利,记不住的后果是
   * 下次回到默认;active_org 记不住的后果是进错租户,所以那边要抛。
   */
  async setOidcActiveWorkspace(
    sid: string,
    clientId: string,
    workspaceId: string,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const key = this.sessionActiveWorkspaceKey(sid);
    try {
      await client.hset(key, clientId, workspaceId);
      const ttl = await client.ttl(this.sessionKey(sid));
      if (ttl > 0) await client.expire(key, ttl);
    } catch (err) {
      this.logger.error(`setOidcActiveWorkspace failed: ${String(err)}`);
    }
  }

  /** 读这个 (sid, clientId) 选中的工作空间;没有 / 读不到都给 null(退回默认)。 */
  async getOidcActiveWorkspace(
    sid: string,
    clientId: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    try {
      return (
        (await client.hget(this.sessionActiveWorkspaceKey(sid), clientId)) ??
        null
      );
    } catch (err) {
      this.logger.error(`getOidcActiveWorkspace failed: ${String(err)}`);
      return null;
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

  /**
   * 记下这个中央会话给某个 client 发过令牌。TTL 对齐会话。
   *
   * 挂在发码那一刻：交互登录和静默 SSO 都必经 issueAuthCode，所以两条路进来的
   * client 都会被记上——这正是此前缺的那一半（靠 active_org 推断的话，静默 SSO
   * 进来的 client 一个都记不上）。
   */
  async addOidcSessionClient(sid: string, clientId: string): Promise<void> {
    const client = this.requireReadyClient();
    const key = this.sessionClientsKey(sid);
    try {
      await client.sadd(key, clientId);
      const ttl = await client.ttl(this.sessionKey(sid));
      if (ttl > 0) await client.expire(key, ttl);
    } catch (err) {
      /* 记不上不该挡住登录本身。代价是这个 client 收不到后端通道登出——
         所以要留一条 error 级日志，而不是静默吞掉。 */
      this.logger.error(`addOidcSessionClient failed: ${String(err)}`);
    }
  }

  /** 这个中央会话发过令牌的所有 client（end_session 枚举 + 后端通道登出的收件人）。 */
  async getOidcSessionClients(sid: string): Promise<string[]> {
    const client = this.requireReadyClient();
    try {
      return await client.smembers(this.sessionClientsKey(sid));
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
      await client.del(
        this.sessionKey(sid),
        this.sessionActiveOrgKey(sid),
        this.sessionClientsKey(sid),
      );
      await client.zrem(this.operatorSessionIndexKey(), sid);
    } catch (err) {
      this.logger.error(`deleteOidcSession failed: ${String(err)}`);
      throw new ServiceUnavailableException("OIDC session deletion failed");
    }
  }

  // ─── 运营者中央会话：在线会话列表 ─────────────────────────────────────────

  /**
   * 列出仍然有效的运营者中央会话。过期成员先按分值剪掉；中央会话已不在（被删、
   * TTL 到期）的成员顺手移出索引。
   */
  async listOperatorSessions(): Promise<OperatorCentralSession[]> {
    const client = this.requireReadyClient();
    const index = this.operatorSessionIndexKey();
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.backfillOperatorSessionIndex(client);
      await client.zremrangebyscore(index, "-inf", now);
      const sids = await client.zrange(index, 0, -1);
      if (sids.length === 0) return [];

      const pipeline = client.pipeline();
      for (const sid of sids) {
        pipeline.hgetall(this.sessionKey(sid));
        pipeline.smembers(this.sessionClientsKey(sid));
      }
      const replies = (await pipeline.exec()) ?? [];
      const sessions: OperatorCentralSession[] = [];
      const gone: string[] = [];
      sids.forEach((sid, i) => {
        const [hashErr, hash] = replies[i * 2] ?? [null, null];
        const [clientsErr, clients] = replies[i * 2 + 1] ?? [null, null];
        if (hashErr) throw hashErr;
        if (clientsErr) throw clientsErr;
        const h = (hash ?? {}) as Record<string, string>;
        if (!h.sub || h.realm !== "workforce") {
          gone.push(sid);
          return;
        }
        sessions.push({
          sid,
          sub: h.sub,
          authMethod: h.authMethod ?? "",
          amr: h.amr ? (JSON.parse(h.amr) as string[]) : [],
          createdAt: Number(h.createdAt),
          absExpiresAt: Number(h.absExpiresAt),
          clients: Array.isArray(clients) ? (clients as string[]) : [],
        });
      });
      if (gone.length > 0) await client.zrem(index, ...gone);
      return sessions;
    } catch (err) {
      this.logger.error(`listOperatorSessions failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "OIDC operator session lookup failed",
      );
    }
  }

  /**
   * 索引上线之前建立的会话不在索引里。第一次列出时扫一遍中央会话键补进去，成功后
   * 写标记，之后不再扫（新会话在 createOidcSession 里入索引）。并发补录无害：zadd 幂等。
   */
  private async backfillOperatorSessionIndex(client: Redis): Promise<void> {
    if ((await client.exists(this.operatorSessionIndexedKey())) === 1) return;
    const head = `${this.prefix}sess:`;
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        `${head}*`,
        "COUNT",
        500,
      );
      cursor = next;
      /* 只要 sess:{sid} 本身，不要 :org / :ws / :clients 这些附属键。 */
      const sessionKeys = keys.filter(
        (key) => !key.slice(head.length).includes(":"),
      );
      if (sessionKeys.length === 0) continue;
      const read = client.pipeline();
      for (const key of sessionKeys) read.hmget(key, "realm", "absExpiresAt");
      const replies = (await read.exec()) ?? [];
      const add = client.pipeline();
      let pending = 0;
      sessionKeys.forEach((key, i) => {
        const [err, fields] = replies[i] ?? [null, null];
        if (err) throw err;
        const [realm, absExpiresAt] = (fields ?? []) as (string | null)[];
        if (realm !== "workforce" || !absExpiresAt) return;
        add.zadd(
          this.operatorSessionIndexKey(),
          Number(absExpiresAt),
          key.slice(head.length),
        );
        pending += 1;
      });
      if (pending > 0) await add.exec();
    } while (cursor !== "0");
    await client.set(this.operatorSessionIndexedKey(), "1");
  }
}
