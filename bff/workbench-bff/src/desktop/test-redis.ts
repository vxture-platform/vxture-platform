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

  // ========================================================================
  // Atomic session lifecycle and refresh fencing for HTTP orchestration tests
  // ========================================================================
  async eval(
    script: string,
    keyCount: number,
    ...input: (string | number)[]
  ): Promise<unknown> {
    if (this.failWrites) throw new Error("Synthetic Redis write outage");
    const keys = input.slice(0, keyCount).map(String);
    const args = input.slice(keyCount).map(String);
    const key = keys[0]!;
    const now = Date.now() + this.offset;
    const read = (name: string) => {
      const row = this.values.get(name);
      return row && row.expires > now ? row : undefined;
    };
    if (script.includes("local requested")) {
      if (read(keys[2]!) || read(key)) return 0;
      this.values.set(key, {
        value: args[0]!,
        expires: now + Number(args[1]) * 1000,
      });
      const set = this.sets.get(keys[1]!) ?? new Set<string>();
      set.add(args[2]!);
      this.sets.set(keys[1]!, set);
      return 1;
    }
    if (script.includes("math.min(lifetime")) {
      const row = read(key);
      if (
        read(keys[1]!) ||
        row?.value !== args[0] ||
        (args[3] && read(keys[2]!)?.value !== args[3])
      )
        return 0;
      this.values.set(key, {
        value: args[1]!,
        expires: Math.min(row!.expires, now + Number(args[2]) * 1000),
      });
      return 1;
    }
    if (script.includes("'srem'")) {
      if (read(key)?.value !== args[0]) return 0;
      this.values.delete(key);
      this.sets.get(keys[1]!)?.delete(args[1]!);
      return 1;
    }
    if (script.includes("local ids")) {
      this.values.set(keys[1]!, {
        value: "1",
        expires: now + Number(args[0]) * 1000,
      });
      const ids = this.sets.get(key) ?? new Set<string>();
      for (const id of ids) this.values.delete(args[1]! + id);
      this.sets.delete(key);
      return ids.size;
    }
    if (keyCount === 3 && script.includes("'NX'")) {
      if (read(keys[1]!) || read(key)?.value !== args[0] || read(keys[2]!))
        return 0;
      this.values.set(keys[2]!, {
        value: args[1]!,
        expires: now + Number(args[2]),
      });
      return 1;
    }
    if (keyCount === 1 && script.includes("'del'")) {
      if (read(key)?.value !== args[0]) return 0;
      this.values.delete(key);
      return 1;
    }
    throw new Error("Unsupported Redis script in HTTP fixture");
  }
}
