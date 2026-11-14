/**
 * pg-metering-read.analytics.itest.spec.ts - Calendar scope and distribution invariants.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category Test
 * @author AI-Generated
 * @date 2026-11-15
 */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Pool, type PoolClient } from "pg";
import { PgMeteringReadRepository } from "./pg-metering-read.repository";

// ============================================================================
// Transactional fixtures: every test rolls back its entire fixture.
// ============================================================================

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
describe.skipIf(!RUN)("usage analytics snapshot", () => {
  let pool: Pool;
  let client: PoolClient;
  let repo: PgMeteringReadRepository;
  let user: string;
  let tenant: string;
  let workspace: string;
  let product: string;
  let zeroProductCode: string;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
    repo = new PgMeteringReadRepository({
      query: client.query.bind(client),
    } as Pool);
    user = randomUUID();
    tenant = randomUUID();
    workspace = randomUUID();
    product = randomUUID();
    const suffix = user.slice(0, 8);
    await client.query(
      "insert into account.users (id, account, phone, phone_verified_at, source) values ($1, $2, $3, now(), 'web')",
      [
        user,
        `analytics-${suffix}`,
        `+8613${String(parseInt(suffix, 16)).padStart(9, "0")}`,
      ],
    );
    await client.query(
      "insert into tenancy.tenants (id, name, type, owner_user_id) values ($1, 'Analytics', 'organization', $2)",
      [tenant, user],
    );
    await client.query(
      "insert into tenancy.workspaces (id, tenant_id, name, is_default) values ($1, $2, 'Analytics', true)",
      [workspace, tenant],
    );
    await client.query(
      "insert into product.products (id, product_code, product_name, product_type, status, standalone_subscribable) values ($1, $2, 'Used product', 'agent', 'active', true)",
      [product, `analytics-${suffix}`],
    );
    const zeroProduct = randomUUID();
    zeroProductCode = `zero-${suffix}`;
    await client.query(
      "insert into product.products (id, product_code, product_name, product_type, status, standalone_subscribable) values ($1, $2, 'Zero product', 'agent', 'active', true)",
      [zeroProduct, zeroProductCode],
    );
    const plan = randomUUID();
    const version = randomUUID();
    await client.query(
      "insert into product.plans (id, plan_code, plan_name) values ($1, $2, 'Analytics plan')",
      [plan, `analytics-${suffix}`],
    );
    await client.query(
      "insert into product.plan_versions (id, plan_id, version_no) values ($1, $2, 1)",
      [version, plan],
    );
    await client.query(
      "insert into product.plan_components (plan_version_id, product_id, tier) values ($1, $2, 'free')",
      [version, zeroProduct],
    );
    await client.query(
      "insert into metering.subscriptions (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, start_at, created_by_type) values ($1, $2, $3, 'free', 'month', now(), 'system')",
      [tenant, workspace, version],
    );
    const tenantRole = randomUUID();
    const workspaceRole = randomUUID();
    await client.query(
      "insert into access.roles (id, role_code, scope) values ($1, $3, 'tenant'), ($2, $3, 'workspace')",
      [tenantRole, workspaceRole, `analytics-${suffix}`],
    );
    await client.query(
      "insert into tenancy.tenant_memberships (tenant_id, user_id, role_id, role_scope) values ($1, $2, $3, 'tenant')",
      [tenant, user, tenantRole],
    );
    await client.query(
      "insert into tenancy.workspace_memberships (workspace_id, tenant_id, user_id, role_id, role_scope) values ($1, $2, $3, $4, 'workspace')",
      [workspace, tenant, user, workspaceRole],
    );
  });
  afterEach(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
  });
  const read = (
    window: "hour" | "day" | "week" | "month",
    now = "2026-11-14T10:30:00Z",
    zone = "Asia/Shanghai",
  ) =>
    repo.readUsageAnalytics({
      workspaceId: workspace,
      tenantId: tenant,
      metric: "ai.credit",
      window,
      zone,
      now: new Date(now),
    });
  const event = (at: string, amount: number, member: string | null = user) =>
    client.query(
      "insert into metering.usage_events (workspace_id, product_id, metric_key, total_amount, end_user_id, created_at) values ($1, $2, 'ai.credit', $3, $4, $5)",
      [workspace, product, amount, member, at],
    );

  // ============================================================================
  // Calendar boundaries, attribution and zero values
  // ============================================================================

  it.each([
    ["hour", "2026-11-13T11:00:00.000Z", 24],
    ["day", "2026-10-15T16:00:00.000Z", 30],
    ["week", "2026-08-23T16:00:00.000Z", 12],
    ["month", "2025-11-30T16:00:00.000Z", 12],
  ] as const)(
    "%s uses natural periods and stops at the shared current instant",
    async (window, from, count) => {
      const result = await read(window);
      expect(result.from).toBe(from);
      expect(result.to).toBe("2026-11-14T10:30:00.000Z");
      expect(result.buckets).toHaveLength(count);
      expect(result.buckets.every((bucket) => bucket.total === 0)).toBe(true);
      expect(
        result.products.find((p) => p.productCode === zeroProductCode)?.total,
      ).toBe(0);
      expect(result.members.find((m) => m.userNo !== null)?.total).toBe(0);
      expect(result.members.find((m) => m.userNo === null)?.total).toBe(0);
    },
  );

  it("includes midnight/month start, excludes the end, and reconciles all dimensions", async () => {
    await event("2025-11-30T15:59:59Z", 100);
    await event("2025-11-30T16:00:00Z", 3);
    await event("2026-11-14T10:29:59Z", 2, null);
    await event("2026-11-14T10:30:00Z", 100);
    const result = await read("month");
    for (const rows of [result.buckets, result.products, result.members]) {
      expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(5);
    }
    expect(result.members.find((m) => m.userNo === null)?.total).toBe(2);
  });

  it("keeps the day window on midnight across a DST change", async () => {
    const result = await read("day", "2026-10-26T12:00:00Z", "Europe/Berlin");
    expect(result.from).toBe("2026-09-26T22:00:00.000Z");
    expect(result.buckets).toHaveLength(30);
  });

  it("keeps repeated DST hours separate within exactly 24 hourly buckets", async () => {
    await event("2026-10-25T00:30:00Z", 2);
    await event("2026-10-25T01:30:00Z", 3);
    const result = await read("hour", "2026-10-25T12:30:00Z", "Europe/Berlin");
    expect(result.from).toBe("2026-10-24T13:00:00.000Z");
    expect(result.buckets).toHaveLength(24);
    expect(
      result.buckets.find((b) => b.period === "2026-10-25 00:00")?.total,
    ).toBe(2);
    expect(
      result.buckets.find((b) => b.period === "2026-10-25 01:00")?.total,
    ).toBe(3);
  });

  it("does not disclose another tenant's workspace", async () => {
    await expect(
      repo.readUsageAnalytics({
        workspaceId: workspace,
        tenantId: randomUUID(),
        metric: "ai.credit",
        window: "month",
        zone: "UTC",
        now: new Date(),
      }),
    ).rejects.toThrow("workspace scope");
  });
});
