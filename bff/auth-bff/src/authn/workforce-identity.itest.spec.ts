/**
 * Real workforce facts, realm isolation, durable logout and Accounts notification recovery.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";
import { SessionService } from "./session.service";
import { IdentityRecoveryRepository } from "./identity-recovery.repository";
import { CentralEventsHub } from "./central-events.hub";

const url = process.env.IDENTITY_PG_ITEST_URL;
const database = `workforce_events_${randomUUID().replaceAll("-", "")}`;
const issuer = "https://accounts.test";
let admin: Pool,
  pool: Pool,
  sessions: SessionService,
  recovery: IdentityRecoveryRepository;
const sql = async (file: string) =>
  readFile(
    new URL(`../../../../deploy/database/ddl/${file}`, import.meta.url),
    "utf8",
  );

// ============================================================================
// Identical UUIDs in both realms intentionally prove namespace separation.
// ============================================================================
async function fixture() {
  const id = randomUUID(),
    role = randomUUID();
  await pool.query(
    "insert into admin.operator_role(id,role_code,role_name,role_name_key,created_by) values($1,$3,'Test','test',$2)",
    [role, id, role],
  );
  await pool.query(
    "insert into admin.operator_account(id,role_id,username) values($1,$2,$3)",
    [id, role, id],
  );
  await pool.query(
    "insert into admin.operator_credential(operator_id,password_hash) values($1,'hash')",
    [id],
  );
  await pool.query(
    "insert into account.users(id,user_no,account,phone,phone_verified_at) values($1,public.new_principal_no(1),$2,$3,now())",
    [id, id, id.slice(0, 32)],
  );
  const workforce = await sessions.create({
    userId: id,
    realm: "workforce",
    authMethod: "password+totp",
    absTtlSeconds: 600,
  });
  const customer = await sessions.create({
    userId: id,
    realm: "customer",
    authMethod: "password",
    absTtlSeconds: 600,
  });
  await sessions.bindClient(workforce.sid, id, "admin", "workforce");
  await sessions.bindClient(customer.sid, id, "console");
  return { id, role, workforce: workforce.sid, customer: customer.sid };
}
describe.skipIf(!url)("workforce event authority", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url!).hostname))
      throw new Error("Local database required");
    vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "true");
    admin = new Pool({ connectionString: url });
    await admin.query(`create database "${database}"`);
    const target = new URL(url!);
    target.pathname = `/${database}`;
    pool = new Pool({ connectionString: target.href });
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
      "80_admin.sql",
      "96_identity_changes.sql",
      "96_identity_delivery.sql",
      "96_identity_workforce.sql",
    ])
      await pool.query(await sql(file));
    await pool.query(await sql("96_identity_workforce.sql"));
    for (const [client, realm] of [
      ["admin", "workforce"],
      ["console", "customer"],
    ]) {
      await pool.query(
        "insert into appoidc.oidc_clients(client_id,realm,client_kind,redirect_uris,slo_participation,back_channel_logout_uri) values($1,$2,'platform','{}','back_channel','https://rp.test/logout')",
        [client, realm],
      );
      await pool.query(
        "insert into session.identity_recovery_streams(client_id,issuer,realm,environment,release_channel,logout_uri,enabled) values($1,$2,$3,'dev','stable','https://rp.test/logout',true)",
        [client, issuer, realm],
      );
    }
    await pool.query(
      "insert into session.identity_change_streams(stream_id,enabled) select stream_id,true from session.identity_recovery_streams",
    );
    sessions = new SessionService(pool, {} as never);
    recovery = new IdentityRecoveryRepository(pool);
  }, 30000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
    if (admin) {
      await admin.query(`drop database if exists "${database}"`);
      await admin.end();
    }
  });

  it("returns workforce subjects and never binds or routes the same customer UUID", async () => {
    const f = await fixture();
    await pool.query(
      "update session.auth_sessions set active_org_id=$2,context_version=4 where sid=$1",
      [f.workforce, randomUUID()],
    );
    const before = await recovery.snapshot(
      "admin",
      issuer,
      [f.workforce, f.customer],
      "changes-v1",
    );
    expect(before.sessions).toEqual([
      expect.objectContaining({
        sub: `opr_${f.id}`,
        context: null,
        context_version: "0",
      }),
      { sid: f.customer, state: "not_bound" },
    ]);
    const customer = await recovery.snapshot(
      "console",
      issuer,
      [f.customer],
      "changes-v1",
    );
    await expect(
      sessions.bindClient(f.workforce, f.id, "console", "workforce"),
    ).rejects.toThrow();
    await pool.query(
      "update admin.operator_account set display_name='New name' where id=$1",
      [f.id],
    );
    const events = await recovery.events(
      "admin",
      issuer,
      before.watermark,
      100,
      "changes-v1",
    );
    expect(events.events).toEqual([
      expect.objectContaining({
        realm: "workforce",
        subject: { sub: `opr_${f.id}` },
        scope: { org_id: null, workspace_id: null, product_id: null },
      }),
    ]);
    expect(
      (
        await recovery.events(
          "console",
          issuer,
          customer.watermark,
          100,
          "changes-v1",
        )
      ).events,
    ).toEqual([]);
    expect(await sessions.get(f.workforce)).not.toBeNull();
  });
  it("commits password revocation and durable recipients together without touching customer sessions", async () => {
    const f = await fixture();
    await pool.query(
      "update admin.operator_credential set password_hash='new hash' where operator_id=$1",
      [f.id],
    );
    expect(await sessions.get(f.workforce)).toBeNull();
    expect(await sessions.get(f.customer)).not.toBeNull();
    expect(
      (
        await pool.query(
          "select realm,client_id from session.logout_deliveries where sid=$1",
          [f.workforce],
        )
      ).rows,
    ).toEqual([{ realm: "workforce", client_id: "admin" }]);
    await expect(
      pool.query(
        "update session.auth_sessions set status='active' where sid=$1",
        [f.workforce],
      ),
    ).rejects.toThrow("reactivated");
    expect(
      (await recovery.snapshot("admin", issuer, [f.workforce])).sessions,
    ).toEqual([{ sid: f.workforce, state: "inactive" }]);
    expect(await sessions.workforceOwner(f.workforce)).toBe(f.id);
    expect(await sessions.workforceOwner(f.customer)).toBeNull();
    expect(
      await sessions.activeWorkforceOwners([f.workforce, f.customer]),
    ).toEqual(new Map());
  });
  it("does not revoke for login bookkeeping or password failures", async () => {
    const f = await fixture();
    const version = (
      await recovery.snapshot("admin", issuer, [f.workforce], "changes-v1")
    ).watermark;
    await pool.query(
      "update admin.operator_account set last_login_at=now(),last_login_ip='127.0.0.1' where id=$1",
      [f.id],
    );
    await pool.query(
      "update admin.operator_credential set failed_attempts=failed_attempts+1,updated_at=now() where operator_id=$1",
      [f.id],
    );
    expect(await sessions.get(f.workforce)).not.toBeNull();
    expect(
      (await recovery.events("admin", issuer, version, 100, "changes-v1"))
        .events,
    ).toEqual([]);
  });
  it("rolls back facts and logout when a security mutation rolls back", async () => {
    const f = await fixture(),
      tx = await pool.connect();
    try {
      await tx.query("begin");
      await tx.query(
        "update admin.operator_account set status='disabled' where id=$1",
        [f.id],
      );
      await tx.query("rollback");
    } finally {
      tx.release();
    }
    expect(await sessions.get(f.workforce)).not.toBeNull();
    expect(
      (
        await pool.query(
          "select 1 from session.logout_deliveries where sid=$1",
          [f.workforce],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("force logout covers durable sessions without a Redis index", async () => {
    const f = await fixture();
    expect(await sessions.revokeOperatorSessions(f.id)).toEqual([f.workforce]);
    expect(await sessions.get(f.customer)).not.toBeNull();
    expect(await sessions.revokeOperatorSessions(f.id)).toEqual([]);
  });
  it("invalidates permissions without issuing permissions or terminating an unchanged login", async () => {
    const f = await fixture(),
      permission = randomUUID();
    await pool.query(
      "insert into admin.operator_permission(id,perm_code,perm_name,perm_type,created_by,updated_by) values($1,$2,'Read','api',$3,$3)",
      [permission, permission, f.id],
    );
    const before = await recovery.snapshot(
      "admin",
      issuer,
      [f.workforce],
      "changes-v1",
    );
    await pool.query(
      "insert into admin.operator_role_permission(role_id,permission_id,created_by) values($1,$2,$3)",
      [f.role, permission, f.id],
    );
    const events = await recovery.events(
      "admin",
      issuer,
      before.watermark,
      100,
      "changes-v1",
    );
    expect(events.events).toEqual([
      expect.objectContaining({
        type: "identity.access_changed",
        subject: { sub: `opr_${f.id}` },
      }),
    ]);
    expect(
      await sessions.activeWorkforceOwners([f.workforce, f.customer]),
    ).toEqual(new Map([[f.workforce, f.id]]));
    expect(await sessions.get(f.workforce)).not.toBeNull();
  });
  it("revokes MFA/passkey mutations but ignores passkey authentication bookkeeping", async () => {
    const f = await fixture();
    await pool.query(
      "insert into admin.operator_mfa(operator_id,policy) values($1,'required')",
      [f.id],
    );
    expect(await sessions.get(f.workforce)).toBeNull();
    await pool.query(
      "insert into admin.operator_webauthn_credential(operator_id,credential_id,public_key) values($1,$2,'\\x01')",
      [f.id, f.id],
    );
    const active = await sessions.create({
      userId: f.id,
      realm: "workforce",
      authMethod: "password+webauthn",
      absTtlSeconds: 600,
    });
    await pool.query(
      "update admin.operator_webauthn_credential set sign_count=sign_count+1,last_used_at=now() where operator_id=$1",
      [f.id],
    );
    expect(await sessions.get(active.sid)).not.toBeNull();
    await pool.query(
      "delete from admin.operator_webauthn_credential where operator_id=$1",
      [f.id],
    );
    expect(await sessions.get(active.sid)).toBeNull();
    expect(await sessions.get(f.customer)).not.toBeNull();
  });
  it("rejects workforce recovery when the rollout flag is disabled", async () => {
    const f = await fixture();
    vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "false");
    try {
      await expect(
        recovery.snapshot("admin", issuer, [f.workforce]),
      ).rejects.toThrow();
    } finally {
      vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "true");
    }
  });
  it("invalidates customer members when a published portal binding is disabled", async () => {
    const f = await fixture(),
      org = randomUUID(),
      space = randomUUID(),
      role = randomUUID();
    await pool.query(
      "insert into tenancy.tenants(id,tenant_no,name,type,owner_user_id) values($1,public.new_principal_no(2),'Portal','organization',$2)",
      [org, f.id],
    );
    await pool.query(
      "insert into tenancy.workspaces(id,workspace_no,tenant_id,name) values($1,public.new_principal_no(3),$2,'Portal')",
      [space, org],
    );
    await pool.query(
      "insert into access.roles(id,scope,role_code) values($1,'tenant','portal-test')",
      [role],
    );
    await pool.query(
      "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
      [org, f.id, role],
    );
    await pool.query(
      "insert into tenancy.customer_portals(tenant_id,hostname,workspace_id,draft,updated_by,updated_surface,enabled) values($1,'portal01.ruyin.work',$2,'{}',$3,'admin',true)",
      [org, space, f.id],
    );
    const before = await recovery.snapshot(
      "console",
      issuer,
      [f.customer],
      "changes-v1",
    );
    const other = await recovery.snapshot(
      "admin",
      issuer,
      [f.workforce],
      "changes-v1",
    );
    await pool.query(
      "update tenancy.customer_portals set enabled=false where tenant_id=$1",
      [org],
    );
    expect(
      (
        await recovery.events(
          "console",
          issuer,
          before.watermark,
          100,
          "changes-v1",
        )
      ).events,
    ).toEqual([
      expect.objectContaining({
        type: "identity.access_changed",
        scope: { org_id: org, workspace_id: null, product_id: null },
      }),
    ]);
    expect(
      (
        await recovery.events(
          "admin",
          issuer,
          other.watermark,
          100,
          "changes-v1",
        )
      ).events,
    ).toEqual([]);
  });
  it("notifies only the bound Accounts realm and closes streams on listener loss", async () => {
    const f = await fixture(),
      hub = new CentralEventsHub(pool),
      changed = vi.fn(),
      other = vi.fn(),
      close = vi.fn();
    try {
      await hub.subscribe({
        realm: "workforce",
        sid: f.workforce,
        sub: f.id,
        changed,
        close,
      });
      await hub.subscribe({
        realm: "customer",
        sid: f.customer,
        sub: f.id,
        changed: other,
        close: other,
      });
      await pool.query(
        "update admin.operator_account set display_name='Accounts update' where id=$1",
        [f.id],
      );
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(other).not.toHaveBeenCalled();
      await hub.onModuleDestroy();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await hub.onModuleDestroy();
    }
  });
});
