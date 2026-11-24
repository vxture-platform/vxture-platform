/**
 * Real signed changes, durable application, recovery and multi-instance SSE.
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
import express from "express";
import { IdentityChangesAuthority } from "../oidc/identity-changes.authority";
import { IdentityEventsRouter } from "./identity-events.router";
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
  HttpIdentityChangesClient,
  IdentityEventVerifier,
  type IdentityChangeEvent,
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
  RP_CHANGES,
  RP_EVENT_VERIFIER,
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
const database = `changes_sse_itest_${randomUUID().replaceAll("-", "")}`;
const prefix = `itest:${randomUUID()}:`;
const issuer = "https://accounts.test";
const origin = "https://console.test";
const scope = { issuer, clientId: "console", environment: "dev" as const };
const cookieName = rpSessionCookieName(false, "console");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const central = new Map<
  string,
  {
    sub: string;
    expires: string;
    active: boolean;
    contextVersion?: string;
    accessVersion?: string;
    context?: { org_id: string; workspace_id: string | null } | null;
  }
>();
let admin: Pool;
let pool: Pool;
let connectionString: string;
let idp: Server;
let idpUrl: string;
let centralReads = 0;
const fixtures: Fixture[] = [];
const streams: Stream[] = [];
function jwt(claims: Record<string, unknown>, typ = "JWT") {
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test", typ }),
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
  changes: IdentityChangesAuthority;
  store: RpSessionStore;
  redis: Redis;
  name: string;
  persistence: Pool;
}
async function fixture(enabled = true, retirement = false): Promise<Fixture> {
  const name = `sse-${randomUUID()}`;
  const runtime: RpRuntime = {
    enabled: true,
    sessionPollingRetirement: retirement,
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
  const changes = new IdentityChangesAuthority(
    new Pool({ connectionString }),
    new HttpIdentityChangesClient(runtime.config, "dev"),
    scope,
    authority,
  );
  const hub = new SessionEventsHub(
    { connectionString, connectionTimeoutMillis: 5000, application_name: name },
    scope,
    () => redis.status === "ready",
    { heartbeatMs: 50, retryMs: 50, maxConnections: 6, maxPerSid: 4 },
    () => {
      authority.reset();
      changes.reset();
    },
    true,
  );
  const store = new RpSessionStore(redis, "console", prefix, 300, authority);
  const client = new HttpOidcRpClient(runtime.config);
  @Module({
    controllers: [SessionEventsRouter, OidcAuthRouter, IdentityEventsRouter],
    providers: [
      { provide: RP_RUNTIME, useValue: runtime },
      { provide: RP_CHANGES, useValue: changes },
      {
        provide: RP_EVENT_VERIFIER,
        useValue: new IdentityEventVerifier(runtime.config, "dev"),
      },
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
  app.use(
    "/auth/identity-events",
    express.text({ type: "application/jwt", limit: "64kb" }),
  );
  await app.listen(0, "127.0.0.1");
  const f = {
    app,
    base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
    hub,
    authority,
    changes,
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
  "Console changes-v1 over real services",
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

      for (const file of [
        "00_schemas.sql",
        "10_account.sql",
        "18_access.sql",
        "20_tenancy.sql",
        "22_appoidc.sql",
        "24_session.sql",
        "25_identity_recovery.sql",
        "26_rp_session_notifications.sql",
        "50_metering.sql",
        "96_identity_changes.sql",
        "96_identity_delivery.sql",
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
          sid?: string;
        };
        centralReads++;
        if (req.url === "/oidc/session/status") {
          const session = central.get(body.sid!);
          res.end(
            JSON.stringify({
              valid: session?.active === true,
              next_check_at: Math.floor(Date.now() / 1000) + 60,
            }),
          );
          return;
        }
        const binding = {
          issuer,
          audience: "console",
          realm: "customer",
          environment: "dev",
          profile: req.url?.includes("/changes/") ? "changes-v1" : "logout-v1",
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
                        context_version: s.contextVersion ?? "0",
                        authorization_version: s.accessVersion ?? "0",
                        context: s.context ?? null,
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
      await pool.query(
        "truncate session.rp_revocation_receipts, session.rp_identity_inbox, session.rp_identity_versions",
      );
      for (const f of fixtures) {
        f.authority.reset();
        f.changes.reset();
      }
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
        await admin.query(`drop database if exists "${database}"`);
        await admin.end();
      }
    }, 60000);

    // ========================================================================
    // Durable commit, signed receipt and multi-instance delivery
    // ========================================================================

    function change(
      session: RpSession,
      type: IdentityChangeEvent["type"] = "identity.access_changed",
      version = "1",
    ): IdentityChangeEvent {
      return {
        schema_version: 1,
        type,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        issuer,
        audience: "console",
        realm: "customer",
        environment: "dev",
        cursor: "trusted-opaque",
        version,
        subject: {
          sub: session.sub,
          ...(type === "session.context_changed" ? { sid: session.sid } : {}),
        },
        ...(type === "identity.access_changed"
          ? { scope: { org_id: null, workspace_id: null, product_id: null } }
          : {}),
      };
    }
    const postEvent = (
      f: Fixture,
      event: IdentityChangeEvent,
      claims: Record<string, unknown> = {},
      typ = "vxture-identity-event+jwt",
    ) =>
      fetch(`${f.base}/auth/identity-events`, {
        method: "POST",
        headers: { "content-type": "application/jwt" },
        body: jwt(
          {
            event,
            jti: randomUUID(),
            exp: Math.floor(Date.now() / 1000) + 120,
            ...claims,
          },
          typ,
        ),
      });
    it("advertises polling retirement only with explicit rollout opt-in", async () => {
      for (const retirement of [false, true]) {
        const f = await fixture(true, retirement);
        const session = await login(f);
        const stream = await open(f, session.rpsid);
        expect(stream.response.headers.get("x-vxture-session-sync")).toBe(
          retirement ? "events-v1" : null,
        );
      }
    });

    it("durably ACKs before fanout to every instance and keeps duplicate delivery idempotent", async () => {
      const f = fixtures[0]!,
        { rpsid, session } = await login(f);
      const tabs = await Promise.all([
        open(f, rpsid),
        open(fixtures[1]!, rpsid),
      ]);
      const event = change(session);
      central.get(session.sid)!.accessVersion = "1";
      expect((await postEvent(f, event)).status).toBe(204);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from session.rp_identity_inbox",
          )
        ).rows[0].n,
      ).toBe(1);
      await vi.waitFor(() =>
        expect(
          tabs.every((s) => s.frames.some((x) => x.includes("access-changed"))),
        ).toBe(true),
      );
      expect((await postEvent(fixtures[1]!, event)).status).toBe(204);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from session.rp_identity_inbox",
          )
        ).rows[0].n,
      ).toBe(1);
      for (const s of tabs)
        expect(s.frames.join("")).not.toContain(session.sub);
    });
    it("reconstructs the central context instead of the old token and keeps versions independent", async () => {
      const f = fixtures[0]!,
        { rpsid, session } = await login(f);
      const stream = await open(f, rpsid);
      const context = { org_id: randomUUID(), workspace_id: randomUUID() };
      Object.assign(central.get(session.sid)!, {
        context,
        contextVersion: "2",
        accessVersion: "5",
      });
      expect(
        (await postEvent(f, change(session, "session.context_changed", "2")))
          .status,
      ).toBe(204);
      expect(
        (await postEvent(f, change(session, "identity.access_changed", "5")))
          .status,
      ).toBe(204);
      await vi.waitFor(() =>
        expect(stream.frames.some((x) => x.includes("context-changed"))).toBe(
          true,
        ),
      );
      const response = await fetch(`${f.base}/auth/session`, {
        headers: { cookie: `${cookieName}=${rpsid}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "active",
        claims: {
          active_org: context.org_id,
          active_workspace: context.workspace_id,
          context_version: "2",
          authorization_version: "5",
          roles: [],
        },
      });
      expect(await f.store.get(rpsid)).toMatchObject({
        accessToken: session.accessToken,
      });
    });
    it("never regresses on reordering, and accepts refreshed recovery cursors for the same fact", async () => {
      const f = fixtures[0]!,
        { session } = await login(f);
      const high = change(session, "identity.access_changed", "9");
      await f.changes.apply(high);
      await f.changes.apply(change(session, "identity.access_changed", "3"));
      await f.changes.apply({ ...high, cursor: "fresh-recovery-cursor" });
      expect((await f.changes.versions(session)).access).toBe("9");
      expect((await postEvent(f, { ...high, version: "10" })).status).toBe(409);
      expect((await f.changes.versions(session)).access).toBe("9");
    });
    it.each([
      ["wrong audience", { aud: "other" }, "vxture-identity-event+jwt"],
      [
        "wrong issuer",
        { iss: "https://other.test" },
        "vxture-identity-event+jwt",
      ],
      ["expired", { iat: 1, exp: 100 }, "vxture-identity-event+jwt"],
      [
        "future issuance",
        {
          iat: Math.floor(Date.now() / 1000) + 300,
          exp: Math.floor(Date.now() / 1000) + 400,
        },
        "vxture-identity-event+jwt",
      ],
      [
        "long lifetime",
        { exp: Math.floor(Date.now() / 1000) + 600 },
        "vxture-identity-event+jwt",
      ],
      ["OIDC JWT", {}, "JWT"],
    ])("rejects %s before persistence", async (_label, claims, typ) => {
      const f = fixtures[0]!,
        { session } = await login(f);
      expect(
        (
          await postEvent(
            f,
            change(session),
            claims as Record<string, unknown>,
            typ as string,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from session.rp_identity_inbox",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("rejects environment mismatch and unknown event fields", async () => {
      const f = fixtures[0]!,
        { session } = await login(f);
      expect(
        (await postEvent(f, { ...change(session), environment: "prod" }))
          .status,
      ).toBe(401);
      expect(
        (
          await postEvent(f, {
            ...change(session),
            permissions: ["admin"],
          } as IdentityChangeEvent)
        ).status,
      ).toBe(401);
    });
    it("does not trust forged notifications or publish uncommitted state", async () => {
      const f = fixtures[0]!,
        { session, rpsid } = await login(f),
        stream = await open(f, rpsid);
      await pool.query("select pg_notify('rp_identity_changed',$1)", [
        JSON.stringify({
          issuer,
          client_id: "console",
          environment: "dev",
          realm: "customer",
          kind: "access",
          subject_key: session.sub,
          sub: session.sub,
        }),
      ]);
      await pulse(stream);
      expect(stream.frames.some((x) => x.includes("access-changed"))).toBe(
        false,
      );
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "update session.rp_identity_versions set version=99 where kind='access'",
        );
        await tx.query("rollback");
      } finally {
        tx.release();
      }
      await pulse(stream);
      expect(stream.frames.some((x) => x.includes("access-changed"))).toBe(
        false,
      );
    });
    it("recovers missed changes after listener generation loss without steady central reads", async () => {
      const f = fixtures[0]!,
        { session, rpsid } = await login(f);
      let stream = await open(f, rpsid);
      const reads = centralReads;
      await pulse(stream);
      expect(centralReads).toBe(reads);
      f.hub.invalidate();
      Object.assign(central.get(session.sid)!, {
        accessVersion: "7",
        contextVersion: "4",
        context: { org_id: randomUUID(), workspace_id: null },
      });
      stream = await open(f, rpsid);
      expect(stream.response.status).toBe(200);
      expect((await f.changes.view(session))!.authorization_version).toBe("7");
      expect((await f.changes.versions(session)).context).toBe("4");
    });
    it("keeps terminal logout ahead of newer access or context versions", async () => {
      const f = fixtures[0]!,
        { session, rpsid } = await login(f),
        stream = await open(f, rpsid);
      await receipt(session.sid);
      await ended(stream);
      expect(
        (await postEvent(f, change(session, "identity.access_changed", "100")))
          .status,
      ).toBe(204);
      expect((await open(f, rpsid)).response.status).toBe(401);
      const fresh = await login(f);
      expect((await open(f, fresh.rpsid)).response.status).toBe(200);
    });
    it("returns unavailable without ACK when durable persistence fails", async () => {
      const f = fixtures[0]!,
        { session } = await login(f);
      vi.spyOn(f.changes, "apply").mockRejectedValueOnce(
        new Error("storage unavailable"),
      );
      const event = change(session);
      expect((await postEvent(f, event)).status).toBe(503);
      expect((await postEvent(f, event)).status).toBe(204);
    });
  },
);
