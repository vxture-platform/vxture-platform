/**
 * rp-session.store.ts - server-side RP session storage (Redis)
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category persistence
 * @author AI-Generated
 * @date 2026-11-24
 * @description
 *   Stores the OIDC token set server-side, keyed by an opaque rpsid (the value
 *   of the browser's __Host-vx_rp_session cookie). A sid→rpsid index supports
 *   OIDC back-channel logout (kill all RP sessions under an IdP central sid).
 *   Keys are namespaced per client_id. See identity-platform-rp-integration.md §3 / §9.
 *
 *   Tokens never leave this layer for the browser.
 */
import type { RpSession } from "./types";
import {
  CREATE_SESSION,
  UPDATE_SESSION,
  REVOKE_SESSION,
  LOCK_REFRESH,
  RELEASE_REFRESH,
  DESTROY_UNCHANGED_SESSION,
} from "./rp-session.scripts";

/** Narrow subset of ioredis used here (keeps the store unit-testable). */
export interface RpRedis {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  /** Required only when the host exposes a connection bounded by session lifetime. */
  pttl?(key: string): Promise<number>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
}

/** Durable revocation and request-time recovery supplied by the hosting BFF. */
export interface RpSessionAuthority {
  /** Return false only for confirmed invalidity; outages must throw. */
  accepts(session: RpSession): Promise<boolean>;
  /** Commit an irreversible receipt before the logout can be acknowledged. */
  revoke(sid: string): Promise<void>;
}

// ============================================================================
// Storage and expiry bounds
// ============================================================================

export class RpSessionStore {
  /**
   * @param redis    ioredis-compatible client
   * @param clientId RP client_id (key namespace)
   * @param prefix   global key prefix (default "vx:")
   * @param maxSessionTtlSec Maximum lifetime also used to retain revocation fences.
   * @param authority Optional durable revocation and startup recovery adapter.
   * @throws RangeError if the configured lifetime is not a positive safe integer.
   */
  constructor(
    private readonly redis: RpRedis,
    private readonly clientId: string,
    private readonly prefix = "vx:",
    private readonly maxSessionTtlSec = 86400,
    private readonly authority?: RpSessionAuthority,
  ) {
    this.assertTtl(maxSessionTtlSec);
  }

  private assertTtl(ttl: number): void {
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > this.maxSessionTtlSec)
      throw new RangeError("RP session TTL is outside the configured lifetime");
  }

  private revokedKey(sid: string): string {
    return `${this.prefix}rp:${this.clientId}:revoked:${sid}`;
  }

  private lockKey(rpsid: string): string {
    return `${this.prefix}rp:${this.clientId}:refresh:${rpsid}`;
  }

  private sessKey(rpsid: string): string {
    return `${this.prefix}rp:${this.clientId}:sess:${rpsid}`;
  }

  private sidIndexKey(sid: string): string {
    return `${this.prefix}rp:${this.clientId}:sididx:${sid}`;
  }

  /**
   * Persist a new session and its sid index atomically.
   * @param rpsid New, randomly generated local session identifier.
   * @param session Verified central identity and server-side token set.
   * @param ttlSeconds Initial absolute lifetime within the configured maximum.
   * @returns Resolves after both the session and index have been written.
   * @throws Error if the sid was revoked or the rpsid already exists.
   */
  async create(
    rpsid: string,
    session: RpSession,
    ttlSeconds: number,
  ): Promise<void> {
    this.assertTtl(ttlSeconds);
    if (!rpsid || !session.sid || !session.sub)
      throw new Error("RP session identity is required");
    if (this.authority && !(await this.authority.accepts(session)))
      throw new Error("RP session authority rejected creation");
    const created = await this.redis.eval(
      CREATE_SESSION,
      3,
      this.sessKey(rpsid),
      this.sidIndexKey(session.sid),
      this.revokedKey(session.sid),
      JSON.stringify(session),
      ttlSeconds,
      rpsid,
    );
    if (created !== 1)
      throw new Error("RP session was revoked or already exists");
    if (this.authority && !(await this.authority.accepts(session))) {
      await this.destroy(rpsid);
      throw new Error("RP session was revoked during creation");
    }
  }

  /** Load a session; null if missing/expired. */
  async get(rpsid: string): Promise<RpSession | null> {
    const raw = await this.redis.get(this.sessKey(rpsid));
    if (!raw) return null;
    const session = JSON.parse(raw) as RpSession;
    if (await this.redis.get(this.revokedKey(session.sid))) return null;
    if (this.authority && !(await this.authority.accepts(session))) return null;
    return session;
  }

  /**
   * Read the remaining absolute Redis lifetime without extending it.
   * @param rpsid Previously authenticated local session identifier.
   * @returns Milliseconds remaining, or zero for an absent/expired session.
   * @throws Error If PTTL is unavailable or the record has no expiry.
   */
  async remainingLifetimeMs(rpsid: string): Promise<number> {
    const ttl = await this.redis.pttl?.(this.sessKey(rpsid));
    if (
      ttl === undefined ||
      !Number.isSafeInteger(ttl) ||
      ttl === -1 ||
      ttl < -2
    )
      throw new Error("RP session requires a verifiable absolute lifetime");
    return Math.max(0, ttl);
  }

  /**
   * Conditionally rotate tokens without extending the original session TTL.
   * @param rpsid Existing local session identifier.
   * @param session Verified replacement token set for the same identity.
   * @param ttlSeconds Upper bound on the remaining lifetime.
   * @param expected Unmodified session previously returned by get().
   * @param lockOwner Optional refresh lease owner to fence a delayed writer.
   * @returns Whether the expected active session was atomically replaced.
   * @throws RangeError if ttlSeconds is outside the configured maximum.
   */
  async update(
    rpsid: string,
    session: RpSession,
    ttlSeconds: number,
    expected: RpSession,
    lockOwner = "",
  ): Promise<boolean> {
    this.assertTtl(ttlSeconds);
    if (expected.sid !== session.sid || expected.sub !== session.sub)
      return false;
    if (this.authority && !(await this.authority.accepts(session)))
      return false;
    return (
      (await this.redis.eval(
        UPDATE_SESSION,
        3,
        this.sessKey(rpsid),
        this.revokedKey(session.sid),
        this.lockKey(rpsid),
        JSON.stringify(expected),
        JSON.stringify(session),
        ttlSeconds,
        lockOwner,
      )) === 1
    );
  }

  /** Delete one RP session (local logout); also de-indexes it from its sid. */
  async destroy(rpsid: string, expected?: RpSession): Promise<void> {
    if (expected) {
      await this.redis.eval(
        DESTROY_UNCHANGED_SESSION,
        2,
        this.sessKey(rpsid),
        this.sidIndexKey(expected.sid),
        JSON.stringify(expected),
        rpsid,
      );
      return;
    }
    // Local cleanup must not depend on central recovery or durable-store health.
    const raw = await this.redis.get(this.sessKey(rpsid));
    const session = raw ? (JSON.parse(raw) as RpSession) : null;
    await this.redis.del(this.sessKey(rpsid));
    if (session) {
      await this.redis.srem(this.sidIndexKey(session.sid), rpsid);
    }
  }

  /**
   * Destroy every RP session under an IdP central sid (back-channel logout).
   * @param sid Central session identifier from a verified logout token.
   * @returns The number of indexed local sessions removed.
   */
  async destroyBySid(sid: string): Promise<number> {
    await this.authority?.revoke(sid);
    // Include the existing authorization callback window in the fence lifetime.
    return Number(
      await this.redis.eval(
        REVOKE_SESSION,
        2,
        this.sidIndexKey(sid),
        this.revokedKey(sid),
        this.maxSessionTtlSec + 600,
        `${this.prefix}rp:${this.clientId}:sess:`,
      ),
    );
  }

  // ========================================================================
  // Distributed refresh coordination
  // ========================================================================

  /**
   * Acquire a bounded lease only for the expected, still-active session.
   * @param rpsid Local session identifier.
   * @param expected Unmodified session previously returned by get().
   * @param owner Random identifier unique to this refresh attempt.
   * @returns Whether this attempt acquired the refresh lease.
   */
  async lockRefresh(
    rpsid: string,
    expected: RpSession,
    owner: string,
  ): Promise<boolean> {
    return (
      (await this.redis.eval(
        LOCK_REFRESH,
        3,
        this.sessKey(rpsid),
        this.revokedKey(expected.sid),
        this.lockKey(rpsid),
        JSON.stringify(expected),
        owner,
        60000,
      )) === 1
    );
  }

  /**
   * Release only the lease owned by this refresh attempt.
   * @param rpsid Local session identifier.
   * @param owner Identifier returned to the acquire path for this attempt.
   * @returns Resolves without releasing a successor's lease.
   */
  async unlockRefresh(rpsid: string, owner: string): Promise<void> {
    await this.redis.eval(RELEASE_REFRESH, 1, this.lockKey(rpsid), owner);
  }
}
