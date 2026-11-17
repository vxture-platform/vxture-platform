/**
 * rp-session.store.ts - server-side RP session storage (Redis)
 * @package @vxture/core-oidc-rp
 * @description
 *   Stores the OIDC token set server-side, keyed by an opaque rpsid (the value
 *   of the browser's __Host-vx_rp_session cookie). A sid→rpsid index supports
 *   OIDC back-channel logout (kill all RP sessions under an IdP central sid).
 *   Keys are namespaced per client_id. See identity-platform-rp-integration.md §3 / §9.
 *
 *   Tokens never leave this layer for the browser.
 */
import type { RpSession } from "./types";

/** Narrow subset of ioredis used here (keeps the store unit-testable). */
export interface RpRedis {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
}

// ============================================================================
// Atomic session rotation
// ============================================================================

const UPDATE_EXISTING_SESSION = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
local replacement = cjson.decode(ARGV[1])
if current.sid ~= replacement.sid or current.sub ~= replacement.sub then return 0 end
if ARGV[4] ~= '' and current.refreshToken ~= ARGV[4] then return 0 end
redis.call('SETEX', KEYS[1], ARGV[2], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
`;

const DESTROY_UNCHANGED_SESSION = `
-- destroy-unchanged-session
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
return 1
`;

export class RpSessionStore {
  /**
   * @param redis    ioredis-compatible client
   * @param clientId RP client_id (key namespace)
   * @param prefix   global key prefix (default "vx:")
   */
  constructor(
    private readonly redis: RpRedis,
    private readonly clientId: string,
    private readonly prefix = "vx:",
  ) {}

  private sessKey(rpsid: string): string {
    return `${this.prefix}rp:${this.clientId}:sess:${rpsid}`;
  }

  private sidIndexKey(sid: string): string {
    return `${this.prefix}rp:${this.clientId}:sididx:${sid}`;
  }

  /** Persist a session under rpsid and index it by the IdP central sid. */
  async create(
    rpsid: string,
    session: RpSession,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.setex(
      this.sessKey(rpsid),
      ttlSeconds,
      JSON.stringify(session),
    );
    const idx = this.sidIndexKey(session.sid);
    await this.redis.sadd(idx, rpsid);
    await this.redis.expire(idx, ttlSeconds);
  }

  /** Load a session; null if missing/expired. */
  async get(rpsid: string): Promise<RpSession | null> {
    const raw = await this.redis.get(this.sessKey(rpsid));
    return raw ? (JSON.parse(raw) as RpSession) : null;
  }

  /** Rotate an existing session atomically; never recreate a revoked session. */
  async update(
    rpsid: string,
    session: RpSession,
    ttlSeconds: number,
    expectedRefreshToken?: string,
  ): Promise<boolean> {
    const updated = await this.redis.eval(
      UPDATE_EXISTING_SESSION,
      2,
      this.sessKey(rpsid),
      this.sidIndexKey(session.sid),
      JSON.stringify(session),
      ttlSeconds,
      rpsid,
      expectedRefreshToken ?? "",
    );
    return updated === 1;
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
    const session = await this.get(rpsid);
    await this.redis.del(this.sessKey(rpsid));
    if (session) {
      await this.redis.srem(this.sidIndexKey(session.sid), rpsid);
    }
  }

  /**
   * Destroy every RP session under an IdP central sid (back-channel logout).
   * Returns the count removed.
   */
  async destroyBySid(sid: string): Promise<number> {
    const idx = this.sidIndexKey(sid);
    const rpsids = await this.redis.smembers(idx);
    if (rpsids.length > 0) {
      await this.redis.del(...rpsids.map((id) => this.sessKey(id)));
    }
    await this.redis.del(idx);
    return rpsids.length;
  }
}
