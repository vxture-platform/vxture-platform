/**
 * Real PostgreSQL fact capture, binding races and authenticated change recovery.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { JwtService } from "@nestjs/jwt";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { Pool, Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise the HTTP boundary with controlled confidential-client credentials.
import { VxConfigService } from "@vxture/core-config";
import { PgOidcClientRepository } from "@vxture/service-iam";
import { IdentityRecoveryRepository } from "../authn/identity-recovery.repository";
import { IdentityRecoveryRouter } from "./identity-recovery.router";
import { SessionService } from "../authn/session.service";
import { IdentityDeliveryRepository } from "../authn/identity-delivery.repository";
import { IdentityDeliveryJob } from "../accounts/identity-delivery.job";
import { OidcKeyService } from "../oidc/oidc-key.service";

// ============================================================================
// Disposable local database; actual schema files and HTTP, no production writes.
// ============================================================================
const pgUrl = process.env["IDENTITY_PG_ITEST_URL"];
const database = `identity_changes_itest_${randomUUID().replaceAll("-", "")}`;
const issuer = "https://accounts.test";
const user = randomUUID(),
  otherUser = randomUUID(),
  org = randomUUID();
const workspace = randomUUID(),
  role = randomUUID(),
  workspaceRole = randomUUID();
const permission = randomUUID(),
  product = randomUUID(),
  subscription = randomUUID();
const writerRole = `changes_writer_${randomUUID().replaceAll("-", "")}`;
let admin: Pool,
  pool: Pool,
  repository: IdentityRecoveryRepository,
  sessions: SessionService;
let app: INestApplication, base: string, connectionString: string, sid: string;
let queue: IdentityDeliveryRepository,
  worker: IdentityDeliveryJob,
  keys: OidcKeyService;
let receiver: Server,
  receiverUrl: string,
  ackStatus = 204;
let received: {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}[] = [];
@Module({
  controllers: [IdentityRecoveryRouter],
  providers: [
    { provide: IdentityRecoveryRepository, useFactory: () => repository },
    { provide: VxConfigService, useValue: { auth: { OIDC_ISSUER: issuer } } },
    {
      provide: PgOidcClientRepository,
      useValue: {
        authenticateClient: async (id: string, secret: string) =>
          secret === "secret" && ["console", "other", "external"].includes(id)
            ? {
                clientId: id,
                realm: "customer",
                tokenEndpointAuthMethod: "client_secret_basic",
              }
            : null,
      },
    },
  ],
})
class ChangesTestModule {}
const sqlFile = (file: string) =>
  readFile(
    new URL(`../../../../deploy/database/${file}`, import.meta.url),
    "utf8",
  );
const snapshot = (client = "console", sids = [sid]) =>
  repository.snapshot(client, issuer, sids, "changes-v1");
const events = (cursor: string, limit = 100, client = "console") =>
  repository.events(client, issuer, cursor, limit, "changes-v1");
const version = async () =>
  (
    await pool.query<{ version: string }>(
      "select version from session.identity_subject_versions where user_id=$1",
      [user],
    )
  ).rows[0]!.version;
const post = (
  path: string,
  body: unknown,
  client = "console",
  authorization?: string,
) =>
  fetch(`${base}/oidc/identity/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization:
        authorization ??
        `Basic ${Buffer.from(`${client}:secret`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
async function createSession(owner = user, client: string | null = "console") {
  const created = await sessions.create({
    userId: owner,
    realm: "customer",
    authMethod: "password",
    absTtlSeconds: 600,
  });
  if (client) await sessions.bindClient(created.sid, owner, client);
  return created.sid;
}
async function blocked(pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{ waiting: boolean }>(
      "select cardinality(pg_blocking_pids($1))>0 as waiting",
      [pid],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected transaction lock was not observed");
}

describe.skipIf(!pgUrl)("customer change facts and recovery", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(pgUrl!).hostname))
      throw new Error("Local disposable test database required");
    admin = new Pool({ connectionString: pgUrl });
    await admin.query(`create database "${database}"`);
    const url = new URL(pgUrl!);
    url.pathname = `/${database}`;
    connectionString = url.toString();
    pool = new Pool({ connectionString, max: 10 });
    for (const file of [
      "00_schemas.sql",
      "10_account.sql",
      "18_access.sql",
      "20_tenancy.sql",
      "22_appoidc.sql",
      "24_session.sql",
      "25_identity_recovery.sql",
      "40_product.sql",
      "50_metering.sql",
      "96_identity_changes.sql",
      "96_identity_delivery.sql",
      "96_identity_extended_facts.sql",
      "80_admin.sql",
      "96_identity_workforce.sql",
    ])
      await pool.query(await sqlFile(`ddl/${file}`));
    await pool.query(
      await sqlFile("migrations/2026-12-18-identity-changes.sql"),
    );
    for (let pass = 0; pass < 2; pass += 1)
      await pool.query(
        await sqlFile("migrations/2026-12-21-identity-presentation.sql"),
      );
    await admin.query(`create role ${writerRole}`);
    await pool.query(
      `grant usage on schema account to ${writerRole}; grant select,update on account.users to ${writerRole}`,
    );
    repository = new IdentityRecoveryRepository(pool);
    queue = new IdentityDeliveryRepository(pool, repository);
    const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keys = new OidcKeyService(
      {
        auth: {
          OIDC_ISSUER: issuer,
          OIDC_ALGORITHM: "RS256",
          OIDC_ACTIVE_KID: "delivery-test",
          OIDC_SIGNING_PRIVATE_KEY: signing.privateKey
            .export({ format: "pem", type: "pkcs8" })
            .toString(),
        },
      } as never,
      new JwtService(),
    );
    worker = new IdentityDeliveryJob(queue, keys);
    receiver = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const token = Buffer.concat(chunks).toString();
      expect(req.headers["content-type"]).toBe("application/jwt");
      received.push({
        header: JSON.parse(
          Buffer.from(token.split(".")[0]!, "base64url").toString(),
        ) as Record<string, unknown>,
        payload: keys.verify(token),
      });
      res.statusCode = ackStatus;
      if (ackStatus === 429) res.setHeader("Retry-After", "3");
      res.end();
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, "127.0.0.1", resolve),
    );
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/auth/identity-events`;
    sessions = new SessionService(pool, {} as never);
    app = await NestFactory.create(ChangesTestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 30000);
  beforeEach(async () => {
    received = [];
    ackStatus = 204;
    await pool.query("truncate session.identity_time_boundaries");
    await pool.query(
      "truncate session.identity_change_outbox,session.identity_subject_versions,session.identity_change_streams,session.identity_recovery_streams,session.auth_sessions,appoidc.oidc_clients,account.users,tenancy.tenants,access.roles,access.permissions,metering.subscriptions cascade",
    );
    for (const id of ["console", "other", "external"]) {
      await pool.query(
        "insert into appoidc.oidc_clients(client_id,client_kind,redirect_uris,slo_participation,back_channel_logout_uri) values($1,'platform','{}','back_channel','https://rp.test/logout')",
        [id],
      );
      await pool.query(
        "insert into session.identity_recovery_streams(client_id,issuer,environment,release_channel,logout_uri,enabled) values($1,$2,'dev','stable','https://rp.test/logout',true)",
        [id, issuer],
      );
    }
    await pool.query(
      "insert into session.identity_change_streams(stream_id,enabled) select stream_id,true from session.identity_recovery_streams",
    );
    for (const id of [user, otherUser])
      await pool.query(
        "insert into account.users(id,user_no,account,phone,phone_verified_at) values($1,public.new_principal_no(1),$2,$3,now())",
        [id, id, id.slice(0, 32)],
      );
    await pool.query(
      "insert into tenancy.tenants(id,tenant_no,name,type,owner_user_id) values($1,public.new_principal_no(2),'Test','organization',$2)",
      [org, user],
    );
    await pool.query(
      "insert into access.roles(id,scope,role_code) values($1,'tenant','test'),($2,'workspace','test')",
      [role, workspaceRole],
    );
    await pool.query(
      "insert into access.permissions(id,perm_code) values($1,'tenant.test.read')",
      [permission],
    );
    await pool.query(
      "insert into access.role_permissions(role_id,permission_id) values($1,$2)",
      [role, permission],
    );
    await pool.query(
      "insert into tenancy.workspaces(id,workspace_no,tenant_id,name) values($1,public.new_principal_no(3),$2,'Test')",
      [workspace, org],
    );
    await pool.query(
      "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
      [org, user, role],
    );
    await pool.query(
      "insert into tenancy.workspace_memberships(tenant_id,workspace_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
      [org, workspace, user, workspaceRole],
    );
    await pool.query(
      "insert into metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,product_id,subscription_kind,cycle_unit,start_at,created_by_type) values($1,$2,$3,$4,$5,'paid','month',now(),'system')",
      [subscription, org, workspace, randomUUID(), product],
    );
    await pool.query(
      "insert into metering.product_seats(workspace_id,user_id,product_id,subscription_id) values($1,$2,$3,$4)",
      [workspace, user, product, subscription],
    );
    sid = await createSession();
  });
  afterAll(async () => {
    await worker?.onModuleDestroy();
    receiver?.closeAllConnections();
    if (receiver)
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`drop database if exists "${database}" with (force)`);
      await admin.query(`drop role if exists ${writerRole}`);
      await admin.end();
    }
  }, 30000);

  // ========================================================================
  // Every fact writer shares the same transaction boundary, including raw SQL.
  // ========================================================================
  const registerReceiver = () =>
    pool.query(
      `insert into session.identity_change_receivers(stream_id,receiver_uri,enabled)
    select stream_id,$1,true from session.identity_recovery_streams where client_id='console'`,
      [receiverUrl],
    );
  const mutate = () =>
    pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);

  it("invalidates session presentation fields and ignores unrelated profile writes", async () => {
    const before = BigInt(await version());
    await pool.query(
      "update account.users set email='updated@test.local' where id=$1",
      [user],
    );
    await pool.query(
      "insert into account.user_profiles(user_id,display_name) values($1,'Updated')",
      [user],
    );
    await pool.query(
      "update account.user_profiles set avatar_hash='new-avatar' where user_id=$1",
      [user],
    );
    await pool.query(
      "update tenancy.tenants set display_name='Renamed' where id=$1",
      [org],
    );
    await pool.query(
      "update tenancy.workspaces set name='Renamed' where id=$1",
      [workspace],
    );
    await pool.query(
      "insert into tenancy.tenant_logos(tenant_id,kind,data,content_type,hash,source) values($1,'logo',decode('00','hex'),'image/png','new-logo','upload')",
      [org],
    );
    expect(BigInt(await version()) - before).toBe(6n);
    await pool.query(
      "update account.user_profiles set bio='Unrelated', updated_at=now() where user_id=$1",
      [user],
    );
    await pool.query(
      "update tenancy.tenant_logos set updated_at=now() where tenant_id=$1",
      [org],
    );
    await pool.query("update tenancy.workspaces set name=name where id=$1", [
      workspace,
    ]);
    expect(BigInt(await version()) - before).toBe(6n);
    await pool.query("delete from account.user_profiles where user_id=$1", [
      user,
    ]);
    await pool.query("delete from tenancy.tenant_logos where tenant_id=$1", [
      org,
    ]);
    expect(BigInt(await version()) - before).toBe(8n);
  });

  it("delivers a committed event with a typed fresh envelope and stable logical retry content", async () => {
    await registerReceiver();
    await mutate();
    ackStatus = 503;
    const first = (await queue.claim())[0]!;
    await worker.deliver(first);
    await pool.query(
      "update session.identity_change_deliveries set available_at=now() where id=$1",
      [first.id],
    );
    ackStatus = 204;
    const second = (await queue.claim())[0]!;
    await worker.deliver(second);
    expect(received).toHaveLength(2);
    expect(received[0]!.header).toMatchObject({
      typ: "vxture-identity-event+jwt",
      alg: "RS256",
    });
    expect(received[0]!.payload.event).toEqual(received[1]!.payload.event);
    expect(received[0]!.payload.jti).not.toBe(received[1]!.payload.jti);
    expect(
      (
        await pool.query(
          "select status,attempts from session.identity_change_deliveries where id=$1",
          [first.id],
        )
      ).rows[0],
    ).toEqual({ status: "delivered", attempts: 2 });
  });
  it("fences expired owners and reclaims an abandoned lease", async () => {
    await registerReceiver();
    await mutate();
    const first = (await queue.claim())[0]!;
    expect(await queue.claim()).toHaveLength(0);
    await pool.query(
      "update session.identity_change_deliveries set lease_until=now()-interval '1 second' where id=$1",
      [first.id],
    );
    const second = (await queue.claim())[0]!;
    expect(await queue.finish(first, "delivered", null)).toBe(false);
    expect(await queue.finish(second, "delivered", null)).toBe(true);
  });
  it.each([200, 302, 400, 401, 403])(
    "quarantines non-ACK HTTP %s without following redirects",
    async (status) => {
      await registerReceiver();
      await mutate();
      ackStatus = status;
      await worker.deliver((await queue.claim())[0]!);
      expect(
        (
          await pool.query(
            "select status,last_error from session.identity_change_deliveries",
          )
        ).rows[0],
      ).toEqual({ status: "quarantined", last_error: `http_${status}` });
    },
  );
  it("honors Retry-After and stops after the durable retry window", async () => {
    await registerReceiver();
    await mutate();
    ackStatus = 429;
    const job = (await queue.claim())[0]!;
    await worker.deliver(job);
    expect(
      (
        await pool.query(
          "select available_at>now()+interval '2 seconds' as delayed from session.identity_change_deliveries",
        )
      ).rows[0].delayed,
    ).toBe(true);
    await pool.query(
      "update session.identity_change_deliveries set available_at=now(),retry_until=now()-interval '1 second'",
    );
    await worker.deliver((await queue.claim())[0]!);
    expect(received).toHaveLength(1);
    expect(
      (
        await pool.query(
          "select last_error from session.identity_change_deliveries",
        )
      ).rows[0].last_error,
    ).toBe("retry_window_exhausted");
  });
  it("captures while disabled and refuses endpoint drift or mismatched registration", async () => {
    await registerReceiver();
    await pool.query(
      "update session.identity_change_receivers set enabled=false",
    );
    await mutate();
    expect(await queue.claim()).toHaveLength(0);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from session.identity_change_deliveries",
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      pool.query(
        "update session.identity_change_receivers set receiver_uri='https://changed.test/events'",
      ),
    ).rejects.toThrow("immutable");
    await pool.query(
      "update session.identity_change_receivers set enabled=true",
    );
    await pool.query(
      "update appoidc.oidc_clients set release_channel='beta' where client_id='console'",
    );
    await worker.deliver((await queue.claim())[0]!);
    expect(received).toHaveLength(0);
    expect(
      (
        await pool.query(
          "select last_error from session.identity_change_deliveries",
        )
      ).rows[0].last_error,
    ).toBe("registration_changed");
  });
  it("rolls back facts and their delivery jobs together", async () => {
    await registerReceiver();
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await tx.query("update account.users set status='disabled' where id=$1", [
        user,
      ]);
      await tx.query("rollback");
    } finally {
      tx.release();
    }
    expect(await queue.claim()).toHaveLength(0);
  });
  it("emits override mutations and time boundaries exactly once without changing commerce state", async () => {
    await queue.emitDue();
    const before = await version();
    await pool.query(
      "insert into metering.subscription_entitlement_overrides(subscription_id,product_id,override_tier_code,expires_at) values($1,$2,'pro',now()-interval '1 second')",
      [subscription, product],
    );
    expect(BigInt(await version())).toBeGreaterThan(BigInt(before));
    const after = await version();
    expect(await queue.emitDue()).toBe(1);
    expect(BigInt(await version())).toBeGreaterThan(BigInt(after));
    expect(await queue.emitDue()).toBe(0);
    expect(
      (
        await pool.query(
          "select status from metering.subscriptions where id=$1",
          [subscription],
        )
      ).rows[0].status,
    ).toBe("active");
    await pool.query(
      "update metering.subscription_entitlement_overrides set expires_at=now()-interval '2 seconds'",
    );
    expect(await queue.emitDue()).toBe(1);
  });
  it("invalidates subscribed users on product and plan configuration changes", async () => {
    const plan = randomUUID(),
      pv = (
        await pool.query(
          "select plan_version_id from metering.subscriptions where id=$1",
          [subscription],
        )
      ).rows[0].plan_version_id as string;
    await pool.query(
      "insert into product.products(id,product_code,product_type,product_name) values($1,$2,'test','test')",
      [product, product],
    );
    await pool.query(
      "insert into product.plans(id,plan_code,plan_name) values($1,$2,'test')",
      [plan, plan],
    );
    await pool.query(
      "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
      [pv, plan],
    );
    let before = await version();
    await pool.query(
      "update product.products set status='inactive' where id=$1",
      [product],
    );
    expect(BigInt(await version())).toBeGreaterThan(BigInt(before));
    before = await version();
    await pool.query("update product.plans set status='inactive' where id=$1", [
      plan,
    ]);
    expect(BigInt(await version())).toBeGreaterThan(BigInt(before));
    before = await version();
    await pool.query(
      "insert into product.plan_components(plan_version_id,product_id,tier) values($1,$2,'pro')",
      [pv, product],
    );
    expect(BigInt(await version())).toBeGreaterThan(BigInt(before));
  });
  it("versions direct context changes once and rejects a workspace without an organization", async () => {
    const before = await snapshot();
    await pool.query(
      "update session.auth_sessions set active_org_id=$2,active_workspace_id=$3 where sid=$1",
      [sid, org, workspace],
    );
    await sessions.setContext(sid, { orgId: org, workspaceId: workspace });
    const page = await events(before.watermark);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      type: "session.context_changed",
      version: "1",
      subject: { sid, sub: `usr_${user}` },
    });
    expect((await snapshot()).sessions[0]).toMatchObject({
      context_version: "1",
      authorization_version: await version(),
      context: { org_id: org, workspace_id: workspace },
    });
    await expect(
      pool.query(
        "update session.auth_sessions set active_org_id=null where sid=$1",
        [sid],
      ),
    ).rejects.toThrow("workspace requires");
  });
  const mutations: [string, string, unknown[]][] = [
    [
      "tenant member suspension",
      "update tenancy.tenant_memberships set status='suspended' where user_id=$1",
      [user],
    ],
    [
      "workspace member suspension",
      "update tenancy.workspace_memberships set status='suspended' where user_id=$1",
      [user],
    ],
    [
      "seat revocation",
      "update metering.product_seats set revoked_at=now() where user_id=$1",
      [user],
    ],
    [
      "account disable",
      "update account.users set status='disabled' where id=$1",
      [user],
    ],
    [
      "tenant freeze",
      "update tenancy.tenants set status='suspended' where id=$1",
      [org],
    ],
    [
      "workspace archive",
      "update tenancy.workspaces set status='archived' where id=$1",
      [workspace],
    ],
    [
      "role disable",
      "update access.roles set status='disabled' where id=$1",
      [role],
    ],
    [
      "permission disable",
      "update access.permissions set is_active=false where id=$1",
      [permission],
    ],
    [
      "role-permission removal",
      "delete from access.role_permissions where role_id=$1",
      [role],
    ],
    [
      "subscription suspension",
      "update metering.subscriptions set status='suspended' where id=$1",
      [subscription],
    ],
    [
      "default context selection",
      "update tenancy.tenant_memberships set default_workspace_id=$2 where user_id=$1",
      [user, workspace],
    ],
  ];
  it.each(mutations)(
    "captures %s in the fact transaction",
    async (_name, sql, args) => {
      const before = await snapshot();
      const previous = BigInt(await version());
      await pool.query(sql, args);
      const page = await events(before.watermark);
      expect(page.events.length).toBeGreaterThan(0);
      expect(
        page.events.every(
          (e) =>
            e.type === "identity.access_changed" &&
            e.subject.sub === `usr_${user}`,
        ),
      ).toBe(true);
      expect(BigInt(await version())).toBeGreaterThan(previous);
      expect(page.events.at(-1)?.version).toBe(await version());
    },
  );
  it("records revoke then grant with increasing versions and no permission payload", async () => {
    const before = await snapshot();
    await pool.query(
      "update metering.product_seats set revoked_at=now() where user_id=$1",
      [user],
    );
    await pool.query(
      "insert into metering.product_seats(workspace_id,user_id,product_id,subscription_id) values($1,$2,$3,$4)",
      [workspace, user, product, subscription],
    );
    const page = await events(before.watermark);
    expect(page.events).toHaveLength(2);
    expect(BigInt(page.events[1]!.version)).toBeGreaterThan(
      BigInt(page.events[0]!.version),
    );
    expect(page.events[0]).toMatchObject({
      scope: { workspace_id: workspace, product_id: product },
    });
    expect(JSON.stringify(page)).not.toMatch(
      /access_token|refresh_token|permissions|phone/,
    );
  });
  it("does not emit changes for audit metadata or identical fact writes", async () => {
    const before = await snapshot();
    const previous = await version();
    await pool.query(
      "update tenancy.tenant_memberships set title='New title',status=status,updated_at=now() where user_id=$1",
      [user],
    );
    await pool.query(
      "update metering.product_seats set granted_at=now() where user_id=$1",
      [user],
    );
    expect((await events(before.watermark)).events).toEqual([]);
    expect(await version()).toBe(previous);
  });
  it("rolls back facts, versions, recipient positions and notifications together", async () => {
    const listener = new Client({ connectionString });
    await listener.connect();
    await listener.query("listen identity_fact_changed");
    const notifications: unknown[] = [];
    listener.on("notification", (n) => notifications.push(n));
    const before = await snapshot();
    const previous = await version();
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await tx.query("update account.users set status='disabled' where id=$1", [
        user,
      ]);
      expect((await events(before.watermark)).events).toEqual([]);
      await tx.query("rollback");
      await listener.query("select 1");
      expect(notifications).toHaveLength(0);
      expect(await version()).toBe(previous);
      expect((await events(before.watermark)).events).toEqual([]);
    } finally {
      await tx.query("rollback");
      tx.release();
      await listener.end();
    }
  });
  it("allows a minimally privileged fact writer but denies direct event fabrication", async () => {
    const before = await snapshot();
    const tx = await pool.connect();
    try {
      await tx.query(`set role ${writerRole}`);
      await tx.query("update account.users set status='disabled' where id=$1", [
        user,
      ]);
      await expect(
        tx.query("select session.record_access_change($1,null,null,null)", [
          user,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await tx.query("reset role");
      tx.release();
    }
    expect((await events(before.watermark)).events).toHaveLength(1);
  });
  it("captures cascading member removal and retains facts without recipients", async () => {
    const before = await snapshot();
    await pool.query(
      "delete from tenancy.tenant_memberships where user_id=$1",
      [user],
    );
    expect((await events(before.watermark)).events.length).toBeGreaterThan(0);
    await pool.query("update account.users set status='disabled' where id=$1", [
      otherUser,
    ]);
    expect(
      (
        await pool.query(
          "select 1 from session.identity_change_outbox where user_id=$1",
          [otherUser],
        )
      ).rowCount,
    ).toBe(1);
  });

  // ========================================================================
  // Committed ordering and first-binding races; no sequence-allocation shortcut.
  // ========================================================================
  it("serializes two subjects at the recipient watermark and exposes only commits", async () => {
    await createSession(otherUser);
    const before = await snapshot();
    const first = await pool.connect(),
      second = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query(
        "update account.users set status='disabled' where id=$1",
        [user],
      );
      const pid = (
        await second.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]!.pid;
      pending = second.query(
        "update account.users set status='disabled' where id=$1",
        [otherUser],
      );
      await blocked(pid);
      expect((await events(before.watermark)).events).toEqual([]);
      await first.query("commit");
      await pending;
      await second.query("commit");
      const page = await events(before.watermark);
      expect(page.events.map((e) => e.subject.sub)).toEqual([
        `usr_${user}`,
        `usr_${otherUser}`,
      ]);
    } finally {
      await first.query("rollback");
      await pending?.catch(() => undefined);
      await second.query("rollback");
      first.release();
      second.release();
    }
  });
  it("waits for an earlier mutation before publishing a first client binding", async () => {
    const unbound = await createSession(otherUser, null);
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await tx.query("update account.users set status='disabled' where id=$1", [
        otherUser,
      ]);
      const binding = sessions.bindClient(unbound, otherUser, "console");
      await tx.query("commit");
      await binding;
      expect((await snapshot("console", [unbound])).sessions[0]).toMatchObject({
        authorization_version: "1",
      });
    } finally {
      await tx.query("rollback");
      tx.release();
    }
  });
  it("routes a mutation that waits behind an uncommitted new binding", async () => {
    const unbound = await createSession(otherUser, null);
    const bind = await pool.connect(),
      write = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await bind.query("begin");
      await bind.query(
        "insert into session.oidc_session_clients(sid,client_id,release_channel,logout_uri) values($1,'console','stable','https://rp.test/logout')",
        [unbound],
      );
      const before = await snapshot();
      const pid = (
        await write.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]!.pid;
      pending = write.query(
        "update account.users set status='disabled' where id=$1",
        [otherUser],
      );
      await blocked(pid);
      await bind.query("commit");
      await pending;
      expect((await events(before.watermark)).events).toMatchObject([
        { subject: { sub: `usr_${otherUser}` }, version: "1" },
      ]);
    } finally {
      await bind.query("rollback");
      await pending?.catch(() => undefined);
      bind.release();
      write.release();
    }
  });

  // ========================================================================
  // Compatibility, authentication, explicit capability and cursor isolation.
  // ========================================================================
  it("isolates clients and protocol cursors while preserving logout-v1", async () => {
    const own = await snapshot(),
      other = await snapshot("other");
    const legacy = await repository.snapshot("console", issuer, [sid]);
    await pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);
    expect((await events(other.watermark, 100, "other")).events).toEqual([]);
    expect((await snapshot("other")).sessions).toEqual([
      { sid, state: "not_bound" },
    ]);
    await expect(events(own.watermark, 100, "other")).rejects.toMatchObject({
      status: 403,
    });
    await expect(events(legacy.watermark)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      repository.events("console", issuer, own.watermark, 100),
    ).rejects.toMatchObject({ status: 403 });
    expect(legacy.binding.profile).toBe("logout-v1");
    expect(legacy.sessions[0]).not.toHaveProperty("authorization_version");
    expect(
      (await repository.events("console", issuer, legacy.watermark, 100))
        .events,
    ).toEqual([]);
  });
  it("captures disabled streams and rejects disabled or non-platform readers", async () => {
    const before = await snapshot();
    await pool.query(
      "update session.identity_change_streams set enabled=false",
    );
    await pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);
    expect((await post("changes/snapshot", { sids: [sid] })).status).toBe(403);
    await pool.query("update session.identity_change_streams set enabled=true");
    expect((await events(before.watermark)).events).toHaveLength(1);
    // A valid non-platform registration is deliberately outside this pilot.
    await pool.query(
      "update appoidc.oidc_clients set client_kind='product',product_id=$1 where client_id='external'",
      [product],
    );
    expect(
      (await post("changes/snapshot", { sids: [] }, "external")).status,
    ).toBe(403);
  });
  it("paginates change events and rejects deleted tail records", async () => {
    const before = await snapshot();
    await pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);
    await pool.query("update account.users set status='active' where id=$1", [
      user,
    ]);
    const first = await events(before.watermark, 1);
    expect(first.has_more).toBe(true);
    const second = await events(first.next_cursor, 1);
    expect(second.events).toHaveLength(1);
    expect(second.has_more).toBe(false);
    await pool.query(
      "delete from session.identity_change_events where sequence=(select max(sequence) from session.identity_change_events)",
    );
    await expect(events(first.next_cursor)).rejects.toMatchObject({
      status: 410,
    });
  });
  it("fans one logical event to two registered clients without changing its version", async () => {
    await sessions.bindClient(sid, user, "other");
    const one = await snapshot(),
      two = await snapshot("other");
    await pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);
    const first = (await events(one.watermark)).events[0]!;
    const second = (await events(two.watermark, 100, "other")).events[0]!;
    expect(first.event_id).toBe(second.event_id);
    expect(first.version).toBe(second.version);
    expect(first.audience).toBe("console");
    expect(second.audience).toBe("other");
  });
  it("keeps workforce context and foreign environment registrations out of the stream", async () => {
    const before = await snapshot();
    const worker = await sessions.create({
      userId: user,
      realm: "workforce",
      authMethod: "password",
      absTtlSeconds: 600,
    });
    await pool.query(
      "update session.auth_sessions set active_org_id=$2 where sid=$1",
      [worker.sid, org],
    );
    expect((await events(before.watermark)).events).toEqual([]);
    expect((await snapshot("console", [worker.sid])).sessions).toEqual([
      { sid: worker.sid, state: "not_bound" },
    ]);
    await pool.query(
      "update appoidc.oidc_clients set release_channel='beta' where client_id='console'",
    );
    await pool.query("update account.users set status='disabled' where id=$1", [
      user,
    ]);
    await expect(snapshot()).rejects.toMatchObject({ status: 403 });
    await pool.query(
      "update appoidc.oidc_clients set release_channel='stable' where client_id='console'",
    );
    // Historical exact bindings keep facts while the live registration is unavailable.
    expect((await events(before.watermark)).events).toHaveLength(1);
    expect((await snapshot()).sessions[0]).toMatchObject({
      authorization_version: await version(),
    });
  });
  it("serves strict authenticated HTTP snapshots and events without Cookies", async () => {
    const response = await post("changes/snapshot", { sids: [sid] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const data = (await response.json()) as {
      watermark: string;
      binding: { profile: string };
    };
    expect(data.binding.profile).toBe("changes-v1");
    expect(
      (await post("changes/events", { cursor: data.watermark, limit: 1 }))
        .status,
    ).toBe(200);
    expect((await post("changes/snapshot", { sids: [sid, sid] })).status).toBe(
      400,
    );
    expect(
      (await post("changes/snapshot?sid=forged", { sids: [sid] })).status,
    ).toBe(400);
    expect(
      (await post("changes/events", { cursor: data.watermark, limit: 101 }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(
          "changes/snapshot",
          { sids: [sid] },
          "console",
          "Bearer forged",
        )
      ).status,
    ).toBe(401);
  });
});
