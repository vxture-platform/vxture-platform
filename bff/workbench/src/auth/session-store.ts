/**
 * Atomic workbench session persistence with absolute expiry and logout fencing.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { Redis } from "ioredis";
import type { OidcTokenSet } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: consume server-side RP token contracts.
import type { WorkbenchConfig } from "../config";
import { failure } from "../errors";

export interface Session extends OidcTokenSet {
  sid: string;
  sub: string;
  expiresAt: number;
  nextCheckAt: number;
  org: string;
  workspace: string;
}

// ============================================================================
// Atomic operations: refresh must never resurrect a concurrent logout.
// ============================================================================
const CREATE = `
if redis.call('exists', KEYS[3]) == 1 then return 0 end
if not redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 0 end
redis.call('sadd', KEYS[2], ARGV[3])
redis.call('expire', KEYS[2], ARGV[4])
return 1`;
const UPDATE = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('exists', KEYS[2]) == 1 then return 0 end
return redis.call('set', KEYS[1], ARGV[2], 'KEEPTTL', 'XX') and 1 or 0`;
const REVOKE = `
redis.call('set', KEYS[2], '1', 'EX', ARGV[1])
local ids = redis.call('smembers', KEYS[1])
for _, id in ipairs(ids) do redis.call('del', ARGV[2] .. id) end
redis.call('del', KEYS[1])
return #ids`;
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
return 0`;

/** Private BFF adapter; no changes to other portals' session lifecycle. */
export class SessionStore {
  readonly prefix: string;
  constructor(
    readonly redis: Redis,
    private readonly config: WorkbenchConfig,
  ) {
    this.prefix = `vx:rp:${config.oidc.clientId}:`;
  }

  key(id: string): string {
    return `${this.prefix}sess:${id}`;
  }
  private revoked(sid: string): string {
    return `${this.prefix}revoked:${sid}`;
  }
  private index(sid: string): string {
    return `${this.prefix}sididx:${sid}`;
  }

  async create(id: string, session: Session): Promise<void> {
    const ttl = session.expiresAt - Math.floor(Date.now() / 1000);
    if (ttl < 1 || ttl > this.config.oidc.sessionTtlSec)
      throw failure(401, "WORKBENCH_SESSION_INVALID", "Session expired");
    const result = await this.redis.eval(
      CREATE,
      3,
      this.key(id),
      this.index(session.sid),
      this.revoked(session.sid),
      JSON.stringify(session),
      ttl,
      id,
      this.config.oidc.sessionTtlSec,
    );
    if (result !== 1)
      throw failure(
        401,
        "WORKBENCH_SESSION_INVALID",
        "Session no longer valid",
      );
  }

  async read(id: string): Promise<{ raw: string; session: Session } | null> {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) return null;
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (
      session.expiresAt <= Math.floor(Date.now() / 1000) ||
      (await this.redis.exists(this.revoked(session.sid)))
    )
      return null;
    return { raw, session };
  }

  async update(id: string, raw: string, session: Session): Promise<boolean> {
    return (
      (await this.redis.eval(
        UPDATE,
        2,
        this.key(id),
        this.revoked(session.sid),
        raw,
        JSON.stringify(session),
      )) === 1
    );
  }

  async destroy(id: string): Promise<void> {
    const old = await this.read(id);
    await this.redis.del(this.key(id));
    if (old) await this.redis.srem(this.index(old.session.sid), id);
  }

  async revokeSid(sid: string): Promise<void> {
    await this.redis.eval(
      REVOKE,
      2,
      this.index(sid),
      this.revoked(sid),
      this.config.oidc.sessionTtlSec,
      `${this.prefix}sess:`,
    );
  }

  async lock(id: string, owner: string): Promise<boolean> {
    return (
      (await this.redis.set(
        `${this.prefix}lock:${id}`,
        owner,
        "PX",
        60000,
        "NX",
      )) === "OK"
    );
  }

  async unlock(id: string, owner: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, `${this.prefix}lock:${id}`, owner);
  }
}
