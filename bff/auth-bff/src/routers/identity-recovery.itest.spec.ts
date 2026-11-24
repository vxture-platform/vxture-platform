/**
 * Recovery HTTP contracts and real PostgreSQL commit-order/visibility boundaries.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
// ⚠️ 跨层引用: Replace authentication only; use real recovery persistence and HTTP.
import { PgOidcClientRepository } from "@vxture/service-iam";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IdentityRecoveryRepository } from "../authn/identity-recovery.repository";
import { SessionService } from "../authn/session.service";
import { IdentityRecoveryRouter } from "./identity-recovery.router";

// ============================================================================
// Random disposable local database, OS-assigned HTTP port, no shared-state writes.
// ============================================================================
const connectionString = process.env["IDENTITY_PG_ITEST_URL"];
const database = `identity_recovery_itest_${randomUUID().replaceAll("-", "")}`;
const issuer = "https://accounts.example.test";
const user = randomUUID();
let admin: Pool;
let pool: Pool;
let app: INestApplication;
let base: string;
let sessions: SessionService;
let repository: IdentityRecoveryRepository;
const auth = {
  authenticateClient: vi.fn(async (id: string, secret: string) =>
    ["product", "other", "operator", "public"].includes(id) &&
    secret === "secret"
      ? {
          clientId: id,
          realm: id === "operator" ? "workforce" : "customer",
          tokenEndpointAuthMethod:
            id === "public" ? "none" : "client_secret_basic",
        }
      : null,
  ),
};
@Module({
  controllers: [IdentityRecoveryRouter],
  providers: [
    { provide: IdentityRecoveryRepository, useFactory: () => repository },
    { provide: PgOidcClientRepository, useValue: auth },
    { provide: VxConfigService, useValue: { auth: { OIDC_ISSUER: issuer } } },
  ],
})
class RecoveryTestModule {}
function post(
  path: string,
  body: unknown,
  client = "product",
  authorization?: string,
) {
  return fetch(`${base}/oidc/identity/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization:
        authorization ??
        `Basic ${Buffer.from(`${client}:secret`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
}
async function session(
  client = "product",
  realm: "customer" | "workforce" = "customer",
) {
  const record = await sessions.create({
    userId: user,
    realm,
    authMethod: "password",
    absTtlSeconds: 300,
  });
  if (realm === "customer") await sessions.bindClient(record.sid, user, client);
  return record.sid;
}
async function snapshot(sids: string[]) {
  return repository.snapshot("product", issuer, sids);
}
async function events(cursor: string, limit = 100) {
  return repository.events("product", issuer, cursor, limit);
}

describe.skipIf(!connectionString)(
  "identity recovery HTTP and PostgreSQL",
  () => {
    beforeAll(async () => {
      const url = new URL(connectionString!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new Error("Local test database required");
      admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
      await admin.query(`create database "${database}"`);
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
      sessions = new SessionService(pool, {} as never);
      repository = new IdentityRecoveryRepository(pool);
      app = await NestFactory.create(RecoveryTestModule, { logger: false });
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    }, 30000);
    beforeEach(async () => {
      vi.restoreAllMocks();
      await pool.query(
        "truncate session.identity_recovery_events,session.identity_recovery_streams,session.logout_deliveries,session.oidc_session_clients,session.auth_sessions,session.refresh_tokens,appoidc.oidc_clients cascade",
      );
      for (const client of ["product", "other"])
        await pool.query(
          `insert into appoidc.oidc_clients(client_id,client_kind,redirect_uris,slo_participation,back_channel_logout_uri)
        values($1,'platform','{}','back_channel','https://rp.example/logout');`,
          [client],
        );
      for (const client of ["product", "other"])
        await pool.query(
          `insert into session.identity_recovery_streams(client_id,issuer,environment,release_channel,logout_uri,enabled)
        values($1,$2,'dev','stable','https://rp.example/logout',true)`,
          [client, issuer],
        );
    });
    afterAll(async () => {
      await app?.close();
      await pool?.end();
      if (admin) {
        await admin.query(`drop database if exists "${database}"`);
        await admin.end();
      }
    });

    // ========================================================================
    // Scope, request validation and explicit failure semantics
    // ========================================================================
    it("exposes only exact client bindings with one consistent watermark", async () => {
      const sid = await session();
      const other = await session("other");
      const workforce = await session("product", "workforce");
      const orgId = randomUUID();
      await sessions.setContext(sid, { orgId, workspaceId: null });
      const response = await post("snapshot", {
        sids: [sid, other, workforce, "missing"],
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      const data = (await response.json()) as Awaited<
        ReturnType<typeof snapshot>
      >;
      expect(data).toMatchObject({
        binding: {
          issuer,
          audience: "product",
          realm: "customer",
          environment: "dev",
          profile: "logout-v1",
        },
        sessions: [
          {
            sid,
            state: "active",
            sub: `usr_${user}`,
            context_version: "1",
            context: { org_id: orgId, workspace_id: null },
          },
          { sid: other, state: "not_bound" },
          { sid: workforce, state: "not_bound" },
          { sid: "missing", state: "not_bound" },
        ],
      });
      expect(JSON.stringify(data)).not.toMatch(
        /cursor_key|logout_uri|refresh_token|authorization_version/,
      );
      expect(await events(data.watermark)).toMatchObject({
        events: [],
        has_more: false,
      });
    });

    it.each([
      "Bearer token",
      "Basic !!!",
      `Basic ${Buffer.from("product:wrong").toString("base64")}`,
    ])("rejects invalid authentication %s", async (authorization) => {
      const res = await post(
        "snapshot",
        { sids: [] },
        "product",
        authorization,
      );
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Basic");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toMatchObject({
        code: "INVALID_CLIENT",
        retryable: false,
      });
    });
    it.each([
      ["operator", 403],
      ["public", 401],
      ["unknown", 401],
    ] as const)("rejects unsuitable client %s", async (client, code) => {
      expect((await post("snapshot", { sids: [] }, client)).status).toBe(code);
    });
    it.each([
      {},
      { sids: ["duplicate", "duplicate"] },
      { sids: ["x".repeat(65)] },
      { sids: [], environment: "prod" },
      { sids: Array.from({ length: 101 }, (_, i) => String(i)) },
    ])("rejects invalid snapshot request %j", async (body) => {
      expect((await post("snapshot", body)).status).toBe(400);
    });
    it.each([
      { cursor: "x", limit: 101 },
      { cursor: "x", limit: 0 },
      { cursor: "x", sid: "foreign" },
      { cursor: "x".repeat(513) },
    ])("rejects invalid events request %j", async (body) => {
      expect((await post("events", body)).status).toBe(400);
    });
    it("returns 503 without leaking store errors or reporting inactive", async () => {
      vi.spyOn(pool, "connect").mockRejectedValueOnce(
        new Error("private database details"),
      );
      const response = await post("snapshot", { sids: ["sid"] });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "IDENTITY_UNAVAILABLE",
        retryable: true,
      });
    });

    // ========================================================================
    // Commit ordering, rollback and recovery race proofs
    // ========================================================================
    it("does not skip a lower uncommitted event when taking a snapshot", async () => {
      const sid = await session();
      const nextSid = await session();
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "update session.auth_sessions set status='revoked' where sid=$1",
          [sid],
        );
        const before = await snapshot([sid, nextSid]);
        expect(before.sessions.every((s) => s.state === "active")).toBe(true);
        expect((await events(before.watermark)).events).toEqual([]);
        // The second transaction cannot publish sequence 2 ahead of sequence 1.
        const second = sessions.revoke(nextSid);
        await tx.query("commit");
        await second;
        const recovered = await events(before.watermark, 1);
        expect(recovered.has_more).toBe(true);
        expect(recovered.events[0]?.subject.sid).toBe(sid);
        const tail = await events(recovered.next_cursor);
        expect(tail.events[0]?.subject.sid).toBe(nextSid);
        expect(tail.has_more).toBe(false);
        expect((await snapshot([sid])).sessions).toEqual([
          { sid, state: "inactive" },
        ]);
      } finally {
        await tx.query("rollback");
        tx.release();
      }
    });

    it("rolls back event allocation with revocation and leaves no cursor gap", async () => {
      const sid = await session();
      const before = await snapshot([sid]);
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "update session.auth_sessions set status='revoked' where sid=$1",
          [sid],
        );
        await tx.query("rollback");
        expect((await events(before.watermark)).events).toEqual([]);
        await sessions.revoke(sid);
        await sessions.revoke(sid);
        const page = await events(before.watermark);
        expect(page.events).toHaveLength(1);
        expect(page.events[0]).toMatchObject({
          schema_version: 1,
          type: "session.revoked",
          version: "2",
          subject: { sid, sub: `usr_${user}` },
        });
      } finally {
        tx.release();
      }
    });

    it("continues recording while capability is disabled and refuses reading until enabled", async () => {
      const sid = await session();
      const before = await snapshot([sid]);
      await pool.query(
        "update session.identity_recovery_streams set enabled=false where client_id='product'",
      );
      await sessions.revoke(sid);
      expect((await post("events", { cursor: before.watermark })).status).toBe(
        403,
      );
      await pool.query(
        "update session.identity_recovery_streams set enabled=true where client_id='product'",
      );
      expect((await events(before.watermark)).events).toHaveLength(1);
    });

    it("binds authenticated cursors to the exact client and rejects tampering", async () => {
      const before = await snapshot([]);
      expect(
        (await post("events", { cursor: before.watermark }, "other")).status,
      ).toBe(403);
      expect(
        (
          await post("events", {
            cursor: `${before.watermark.slice(0, -5)}aaaaa`,
          })
        ).status,
      ).toBe(403);
      await expect(
        pool.query(
          "update session.identity_recovery_streams set environment='prod' where client_id='product'",
        ),
      ).rejects.toThrow("immutable");
    });

    it("requires a new snapshot for an expired signed cursor", async () => {
      const realNow = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(realNow - 8 * 86400000);
      const before = await snapshot([]);
      vi.restoreAllMocks();
      const response = await post("events", { cursor: before.watermark });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: "CURSOR_EXPIRED" });
    });

    it("refuses a changed registration and does not move an old stream to a new endpoint", async () => {
      await pool.query(
        "update appoidc.oidc_clients set release_channel='beta' where client_id='product'",
      );
      expect((await post("snapshot", { sids: [] })).status).toBe(403);
    });

    it("reports already expired state without waiting for the expiration worker", async () => {
      const sid = await session();
      await pool.query(
        "update session.auth_sessions set expires_at=now()-interval '1 second' where sid=$1",
        [sid],
      );
      expect((await snapshot([sid])).sessions).toEqual([
        { sid, state: "inactive" },
      ]);
    });

    it("refuses a hole in retained events instead of advancing the recovery cursor", async () => {
      const sid = await session();
      const before = await snapshot([sid]);
      await sessions.revoke(sid);
      await pool.query("delete from session.identity_recovery_events");
      expect((await post("events", { cursor: before.watermark })).status).toBe(
        410,
      );
    });

    it("can rerun the migration without changing an established stream or receipt", async () => {
      const sid = await session();
      const before = await snapshot([sid]);
      await sessions.revoke(sid);
      const sql = await readFile(
        new URL(
          "../../../../deploy/database/migrations/2026-12-16-identity-logout-recovery.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(sql);
      await pool.query(sql);
      expect((await events(before.watermark)).events).toHaveLength(1);
    });

    it("refuses a missing tail even when an earlier retained event is returned", async () => {
      const first = await session();
      const last = await session();
      const before = await snapshot([first, last]);
      await sessions.revoke(first);
      await sessions.revoke(last);
      await pool.query(
        "delete from session.identity_recovery_events where sequence=2",
      );
      expect((await post("events", { cursor: before.watermark })).status).toBe(
        410,
      );
    });
  },
);
