/**
 * Real HTTP/SSE, signed OIDC logout, PostgreSQL notifications and Redis sessions.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Pool } from "pg";
import Redis from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// ⚠️ 跨层引用: Exercise the public toolkit with actual HTTP and persistence.
import {
  HttpIdentityRecoveryClient,
  HttpOidcRpClient,
  RpAuthService,
  RpSessionStore,
  rpSessionCookieName,
  type RpSession,
} from "@vxture/core-oidc-rp";
import { SessionRecoveryAuthority } from "../oidc/session-recovery.authority";
import { SessionEventsHub } from "../oidc/session-events.hub";
import { SessionEventsRouter } from "./session-events.router";
import { OidcAuthRouter } from "./oidc-auth.router";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_RECOVERY,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_EVENTS,
  RP_SESSION_STORE,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";

// ============================================================================
// Isolated services and real signed IdP transport; no shared database is mutated.
// ============================================================================
const pgUrl = process.env["IDENTITY_PG_ITEST_URL"];
const redisUrl = process.env["REDIS_ITEST_URL"];
const database = `sse_itest_${randomUUID().replaceAll("-", "")}`;
const prefix = `itest:${randomUUID()}:`;
const issuer = "https://accounts.test";
const origin = "https://console.test";
const scope = { issuer, clientId: "console", environment: "dev" as const };
const cookieName = rpSessionCookieName(false, "console");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const central = new Map<
  string,
  { sub: string; expires: string; active: boolean }
>();
let admin: Pool;
let pool: Pool;
let connectionString: string;
let idp: Server;
let idpUrl: string;
let centralReads = 0;
const fixtures: Fixture[] = [];
const streams: Stream[] = [];
function jwt(claims: Record<string, unknown>) {
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: "console",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    }),
  ).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), keys.privateKey).toString("base64url")}`;
}
interface Fixture {
  app: INestApplication;
  base: string;
  hub: SessionEventsHub;
  authority: SessionRecoveryAuthority;
  store: RpSessionStore;
  redis: Redis;
  name: string;
  persistence: Pool;
}
async function fixture(enabled = true): Promise<Fixture> {
  const name = `sse-${randomUUID()}`;
  const runtime: RpRuntime = {
    enabled: true,
    sessionPollingRetirement: true,
    config: {
      issuer,
      clientId: "console",
      clientSecret: "test-secret",
      backchannelIssuer: idpUrl,
      redirectUri: `${origin}/auth/callback`,
      scopes: ["openid"],
      sessionTtlSec: 300,
    },
    allowedReturnOrigins: [origin],
    defaultReturnTo: `${origin}/`,
    postLogoutRedirectUri: `${issuer}/logout`,
    cookieSecure: false,
    keyPrefix: prefix,
  };
  const redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
  await redis.ping();
  const persistence = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  const authority = new SessionRecoveryAuthority(
    persistence,
    new HttpIdentityRecoveryClient(runtime.config, "dev"),
    scope,
  );
  const hub = new SessionEventsHub(
    { connectionString, connectionTimeoutMillis: 5000, application_name: name },
    scope,
    () => redis.status === "ready",
    { heartbeatMs: 50, retryMs: 50, maxConnections: 6, maxPerSid: 4 },
    () => authority.reset(),
  );
  const store = new RpSessionStore(redis, "console", prefix, 300, authority);
  const client = new HttpOidcRpClient(runtime.config);
  @Module({
    controllers: [SessionEventsRouter, OidcAuthRouter],
    providers: [
      { provide: RP_RUNTIME, useValue: runtime },
      { provide: RP_REDIS, useValue: redis },
      { provide: RP_RECOVERY, useValue: authority },
      { provide: RP_SESSION_EVENTS, useValue: enabled ? hub : null },
      { provide: RP_SESSION_STORE, useValue: store },
      { provide: RP_OIDC_CLIENT, useValue: client },
      {
        provide: RP_AUTH_SERVICE,
        useValue: new RpAuthService(store, client, 300),
      },
    ],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, "127.0.0.1");
  const f = {
    app,
    base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
    hub,
    authority,
    store,
    redis,
    name,
    persistence,
  };
  fixtures.push(f);
  return f;
}
async function login(
  f: Fixture,
  sid = randomUUID(),
  expiry = Date.now() + 60000,
) {
  const sub = `usr_${randomUUID()}`;
  central.set(sid, {
    sub,
    expires: new Date(expiry).toISOString(),
    active: true,
  });
  const session: RpSession = {
    sid,
    sub,
    accessToken: jwt({ sid, sub }),
    idToken: "not-sent",
    refreshToken: "not-sent",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 300,
  };
  const rpsid = randomUUID();
  await f.store.create(rpsid, session, 60);
  return { rpsid, session };
}
interface Stream {
  response: Response;
  frames: string[];
  done: boolean;
  stop(): void;
  pump: Promise<void>;
}
async function open(
  f: Fixture,
  rpsid: string,
  headers: Record<string, string> = {},
  query = "",
): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${f.base}/auth/events${query}`, {
    headers: { cookie: `${cookieName}=${rpsid}`, origin, ...headers },
    signal: controller.signal,
  });
  expect(response.headers.get("x-vxture-session-sync")).toBeNull();
  const s: Stream = {
    response,
    frames: [],
    done: false,
    stop: () => controller.abort(),
    pump: Promise.resolve(),
  };
  streams.push(s);
  if (response.status !== 200) {
    await response.arrayBuffer();
    s.done = true;
    return s;
  }
  s.pump = (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          s.frames.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {
      /* Aborting an owned stream is normal test cleanup. */
    } finally {
      s.done = true;
      await reader.cancel().catch(() => undefined);
    }
  })();
  await vi.waitFor(() =>
    expect(s.frames.some((frame) => frame.includes("resync-required"))).toBe(
      true,
    ),
  );
  return s;
}
async function receipt(sid: string, environment = "dev", client = "console") {
  await pool.query(
    "insert into session.rp_revocation_receipts(issuer,client_id,realm,environment,sid) values($1,$2,'customer',$3,$4) on conflict do nothing",
    [issuer, client, environment, sid],
  );
}
async function ended(s: Stream) {
  await vi.waitFor(() =>
    expect(s.frames.some((frame) => frame.includes("session-ended"))).toBe(
      true,
    ),
  );
}
async function pulse(s: Stream) {
  const before = s.frames.length;
  await vi.waitFor(() => expect(s.frames.length).toBeGreaterThan(before + 1));
}

describe.skipIf(!pgUrl || !redisUrl)(
  "Console logout SSE over real services",
  () => {
    beforeAll(async () => {
      for (const url of [pgUrl!, redisUrl!])
        if (
          !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
        )
          throw new Error("Local test services required");
      admin = new Pool({
        connectionString: pgUrl,
        connectionTimeoutMillis: 5000,
      });
      await admin.query(`create database "${database}"`);
      const url = new URL(pgUrl!);
      url.pathname = `/${database}`;
      connectionString = url.toString();
      pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
      await pool.query("create schema session; create schema appoidc");
      for (const file of [
        "22_appoidc.sql",
        "24_session.sql",
        "25_identity_recovery.sql",
        "26_rp_session_notifications.sql",
      ])
        await pool.query(
          await readFile(
            new URL(`../../../../deploy/database/ddl/${file}`, import.meta.url),
            "utf8",
          ),
        );
      idp = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/oidc/jwks") {
          res.end(
            JSON.stringify({
              keys: [
                {
                  ...keys.publicKey.export({ format: "jwk" }),
                  kid: "test",
                  alg: "RS256",
                },
              ],
            }),
          );
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          sids?: string[];
        };
        centralReads++;
        const binding = {
          issuer,
          audience: "console",
          realm: "customer",
          environment: "dev",
          profile: "logout-v1",
        };
        if (req.url?.endsWith("snapshot"))
          res.end(
            JSON.stringify({
              binding,
              watermark: "test-cursor",
              sessions: body.sids!.map((sid) => {
                const s = central.get(sid);
                return !s
                  ? { sid, state: "not_bound" }
                  : !s.active
                    ? { sid, state: "inactive" }
                    : {
                        sid,
                        state: "active",
                        sub: s.sub,
                        absolute_expires_at: s.expires,
                        session_version: "1",
                        context_version: "0",
                        context: null,
                      };
              }),
            }),
          );
        else
          res.end(
            JSON.stringify({
              binding,
              events: [],
              next_cursor: "test-cursor",
              has_more: false,
            }),
          );
      });
      await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
      idpUrl = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
      await fixture();
      await fixture();
    }, 30000);
    beforeEach(async () => {
      vi.restoreAllMocks();
      central.clear();
      centralReads = 0;
      await pool.query("truncate session.rp_revocation_receipts");
      for (const f of fixtures) f.authority.reset();
      const keys = await fixtures[0]!.redis.keys(`${prefix}*`);
      if (keys.length) await fixtures[0]!.redis.del(...keys);
    });
    afterEach(async () => {
      for (const s of streams) s.stop();
      await Promise.all(streams.map((s) => s.pump));
      streams.length = 0;
    });
    afterAll(async () => {
      for (const f of fixtures.reverse()) {
        await f.app.close();
        await f.redis.quit();
      }
      idp?.closeAllConnections();
      if (idp) await new Promise<void>((resolve) => idp.close(() => resolve()));
      await pool?.end();
      if (admin) {
        await admin.query(`drop database if exists "${database}" with (force)`);
        await admin.end();
      }
    }, 30000);

    // ========================================================================
    // Durable commit, signed receipt and multi-instance delivery
    // ========================================================================
    it("broadcasts one verified logout to every instance and tab after the receipt commits", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const tabs = await Promise.all([
        open(f, rpsid),
        open(fixtures[1]!, rpsid),
        open(f, rpsid),
      ]);
      const token = jwt({
        sid: session.sid,
        sub: session.sub,
        jti: randomUUID(),
        events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      });
      const response = await fetch(
        `${fixtures[1]!.base}/auth/backchannel-logout`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ logout_token: token }),
        },
      );
      expect(response.status).toBe(200);
      expect(
        (
          await pool.query(
            "select 1 from session.rp_revocation_receipts where sid=$1",
            [session.sid],
          )
        ).rowCount,
      ).toBe(1);
      await Promise.all(tabs.map(ended));
      for (const tab of tabs) {
        expect(tab.response.headers.get("cache-control")).toBe(
          "no-store, no-transform",
        );
        expect(tab.response.headers.get("x-accel-buffering")).toBe("no");
        const text = tab.frames.join("");
        for (const secret of [
          session.sid,
          session.sub,
          rpsid,
          session.accessToken,
        ])
          expect(text).not.toContain(secret);
      }
      expect((await open(f, rpsid)).response.status).toBe(401);
    });

    it("never sends a rolled-back revocation, and duplicate receipts remain idempotent", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "insert into session.rp_revocation_receipts(issuer,client_id,realm,environment,sid) values($1,'console','customer','dev',$2)",
          [issuer, session.sid],
        );
        await pulse(stream);
        expect(stream.frames.join("")).not.toContain("session-ended");
        await tx.query("rollback");
      } finally {
        await tx.query("rollback");
        tx.release();
      }
      await receipt(session.sid);
      await receipt(session.sid);
      await ended(stream);
      expect(
        (await pool.query("select 1 from session.rp_revocation_receipts"))
          .rowCount,
      ).toBe(1);
    });

    it("revalidates durable state instead of trusting a forged NOTIFY hint", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      await pool.query("select pg_notify('rp_session_revoked',$1)", [
        JSON.stringify({
          issuer,
          client_id: "console",
          realm: "customer",
          environment: "dev",
          sid: session.sid,
        }),
      ]);
      await pulse(stream);
      expect(stream.frames.join("")).not.toContain("session-ended");
      expect(await f.store.get(rpsid)).not.toBeNull();
    });

    it("isolates clients and environments even if the central sid is the same", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      await receipt(session.sid, "beta");
      await receipt(session.sid, "dev", "other");
      await pulse(stream);
      expect(stream.frames.join("")).not.toContain("session-ended");
      await receipt(session.sid);
      await ended(stream);
    });

    it("does not miss a logout occurring during stream registration", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const subscribe = f.hub.subscribe.bind(f.hub);
      vi.spyOn(f.hub, "subscribe").mockImplementation((sid, listener) => {
        const subscription = subscribe(sid, listener);
        void receipt(session.sid);
        return subscription;
      });
      const stream = await open(f, rpsid);
      if (stream.response.status === 200) await ended(stream);
      else expect(stream.response.status).toBe(401);
    });

    it("rejects an invalid standard logout token without disturbing an active stream", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      const stream = await open(f, rpsid);
      expect(
        (
          await fetch(`${f.base}/auth/backchannel-logout`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "logout_token=invalid",
          })
        ).status,
      ).toBe(400);
      await pulse(stream);
      expect(stream.frames.join("")).not.toContain("session-ended");
    });

    it("rechecks again when a real revocation arrives during an earlier hint read", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const notify = vi.fn();
      const subscribe = f.hub.subscribe.bind(f.hub);
      vi.spyOn(f.hub, "subscribe").mockImplementation((sid, listener) =>
        subscribe(sid, {
          ...listener,
          revoked: () => {
            notify();
            listener.revoked();
          },
        }),
      );
      const stream = await open(f, rpsid);
      let finish!: (value: RpSession | null) => void;
      const get = vi.spyOn(f.store, "get").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await pool.query("select pg_notify('rp_session_revoked',$1)", [
        JSON.stringify({
          issuer,
          client_id: "console",
          realm: "customer",
          environment: "dev",
          sid: session.sid,
        }),
      ]);
      await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
      await receipt(session.sid);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
      finish(session);
      await ended(stream);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it("keeps a newer local login valid when the old connection is revoked", async () => {
      const f = fixtures[0]!;
      const previous = await login(f);
      const stream = await open(f, previous.rpsid);
      const current = await login(f);
      await receipt(previous.session.sid);
      await ended(stream);
      expect((await open(f, current.rpsid)).response.status).toBe(200);
    });

    // ========================================================================
    // Loss recovery, lifetimes, transport limits and quiet heartbeats
    // ========================================================================
    it("closes streams on LISTEN loss and checks durable receipts on reconnect", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      await pool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name=$1",
        [f.name],
      );
      await vi.waitFor(() => expect(stream.done).toBe(true));
      await receipt(session.sid);
      await vi.waitFor(() => expect(f.hub.ready).toBe(true));
      expect(
        (await open(f, rpsid, { "last-event-id": "cursor-from-another-login" }))
          .response.status,
      ).toBe(401);
    });

    it("performs no database, Redis or central identity reads for healthy heartbeats", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      const stream = await open(f, rpsid);
      const get = vi.spyOn(f.store, "get");
      const redisRead = vi.spyOn(f.redis, "get");
      const databaseRead = vi.spyOn(f.persistence, "query");
      const reads = centralReads;
      const before = await f.store.remainingLifetimeMs(rpsid);
      await pulse(stream);
      await pulse(stream);
      expect(get).not.toHaveBeenCalled();
      expect(redisRead).not.toHaveBeenCalled();
      expect(databaseRead).not.toHaveBeenCalled();
      expect(centralReads).toBe(reads);
      expect(await f.store.remainingLifetimeMs(rpsid)).toBeLessThan(before);
    });

    it("closes at the existing Redis deadline without renewing the session", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      await f.redis.pexpire(`${prefix}rp:console:sess:${rpsid}`, 700);
      const stream = await open(f, rpsid);
      await vi.waitFor(() => expect(stream.done).toBe(true), { timeout: 3000 });
      expect(stream.frames.join("")).toContain('"expired"');
      expect((await open(f, rpsid)).response.status).toBe(401);
    });

    it("also closes at the earlier recovered central deadline", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f, randomUUID(), Date.now() + 1000);
      const stream = await open(f, rpsid);
      await vi.waitFor(() => expect(stream.done).toBe(true), { timeout: 3000 });
      expect(stream.frames.join("")).toContain('"expired"');
      expect(
        await f.redis.pttl(`${prefix}rp:console:sess:${rpsid}`),
      ).toBeGreaterThan(0);
    });

    it("bounds per-session connections and releases capacity when a tab disconnects", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      const tabs = [];
      for (let i = 0; i < 4; i++) tabs.push(await open(f, rpsid));
      const limited = await open(f, rpsid);
      expect(limited.response.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).toBe("5");
      tabs[0]!.stop();
      await tabs[0]!.pump;
      await vi.waitFor(async () =>
        expect((await open(f, rpsid)).response.status).toBe(200),
      );
    });

    it.each([
      { origin: "https://foreign.test" },
      { "sec-fetch-site": "cross-site" },
    ])("rejects cross-origin streams %j", async (headers) => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      expect((await open(f, rpsid, headers)).response.status).toBe(403);
    });
    it("rejects URL credentials and anonymous access", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      expect((await open(f, rpsid, {}, "?sid=foreign")).response.status).toBe(
        400,
      );
      expect((await open(f, "missing")).response.status).toBe(401);
    });
    it("returns 204 when optional push is disabled", async () => {
      const f = await fixture(false);
      expect((await open(f, "missing")).response.status).toBe(204);
    });

    it("keeps enabled streams unavailable until the commit-notification migration is present", async () => {
      await pool.query(
        "alter table session.rp_revocation_receipts disable trigger trg_rp_revocation_notify",
      );
      try {
        const f = await fixture();
        expect((await open(f, "missing")).response.status).toBe(503);
      } finally {
        await pool.query(
          "alter table session.rp_revocation_receipts enable trigger trg_rp_revocation_notify",
        );
      }
      await vi.waitFor(() => expect(fixtures.at(-1)!.hub.ready).toBe(true));
    });

    it("recovers central logout missed during a listener outage before reopening the stream", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      central.get(session.sid)!.active = false;
      await pool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name=$1",
        [f.name],
      );
      await vi.waitFor(() => expect(stream.done).toBe(true));
      await vi.waitFor(() => expect(f.hub.ready).toBe(true));
      expect((await open(f, rpsid)).response.status).toBe(401);
      expect(
        (
          await pool.query(
            "select 1 from session.rp_revocation_receipts where sid=$1",
            [session.sid],
          )
        ).rowCount,
      ).toBe(1);
    });

    it("rejects a session with no Redis expiration instead of leaving an unbounded stream", async () => {
      const f = fixtures[0]!;
      const { rpsid } = await login(f);
      await f.redis.persist(`${prefix}rp:console:sess:${rpsid}`);
      expect((await open(f, rpsid)).response.status).toBe(503);
    });
    it("can rerun the notification migration with active receipts", async () => {
      const f = fixtures[0]!;
      const { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      const sql = await readFile(
        new URL(
          "../../../../deploy/database/migrations/2026-12-17-rp-session-notifications.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(sql);
      await pool.query(sql);
      await receipt(session.sid);
      await ended(stream);
    });
  },
);
