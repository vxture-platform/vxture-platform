/**
 * Real PostgreSQL transaction/lease tests and real HTTP logout fault recovery.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
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
import { SessionService } from "./session.service";
import { SessionLogoutRepository } from "./session-logout.repository";
import { SessionLogoutJob } from "../accounts/session-logout.job";

// ============================================================================
// Each run creates and drops only its randomly named database on a test server.
// ============================================================================
const connectionString = process.env["IDENTITY_PG_ITEST_URL"];
const database = `identity_logout_itest_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID();
let admin: Pool;
let pool: Pool;
let sessions: SessionService;
let queue: SessionLogoutRepository;
let server: Server;
let endpoint: string;
let httpStatus = 200;
let requests: string[] = [];
let dropAck = false;
let redirectHits = 0;
let activeJob: SessionLogoutJob | undefined;
const keys = { sign: vi.fn(() => `signed-${randomUUID()}`) };
const migration = () =>
  readFile(
    new URL(
      "../../../../deploy/database/migrations/2026-12-15-customer-session-outbox.sql",
      import.meta.url,
    ),
    "utf8",
  );

async function createSession(realm: "customer" | "workforce" = "customer") {
  return sessions.create({
    userId,
    realm,
    authMethod: "password",
    absTtlSeconds: 300,
  });
}
async function queued() {
  const session = await createSession();
  await sessions.bindClient(session.sid, userId, "product");
  await sessions.revoke(session.sid);
  return session;
}
async function rows(sid: string) {
  return (
    await pool.query("select * from session.logout_deliveries where sid=$1", [
      sid,
    ])
  ).rows;
}
async function due(sid: string) {
  await pool.query(
    "update session.logout_deliveries set available_at=now()-interval '1 second' where sid=$1",
    [sid],
  );
}
function worker() {
  return new SessionLogoutJob(queue, keys as never);
}

describe.skipIf(!connectionString)(
  "durable customer logout (PostgreSQL + HTTP)",
  () => {
    beforeAll(async () => {
      const url = new URL(connectionString!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new Error(
          "IDENTITY_PG_ITEST_URL must address a local test PostgreSQL server",
        );
      admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
      await admin.query(`create database "${database}"`);
      url.pathname = `/${database}`;
      pool = new Pool({
        connectionString: url.toString(),
        max: 8,
        connectionTimeoutMillis: 5000,
      });
      await pool.query("create schema session; create schema appoidc");
      for (const file of ["22_appoidc.sql", "24_session.sql"])
        await pool.query(
          await readFile(
            new URL(`../../../../deploy/database/ddl/${file}`, import.meta.url),
            "utf8",
          ),
        );
      sessions = new SessionService(pool, {} as never);
      queue = new SessionLogoutRepository(pool);
      server = createServer(async (req, res) => {
        if (req.url === "/redirect-target") redirectHits += 1;
        let body = "";
        for await (const part of req) body += String(part);
        requests.push(body);
        if (dropAck) {
          req.socket.destroy();
          return;
        }
        res.writeHead(httpStatus, {
          "Retry-After": "1",
          Location: `${endpoint}/redirect-target`,
        });
        res.end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }, 30000);

    beforeEach(async () => {
      if (activeJob) {
        await activeJob.onModuleDestroy();
        activeJob = undefined;
      }
      await pool.query(
        "truncate session.logout_deliveries,session.oidc_session_clients,session.auth_sessions,session.refresh_tokens,appoidc.oidc_clients cascade",
      );
      await pool.query(
        `insert into appoidc.oidc_clients
      (client_id,realm,client_kind,redirect_uris,slo_participation,back_channel_logout_uri)
      values ('product','customer','platform','{}','back_channel',$1),
             ('operator','workforce','platform','{}','back_channel',$1)`,
        [endpoint],
      );
      httpStatus = 200;
      dropAck = false;
      requests = [];
      redirectHits = 0;
      keys.sign.mockClear();
    });

    afterAll(async () => {
      await activeJob?.onModuleDestroy();
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await pool?.end();
      if (admin) {
        await admin.query(`drop database if exists "${database}" with (force)`);
        await admin.end();
      }
    });

    // ========================================================================
    // Commit, rollback, realm boundaries and authorization/revocation races
    // ========================================================================
    it("rolls back revocation and delivery together, then enqueues every recipient on direct SQL commit", async () => {
      const s = await createSession();
      await sessions.bindClient(s.sid, userId, "product");
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "update session.auth_sessions set status='revoked' where sid=$1",
          [s.sid],
        );
        expect(
          (await tx.query("select * from session.logout_deliveries")).rowCount,
        ).toBe(1);
        await tx.query("rollback");
        expect(await sessions.get(s.sid)).not.toBeNull();
        expect(await rows(s.sid)).toHaveLength(0);
        await sessions.revoke(s.sid);
        const delivery = await rows(s.sid);
        expect(delivery).toHaveLength(1);
        await sessions.revoke(s.sid);
        expect(await rows(s.sid)).toEqual(delivery);
        await expect(
          pool.query(
            "update session.auth_sessions set status='active' where sid=$1",
            [s.sid],
          ),
        ).rejects.toThrow("cannot be reactivated");
      } finally {
        tx.release();
      }
    });

    it("retains a committed recipient when logout starts while its row is locked", async () => {
      const s = await createSession();
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "select sid from session.auth_sessions where sid=$1 for update",
          [s.sid],
        );
        await tx.query(
          "insert into session.oidc_session_clients(sid,client_id,release_channel,logout_uri) values($1,'product','stable',$2)",
          [s.sid, endpoint],
        );
        const revoke = sessions.revoke(s.sid);
        await tx.query("commit");
        await revoke;
        expect(await rows(s.sid)).toHaveLength(1);
      } finally {
        tx.release();
      }
    });

    it("rejects a late binding after concurrent revocation commits", async () => {
      const s = await createSession();
      const tx = await pool.connect();
      try {
        await tx.query("begin");
        await tx.query(
          "update session.auth_sessions set status='revoked' where sid=$1",
          [s.sid],
        );
        const binding = sessions.bindClient(s.sid, userId, "product");
        const assertion = expect(binding).rejects.toThrow("invalid_grant");
        await tx.query("commit");
        await assertion;
        expect(await sessions.getClients(s.sid)).toEqual([]);
      } finally {
        tx.release();
      }
    });

    it("never binds another owner, workforce session or workforce client", async () => {
      const s = await createSession();
      const w = await createSession("workforce");
      await expect(
        sessions.bindClient(s.sid, randomUUID(), "product"),
      ).rejects.toThrow("invalid_grant");
      await expect(
        sessions.bindClient(s.sid, userId, "operator"),
      ).rejects.toThrow("invalid_grant");
      await expect(
        sessions.bindClient(w.sid, userId, "product"),
      ).rejects.toThrow("invalid_grant");
      await pool.query(
        "update session.auth_sessions set status='revoked' where sid=$1",
        [w.sid],
      );
      expect(await rows(w.sid)).toEqual([]);
    });

    it("persists a coherent context/version without extending expiry or reviving an ended session", async () => {
      const s = await createSession();
      const orgId = randomUUID();
      const workspaceId = randomUUID();
      await sessions.setContext(s.sid, { orgId, workspaceId });
      await sessions.setContext(s.sid, { orgId, workspaceId });
      await sessions.setContext(s.sid, { orgId, workspaceId: null });
      expect(await sessions.getContext(s.sid)).toEqual({
        orgId,
        workspaceId: null,
      });
      const record = (
        await pool.query(
          "select context_version,expires_at from session.auth_sessions where sid=$1",
          [s.sid],
        )
      ).rows[0];
      expect(record.context_version).toBe("2");
      expect(record.expires_at).toEqual(s.expiresAt);
      await sessions.revoke(s.sid);
      await expect(
        sessions.setContext(s.sid, { orgId, workspaceId }),
      ).rejects.toThrow("invalid_grant");
    });

    it("grants context writes to the restricted runtime role without unlocking anchors", async () => {
      const role = `session_context_${randomUUID().replaceAll("-", "")}`;
      const session = await createSession();
      await admin.query(`create role ${role}`);
      const runtime = new Pool({
        ...pool.options,
        options: `-c role=${role}`,
        max: 1,
      });
      try {
        await pool.query(`grant usage on schema session to ${role};
          grant select on session.auth_sessions to ${role};
          grant update(status,last_active_at,revoked_at) on session.auth_sessions to ${role}`);
        const restricted = new SessionService(runtime, {} as never);
        const context = { orgId: randomUUID(), workspaceId: randomUUID() };
        await expect(
          restricted.setContext(session.sid, context),
        ).rejects.toMatchObject({ code: "42501" });
        // Substitute only the role name so the production migration can run
        // against a unique test role without altering any shared role grants.
        await pool.query((await migration()).replaceAll("platform_svc", role));
        await restricted.setContext(session.sid, context);
        expect(await restricted.getContext(session.sid)).toEqual(context);
        await expect(
          runtime.query(
            "update session.auth_sessions set created_at=now() where sid=$1",
            [session.sid],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        const record = (
          await pool.query(
            "select context_version,expires_at from session.auth_sessions where sid=$1",
            [session.sid],
          )
        ).rows[0];
        expect(record.context_version).toBe("1");
        expect(record.expires_at).toEqual(session.expiresAt);
      } finally {
        await runtime.end();
        await pool.query(`drop owned by ${role}`);
        await admin.query(`drop role ${role}`);
      }
    });

    it("upgrades legacy bindings and is rerunnable alongside fresh DDL", async () => {
      const s = await createSession();
      await pool.query(
        "insert into session.refresh_tokens(user_id,session_id,client_id,token_hash,expires_at) values($1,$2,'product','historic-proof',now()+interval '1 day')",
        [userId, s.sid],
      );
      await pool.query(
        "drop trigger trg_customer_session_logout on session.auth_sessions; drop function session.enqueue_customer_logout(); drop table session.logout_deliveries,session.oidc_session_clients; alter table session.auth_sessions drop column active_org_id, drop column active_workspace_id, drop column context_version",
      );
      const sql = await migration();
      await pool.query(sql);
      await pool.query(sql);
      expect(await sessions.getClients(s.sid)).toEqual(["product"]);
      await sessions.revoke(s.sid);
      expect(await rows(s.sid)).toHaveLength(1);
    });

    it("expires only due customer sessions and records their recipients", async () => {
      const s = await createSession();
      const w = await createSession("workforce");
      await sessions.bindClient(s.sid, userId, "product");
      await pool.query(
        "update session.auth_sessions set expires_at=now()-interval '1 second' where sid=any($1::text[])",
        [[s.sid, w.sid]],
      );
      expect(await queue.expire()).toBe(1);
      expect(await rows(s.sid)).toHaveLength(1);
      expect(
        (
          await pool.query(
            "select status from session.auth_sessions where sid=$1",
            [w.sid],
          )
        ).rows[0].status,
      ).toBe("active");
    });

    // ========================================================================
    // Competing workers, abandoned leases and real transport faults
    // ========================================================================
    it("leases each job once across workers and fences a crashed owner's late ACK", async () => {
      const s = await queued();
      const claims = await Promise.all([
        queue.claim(),
        new SessionLogoutRepository(pool).claim(),
      ]);
      const jobs = claims.flat();
      expect(jobs).toHaveLength(1);
      await pool.query(
        "update session.logout_deliveries set lease_until=now()-interval '1 second' where sid=$1",
        [s.sid],
      );
      const next = (await queue.claim())[0]!;
      expect(next.lease_id).not.toBe(jobs[0]!.lease_id);
      expect(await queue.finish(jobs[0]!, "delivered", null)).toBe(false);
      expect(await queue.finish(next, "delivered", null)).toBe(true);
    });

    it("retries HTTP 503 after worker recreation with a fresh JWT envelope", async () => {
      const s = await queued();
      httpStatus = 503;
      const first = worker();
      await first.deliver((await queue.claim())[0]!);
      expect((await rows(s.sid))[0]).toMatchObject({
        status: "pending",
        attempts: 1,
        last_error: "http_503",
      });
      expect((await rows(s.sid))[0].available_at.getTime()).toBeGreaterThan(
        Date.now() - 500,
      );
      await first.onModuleDestroy();
      await due(s.sid);
      httpStatus = 204;
      await worker().deliver(
        (await new SessionLogoutRepository(pool).claim())[0]!,
      );
      expect((await rows(s.sid))[0]).toMatchObject({
        status: "delivered",
        attempts: 2,
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]).not.toBe(requests[1]);
      expect(keys.sign).toHaveBeenCalledWith(
        {
          sid: s.sid,
          events: { "http://schemas.openid.net/event/backchannel-logout": {} },
        },
        { audience: "product", subject: `usr_${userId}`, expiresInSec: 120 },
      );
    });

    it("redelivers after a lost HTTP ACK instead of falsely recording success", async () => {
      const s = await queued();
      dropAck = true;
      await worker().deliver((await queue.claim())[0]!);
      expect((await rows(s.sid))[0].status).toBe("pending");
      dropAck = false;
      await due(s.sid);
      await worker().deliver((await queue.claim())[0]!);
      expect((await rows(s.sid))[0].status).toBe("delivered");
      expect(requests).toHaveLength(2);
    });

    it("never follows a redirect carrying a logout token", async () => {
      const s = await queued();
      httpStatus = 302;
      await worker().deliver((await queue.claim())[0]!);
      expect(redirectHits).toBe(0);
      expect(requests).toHaveLength(1);
      expect((await rows(s.sid))[0].status).toBe("pending");
    });

    it.each([
      "release_channel='beta'",
      "back_channel_logout_uri='https://changed.example/logout'",
      "status='inactive'",
    ])(
      "quarantines changed registration %s without sending",
      async (change) => {
        const s = await queued();
        await pool.query(
          `update appoidc.oidc_clients set ${change} where client_id='product'`,
        );
        await worker().deliver((await queue.claim())[0]!);
        expect((await rows(s.sid))[0]).toMatchObject({
          status: "quarantined",
          last_error: "registration_changed",
        });
        expect(requests).toHaveLength(0);
      },
    );

    it("quarantines permanent rejection and exhausted retry windows", async () => {
      const s = await queued();
      httpStatus = 400;
      await worker().deliver((await queue.claim())[0]!);
      expect((await rows(s.sid))[0].last_error).toBe("http_400");
      const other = await queued();
      await pool.query(
        "update session.logout_deliveries set retry_until=now()-interval '1 second' where sid=$1",
        [other.sid],
      );
      await worker().deliver((await queue.claim())[0]!);
      expect((await rows(other.sid))[0].last_error).toBe(
        "retry_window_exhausted",
      );
      expect(requests).toHaveLength(1);
    });

    it("recovers startup backlog and wakes on a later committed revocation", async () => {
      const backlog = await queued();
      activeJob = worker();
      activeJob.onApplicationBootstrap();
      await vi.waitFor(
        async () =>
          expect((await rows(backlog.sid))[0].status).toBe("delivered"),
        { timeout: 5000 },
      );
      const later = await queued();
      await vi.waitFor(
        async () => expect((await rows(later.sid))[0].status).toBe("delivered"),
        { timeout: 5000 },
      );
      expect(requests).toHaveLength(2);
    });
  },
);
