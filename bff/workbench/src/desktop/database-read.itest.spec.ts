/**
 * database-read.itest.spec.ts - Opt-in domain SQL checks with restricted credentials.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
// ⚠️ 跨层引用: Verify the public shared query against authoritative database DDL.
import {
  ProductSeatService,
  PgProductSeatRepository,
} from "@vxture/service-subscription";
import type { RpUser } from "@vxture/core-oidc-rp";
import { ApplicationReader } from "./application-reader";
import { WorkspaceReader } from "./workspace-reader";
import {
  OrganizationService,
  PgOrganizationRepository,
  ActiveContextService,
} from "@vxture/service-organization";
import { ScopeService } from "../scope-service";
import { CatalogService } from "../catalog-service";
import {
  createDatabaseReadFixture,
  databaseReadTestConfig,
} from "./database-read.fixture";

const config = databaseReadTestConfig(process.env);

describe("database integration test targeting", () => {
  const admin =
    "postgresql://admin@127.0.0.1:4567/workbench_desktop_itest_test";
  const read =
    "postgresql://reader@127.0.0.1:4567/workbench_desktop_itest_test";
  const env = {
    RUYIN_BFF_DB_ITEST: "1",
    RUYIN_DB_TEST_ADMIN_URL: admin,
    RUYIN_DB_TEST_READ_URL: read,
  };
  it("does not consume ambient application credentials or run implicitly", () => {
    expect(
      databaseReadTestConfig({
        DATABASE_URL: "postgresql://production/production",
      }),
    ).toBeUndefined();
    expect(databaseReadTestConfig(env)).toEqual({
      adminUrl: admin,
      readUrl: read,
    });
  });
  it.each([
    undefined,
    "not-a-url",
    "postgresql://reader@remote.test:4567/workbench_desktop_itest_test",
    "postgresql://reader@127.0.0.1:4567/production",
    admin,
    "postgresql://reader@127.0.0.1:4568/workbench_desktop_itest_test",
    "postgresql://reader@127.0.0.1:4567/workbench_desktop_itest_other",
  ])("refuses an unsafe or mismatched target %s", (url) => {
    expect(() =>
      databaseReadTestConfig({ ...env, RUYIN_DB_TEST_READ_URL: url }),
    ).toThrow();
  });
});

// ============================================================================
// Existing workbench sources against a fresh, explicitly isolated platform schema
// ============================================================================
describe.skipIf(!config)("desktop read projection · real PostgreSQL", () => {
  let fixture:
      | Awaited<ReturnType<typeof createDatabaseReadFixture>>
      | undefined,
    pool: Pool,
    plain: Client,
    reader: WorkspaceReader,
    application: ApplicationReader,
    user: RpUser;
  beforeAll(async () => {
    fixture = await createDatabaseReadFixture(config!.adminUrl);
    pool = new Pool({
      connectionString: config!.readUrl,
      max: 2,
      options: "-c default_transaction_read_only=on",
    });
    plain = new Client({ connectionString: config!.readUrl });
    await plain.connect();
    const repository = new PgOrganizationRepository(pool),
      organization = new OrganizationService(repository);
    reader = new WorkspaceReader(
      organization,
      new ScopeService(new ActiveContextService(repository), organization),
    );
    application = new ApplicationReader(
      new CatalogService(
        pool,
        new ProductSeatService(new PgProductSeatRepository(pool)),
      ),
      pool,
    );
    user = {
      userId: fixture.ids.user,
      activeOrg: fixture.ids.org,
      activeWorkspace: fixture.ids.one,
    } as RpUser;
  }, 20000);
  afterAll(async () => {
    await pool?.end();
    await plain?.end();
    await fixture?.close();
  });
  it("reuses live workbench membership without exposing another tenant", async () => {
    const { ids } = fixture!;
    expect(await reader.all(user)).toHaveLength(2);
    expect((await reader.current(user)).organization.name).toBe(
      "Synthetic Org",
    );
    await expect(
      reader.current({
        ...user,
        activeOrg: ids.otherOrg,
        activeWorkspace: ids.otherSpace,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("projects actual subscriptions and metadata for the exact workspace", async () => {
    const { ids } = fixture!;
    const rows = await application.subscribed(user);
    expect(new Set(rows.map((row) => row.subscriptionId))).toEqual(
      new Set([ids.s1, ids.expired]),
    );
    expect(rows[0]).toMatchObject({
      productName: "Synthetic Agent",
      releaseVersion: "1.2.3",
      iconVersion: fixture!.checksum,
      homeUrl: "https://synthetic.example",
      bundled: false,
    });
    expect(
      (await application.subscribed({ ...user, activeWorkspace: ids.two })).map(
        (row) => row.subscriptionId,
      ),
    ).toEqual([ids.s2]);
  });
  it("retains bundled products and domain access results without a billing permission", async () => {
    await fixture!.admin.query(
      "delete from access.role_permissions where role_id=$1",
      [fixture!.ids.tenantRole],
    );
    await fixture!.admin.query(
      "update product.plan_components set component_role='bundled',tier=null where plan_version_id=$1",
      [fixture!.ids.version],
    );
    const rows = await application.subscribed(user);
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) => row.bundled && row.tier === null && row.access === "denied",
      ),
    ).toBe(true);
    const { ids } = fixture!;
    await fixture!.admin.query(
      "insert into metering.product_seats(workspace_id,user_id,product_id,subscription_id) values($1,$2,$3,$4)",
      [ids.one, ids.user, ids.product, ids.s1],
    );
    try {
      expect(
        (await application.subscribed(user)).every(
          (row) => row.access === "allowed",
        ),
      ).toBe(true);
      await fixture!.admin.query(
        "update metering.product_seats set revoked_at=now() where workspace_id=$1 and user_id=$2 and product_id=$3",
        [ids.one, ids.user, ids.product],
      );
      expect(
        (await application.subscribed(user)).every(
          (row) => row.access === "denied",
        ),
      ).toBe(true);
    } finally {
      await fixture!.admin.query(
        "delete from metering.product_seats where workspace_id=$1 and user_id=$2 and product_id=$3",
        [ids.one, ids.user, ids.product],
      );
    }
  });
  it("reads public icon bytes and binds injection-shaped codes literally", async () => {
    expect(await application.icon("synthetic-ruyin-agent")).toMatchObject({
      bytes: fixture!.bytes,
      checksum: fixture!.checksum,
    });
    expect(
      await application.icon("synthetic-ruyin-agent' OR true --"),
    ).toBeNull();
  });
  it("uses read-only workbench credentials and creates no desktop database role", async () => {
    expect(
      (await pool.query("show default_transaction_read_only")).rows[0]
        .default_transaction_read_only,
    ).toBe("on");
    await expect(
      pool.query(
        "insert into product.plans(plan_code,plan_name) values('forbidden','forbidden')",
      ),
    ).rejects.toMatchObject({ code: "25006" });
    await expect(
      plain.query(
        "insert into product.plans(plan_code,plan_name) values('forbidden','forbidden')",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await fixture!.admin.query(
          "select 1 from pg_roles where rolname='svc_ruyin_bff'",
        )
      ).rows,
    ).toEqual([]);
  });
});
