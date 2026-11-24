/**
 * Independent portal cookie wiring and cross-host session fencing.
 * @package @vxture/bff-tenant
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { IdentitySyncRuntime } from "@vxture/core-oidc-rp";
import { DEFAULT_CONFIGURATION } from "@vxture/service-customer-portal";
import { runtimeFor, type PortalRuntime } from "../config";
import type { PortalGateway } from "../gateway";
import { AuthRouter } from "./auth-router";
import { SessionStore, type Session } from "./session-store";

const config = (
  host = "a.ruyin.work",
  client = "customer-portal",
): PortalRuntime =>
  runtimeFor(
    {
      port: 0,
      databaseUrl: "",
      redisUrl: "",
      proxyToken: "fixture",
      oidc: {
        issuer: "https://accounts.test",
        clientId: client,
        clientSecret: "fixture",
        scopes: ["openid"],
        sessionTtlSec: 600,
      },
    },
    {
      id: host,
      hostname: host,
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      versionId: randomUUID(),
      configuration: DEFAULT_CONFIGURATION,
    },
  );
const session = (): Session => ({
  sid: randomUUID(),
  sub: `usr_${randomUUID()}`,
  org: randomUUID(),
  workspace: randomUUID(),
  idToken: "fixture",
  accessToken: "fixture",
  refreshToken: "fixture",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 60,
  expiresAt: Math.floor(Date.now() / 1000) + 120,
  nextCheckAt: 0,
});

// ============================================================================
// The customer portal intentionally has an existing cookie distinct from other RPs.
// ============================================================================
it("opens SSE with the existing customer portal cookie and pinned host", async () => {
  const runtime = config(),
    value = session(),
    id = randomBytes(32).toString("base64url");
  const unsubscribe = vi.fn();
  const sync = {
    recovery: { confirmedUntil: () => Date.now() + 60000 },
    changes: {
      view: async () => value,
      versions: async () => ({ access: "1", context: "0" }),
    },
    hub: {
      ready: true,
      subscribe: vi.fn(() => ({ current: () => true, unsubscribe })),
    },
    retirement: true,
  };
  const store = {
    sync,
    get: vi.fn(async () => value),
    remainingLifetimeMs: async () => 60000,
  };
  const gateway = {
    context: vi.fn(async () => ({
      runtime,
      store,
      sessions: { authenticate: vi.fn() },
      client: { verifyAccessToken: async () => ({ sub: value.sub }) },
    })),
  };
  const req = Object.assign(new EventEmitter(), {
    headers: { origin: runtime.origin, "sec-fetch-site": "same-origin" },
    query: {},
    cookies: { [runtime.cookieName]: id },
  });
  const headers = new Map<string, unknown>(),
    chunks: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: false,
    setHeader(name: string, value: unknown) {
      headers.set(name, value);
    },
    status: vi.fn().mockReturnThis(),
    end() {
      res.emit("close");
    },
    destroy() {
      this.destroyed = true;
      res.emit("close");
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    flushHeaders() {
      this.headersSent = true;
    },
  });
  try {
    await new AuthRouter(gateway as unknown as PortalGateway).events(
      req as unknown as Request,
      res as unknown as Response,
    );
    expect(store.get).toHaveBeenCalledWith(id);
    expect(headers.get("X-Vxture-Session-Sync")).toBe("events-v1");
    expect(chunks.join("")).toContain('"connected"');
    expect(gateway.context).toHaveBeenCalledWith(req);
  } finally {
    res.end();
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
});

// ============================================================================
// Real Redis tests use a unique client namespace and never flush shared state.
// ============================================================================
describe.skipIf(!process.env.REDIS_ITEST_URL)(
  "portal durable fencing adapters (real Redis)",
  () => {
    let redis: Redis | undefined;
    let prefix: string;
    afterEach(async () => {
      if (!redis) return;
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
      redis.disconnect();
      redis = undefined;
    });
    async function fixture() {
      const url = process.env.REDIS_ITEST_URL!;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Local Redis required");
      redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: 3000,
        commandTimeout: 3000,
      });
      await redis.connect();
      const client = `portal-itest-${randomUUID()}`;
      prefix = `vx:customer-portal:${client}:`;
      const revoked = new Set<string>();
      const recovery = {
        accepts: vi.fn(async (value: Session) => !revoked.has(value.sid)),
        revoke: vi.fn(async (sid: string) => {
          revoked.add(sid);
        }),
      };
      const sync = { recovery } as unknown as IdentitySyncRuntime;
      return {
        recovery,
        first: new SessionStore(redis, config("a.ruyin.work", client), sync),
        second: new SessionStore(
          redis,
          config("robot01.ruyin.work", client),
          sync,
        ),
      };
    }
    it("fences another host and restored Redis state after a durable revocation", async () => {
      const f = await fixture(),
        value = session(),
        a = randomBytes(32).toString("base64url"),
        b = randomBytes(32).toString("base64url");
      await f.first.create(a, value);
      await f.second.create(b, value);
      const old = (await f.second.read(b))!;
      await f.first.revokeSid(value.sid);
      await redis!.del(`${prefix}revoked:${value.sid}`);
      expect(await f.second.read(b)).toBeNull();
      expect(await f.second.update(b, old.raw, value)).toBe(false);
      await expect(
        f.second.create(randomBytes(32).toString("base64url"), value),
      ).rejects.toThrow();
      expect(f.recovery.revoke).toHaveBeenCalledWith(value.sid);
    });
    it("removes a session revoked between its two creation checks", async () => {
      const f = await fixture(),
        id = randomBytes(32).toString("base64url");
      f.recovery.accepts
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      await expect(f.first.create(id, session())).rejects.toThrow();
      expect(await redis!.exists(f.first.key(id))).toBe(0);
    });
    it("preserves the cached record on authority failure and preserves TTL on refresh", async () => {
      const f = await fixture(),
        id = randomBytes(32).toString("base64url");
      await f.first.create(id, session());
      const old = (await f.first.read(id))!,
        ttl = await f.first.remainingLifetimeMs(id);
      expect(
        await f.first.update(id, old.raw, {
          ...old.session,
          accessToken: "rotated",
        }),
      ).toBe(true);
      expect(await f.first.remainingLifetimeMs(id)).toBeLessThanOrEqual(ttl);
      f.recovery.accepts.mockRejectedValueOnce(new Error("unavailable"));
      await expect(f.first.read(id)).rejects.toMatchObject({ status: 503 });
      expect(await redis!.exists(f.first.key(id))).toBe(1);
    });
  },
);
