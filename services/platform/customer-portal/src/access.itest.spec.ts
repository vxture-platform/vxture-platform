/**
 * Real PostgreSQL membership, lifecycle and least-privilege access regression tests.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-15
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PortalAccessService } from "./access";
import { DEFAULT_CONFIGURATION, portalHostname } from "./configuration";
import { CustomerPortalService, type PublishedPortal } from "./service";

const url = process.env.CUSTOMER_PORTAL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000002";
const SPACE = "00000000-0000-4000-8000-000000000003";
const PORTAL = "00000000-0000-4000-8000-000000000004";
const VERSION = "00000000-0000-4000-8000-000000000005";
const OTHER = "00000000-0000-4000-8000-000000000006";

describe("strict customer hostname policy", () => {
  it.each(["abc", "robot01", "lab2026", "abcd1234"])("accepts %s", (prefix) => {
    expect(portalHostname(prefix)).toBe(`${prefix}.ruyin.work`);
  });
  it.each([
    "a",
    "ab",
    "abcdefghi",
    "123lab",
    "Robot01",
    "robot-lab",
    "robot_1",
    "robot.abc",
    "robot01.ruyin.work",
    "https://robot01",
    " robot01",
    "robot01 ",
    "研究院",
    "ｒobot01",
    "robot\n",
    "robot01;",
    "admin",
    "billing",
    "atlas",
    "admin01",
    "api123",
    "test01",
    "www999",
    "ruyin01",
    "vxture01",
    "oauth01",
  ])("rejects %s", (prefix) => {
    expect(() => portalHostname(prefix)).toThrow();
  });
});

suite("organization-only customer portal access", () => {
  let admin: Pool,
    reader: Pool,
    access: PortalAccessService,
    portal: PublishedPortal;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    // This suite requires an explicitly disposable empty database.
    const existing = await admin.query(
      "select 1 from information_schema.schemata where schema_name='tenancy'",
    );
    if (existing.rowCount)
      throw new Error(
        "Customer portal integration tests require an empty disposable database",
      );
    const root = resolve(import.meta.dirname, "../../../..");
    for (const file of [
      "00_schemas.sql",
      "10_account.sql",
      "18_access.sql",
      "20_tenancy.sql",
      "40_product.sql",
      "50_metering.sql",
    ])
      await admin.query(
        await readFile(resolve(root, "deploy/database/ddl", file), "utf8"),
      );
    await admin.query(
      await readFile(
        resolve(
          root,
          "deploy/database/migrations/2026-11-15-customer-portal-access.sql",
        ),
        "utf8",
      ),
    );
    await admin.query(
      `insert into account.users (id,user_no,account,phone,phone_verified_at)
      values ($1,public.new_principal_no(1),'researcher','13800000000',now()),
      ($2,public.new_principal_no(1),'outsider','13800000001',now())`,
      [USER, OTHER],
    );
    await admin.query(
      `insert into tenancy.tenants (id,tenant_no,name,type,owner_user_id)
      values ($1,public.new_principal_no(2),'如影智能研究院','organization',$2)`,
      [ORG, USER],
    );
    await admin.query(
      `insert into tenancy.workspaces (id,workspace_no,tenant_id,name)
      values ($1,public.new_principal_no(3),$2,'Default')`,
      [SPACE, ORG],
    );
    await admin.query(
      `insert into tenancy.tenant_memberships (tenant_id,user_id,role_id,role_scope)
      values ($1,$2,$3,'org')`,
      [ORG, USER, PORTAL],
    );
    await admin.query(
      `insert into tenancy.workspace_memberships (workspace_id,tenant_id,user_id,role_id,role_scope)
      values ($1,$2,$3,$4,'workspace')`,
      [SPACE, ORG, USER, PORTAL],
    );
    await admin.query(
      `insert into tenancy.customer_portals (id,tenant_id,hostname,workspace_id,enabled,draft,updated_by,updated_surface)
      values ($1,$2,'a.ruyin.work',$3,true,$4,$5,'admin')`,
      [PORTAL, ORG, SPACE, DEFAULT_CONFIGURATION, USER],
    );
    await admin.query(
      `insert into tenancy.customer_portal_versions
      (id,portal_id,version,configuration,status,note,submitted_by,submitted_surface)
      values ($1,$2,1,$3,'approved','Initial',$4,'admin')`,
      [VERSION, PORTAL, DEFAULT_CONFIGURATION, USER],
    );
    await admin.query(
      "update tenancy.customer_portals set published_version_id=$1 where id=$2",
      [VERSION, PORTAL],
    );
    const readerUrl = new URL(url!);
    readerUrl.username = "svc_customer_portal";
    reader = new Pool({ connectionString: readerUrl.href });
    access = new PortalAccessService(reader);
    portal = await new CustomerPortalService(reader).published("a.ruyin.work");
  });
  beforeEach(async () => {
    await admin.query("update tenancy.customer_portals set enabled=true");
    await admin.query(
      "update tenancy.tenants set status='active', deleted_at=null",
    );
    await admin.query(
      "update tenancy.workspaces set status='active', deleted_at=null",
    );
    await admin.query("update tenancy.tenant_memberships set status='active'");
    await admin.query(
      "update tenancy.workspace_memberships set status='active'",
    );
    await admin.query(
      "update account.users set status='active', deleted_at=null",
    );
  });
  afterAll(async () => {
    await reader?.end();
    await admin?.end();
  });
  const identity = () => ({
    userId: USER,
    activeOrg: ORG,
    activeWorkspace: SPACE,
    userType: "tenant_user",
    accountStatus: "active",
  });

  async function addOrganization(name: string) {
    const { rows: tenants } = await admin.query<{ id: string }>(
      `insert into tenancy.tenants (tenant_no,name,type,owner_user_id)
       values (public.new_principal_no(2),$1,'organization',$2) returning id`,
      [name, USER],
    );
    const tenantId = tenants[0]!.id;
    const { rows: workspaces } = await admin.query<{ id: string }>(
      `insert into tenancy.workspaces (workspace_no,tenant_id,name)
       values (public.new_principal_no(3),$1,'Default') returning id`,
      [tenantId],
    );
    return { tenantId, workspaceId: workspaces[0]!.id };
  }

  // ========================================================================
  // Signed claims never substitute for live membership or exact host bindings.
  // ========================================================================
  it("replays the migration without changing published data or runtime privileges", async () => {
    await admin.query(
      `insert into tenancy.customer_portal_assets (portal_id,hash,mime,bytes)
       values ($1,$2,'image/png',decode(repeat('00',12),'hex'))`,
      [PORTAL, "f".repeat(64)],
    );
    await admin.query(
      `insert into tenancy.customer_portal_events (portal_id,actor_id,surface,action,version_id)
       values ($1,$2,'admin','publish',$3)`,
      [PORTAL, USER, VERSION],
    );
    const snapshot = () =>
      admin.query<{ data: unknown }>(
        `select jsonb_build_object(
        'portals', (select jsonb_agg(to_jsonb(p) order by id) from tenancy.customer_portals p),
        'versions', (select jsonb_agg(to_jsonb(v) order by id) from tenancy.customer_portal_versions v),
        'assets', (select jsonb_agg(to_jsonb(a) order by hash) from tenancy.customer_portal_assets a),
        'events', (select jsonb_agg(to_jsonb(e) order by id) from tenancy.customer_portal_events e)
      ) as data`,
      );
    const before = (await snapshot()).rows[0]!.data;
    const migration = await readFile(
      resolve(
        import.meta.dirname,
        "../../../../deploy/database/migrations/2026-11-15-customer-portal-access.sql",
      ),
      "utf8",
    );
    await admin.query(migration);
    await admin.query(migration);
    expect((await snapshot()).rows[0]!.data).toEqual(before);
    await expect(
      new CustomerPortalService(reader).published("a.ruyin.work"),
    ).resolves.toMatchObject({ id: PORTAL, versionId: VERSION });
    for (const table of [
      "customer_portal_versions",
      "customer_portal_assets",
      "customer_portal_events",
    ]) {
      await expect(
        admin.query(`delete from tenancy.${table} where portal_id=$1`, [
          PORTAL,
        ]),
      ).rejects.toThrow("append-only");
    }
    await expect(
      reader.query("update tenancy.customer_portals set enabled=false"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      reader.query("select phone from account.users"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("checks reserved, bound and registered product hosts before committing a binding", async () => {
    const service = new CustomerPortalService(admin);
    const operator = { id: USER, surface: "admin" } as const;
    const customer = { id: USER, surface: "console" } as const;
    const { tenantId, workspaceId } = await addOrganization("Domain applicant");
    await admin.query(`with entry as (
      insert into product.products (product_code,product_type,product_name,status)
      values ('portal-domain-fixture','service','Domain fixture','draft') returning id
    ) insert into product.product_webhooks (product_id,edge_domain,home_url)
      select id,'robot02.ruyin.work','https://user@Robot03.Ruyin.Work.:8443/start' from entry`);
    await admin.query(
      "update tenancy.customer_portals set enabled=false where id=$1",
      [PORTAL],
    );

    await expect(
      service.checkHostname(tenantId, "www", operator),
    ).resolves.toMatchObject({ status: "invalid" });
    await expect(
      service.checkHostname(tenantId, "robot01", customer),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.checkHostname(tenantId, "robot01", operator),
    ).resolves.toEqual({ status: "available" });
    await expect(service.checkHostname(ORG, "a", operator)).resolves.toEqual({
      status: "available",
    });
    await expect(
      service.checkHostname(tenantId, "a", operator),
    ).resolves.toMatchObject({
      status: "invalid",
    });
    await expect(
      service.provision(
        tenantId,
        { prefix: "a", workspaceId, enabled: true, selfService: false },
        operator,
      ),
    ).rejects.toMatchObject({ status: 400 });
    for (const prefix of ["robot02", "robot03"]) {
      await expect(
        service.checkHostname(tenantId, prefix, operator),
      ).resolves.toEqual({ status: "occupied" });
      await expect(
        service.provision(
          tenantId,
          { prefix, workspaceId, enabled: true, selfService: false },
          operator,
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
    await expect(service.get(tenantId, operator)).resolves.toBeNull();
  });

  it("allows only one organization to claim a hostname after both availability checks pass", async () => {
    const service = new CustomerPortalService(admin);
    const operator = { id: USER, surface: "admin" } as const;
    const applicants = [
      await addOrganization("First applicant"),
      await addOrganization("Second applicant"),
    ];
    const prefix = "robot04";
    const checks = await Promise.all(
      applicants.map(({ tenantId }) =>
        service.checkHostname(tenantId, prefix, operator),
      ),
    );
    expect(checks).toEqual([{ status: "available" }, { status: "available" }]);
    const claims = await Promise.allSettled(
      applicants.map(({ tenantId, workspaceId }) =>
        service.provision(
          tenantId,
          { prefix, workspaceId, enabled: true, selfService: false },
          operator,
        ),
      ),
    );
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(claims).toContainEqual(
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ status: 409 }),
      }),
    );
    const saved = await admin.query(
      "select 1 from tenancy.customer_portals where hostname=$1",
      [`${prefix}.ruyin.work`],
    );
    expect(saved.rowCount).toBe(1);
  });

  it("shares drafts across surfaces while publication remains platform controlled", async () => {
    const service = new CustomerPortalService(admin);
    const operator = { id: USER, surface: "admin" } as const;
    const customer = { id: USER, surface: "console" } as const;
    const binding = {
      prefix: "a",
      workspaceId: SPACE,
      enabled: true,
      selfService: true,
    };
    await expect(service.selfServiceAvailable(ORG)).resolves.toBe(false);
    await expect(service.get(ORG, customer)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.provision(ORG, binding, customer),
    ).rejects.toMatchObject({ status: 403 });
    await service.provision(ORG, binding, operator);
    await expect(service.selfServiceAvailable(ORG)).resolves.toBe(true);
    await expect(service.selfServiceAvailable(OTHER)).resolves.toBe(false);

    const initial = (await service.get(ORG, operator))!;
    const brand = { ...initial.draft, name: "如影智能研究院" };
    const uploaded = await service.upload(
      ORG,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
      customer,
    );
    const saved = (await service.save(
      ORG,
      {
        revision: initial.revision,
        configuration: { ...brand, logo: uploaded.hash },
      },
      customer,
    ))!;
    await expect(service.asset(saved.id, uploaded.hash)).resolves.toMatchObject(
      { mime: "image/png" },
    );
    await expect(service.get(ORG, operator)).resolves.toMatchObject({
      revision: saved.revision,
      draft: { name: brand.name },
    });
    await expect(
      service.save(
        ORG,
        { revision: initial.revision, configuration: brand },
        operator,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const submission = (await service.submit(
      ORG,
      { revision: saved.revision, note: "品牌更新" },
      customer,
    ))!;
    const version = submission.versions[0]!;
    await service.save(
      ORG,
      {
        revision: saved.revision,
        configuration: { ...brand, name: "后续草稿" },
      },
      operator,
    );
    await expect(
      service.transition(ORG, version.id, { action: "approve" }, customer),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.transition(ORG, version.id, { action: "publish" }, operator),
    ).rejects.toMatchObject({ status: 409 });
    await service.transition(ORG, version.id, { action: "approve" }, operator);
    await expect(
      service.transition(ORG, version.id, { action: "publish" }, customer),
    ).rejects.toMatchObject({ status: 403 });
    await service.transition(ORG, version.id, { action: "publish" }, operator);
    await expect(
      new CustomerPortalService(reader).published("a.ruyin.work"),
    ).resolves.toMatchObject({
      configuration: { name: brand.name, logo: uploaded.hash },
    });
    await service.provision(ORG, { ...binding, selfService: false }, operator);
    await expect(service.selfServiceAvailable(ORG)).resolves.toBe(false);
    await expect(
      service.submit(
        ORG,
        { revision: saved.revision + 1, note: "撤权后提交" },
        customer,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await service.transition(ORG, VERSION, { action: "publish" }, operator);
  });

  it("allows an active member using the dedicated read-only role", async () => {
    await expect(access.assertMember(portal, identity())).resolves.toEqual({
      name: "researcher",
      workspaceName: "Default",
    });
  });
  it("rejects an outsider even with matching organization claims", async () => {
    await expect(
      access.assertMember(portal, { ...identity(), userId: OTHER }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(["activeOrg", "activeWorkspace", "userType", "accountStatus"])(
    "rejects mismatched %s",
    async (key) => {
      await expect(
        access.assertMember(portal, { ...identity(), [key]: OTHER }),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it.each([
    "update tenancy.tenant_memberships set status='removed'",
    "update tenancy.workspace_memberships set status='suspended'",
    "update tenancy.tenants set status='suspended'",
    "update tenancy.workspaces set status='archived'",
    "update account.users set status='disabled'",
    "update tenancy.customer_portals set enabled=false",
  ])("denies an existing session after lifecycle change: %s", async (sql) => {
    await access.assertMember(portal, identity());
    await admin.query(sql);
    await expect(access.assertMember(portal, identity())).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("rejects a foreign host and an unpublished portal", async () => {
    await expect(
      access.assertMember({ ...portal, hostname: "b.ruyin.work" }, identity()),
    ).rejects.toMatchObject({ status: 403 });
    await admin.query(
      "update tenancy.customer_portals set published_version_id=null where id=$1",
      [PORTAL],
    );
    await expect(access.assertMember(portal, identity())).rejects.toMatchObject(
      { status: 403 },
    );
    await admin.query(
      "update tenancy.customer_portals set published_version_id=$1 where id=$2",
      [VERSION, PORTAL],
    );
  });
  it("does not grant the runtime account writes or private credential reads", async () => {
    await expect(
      reader.query("update tenancy.customer_portals set enabled=false"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      reader.query("select phone from account.users"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps reviewed configuration snapshots immutable", async () => {
    await expect(
      admin.query(
        "update tenancy.customer_portal_versions set configuration='{}'::jsonb",
      ),
    ).rejects.toThrow("cannot be changed");
  });
});
