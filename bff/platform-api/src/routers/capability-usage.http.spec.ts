/**
 * Signed HTTP isolation and concurrent idempotency against disposable PostgreSQL.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-21
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sTokenVerifier } from "../authn/s2s-token-verifier.service";
import { CapabilityUsageService } from "../platform/capability-usage.service";
import { PlatformUsageService } from "../platform/platform-usage.service";
import { TokenUsageService } from "../platform/token-usage.service";
import { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
import { PlatformUsageRouter } from "./platform-usage.router";

// --- Disposable database and real JWKS server -------------------------------
const connectionString = process.env["CAPABILITY_USAGE_TEST_DATABASE_URL"];
if (
  connectionString &&
  new URL(connectionString).pathname !== "/platform_usage_test"
) {
  throw new Error(
    "usage tests require the disposable platform_usage_test database",
  );
}
const pool = new Pool({ connectionString, max: 12 });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
let issuer = "";
let jwks: Server;
const config = {
  auth: { OIDC_ISSUER: "", AUTH_INTERNAL_TOKEN: "fixture-legacy" },
  platform: { AUTH_BFF_URL: "" },
};
const forbidden = () => {
  throw new Error("existing consume path must not run for raw facts");
};
@Module({
  controllers: [PlatformUsageRouter],
  providers: [
    PlatformAuthGuard,
    S2sTokenVerifier,
    CapabilityUsageService,
    { provide: "COMMERCE_PG_POOL", useValue: pool },
    { provide: VxConfigService, useValue: config },
    {
      provide: PlatformUsageService,
      useValue: { resolveProductId: forbidden, consume: forbidden },
    },
    { provide: TokenUsageService, useValue: { ingest: forbidden } },
    { provide: LegacyAuthUsageService, useValue: { record: forbidden } },
  ],
})
class TestModule {}

function ticket(overrides: Record<string, unknown> = {}) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "RS256", typ: "JWT", kid: "usage" })}.${encode(
    {
      iss: issuer,
      aud: "vxture",
      exp: now + 300,
      iat: now,
      act: { sub: "runos" },
      mode: "service",
      scope: "tool:vxture",
      delegated: true,
      ...overrides,
    },
  )}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}
function body() {
  return {
    workspace_id: id(1),
    product: "karda",
    capability_usage: {
      event_id: randomUUID(),
      call_id: randomUUID(),
      capability_id: "skill.test",
      metric: "runos.call",
      amount: "1",
      unit: "call",
      occurred_at: "2026-10-20T01:02:03.456Z",
    },
  };
}

// --- HTTP authorization, replay and mutation --------------------------------
describe.skipIf(!connectionString)(
  "capability raw usage HTTP + PostgreSQL",
  () => {
    let app: INestApplication;
    let base = "";
    beforeAll(async () => {
      // This suite accepts only an explicitly supplied disposable database.
      // Parent fixtures model the receiver's lookup columns, not the full platform schema.
      await pool.query(`
        create schema if not exists product; create schema if not exists tenancy; create schema if not exists metering;
        create table if not exists product.products (id uuid primary key, product_code text unique not null, deleted_at timestamptz);
        create table if not exists tenancy.workspaces (id uuid primary key);
        do $$ begin
          if not exists (select from pg_roles where rolname='platform_svc') then create role platform_svc; end if;
          if not exists (select from pg_roles where rolname='svc_platform_api') then create role svc_platform_api; end if;
          if not exists (select from pg_roles where rolname='svc_console_bff') then create role svc_console_bff; end if;
          if not exists (select from pg_roles where rolname='svc_admin_bff') then create role svc_admin_bff; end if;
          if not exists (select from pg_roles where rolname='reporting_ro') then create role reporting_ro; end if;
        end $$;
        create or replace function metering.forbid_mutation() returns trigger language plpgsql as $$
        begin raise exception 'append-only'; end $$;
      `);
      await pool.query(
        readFileSync(
          new URL(
            "../../../../deploy/database/migrations/2026-12-06-capability-usage-facts.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await pool.query(
        "insert into product.products (id,product_code) values ($1,'karda'),($2,'arda') on conflict do nothing",
        [id(3), id(4)],
      );
      await pool.query(
        "insert into tenancy.workspaces (id) values ($1),($2) on conflict do nothing",
        [id(1), id(2)],
      );
      jwks = createServer((_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            keys: [
              {
                ...publicKey.export({ format: "jwk" }),
                kid: "usage",
                alg: "RS256",
                use: "sig",
              },
            ],
          }),
        );
      });
      await new Promise<void>((resolve) =>
        jwks.listen(0, "127.0.0.1", resolve),
      );
      issuer = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}`;
      config.auth.OIDC_ISSUER = issuer;
      config.platform.AUTH_BFF_URL = issuer;
      app = await NestFactory.create(TestModule, { logger: false });
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await app?.close();
      await pool.end();
      await new Promise<void>((resolve) => jwks?.close(() => resolve()));
    });
    const send = (value: unknown = body(), token = ticket()) =>
      fetch(`${base}/usage/consume`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
      });

    it("commits one fact under 12 simultaneous deliveries and returns one stable receipt", async () => {
      const value = body();
      const replies = await Promise.all(
        Array.from({ length: 12 }, () => send(value)),
      );
      expect(replies.every((response) => response.status === 200)).toBe(true);
      const receipts = await Promise.all(
        replies.map(
          async (response) =>
            (await response.json()) as Record<string, unknown>,
        ),
      );
      expect(
        new Set(receipts.map((receipt) => receipt.capability_event_id)).size,
      ).toBe(1);
      expect(receipts.filter((receipt) => !receipt.replayed)).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        recorded: true,
        source_event_id: value.capability_usage.event_id,
        settlement: "not_configured",
      });
      const count = await pool.query(
        "select count(*)::int as n from metering.capability_usage_events where source_event_id=$1",
        [value.capability_usage.event_id],
      );
      expect(count.rows[0].n).toBe(1);
    });
    it.each(["workspace", "product", "capability", "time"])(
      "rejects same-event %s mutation without changing its original fact",
      async (field) => {
        const value = body();
        expect((await send(value)).status).toBe(200);
        if (field === "workspace") value.workspace_id = id(2);
        if (field === "product") value.product = "arda";
        if (field === "capability")
          value.capability_usage.capability_id = "skill.other";
        if (field === "time")
          value.capability_usage.occurred_at = "2026-10-20T01:02:04.456Z";
        expect((await send(value)).status).toBe(409);
      },
    );
    it.each([
      { act: { sub: "atlas" } },
      { act: { sub: "karda" }, delegated: false, workspace_id: id(1) },
      { delegated: false },
      { mode: "obo" },
      { scope: "provisioning:read" },
      { workspace_id: id(1) },
      { sub: id(9) },
      { aud: "runos" },
    ])("rejects unauthorized ticket %j", async (claims) => {
      expect([401, 403]).toContain((await send(body(), ticket(claims))).status);
    });
    it("rejects the shared header and absent credentials", async () => {
      for (const headers of [
        {},
        { "x-vxture-internal-auth": "fixture-legacy" },
      ]) {
        expect([401, 403]).toContain(
          (
            await fetch(`${base}/usage/consume`, {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify(body()),
            })
          ).status,
        );
      }
    });
    it("Runos cannot use amount, tokens, gauge or C2", async () => {
      for (const value of [
        {
          workspace_id: id(1),
          product: "karda",
          metric: "runos.call",
          amount: 1,
          idempotency_key: "fixture",
        },
        { tokens: {} },
      ]) {
        expect((await send(value)).status).toBe(403);
      }
      expect(
        (
          await fetch(`${base}/usage/gauge`, {
            method: "PUT",
            headers: { authorization: `Bearer ${ticket()}` },
          })
        ).status,
      ).toBe(401);
    });
    it("refuses unknown attribution, mixed fields, and malformed measurements", async () => {
      const unknown = body();
      unknown.workspace_id = id(9999);
      expect((await send(unknown)).status).toBe(400);
      expect((await send({ ...body(), tokens: {} })).status).toBe(400);
    });
    it.each([null, [], "invalid"])(
      "rejects a non-object body %j without a server error",
      async (value) => {
        expect((await send(value)).status).toBe(400);
      },
    );
    it("replays a committed receipt after product soft deletion but refuses new facts", async () => {
      const value = body();
      const first = (await (await send(value)).json()) as Record<
        string,
        unknown
      >;
      await pool.query(
        "update product.products set deleted_at=now() where product_code='karda'",
      );
      try {
        const replay = await send(value);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({
          capability_event_id: first.capability_event_id,
          replayed: true,
        });
        expect((await send(body())).status).toBe(400);
      } finally {
        await pool.query(
          "update product.products set deleted_at=null where product_code='karda'",
        );
      }
    });
    it("database itself rejects mutation and deletion of committed facts", async () => {
      const value = body();
      await send(value);
      await expect(
        pool.query(
          "update metering.capability_usage_events set amount=2 where source_event_id=$1",
          [value.capability_usage.event_id],
        ),
      ).rejects.toThrow("append-only");
      await expect(
        pool.query(
          "delete from metering.capability_usage_events where source_event_id=$1",
          [value.capability_usage.event_id],
        ),
      ).rejects.toThrow("append-only");
    });
  },
);
