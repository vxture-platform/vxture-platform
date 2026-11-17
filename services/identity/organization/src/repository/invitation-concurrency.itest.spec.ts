/**
 * invitation-concurrency.itest.spec.ts - Verify invitation integrity on real PostgreSQL.
 * @package @vxture/service-organization
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgOrganizationRepository } from "./pg-organization.repository";

// ===== Isolated database fixture =====
const enabled = process.env.INVITATION_CONCURRENCY_ITEST === "1";
const connectionString = process.env.INVITATION_TEST_DATABASE_URL;
const owner = randomUUID(),
  admin = randomUUID(),
  person = randomUUID(),
  stranger = randomUUID();
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  workspace = randomUUID(),
  otherWorkspace = randomUUID();
const email = "recipient@example.test",
  phone = "+8613800138000",
  userNo = "1000000017";

describe.runIf(enabled)("invitation concurrency (isolated PostgreSQL)", () => {
  let pool: Pool;
  let repo: PgOrganizationRepository;
  beforeAll(async () => {
    if (
      !connectionString ||
      !new URL(connectionString).pathname.startsWith("/codex_invitation_")
    )
      throw new Error("A disposable codex_invitation_* database is required");
    pool = new Pool({ connectionString });
    repo = new PgOrganizationRepository(pool);
    await pool.query(`
      CREATE SCHEMA account; CREATE SCHEMA tenancy; CREATE SCHEMA access;
      CREATE TABLE account.users(id uuid PRIMARY KEY, user_no bigint, account text, email text, phone text, email_verified_at timestamptz, phone_verified_at timestamptz, status text DEFAULT 'active', deleted_at timestamptz);
      CREATE TABLE account.user_profiles(user_id uuid PRIMARY KEY, display_name text);
      CREATE TABLE access.roles(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, role_code text, scope text);
      INSERT INTO access.roles(role_code,scope) VALUES ('member','tenant'),('manager','tenant'),('owner','tenant'),('member','workspace'),('manager','workspace');
      CREATE TABLE tenancy.tenants(id uuid PRIMARY KEY, tenant_no bigint, name text DEFAULT 'Test', status text DEFAULT 'active', deleted_at timestamptz, member_limit int DEFAULT 500);
      CREATE TABLE tenancy.workspaces(id uuid PRIMARY KEY, tenant_id uuid, is_default boolean DEFAULT true, status text DEFAULT 'active', deleted_at timestamptz);
      CREATE TABLE tenancy.tenant_memberships(tenant_id uuid, user_id uuid, role_id uuid, role_scope text, status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(tenant_id,user_id));
      CREATE TABLE tenancy.workspace_memberships(workspace_id uuid, tenant_id uuid, user_id uuid, role_id uuid, role_scope text, status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(workspace_id,user_id));
      CREATE TABLE tenancy.invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text, tenant_id uuid, workspace_id uuid, target_type text, target text, role_id uuid, role_scope text, status text DEFAULT 'pending', token_hash text UNIQUE, expires_at timestamptz, accepted_at timestamptz, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    `);
    await pool.query(
      readFileSync(
        new URL(
          "../../../../../deploy/database/migrations/2026-11-17-invitation-recipient-uniqueness.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE tenancy.invitations, tenancy.workspace_memberships, tenancy.tenant_memberships, tenancy.workspaces, tenancy.tenants, account.user_profiles, account.users CASCADE",
    );
    await pool.query(
      "INSERT INTO account.users(id,user_no,account,email,phone,email_verified_at,phone_verified_at) VALUES ($1,1000000001,'owner',null,null,null,null),($2,1000000002,'admin',null,null,null,null),($3,$4,'recipient',$5,$6,now(),now()),($7,1000000003,'stranger',null,null,null,null)",
      [owner, admin, person, userNo, email, phone, stranger],
    );
    await pool.query(
      "INSERT INTO tenancy.tenants(id,tenant_no) VALUES ($1,2000000001),($2,2000000002)",
      [tenant, otherTenant],
    );
    await pool.query(
      "INSERT INTO tenancy.workspaces(id,tenant_id) VALUES ($1,$2),($3,$4)",
      [workspace, tenant, otherWorkspace, otherTenant],
    );
  });
  const invite = (
    targetType: "email" | "phone" | "user_no",
    createdBy = owner,
    organizationId = tenant,
    workspaceId = workspace,
    role = "member",
  ) =>
    repo.createInvitation({
      scope: "org",
      organizationId,
      workspaceId,
      targetType,
      target:
        targetType === "email"
          ? email
          : targetType === "phone"
            ? phone
            : userNo,
      role,
      createdBy,
    });
  const identity = { email, phone, userNo, userId: person };

  // ===== Concurrent signing and uniqueness =====
  it.each([
    ["email", "email"],
    ["email", "user_no"],
    ["email", "phone"],
    ["phone", "user_no"],
  ] as const)(
    "two administrators using %s/%s create exactly one invitation",
    async (a, b) => {
      const results = await Promise.allSettled([
        invite(a, owner),
        invite(b, admin),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason.message).toBe(
        "invitation_pending",
      );
      expect(
        (await pool.query("select count(*)::int as n from tenancy.invitations"))
          .rows[0].n,
      ).toBe(1);
    },
  );
  it("changing the role and selected workspace cannot bypass organization uniqueness", async () => {
    await invite("email");
    const another = randomUUID();
    await pool.query(
      "insert into tenancy.workspaces(id,tenant_id,is_default) values ($1,$2,false)",
      [another, tenant],
    );
    await expect(
      invite("user_no", admin, tenant, another, "manager"),
    ).rejects.toThrow("invitation_pending");
  });
  it("the same recipient may be invited by two organizations", async () => {
    await invite("phone");
    await expect(
      invite("user_no", admin, otherTenant, otherWorkspace),
    ).resolves.toBeDefined();
  });
  it("database indexes also reject duplicate raw writes", async () => {
    const { invitation } = await invite("email");
    await expect(
      pool.query(
        "insert into tenancy.invitations(id,scope,tenant_id,workspace_id,target_type,target,role_id,role_scope,status,token_hash,expires_at,accepted_at,created_by,created_at,updated_at,recipient_user_id) select gen_random_uuid(),scope,tenant_id,workspace_id,target_type,target,role_id,role_scope,status,token_hash || 'different',expires_at,accepted_at,created_by,created_at,updated_at,recipient_user_id from tenancy.invitations where id=$1",
        [invitation.id],
      ),
    ).rejects.toThrow("invitation_pending");
  });
  it("email case and whitespace do not create another invitation", async () => {
    await invite("email");
    await expect(
      repo.createInvitation({
        scope: "org",
        organizationId: tenant,
        workspaceId: workspace,
        targetType: "email",
        target: " Recipient@Example.Test ",
        role: "member",
        createdBy: admin,
      }),
    ).rejects.toThrow("invitation_pending");
  });
  it("resolves a previously unregistered email when its owner registers later", async () => {
    await pool.query(
      "update account.users set email=null,email_verified_at=null where id=$1",
      [person],
    );
    await invite("email");
    await pool.query(
      "update account.users set email=$2,email_verified_at=now() where id=$1",
      [person, email],
    );
    await expect(invite("phone", admin)).rejects.toThrow("invitation_pending");
  });
  it("expired slots are reused without deleting history", async () => {
    const first = await invite("email");
    await pool.query(
      "update tenancy.invitations set status='expired',expires_at=now()-interval '1 second' where id=$1",
      [first.invitation.id],
    );
    await invite("user_no", admin);
    await expect(
      repo.rotateInvitationToken(first.invitation.id, tenant),
    ).rejects.toThrow("invitation_pending");
    expect(
      (await pool.query("select count(*)::int as n from tenancy.invitations"))
        .rows[0].n,
    ).toBe(2);
  });
  it("limits resend rate and invalidates the previous link", async () => {
    const first = await invite("email");
    await expect(
      repo.rotateInvitationToken(first.invitation.id, tenant),
    ).rejects.toThrow("invitation_resend_cooldown");
    await pool.query(
      "update tenancy.invitations set last_sent_at=now()-interval '2 minutes' where id=$1",
      [first.invitation.id],
    );
    const rotated = await repo.rotateInvitationToken(
      first.invitation.id,
      tenant,
    );
    expect(rotated?.token).not.toBe(first.token);
    expect(await repo.getInvitationByToken(first.token)).toBeNull();
  });

  // ===== Acceptance, account identity and atomic membership =====
  it("phone invitations are only accepted by the bound account", async () => {
    const { token } = await invite("phone");
    expect(await repo.acceptInvitation({ token }, stranger, identity)).toEqual({
      ok: false,
      reason: "user_mismatch",
    });
    const accepted = await repo.acceptInvitation({ token }, person, identity);
    expect(accepted.ok).toBe(true);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from tenancy.tenant_memberships",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from tenancy.workspace_memberships",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("simultaneous acceptance only adds one member", async () => {
    const { token } = await invite("email");
    const results = await Promise.all([
      repo.acceptInvitation({ token }, person, identity),
      repo.acceptInvitation({ token }, person, identity),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });
  it.each(["active", "suspended"])(
    "old invitations cannot overwrite %s members",
    async (status) => {
      const { token } = await invite("email");
      await pool.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope,status) select $1,$2,id,scope,$3 from access.roles where role_code='manager' and scope='tenant'",
        [tenant, person, status],
      );
      expect(await repo.acceptInvitation({ token }, person, identity)).toEqual({
        ok: false,
        reason: status === "suspended" ? "member_suspended" : "already_member",
      });
      expect(
        (
          await pool.query(
            "select m.status,r.role_code from tenancy.tenant_memberships m join access.roles r on r.id=m.role_id",
          )
        ).rows[0],
      ).toEqual({ status, role_code: "manager" });
    },
  );
  it("an unavailable workspace leaves both memberships unwritten", async () => {
    const { token, invitation } = await invite("email");
    await pool.query(
      "update tenancy.workspaces set status='archived' where id=$1",
      [workspace],
    );
    expect(await repo.acceptInvitation({ token }, person, identity)).toEqual({
      ok: false,
      reason: "workspace_unavailable",
    });
    expect(
      (
        await pool.query("select status from tenancy.invitations where id=$1", [
          invitation.id,
        ])
      ).rows[0].status,
    ).toBe("pending");
    expect(
      (
        await pool.query(
          "select count(*)::int as n from tenancy.tenant_memberships",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("a recycled contact address cannot accept another account's invitation", async () => {
    const { token } = await invite("email");
    await pool.query("update account.users set email=null where id=$1", [
      person,
    ]);
    await pool.query(
      "update account.users set email=$2,email_verified_at=now() where id=$1",
      [stranger, email],
    );
    expect(
      await repo.acceptInvitation({ token }, stranger, { email, userNo: null }),
    ).toEqual({ ok: false, reason: "user_mismatch" });
  });
  it("rejects stale preview identity when a phone number was reassigned", async () => {
    await pool.query("update account.users set phone=null where id=$1", [
      person,
    ]);
    await pool.query(
      "update account.users set phone=$2,phone_verified_at=now() where id=$1",
      [stranger, phone],
    );
    await expect(
      repo.createInvitation({
        scope: "org",
        organizationId: tenant,
        workspaceId: workspace,
        targetType: "phone",
        target: phone,
        recipientUserId: person,
        role: "member",
        createdBy: admin,
      }),
    ).rejects.toThrow("invitation_identity_changed");
    expect(
      (await pool.query("select count(*)::int as n from tenancy.invitations"))
        .rows[0].n,
    ).toBe(0);
  });
  it("a disabled account cannot accept a previously issued invitation", async () => {
    const { token } = await invite("phone");
    await pool.query("update account.users set status='disabled' where id=$1", [
      person,
    ]);
    expect(await repo.acceptInvitation({ token }, person, identity)).toEqual({
      ok: false,
      reason: "user_mismatch",
    });
  });
  it("repeated withdrawal does not create another notification", async () => {
    const { invitation } = await invite("phone");
    expect((await repo.revokeInvitation(invitation.id, tenant)).ok).toBe(true);
    expect(await repo.revokeInvitation(invitation.id, tenant)).toEqual({
      ok: true,
    });
  });
  it("simultaneous resend and creation cannot revive duplicate invitations", async () => {
    const first = await invite("email");
    await pool.query(
      "update tenancy.invitations set status='expired',expires_at=now()-interval '2 minutes',last_sent_at=now()-interval '2 minutes' where id=$1",
      [first.invitation.id],
    );
    const results = await Promise.allSettled([
      repo.rotateInvitationToken(first.invitation.id, tenant),
      invite("phone", admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from tenancy.invitations where status='pending'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
