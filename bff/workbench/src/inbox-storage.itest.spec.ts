/**
 * Exercise actual pool modes, inbox HTTP writes and least-privilege PostgreSQL grants.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { configureHttp } from "./bootstrap";
import { PoolsModule } from "./pools.module";
import { InboxRouter } from "./inbox-router";
import { SessionService } from "./auth/session-service";
import { INBOX_WRITE_POOL, PRIMARY_POOL, READ_POOL } from "./tokens";

// ============================================================================
// Explicit local-only opt-in; create and clean only this invocation's database.
// ============================================================================
const run =
  process.env.WORKBENCH_PG_ITEST === "1" &&
  !!process.env.WORKBENCH_PG_ITEST_ADMIN_URL;
const ACCOUNT = "00000000-0000-4000-a000-000000000100";
const OTHER = "00000000-0000-4000-a000-000000000200";
const MESSAGE = "00000000-0000-4000-a000-000000000001";
const FOREIGN = "00000000-0000-4000-a000-000000000002";
const DELETED = "00000000-0000-4000-a000-000000000003";
const ORIGIN = "http://127.0.0.1";
const headers = { Origin: ORIGIN, "X-Workbench-Request": "1" };

describe.runIf(run)("inbox storage (isolated live PostgreSQL)", () => {
  const database = `workbench_itest_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let fixture: Pool;
  let app: INestApplication | undefined;
  let writer: Pool;
  let primary: Pool;
  let reporting: Pool;
  let base: string;
  let databaseCreated = false;
  let roleCreated = false;
  let grantSql: string;

  beforeAll(async () => {
    const url = new URL(process.env.WORKBENCH_PG_ITEST_ADMIN_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Inbox integration tests require local PostgreSQL");
    admin = new Pool({ connectionString: url.href });
    const existing = await admin.query(
      "select 1 from pg_roles where rolname = 'svc_workbench_inbox'",
    );
    if (existing.rowCount)
      throw new Error("Use an isolated cluster without svc_workbench_inbox");
    await admin.query(`create database ${database}`);
    databaseCreated = true;
    url.pathname = `/${database}`;
    fixture = new Pool({ connectionString: url.href });
    const migration = readFileSync(
      new URL(
        "../../../deploy/database/migrations/2026-09-08-inbox-messages.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const tableSql = migration.match(
      /CREATE TABLE IF NOT EXISTS support\.inbox_messages \([\s\S]*?\n\);/,
    )?.[0];
    if (!tableSql) throw new Error("Inbox table DDL not found");
    const supportDdl = readFileSync(
      new URL("../../../deploy/database/ddl/72_support.sql", import.meta.url),
      "utf8",
    );
    const deliveryTableSql = supportDdl.match(
      /CREATE TABLE support\.notification_logs \([\s\S]*?\n\);/,
    )?.[0];
    if (!deliveryTableSql)
      throw new Error("Notification delivery DDL not found");
    await fixture.query(`create schema support; ${tableSql}
      alter table support.inbox_messages add column deleted_at timestamptz;
      ${deliveryTableSql}`);
    const rolesSql = readFileSync(
      new URL(
        "../../../deploy/database/ddl/97_service_roles.sql",
        import.meta.url,
      ),
      "utf8",
    );
    grantSql =
      rolesSql
        .split("-- BEGIN WORKBENCH INBOX ROLE")[1]
        ?.split("-- END WORKBENCH INBOX ROLE")[0] ?? "";
    if (!grantSql.includes("GRANT UPDATE (read_at)"))
      throw new Error("Dedicated inbox grant block not found");
    await fixture.query(grantSql);
    roleCreated = true;
    // Even a role-level read-only default must not disable the dedicated writer.
    await fixture.query(
      "alter role svc_workbench_inbox set default_transaction_read_only = on",
    );
    await fixture.query(
      `insert into support.inbox_messages
       (id, tenant_id, account_id, template_code, title, body, reference_type, reference_id, deleted_at)
       select id, $1, recipient, 'fixture', 'Private title', 'Private body', 'fixture', id::text, deleted
       from (values ($3::uuid, $1::uuid, null::timestamptz),
                    ($4::uuid, $2::uuid, null::timestamptz),
                    ($5::uuid, $1::uuid, now())) as t(id, recipient, deleted)`,
      [ACCOUNT, OTHER, MESSAGE, FOREIGN, DELETED],
    );
    const writerUrl = new URL(url.href);
    writerUrl.username = "svc_workbench_inbox";
    writerUrl.password = "";
    const env = {
      NODE_ENV: "test",
      WORKBENCH_BASE_URL: ORIGIN,
      WORKBENCH_BFF_PORT: "0",
      OIDC_ISSUER: ORIGIN,
      OIDC_CLIENT_ID: "workbench",
      OIDC_CLIENT_SECRET: "fixture-only",
      RP_COOKIE_INSECURE: "true",
      REDIS_URL: "redis://127.0.0.1:1",
      DATABASE_URL: url.href,
      REPORTING_RO_DATABASE_URL: url.href,
      WORKBENCH_INBOX_DATABASE_URL: writerUrl.href,
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    @Module({
      imports: [PoolsModule],
      controllers: [InboxRouter],
      providers: [
        {
          provide: SessionService,
          useValue: {
            authenticate: async () => ({ user: { userId: ACCOUNT } }),
          },
        },
      ],
    })
    class FixtureModule {}
    app = await NestFactory.create(FixtureModule, { logger: false });
    configureHttp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    primary = app.get<Pool>(PRIMARY_POOL);
    reporting = app.get<Pool>(READ_POOL);
    writer = app.get<Pool>(INBOX_WRITE_POOL);
  });

  afterAll(async () => {
    await app?.close();
    await fixture?.end();
    if (databaseCreated) await admin.query(`drop database ${database}`);
    if (roleCreated) await admin.query("drop role svc_workbench_inbox");
    await admin?.end();
    vi.unstubAllEnvs();
  });

  // ========================================================================
  // Verify server-side modes and permissions, not a permissive query mock.
  // ========================================================================
  it("keeps primary and reporting queries read-only while enabling the writer", async () => {
    for (const pool of [primary, reporting]) {
      expect((await pool.query("show transaction_read_only")).rows[0]).toEqual({
        transaction_read_only: "on",
      });
      await expect(
        pool.query("update support.inbox_messages set read_at = now()"),
      ).rejects.toMatchObject({ code: "25006" });
    }
    expect((await writer.query("show transaction_read_only")).rows[0]).toEqual({
      transaction_read_only: "off",
    });
  });

  it("marks a recipient's message through HTTP, preserving foreign/deleted records", async () => {
    const list = await (await fetch(`${base}/api/me/inbox`)).json();
    expect(list).toMatchObject({
      unreadCount: 1,
      items: [{ id: MESSAGE, readAt: null }],
    });
    for (const id of [FOREIGN, DELETED])
      expect(
        (
          await fetch(`${base}/api/me/inbox/${id}/read`, {
            method: "POST",
            headers,
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await fetch(`${base}/api/me/inbox/${MESSAGE}/read`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(201);
    const after = (await (await fetch(`${base}/api/me/inbox`)).json()) as {
      unreadCount: number;
      items: { readAt: string | null }[];
    };
    expect(after.unreadCount).toBe(0);
    expect(after.items[0]?.readAt).toEqual(expect.any(String));
    expect(
      (
        await fixture.query(
          "select read_at from support.inbox_messages where id = any($1::uuid[])",
          [[FOREIGN, DELETED]],
        )
      ).rows,
    ).toEqual([{ read_at: null }, { read_at: null }]);
  });

  it("acknowledges all unread messages idempotently through HTTP", async () => {
    await fixture.query(
      "update support.inbox_messages set read_at = null where id = $1",
      [MESSAGE],
    );
    for (const updated of [1, 0]) {
      const response = await fetch(`${base}/api/me/inbox/read-all`, {
        method: "POST",
        headers,
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ updated });
    }
  });

  it("denies content/recipient/deletion writes, delivery, deletes and unrelated reads", async () => {
    for (const sql of [
      "update support.inbox_messages set title = 'tampered'",
      `update support.inbox_messages set account_id = '${OTHER}'`,
      "update support.inbox_messages set deleted_at = now()",
      "delete from support.inbox_messages",
      "insert into support.inbox_messages (title) values ('forbidden')",
      "select title, body from support.inbox_messages",
      "select * from support.notification_logs",
    ])
      await expect(writer.query(sql)).rejects.toMatchObject({ code: "42501" });
  });

  it("replays the exact deployment grants safely and detects broadened privileges", async () => {
    await expect(fixture.query(grantSql)).resolves.toBeDefined();
    await fixture.query(
      "grant update(title) on support.inbox_messages to svc_workbench_inbox",
    );
    await expect(fixture.query(grantSql)).rejects.toThrow(
      "permissions beyond read_at updates",
    );
    await fixture.query(
      "revoke update(title) on support.inbox_messages from svc_workbench_inbox",
    );
  });
});
