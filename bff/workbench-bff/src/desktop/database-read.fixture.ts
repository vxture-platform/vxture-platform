/**
 * database-read.fixture.ts - Synthetic data for explicitly isolated PostgreSQL tests.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test-fixture
 * @author AI-Generated
 * @date 2026-11-22
 */
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";

/** Never use ambient DATABASE_URL or accept a shared/non-loopback database. */
export function databaseReadTestConfig(env: NodeJS.ProcessEnv) {
  if (env.RUYIN_BFF_DB_ITEST !== "1") return undefined;
  const invalid = () =>
    new Error(
      "Database tests require two loopback URLs for the same workbench_desktop_itest_* database and distinct identities",
    );
  let admin: URL, read: URL;
  try {
    admin = new URL(env.RUYIN_DB_TEST_ADMIN_URL ?? "");
    read = new URL(env.RUYIN_DB_TEST_READ_URL ?? "");
  } catch {
    throw invalid();
  }
  for (const url of [admin, read])
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/workbench_desktop_itest_[a-z0-9]+$/.test(url.pathname) ||
      !url.username ||
      url.hash
    )
      throw invalid();
  if (
    admin.hostname !== read.hostname ||
    (admin.port || "5432") !== (read.port || "5432") ||
    admin.pathname !== read.pathname ||
    admin.username === read.username
  )
    throw invalid();
  return { adminUrl: admin.href, readUrl: read.href };
}

const KEYS = [
  "user",
  "otherUser",
  "org",
  "otherOrg",
  "one",
  "two",
  "otherSpace",
  "tenantRole",
  "workspaceRole",
  "perm",
  "product",
  "plan",
  "version",
  "s1",
  "s2",
  "sOther",
  "expired",
  "cancelled",
  "deleted",
] as const;

// ============================================================================
// Fresh, already provisioned test database only; no DDL or role creation here
// ============================================================================

export async function createDatabaseReadFixture(adminUrl: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const ids = Object.fromEntries(
    KEYS.map((key) => [key, randomUUID()]),
  ) as Record<(typeof KEYS)[number], string>;
  const bytes = Buffer.from([137, 80, 78, 71]);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  try {
    const fresh = await admin.query<{ used: boolean }>(
      "select exists(select 1 from account.users) or exists(select 1 from product.products) as used",
    );
    if (fresh.rows[0]?.used)
      throw new Error(
        "Database tests require an empty isolated fixture database",
      );
    await admin.query("BEGIN");
    for (const [id, name, phone] of [
      [ids.user, "synthetic-ruyin-one", "+10000000001"],
      [ids.otherUser, "synthetic-ruyin-other", "+10000000002"],
    ])
      await admin.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1,$2,$3,now())",
        [id, name, phone],
      );
    await admin.query(
      "insert into access.roles(id,role_code,scope) values($1,'synthetic-owner','tenant'),($2,'synthetic-member','workspace')",
      [ids.tenantRole, ids.workspaceRole],
    );
    await admin.query(
      "insert into access.permissions(id,perm_code) values($1,'tenant.billing.read')",
      [ids.perm],
    );
    await admin.query(
      "insert into access.role_permissions(role_id,permission_id) values($1,$2)",
      [ids.tenantRole, ids.perm],
    );
    for (const [org, user, name] of [
      [ids.org, ids.user, "Synthetic Org"],
      [ids.otherOrg, ids.otherUser, "Other Org"],
    ]) {
      await admin.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,$2,'organization',$3)",
        [org, name, user],
      );
      await admin.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [org, user, ids.tenantRole],
      );
    }
    for (const [ws, org, user] of [
      [ids.one, ids.org, ids.user],
      [ids.two, ids.org, ids.user],
      [ids.otherSpace, ids.otherOrg, ids.otherUser],
    ]) {
      await admin.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,$3)",
        [ws, org, ws],
      );
      await admin.query(
        "insert into tenancy.workspace_memberships(workspace_id,tenant_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [ws, org, user, ids.workspaceRole],
      );
    }
    await admin.query(
      "insert into product.products(id,product_code,product_type,product_name,product_nick,release_version) values($1,'synthetic-ruyin-agent','agent','Synthetic Agent','SYN','1.2.3')",
      [ids.product],
    );
    await admin.query(
      "insert into product.plans(id,plan_code,plan_name) values($1,'synthetic-ruyin-plan','Synthetic Plan')",
      [ids.plan],
    );
    await admin.query(
      "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
      [ids.version, ids.plan],
    );
    await admin.query(
      "insert into product.plan_components(plan_version_id,product_id,component_role,tier,quota) values($1,$2,'primary','pro','{\"seat.max\":3}')",
      [ids.version, ids.product],
    );
    await admin.query(
      "insert into product.product_webhooks(product_id,home_url) values($1,'https://synthetic.example')",
      [ids.product],
    );
    await admin.query(
      "insert into product.product_icons(product_id,mime_type,bytes,byte_size,checksum) values($1,'image/png',$2,$3,$4)",
      [ids.product, bytes, bytes.length, checksum],
    );
    for (const [id, ws, org, status, deleted] of [
      [ids.s1, ids.one, ids.org, "active", false],
      [ids.s2, ids.two, ids.org, "trialing", false],
      [ids.sOther, ids.otherSpace, ids.otherOrg, "active", false],
      [ids.expired, ids.one, ids.org, "expired", false],
      [ids.cancelled, ids.one, ids.org, "cancelled", false],
      [ids.deleted, ids.one, ids.org, "active", true],
    ])
      await admin.query(
        "insert into metering.subscriptions(id,tenant_id,workspace_id,plan_version_id,subscription_kind,cycle_unit,start_at,end_at,status,created_by_type,deleted_at) values($1,$2,$3,$4,'free','month',now(),now()+interval '1 month',$5,'system',case when $6 then now() else null end)",
        [id, org, ws, ids.version, status, deleted],
      );
    await admin.query(
      "update product.products set status='active' where id=$1",
      [ids.product],
    );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK").catch(() => {});
    await admin.end();
    throw error;
  }
  return {
    admin,
    ids,
    bytes,
    checksum,
    close: async () => {
      // Delete only rows created above, using their generated primary keys.
      try {
        await admin.query("BEGIN");
        await admin.query(
          "delete from metering.subscriptions where id=any($1::uuid[])",
          [
            [
              ids.s1,
              ids.s2,
              ids.sOther,
              ids.expired,
              ids.cancelled,
              ids.deleted,
            ],
          ],
        );
        await admin.query(
          "delete from product.product_icons where product_id=$1",
          [ids.product],
        );
        await admin.query(
          "delete from product.product_webhooks where product_id=$1",
          [ids.product],
        );
        await admin.query(
          "delete from product.plan_components where plan_version_id=$1",
          [ids.version],
        );
        await admin.query("delete from product.plan_versions where id=$1", [
          ids.version,
        ]);
        await admin.query("delete from product.plans where id=$1", [ids.plan]);
        await admin.query("delete from product.products where id=$1", [
          ids.product,
        ]);
        await admin.query(
          "delete from tenancy.workspace_memberships where user_id=any($1::uuid[])",
          [[ids.user, ids.otherUser]],
        );
        await admin.query(
          "delete from tenancy.tenant_memberships where user_id=any($1::uuid[])",
          [[ids.user, ids.otherUser]],
        );
        await admin.query(
          "delete from tenancy.workspaces where id=any($1::uuid[])",
          [[ids.one, ids.two, ids.otherSpace]],
        );
        await admin.query(
          "delete from tenancy.tenants where id=any($1::uuid[])",
          [[ids.org, ids.otherOrg]],
        );
        await admin.query(
          "delete from access.role_permissions where role_id=$1",
          [ids.tenantRole],
        );
        await admin.query("delete from access.roles where id=any($1::uuid[])", [
          [ids.tenantRole, ids.workspaceRole],
        ]);
        await admin.query("delete from access.permissions where id=$1", [
          ids.perm,
        ]);
        await admin.query(
          "delete from account.users where id=any($1::uuid[])",
          [[ids.user, ids.otherUser]],
        );
        await admin.query("COMMIT");
      } catch (error) {
        await admin.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        await admin.end();
      }
    },
  };
}
