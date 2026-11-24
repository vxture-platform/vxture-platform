/**
 * test-redis.ts - Expiring Redis adapter for isolated HTTP contracts.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import type { DesktopRedis } from "./runtime";

export class TestRedis implements DesktopRedis {
  readonly values = new Map<string, { value: string; expires: number }>();
  private readonly sets = new Map<string, Set<string>>();
  offset = 0;
  failWrites = false;

  async get(key: string): Promise<string | null> {
    const row = this.values.get(key);
    if (!row || row.expires <= Date.now() + this.offset) {
      this.values.delete(key);
      return null;
    }
    return row.value;
  }
  async getdel(key: string): Promise<string | null> {
    // A real Redis GETDEL is atomic. This adapter consumes synchronously before
    // yielding so concurrent HTTP requests cannot both read the same approval.
    const row = this.values.get(key);
    this.values.delete(key);
    return row && row.expires > Date.now() + this.offset ? row.value : null;
  }
  async setex(key: string, ttl: number, value: string): Promise<unknown> {
    if (this.failWrites) throw new Error("Synthetic Redis write outage");
    this.values.set(key, {
      value,
      expires: Date.now() + this.offset + ttl * 1000,
    });
    return "OK";
  }
  async set(
    key: string,
    value: string,
    _mode: "EX",
    ttl: number,
    _condition: "NX",
  ): Promise<unknown> {
    const row = this.values.get(key);
    if (row && row.expires > Date.now() + this.offset) return null;
    return this.setex(key, ttl, value);
  }
  async del(...keys: string[]): Promise<unknown> {
    for (const key of keys) {
      this.values.delete(key);
      this.sets.delete(key);
    }
    return keys.length;
  }
  async sadd(key: string, ...members: string[]): Promise<unknown> {
    const set = this.sets.get(key) ?? new Set<string>();
    for (const member of members) set.add(member);
    this.sets.set(key, set);
    return members.length;
  }
  async srem(key: string, ...members: string[]): Promise<unknown> {
    for (const member of members) this.sets.get(key)?.delete(member);
    return members.length;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  async expire(): Promise<unknown> {
    return 1;
  }

  async eval(
    script: string,
    keyCount: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    if (keyCount !== 2) throw new Error("Unexpected RP script key count");
    const [sessionKey, indexKey, serialized, ttl, rpsid, expectedRefresh] =
      args.map(String);
    const raw = await this.get(sessionKey!);
    if (!raw) return 0;
    if (script.includes("destroy-unchanged-session")) {
      if (raw !== serialized) return 0;
      await this.del(sessionKey!);
      await this.srem(indexKey!, ttl!);
      return 1;
    }
    const current = JSON.parse(raw) as Record<string, unknown>;
    const replacement = JSON.parse(serialized!) as Record<string, unknown>;
    if (
      current.sid !== replacement.sid ||
      current.sub !== replacement.sub ||
      (expectedRefresh && current.refreshToken !== expectedRefresh)
    )
      return 0;
    await this.setex(sessionKey!, Number(ttl), serialized!);
    await this.sadd(indexKey!, rpsid!);
    return 1;
  }
}
