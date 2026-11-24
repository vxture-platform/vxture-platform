/**
 * Durable logout recovery across PostgreSQL, Redis rollback and process restart.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Redis from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// ⚠️ 跨层引用: Exercise the public RP store against real persistence.
import {
  RpAuthService,
  RpSessionStore,
  type IdentityRecoveryClient,
  type LogoutRecoveryPage,
  type OidcRpClient,
  type RecoverySnapshot,
  type RpSession,
} from "@vxture/core-oidc-rp";
import { SessionRecoveryAuthority } from "./session-recovery.authority";

// ============================================================================
// Each suite owns one disposable local database and one random Redis namespace.
// ============================================================================
const pgUrl = process.env["IDENTITY_PG_ITEST_URL"];
const redisUrl = process.env["REDIS_ITEST_URL"];
const database = `rp_recovery_itest_${randomUUID().replaceAll("-", "")}`;
const prefix = `itest:${randomUUID()}:`;
const scope = {
  issuer: "https://accounts.test",
  clientId: "console",
  environment: "dev" as const,
};
const session: RpSession = {
  sid: "central-sid",
  sub: "usr_user",
  idToken: "id",
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 300,
};
let admin: Pool;
let pool: Pool;
let redis: Redis;
let authority: SessionRecoveryAuthority;
let store: RpSessionStore;
const snapshot = vi.fn<IdentityRecoveryClient["snapshot"]>();
const events = vi.fn<IdentityRecoveryClient["events"]>();
const recovery = { snapshot, events };
const sessKey = `${prefix}rp:console:sess:local`;
function active(): RecoverySnapshot {
  return {
    watermark: "start",
    sessions: [
      {
        sid: session.sid,
        sub: session.sub,
        state: "active",
        absolute_expires_at: new Date(Date.now() + 300000).toISOString(),
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function restore() {
  // A backup can contain a session whose already-acknowledged fence is absent.
  await redis.del(`${prefix}rp:console:revoked:${session.sid}`);
  await redis.setex(sessKey, 60, JSON.stringify(session));
}
async function receipts() {
  return (await pool.query("select * from session.rp_revocation_receipts"))
    .rows;
}

describe.skipIf(!pgUrl || !redisUrl)("Console durable logout recovery", () => {
  beforeAll(async () => {
    for (const url of [pgUrl!, redisUrl!])
      if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Local disposable test services required");
    admin = new Pool({
      connectionString: pgUrl,
      connectionTimeoutMillis: 5000,
    });
    await admin.query(`create database "${database}"`);
    const url = new URL(pgUrl!);
    url.pathname = `/${database}`;
    pool = new Pool({
      connectionString: url.toString(),
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    await pool.query("create schema session; create schema appoidc");
    for (const file of [
      "22_appoidc.sql",
      "24_session.sql",
      "25_identity_recovery.sql",
    ])
      await pool.query(
        await readFile(
          new URL(`../../../../deploy/database/ddl/${file}`, import.meta.url),
          "utf8",
        ),
      );
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    await redis.ping();
  }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    snapshot.mockReset();
    events.mockReset();
    snapshot.mockResolvedValue(active());
    events.mockResolvedValue({
      events: [],
      next_cursor: "start",
      has_more: false,
    });
    await pool.query("truncate session.rp_revocation_receipts");
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    authority = new SessionRecoveryAuthority(pool, recovery, scope);
    store = new RpSessionStore(redis, "console", prefix, 300, authority);
  });
  afterAll(async () => {
    if (redis) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    }
    await pool?.end();
    if (admin) {
      await admin.query(`drop database if exists "${database}" with (force)`);
      await admin.end();
    }
  }, 30000);

  // ========================================================================
  // Durable acknowledgement and restoration of old Redis session data
  // ========================================================================
  it("keeps acknowledged logout terminal after restoring Redis and restarting the adapter", async () => {
    await store.create("local", session, 60);
    expect(await store.destroyBySid(session.sid)).toBe(1);
    expect(await receipts()).toHaveLength(1);
    await restore();
    snapshot.mockClear();
    const restarted = new RpSessionStore(
      redis,
      "console",
      prefix,
      300,
      new SessionRecoveryAuthority(pool, recovery, scope),
    );
    expect(await restarted.get("local")).toBeNull();
    await expect(restarted.create("late", session, 60)).rejects.toThrow(
      "rejected",
    );
    await restarted.destroyBySid(session.sid);
    expect(await receipts()).toHaveLength(1);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("recovers a missed logout from the central snapshot before serving old sessions", async () => {
    await restore();
    snapshot.mockResolvedValue({
      watermark: "start",
      sessions: [{ sid: session.sid, state: "inactive" }],
    });
    expect(await store.get("local")).toBeNull();
    expect(await receipts()).toHaveLength(1);
    expect(events).not.toHaveBeenCalled();
  });

  it.each(["not_bound", "wrong_subject"])(
    "rejects %s without inventing a permanent revocation",
    async (state) => {
      await restore();
      const data = active();
      data.sessions =
        state === "not_bound"
          ? [{ sid: session.sid, state: "not_bound" }]
          : [
              {
                ...active().sessions[0]!,
                state: "active",
                sub: "usr_other",
                absolute_expires_at: new Date(
                  Date.now() + 300000,
                ).toISOString(),
              },
            ];
      snapshot.mockResolvedValue(data);
      expect(await store.get("local")).toBeNull();
      expect(await receipts()).toHaveLength(0);
    },
  );

  it("isolates the same sid across issuer, client and deployment environment", async () => {
    await authority.revoke(session.sid);
    for (const otherScope of [
      { ...scope, issuer: "https://other.test" },
      { ...scope, clientId: "other" },
      { ...scope, environment: "beta" as const },
    ]) {
      const isolated = new SessionRecoveryAuthority(pool, recovery, otherScope);
      expect(await isolated.accepts(session)).toBe(true);
    }
    expect(await authority.accepts(session)).toBe(false);
  });

  it("does not acknowledge logout if its durable write fails", async () => {
    await restore();
    await pool.query(
      "alter table session.rp_revocation_receipts rename to unavailable_receipts",
    );
    try {
      await expect(store.destroyBySid(session.sid)).rejects.toThrow();
      expect(await redis.get(sessKey)).not.toBeNull();
    } finally {
      await pool.query(
        "alter table session.unavailable_receipts rename to rp_revocation_receipts",
      );
    }
    await store.destroyBySid(session.sid);
    expect(await store.get("local")).toBeNull();
  });

  it("preserves the durable receipt even if Redis cleanup fails after commit", async () => {
    await restore();
    vi.spyOn(redis, "eval").mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );
    await expect(store.destroyBySid(session.sid)).rejects.toThrow(
      "Redis unavailable",
    );
    expect(await receipts()).toHaveLength(1);
    expect(await store.get("local")).toBeNull();
  });

  // ========================================================================
  // Finite recovery, concurrency and outage behavior
  // ========================================================================
  it("single-flights concurrent startup reads and makes no repeated remote checks", async () => {
    await restore();
    const gate = deferred<RecoverySnapshot>();
    snapshot.mockReturnValueOnce(gate.promise);
    const first = store.get("local");
    const second = store.get("local");
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    gate.resolve(active());
    expect(await Promise.all([first, second])).toEqual([session, session]);
    await store.get("local");
    await store.get("local");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledTimes(1);
    expect(await redis.ttl(sessKey)).toBeLessThanOrEqual(60);
  });

  it("applies revocation arriving between the snapshot and recovery completion", async () => {
    await restore();
    const gate = deferred<LogoutRecoveryPage>();
    events.mockReturnValueOnce(gate.promise);
    const read = store.get("local");
    await vi.waitFor(() => expect(events).toHaveBeenCalled());
    await authority.revoke(session.sid);
    gate.resolve({ events: [], has_more: false, next_cursor: "start" });
    expect(await read).toBeNull();
  });

  it("applies replay pages before opening the requested session", async () => {
    await restore();
    events
      .mockResolvedValueOnce({
        events: [
          {
            event_id: randomUUID(),
            subject: { sid: "other", sub: "usr_other" },
            cursor: "one",
          },
        ],
        next_cursor: "one",
        has_more: true,
      })
      .mockResolvedValueOnce({
        events: [
          {
            event_id: randomUUID(),
            subject: { sid: session.sid, sub: session.sub },
            cursor: "two",
          },
        ],
        next_cursor: "two",
        has_more: false,
      });
    expect(await store.get("local")).toBeNull();
    expect(await receipts()).toHaveLength(2);
    expect(events).toHaveBeenNthCalledWith(2, "one");
  });

  it("discards recovery from a previous Redis connection generation", async () => {
    await restore();
    const gate = deferred<RecoverySnapshot>();
    snapshot.mockReturnValueOnce(gate.promise);
    const read = store.get("local");
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalled());
    authority.reset();
    gate.resolve(active());
    await expect(read).rejects.toThrow("reconnected");
    expect(await store.get("local")).toEqual(session);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("rechecks the generation after the final asynchronous receipt read", async () => {
    events.mockImplementationOnce(async () => {
      pool.once("acquire", () => authority.reset());
      return { events: [], next_cursor: "start", has_more: false };
    });
    await expect(authority.accepts(session)).rejects.toThrow("reconnected");
    expect(await authority.accepts(session)).toBe(true);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable on central failure without deleting the restored session", async () => {
    await restore();
    snapshot.mockRejectedValue(new Error("Central unavailable"));
    const auth = new RpAuthService(store, {} as OidcRpClient, 300);
    expect(await auth.resolve("local")).toEqual({
      status: "unavailable",
      reauthorizationRequired: false,
    });
    expect(await redis.get(sessKey)).not.toBeNull();
    expect(await receipts()).toHaveLength(0);
  });

  it("fails closed on local database outage even for a previously recovered session", async () => {
    await restore();
    expect(await store.get("local")).toEqual(session);
    await pool.query(
      "alter table session.rp_revocation_receipts rename to unavailable_receipts",
    );
    try {
      const auth = new RpAuthService(store, {} as OidcRpClient, 300);
      expect(await auth.resolve("local")).toEqual({
        status: "unavailable",
        reauthorizationRequired: false,
      });
      expect(await redis.get(sessKey)).not.toBeNull();
    } finally {
      await pool.query(
        "alter table session.unavailable_receipts rename to rp_revocation_receipts",
      );
    }
  });

  it("bounds replay when the upstream keeps advancing", async () => {
    let page = 0;
    events.mockImplementation(async () => ({
      events: [
        {
          event_id: randomUUID(),
          subject: { sid: "other", sub: "usr_other" },
          cursor: String(++page),
        },
      ],
      next_cursor: String(page),
      has_more: true,
    }));
    await expect(authority.accepts(session)).rejects.toThrow("budget");
    expect(events).toHaveBeenCalledTimes(20);
  });

  it("keeps local cleanup available without recovery and without revoking the central sid", async () => {
    await restore();
    snapshot.mockRejectedValue(new Error("Central unavailable"));
    await store.destroy("local");
    expect(await redis.get(sessKey)).toBeNull();
    expect(await receipts()).toHaveLength(0);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
