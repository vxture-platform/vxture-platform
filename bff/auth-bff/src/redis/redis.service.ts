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
import { createHash, randomUUID } from "node:crypto";
import type { OidcSessionStatus } from "../oidc/session-status";

/** Encrypted enrollment staged separately from the active workforce factor. */
export interface OperatorTotpPending {
  secret: string;
  previousSecret: string | null;
  previousEnabled: boolean;
  initialOnly: boolean;
}

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
  /** A focus/resume probe must never bypass an explicit interactive prompt. */
  requiresReauthentication?: boolean;
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
  /** Present only for proof-authorized customer self-service linking. */
  link?: { userId: string; sid: string };
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
  credentialVersion?: string;
  authenticationVersion?: string;
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
  authenticationVersion?: string | undefined;
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

  /** Store a realm-namespaced, expiring, first-party ceremony. */
  async createAccountReauthentication(
    id: string,
    value: string,
  ): Promise<boolean> {
    return (
      (await this.client.set(
        `${this.prefix}accounts:reauth:${id}`,
        value,
        "EX",
        300,
        "NX",
      )) === "OK"
    );
  }

  async readAccountReauthentication(id: string): Promise<string | null> {
    return this.client.get(`${this.prefix}accounts:reauth:${id}`);
  }

  async swapAccountReauthentication(
    id: string,
    expected: string,
    replacement: string | null,
  ): Promise<boolean> {
    const script = `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      if ARGV[2] == '' then redis.call('DEL', KEYS[1])
      else redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') end
      return 1`;
    return (
      Number(
        await this.client.eval(
          script,
          1,
          `${this.prefix}accounts:reauth:${id}`,
          expected,
          replacement ?? "",
        ),
      ) === 1
    );
  }

  async storeAccountsCeremony(
    token: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.requireReadyClient().set(
      `${this.prefix}accounts:ceremony:${token}`,
      JSON.stringify({ ...data, attempts: 0 }),
      "EX",
      300,
      "NX",
    );
  }

  /** Reserve one attempt atomically, keeping the original expiry. */
  async attemptAccountsCeremony(token: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/.test(token)) return null;
    const raw = await this.requireReadyClient().eval(
      `local raw=redis.call('GET',KEYS[1]); if not raw then return nil end
       local data=cjson.decode(raw); if data.attempts>=5 then redis.call('DEL',KEYS[1]); return nil end
       data.attempts=data.attempts+1; local next=cjson.encode(data)
       redis.call('SET',KEYS[1],next,'KEEPTTL'); return next`,
      1,
      `${this.prefix}accounts:ceremony:${token}`,
    );
    return typeof raw === "string" ? raw : null;
  }

  /** Only the most recently reserved attempt can consume the ceremony. */
  async consumeAccountsCeremony(
    token: string,
    version: string,
  ): Promise<boolean> {
    return (
      (await this.requireReadyClient().eval(
        `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; return redis.call('DEL',KEYS[1])`,
        1,
        `${this.prefix}accounts:ceremony:${token}`,
        version,
      )) === 1
    );
  }

  private requireReadyClient(): Redis {
    if (this.client.status !== "ready") {
      throw new ServiceUnavailableException("Auth session store unavailable");
    }
    return this.client;
  }

  // ============================================================================
  // Workforce TOTP ceremonies
  // ============================================================================

  /** Bound provider traffic per source IP without storing raw IP addresses. */
  async reserveCaptchaVerification(ip: string): Promise<boolean> {
    const key = `${this.prefix}captcha:rate:${createHash("sha256").update(ip).digest("hex")}`;
    const count = await this.requireReadyClient().eval(
      `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return n`,
      1,
      key,
    );
    return typeof count === "number" && count <= 30;
  }

  /** Reserve the provider ceremony before I/O; duplicate/concurrent proofs fail closed. */
  async reserveCaptchaCeremony(scene: string, id: string): Promise<boolean> {
    const digest = createHash("sha256").update(`${scene}:${id}`).digest("hex");
    return (
      (await this.requireReadyClient().set(
        `${this.prefix}captcha:ceremony:${digest}`,
        "1",
        "EX",
        600,
        "NX",
      )) === "OK"
    );
  }

  /** Store an opaque two-minute local proof; raw SDK material is never persisted. */
  async storeCaptchaProof(
    token: string,
    realm: "customer" | "workforce",
  ): Promise<void> {
    await this.requireReadyClient().setex(
      `${this.prefix}captcha:proof:${token}`,
      120,
      realm,
    );
  }

  /** Atomic compare-and-delete prevents replay and cross-realm consumption. */
  async consumeCaptchaProof(
    token: string,
    realm: "customer" | "workforce",
  ): Promise<boolean> {
    return (
      (await this.requireReadyClient().eval(
        `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])`,
        1,
        `${this.prefix}captcha:proof:${token}`,
        realm,
      )) === 1
    );
  }

  private operatorTotpKey(operatorId: string, context: string): string {
    const digest = createHash("sha256").update(context).digest("hex");
    return `${this.prefix}operator:totp:${operatorId}:${digest}`;
  }

  /** Stage encrypted material for five minutes without touching the active factor. */
  async storeOperatorTotpPending(
    operatorId: string,
    context: string,
    pending: OperatorTotpPending,
  ): Promise<boolean> {
    const stored = await this.requireReadyClient().set(
      this.operatorTotpKey(operatorId, context),
      JSON.stringify({ ...pending, attempts: 0 }),
      "EX",
      300,
      "NX",
    );
    return stored === "OK";
  }

  /** Atomically reserve one of five confirmation attempts while preserving expiry. */
  async attemptOperatorTotpPending(
    operatorId: string,
    context: string,
  ): Promise<{ pending: OperatorTotpPending; version: string } | null> {
    const raw = await this.requireReadyClient().eval(
      `local raw = redis.call('GET', KEYS[1])
       if not raw then return nil end
       local pending = cjson.decode(raw)
       if pending.attempts >= 5 then redis.call('DEL', KEYS[1]); return nil end
       pending.attempts = pending.attempts + 1
       local updated = cjson.encode(pending)
       redis.call('SET', KEYS[1], updated, 'KEEPTTL')
       return updated`,
      1,
      this.operatorTotpKey(operatorId, context),
    );
    if (typeof raw !== "string") return null;
    return { pending: JSON.parse(raw) as OperatorTotpPending, version: raw };
  }

  /** Only the latest reserved attempt may consume a ceremony, exactly once. */
  async consumeOperatorTotpPending(
    operatorId: string,
    context: string,
    version: string,
  ): Promise<boolean> {
    const result = await this.requireReadyClient().eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       return redis.call('DEL', KEYS[1])`,
      1,
      this.operatorTotpKey(operatorId, context),
      version,
    );
    return result === 1;
  }

  /** Account-wide budget bounds password/current-factor guesses across sessions. */
  async reserveOperatorMfaStepUp(operatorId: string): Promise<boolean> {
    const count = await this.requireReadyClient().eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], 900) end
       return n`,
      1,
      `${this.prefix}operator:mfa-step-up:${operatorId}`,
    );
    return typeof count === "number" && count <= 5;
  }

  // ============================================================================
  // Workforce phone-change ceremonies (independent of email changes)
  // ============================================================================

  /**
   * Stage a phone change before sending. One start per account per minute bounds
   * retries across sessions. The nonce prevents an older request consuming a resend.
   * @returns The opaque pending version, or null when the send budget is exhausted.
   * @throws {Error} When Redis is unavailable.
   */
  async beginOperatorPhoneChange(
    operatorId: string,
    sid: string,
    phone: string,
  ): Promise<string | null> {
    const pending = JSON.stringify({
      sidHash: createHash("sha256").update(sid).digest("hex"),
      phone,
      nonce: randomUUID(),
      attempts: 0,
      phase: "sending",
    });
    const result = await this.requireReadyClient().eval(
      `if not redis.call('SET', KEYS[2], '1', 'EX', 60, 'NX') then return nil end
       redis.call('SET', KEYS[1], ARGV[1], 'EX', 300)
       return ARGV[1]`,
      2,
      `${this.prefix}operator:phone-change:${operatorId}`,
      `${this.prefix}operator:phone-change-budget:${operatorId}`,
      pending,
    );
    return typeof result === "string" ? result : null;
  }

  /**
   * Reserve one attempt only for the issuing account, session and target phone.
   * A verifying record excludes concurrent provider checks until completed or expired.
   * @returns The reserved version, or null for invalid, busy or exhausted ceremonies.
   * @throws {Error} When Redis is unavailable.
   */
  async attemptOperatorPhoneChange(
    operatorId: string,
    sid: string,
    phone: string,
  ): Promise<string | null> {
    const result = await this.requireReadyClient().eval(
      `local raw = redis.call('GET', KEYS[1])
       if not raw then return nil end
       local pending = cjson.decode(raw)
       if pending.sidHash ~= ARGV[1] or pending.phone ~= ARGV[2] or pending.phase ~= 'ready' then return nil end
       if pending.attempts >= 5 then redis.call('DEL', KEYS[1]); return nil end
       pending.attempts = pending.attempts + 1
       pending.phase = 'verifying'
       local updated = cjson.encode(pending)
       redis.call('SET', KEYS[1], updated, 'KEEPTTL')
       return updated`,
      1,
      `${this.prefix}operator:phone-change:${operatorId}`,
      createHash("sha256").update(sid).digest("hex"),
      phone,
    );
    return typeof result === "string" ? result : null;
  }

  /**
   * Compare before consuming or releasing a pending send/check. Expiry and resends
   * invalidate in-flight results; releasing never extends the original lifetime.
   * @returns Whether this request still owns the pending version.
   * @throws {Error} When Redis is unavailable.
   */
  async finishOperatorPhoneChange(
    operatorId: string,
    version: string,
    consume: boolean,
  ): Promise<boolean> {
    const result = await this.requireReadyClient().eval(
      `local raw = redis.call('GET', KEYS[1])
       if not raw or raw ~= ARGV[1] then return 0 end
       if ARGV[2] == '1' then return redis.call('DEL', KEYS[1]) end
       local pending = cjson.decode(raw)
       if pending.attempts >= 5 then return redis.call('DEL', KEYS[1]) end
       pending.phase = 'ready'
       redis.call('SET', KEYS[1], cjson.encode(pending), 'KEEPTTL')
       return 1`,
      1,
      `${this.prefix}operator:phone-change:${operatorId}`,
      version,
      consume ? "1" : "0",
    );
    return result === 1;
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
    proof: { operatorId: string; email: string; credentialVersion: string },
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.requireReadyClient();
    const ownerKey = `${this.prefix}operator:pwreset:by-op:${proof.operatorId}`;
    const tokenPrefix = `${this.prefix}operator:pwreset:`;
    try {
      await client.eval(
        `
        local prior=redis.call('GET',KEYS[1])
        if prior then redis.call('DEL',ARGV[1]..prior) end
        redis.call('SET',ARGV[1]..ARGV[2],ARGV[3],'EX',ARGV[4])
        redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[4])
        return 1`,
        1,
        ownerKey,
        tokenPrefix,
        token,
        JSON.stringify(proof),
        ttlSeconds,
      );
    } catch (err) {
      this.logger.error(`storeOperatorPasswordReset failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_reset_persistence_failed",
      );
    }
  }

  /** Consume only the latest issued, well-formed recovery binding atomically. */
  async consumeOperatorPasswordReset(token: string): Promise<{
    operatorId: string;
    email: string;
    credentialVersion: string;
  } | null> {
    const client = this.requireReadyClient();
    try {
      const raw = await client.eval(
        `
        local raw=redis.call('GET',KEYS[1])
        if not raw then return nil end
        local ok,proof=pcall(cjson.decode,raw)
        redis.call('DEL',KEYS[1])
        if not ok or type(proof)~='table' or type(proof.operatorId)~='string'
          or type(proof.email)~='string' or type(proof.credentialVersion)~='string' then return nil end
        local owner=ARGV[1]..proof.operatorId
        if redis.call('GET',owner)~=ARGV[2] then return nil end
        redis.call('DEL',owner)
        return raw`,
        1,
        `${this.prefix}operator:pwreset:${token}`,
        `${this.prefix}operator:pwreset:by-op:`,
        token,
      );
      if (typeof raw !== "string") return null;
      const proof = JSON.parse(raw) as {
        operatorId: string;
        email: string;
        credentialVersion: string;
      };
      return /^[a-f0-9]{64}$/.test(proof.credentialVersion) &&
        !!proof.email &&
        !!proof.operatorId
        ? proof
        : null;
    } catch (err) {
      this.logger.error(`consumeOperatorPasswordReset failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        "operator_reset_verification_failed",
      );
    }
  }

  // ============================================================================
  // Session-bound workforce email changes with atomic verification
  // ============================================================================

  /**
   * Stage before delivery; one send per account/minute across all sessions.
   * @param operatorId - Authenticated workforce account identifier.
   * @param sid - Issuing workforce central session.
   * @param email - Normalized destination verified by this ceremony.
   * @param code - Code to hash before storing.
   * @returns Pending version or null when the send budget is exhausted.
   * @throws {Error} When Redis is unavailable.
   */
  async beginOperatorEmailChange(
    operatorId: string,
    sid: string,
    email: string,
    code: string,
  ): Promise<string | null> {
    const nonce = randomUUID();
    const pending = JSON.stringify({
      sidHash: createHash("sha256").update(sid).digest("hex"),
      email,
      nonce,
      digest: createHash("sha256").update(`${nonce}:${code}`).digest("hex"),
      attempts: 0,
      phase: "sending",
    });
    const result = await this.requireReadyClient().eval(
      `if not redis.call('SET', KEYS[2], '1', 'EX', 60, 'NX') then return nil end
       redis.call('SET', KEYS[1], ARGV[1], 'EX', 600)
       return ARGV[1]`,
      2,
      `${this.prefix}operator:email-change:${operatorId}`,
      `${this.prefix}operator:email-change-budget:${operatorId}`,
      pending,
    );
    return typeof result === "string" ? result : null;
  }

  /**
   * Activate or discard only the exact version whose delivery just finished.
   * @param operatorId - Account owning the pending ceremony.
   * @param version - Version returned before delivery.
   * @param discard - Whether delivery failed and the version must be removed.
   * @returns Whether this version still owns the pending ceremony.
   * @throws {Error} When Redis is unavailable.
   */
  async finishOperatorEmailChange(
    operatorId: string,
    version: string,
    discard: boolean,
  ): Promise<boolean> {
    const result = await this.requireReadyClient().eval(
      `local raw = redis.call('GET', KEYS[1])
       if not raw or raw ~= ARGV[1] then return 0 end
       if ARGV[2] == '1' then return redis.call('DEL', KEYS[1]) end
       local pending = cjson.decode(raw)
       pending.phase = 'ready'
       redis.call('SET', KEYS[1], cjson.encode(pending), 'KEEPTTL')
       return 1`,
      1,
      `${this.prefix}operator:email-change:${operatorId}`,
      version,
      discard ? "1" : "0",
    );
    return result === 1;
  }

  /**
   * Atomically consume a session-bound proof; wrong codes retain the original TTL.
   * @param operatorId - Authenticated workforce account identifier.
   * @param sid - Session that issued the pending ceremony.
   * @param code - Submitted six-digit code.
   * @returns Verified destination or null for a rejected proof.
   * @throws {Error} When Redis or its stored payload is unavailable/invalid.
   */
  async consumeOperatorEmailChange(
    operatorId: string,
    sid: string,
    code: string,
  ): Promise<string | null> {
    const client = this.requireReadyClient();
    const key = `${this.prefix}operator:email-change:${operatorId}`;
    const raw = await client.get(key);
    if (!raw) return null;
    const pending = JSON.parse(raw) as { nonce: string };
    const digest = createHash("sha256")
      .update(`${pending.nonce}:${code}`)
      .digest("hex");
    const result = await client.eval(
      `local raw = redis.call('GET', KEYS[1])
       if not raw or raw ~= ARGV[1] then return nil end
       local pending = cjson.decode(raw)
       if pending.sidHash ~= ARGV[2] or pending.phase ~= 'ready' then return nil end
       if pending.digest == ARGV[3] then
         redis.call('DEL', KEYS[1]); return pending.email
       end
       pending.attempts = pending.attempts + 1
       if pending.attempts >= 5 then redis.call('DEL', KEYS[1])
       else redis.call('SET', KEYS[1], cjson.encode(pending), 'KEEPTTL') end
       return nil`,
      1,
      key,
      raw,
      createHash("sha256").update(sid).digest("hex"),
      digest,
    );
    return typeof result === "string" ? result : null;
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

  /** Read a pending binding before spending an SMS attempt or dispatching a code. */
  async readOauthBind(token: string): Promise<OauthBindPayload | null> {
    const raw = await this.requireReadyClient().get(
      `${this.prefix}oauth:bind:${token}`,
    );
    return raw ? (JSON.parse(raw) as OauthBindPayload) : null;
  }

  // ============================================================================
  // Customer SMS ceremonies: purpose + normalized phone + optional binding owner
  // ============================================================================

  /** Reserve bounded security requests before any delivery or password hashing. */
  async reserveCustomerSecurityBudget(
    bucket: string,
    limits = [1, 5, 20],
  ): Promise<boolean> {
    const hash = createHash("sha256").update(bucket).digest("hex");
    return (
      (await this.requireReadyClient().eval(
        `
local ttls={60,3600,86400}
for i=1,3 do if tonumber(redis.call('GET',KEYS[i]) or '0') >= tonumber(ARGV[i]) then return 0 end end
for i=1,3 do local n=redis.call('INCR',KEYS[i]); if n==1 then redis.call('EXPIRE',KEYS[i],ttls[i]) end end
return 1`,
        3,
        ...["m", "h", "d"].map(
          (window) =>
            `${this.prefix}customer-security:budget:${hash}:${window}`,
        ),
        ...limits,
      )) === 1
    );
  }

  /** Create a random-token ceremony with a fixed absolute lifetime. */
  async createCustomerSecurity(id: string, value: string): Promise<boolean> {
    return (
      (await this.requireReadyClient().set(
        this.customerSecurityKey(id),
        value,
        "EX",
        600,
        "NX",
      )) === "OK"
    );
  }

  /** Read a ceremony without extending its lifetime. */
  async readCustomerSecurity(id: string): Promise<string | null> {
    return this.requireReadyClient().get(this.customerSecurityKey(id));
  }

  /** Compare-and-swap or consume the exact ceremony; expiry never gets renewed. */
  async swapCustomerSecurity(
    id: string,
    expected: string,
    next: string | null,
  ): Promise<boolean> {
    return (
      (await this.requireReadyClient().eval(
        `
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') end
return 1`,
        1,
        this.customerSecurityKey(id),
        expected,
        next ?? "",
      )) === 1
    );
  }

  private customerSecurityKey(id: string): string {
    return `${this.prefix}customer-security:ceremony:${createHash("sha256").update(id).digest("hex")}`;
  }

  private customerCodeKey(
    purpose: string,
    phone: string,
    _context: string,
  ): string {
    const hash = createHash("sha256")
      .update(JSON.stringify([purpose, phone]))
      .digest("hex");
    return `${this.prefix}customer-code:${hash}`;
  }

  /** Reserve aggregate phone send budgets and replace this purpose's ceremony. */
  async beginCustomerCode(
    purpose: string,
    phone: string,
    context: string,
    owner: string,
  ): Promise<boolean> {
    const phoneHash = createHash("sha256").update(phone).digest("hex");
    return (
      (await this.requireReadyClient().eval(
        `
local limits = {1, 5, 10}
local ttls = {60, 3600, 86400}
for i=1,3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i] then return 0 end
end
for i=1,3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], ttls[i]) end
end
redis.call('HSET', KEYS[4], 'owner', ARGV[1], 'phase', 'sending', 'attempts', 0, 'context', ARGV[2])
redis.call('EXPIRE', KEYS[4], 300)
return 1`,
        4,
        `${this.prefix}customer-code:rl:1m:${phoneHash}`,
        `${this.prefix}customer-code:rl:1h:${phoneHash}`,
        `${this.prefix}customer-code:rl:1d:${phoneHash}`,
        this.customerCodeKey(purpose, phone, context),
        owner,
        createHash("sha256").update(context).digest("hex"),
      )) === 1
    );
  }

  /** Transition only the dispatch owned by this request; expired/resend results cannot reactivate it. */
  async finishCustomerCodeSend(
    purpose: string,
    phone: string,
    context: string,
    owner: string,
    success: boolean,
  ): Promise<boolean> {
    return (
      (await this.requireReadyClient().eval(
        `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'phase') ~= 'sending' then return 0 end
if ARGV[2] == '1' then redis.call('HSET', KEYS[1], 'phase', 'ready'); return 1 end
return redis.call('DEL', KEYS[1])`,
        1,
        this.customerCodeKey(purpose, phone, context),
        owner,
        success ? "1" : "0",
      )) === 1
    );
  }

  /** Acquire one of five attempts, excluding concurrent provider checks. */
  async acquireCustomerCode(
    purpose: string,
    phone: string,
    context: string,
  ): Promise<string | null> {
    const owner = await this.requireReadyClient().eval(
      `
if redis.call('HGET', KEYS[1], 'phase') ~= 'ready' or redis.call('HGET', KEYS[1], 'context') ~= ARGV[1] then return '' end
if tonumber(redis.call('HGET', KEYS[1], 'attempts') or '5') >= 5 then redis.call('DEL', KEYS[1]); return '' end
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
redis.call('HSET', KEYS[1], 'phase', 'verifying')
return redis.call('HGET', KEYS[1], 'owner')`,
      1,
      this.customerCodeKey(purpose, phone, context),
      createHash("sha256").update(context).digest("hex"),
    );
    return typeof owner === "string" && owner ? owner : null;
  }

  /** A successful check consumes the ceremony atomically; failures keep only the remaining budget. */
  async finishCustomerCodeCheck(
    purpose: string,
    phone: string,
    context: string,
    owner: string,
    success: boolean,
  ): Promise<boolean> {
    return (
      (await this.requireReadyClient().eval(
        `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'phase') ~= 'verifying' then return 0 end
if ARGV[2] == '1' then redis.call('DEL', KEYS[1]); return 1 end
if tonumber(redis.call('HGET', KEYS[1], 'attempts')) >= 5 then redis.call('DEL', KEYS[1])
else redis.call('HSET', KEYS[1], 'phase', 'ready') end
return 0`,
        1,
        this.customerCodeKey(purpose, phone, context),
        owner,
        success ? "1" : "0",
      )) === 1
    );
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
        authenticationVersion: session.authenticationVersion ?? "",
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
        authenticationVersion: h.authenticationVersion || undefined,
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

  /**
   * Atomically verify a session, its realm and the client binding.
   * `active` records observed activity but never extends the absolute TTL.
   * @throws {ServiceUnavailableException} For store errors or corrupt metadata.
   */
  async checkOidcSessionStatus(
    sid: string,
    clientId: string,
    realm: string,
    active: boolean,
  ): Promise<OidcSessionStatus> {
    const client = this.requireReadyClient();
    const script = `
      local session = KEYS[1]
      local clients = KEYS[2]
      if redis.call('EXISTS', session) == 0 then return {0} end
      local fields = redis.call('HMGET', session, 'sub', 'realm', 'absExpiresAt', 'lastActiveAt')
      local expiry = tonumber(fields[3])
      local last = tonumber(fields[4])
      local ttl = redis.call('PTTL', session)
      if not fields[1] or fields[1] == '' or not fields[2]
          or (fields[2] ~= 'customer' and fields[2] ~= 'workforce')
          or not expiry or expiry < 1 or expiry > 9007199254740991
          or expiry ~= math.floor(expiry)
          or not last or last < 0 or last > 9007199254740991
          or last ~= math.floor(last) or ttl == -1 then return {-1} end
      local current = tonumber(redis.call('TIME')[1])
      if ttl <= 0 or current >= expiry then return {0} end
      if fields[2] ~= ARGV[2] then return {0} end
      if redis.call('SISMEMBER', clients, ARGV[1]) ~= 1 then return {0} end
      if ARGV[3] == '1' then
        if current > last then redis.call('HSET', session, 'lastActiveAt', current) end
      end
      return {1, math.min(current + 300, expiry, current + math.floor(ttl / 1000))}
    `;
    try {
      const raw: unknown = await client.eval(
        script,
        2,
        this.sessionKey(sid),
        this.sessionClientsKey(sid),
        clientId,
        realm,
        active ? "1" : "0",
      );
      if (Array.isArray(raw)) {
        if (raw.length === 1 && raw[0] === 0) return { valid: false };
        if (
          raw.length === 2 &&
          raw[0] === 1 &&
          Number.isSafeInteger(raw[1]) &&
          raw[1] > 0
        ) {
          return { valid: true, next_check_at: raw[1] as number };
        }
      }
      throw new Error("Invalid session status result");
    } catch {
      // Never log Redis command arguments, which include the session id.
      this.logger.error("OIDC session status lookup failed");
      throw new ServiceUnavailableException("OIDC session status unavailable");
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
