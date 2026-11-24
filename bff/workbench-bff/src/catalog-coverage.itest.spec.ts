/**
 * Verify workspace coverage and annual retention against isolated PostgreSQL data.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-18
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";
import { CatalogService } from "./catalog-service";

const ORG = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "33333333-3333-4333-8333-333333333333";
const OTHER = "66666666-6666-4666-8666-666666666666";
const USER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const PLAN = "55555555-5555-4555-8555-555555555555";

// ============================================================================
// Transactions keep the anniversary boundary stable and roll back fixture writes.
// ============================================================================
describe.skipIf(process.env.WORKBENCH_CATALOG_ITEST !== "1")(
  "workspace catalog PostgreSQL",
  () => {
    let pool: Pool;
    let service: CatalogService;
    beforeAll(async () => {
      if (!process.env.PGDATABASE?.startsWith("workbench_catalog_qa_"))
        throw new Error("Dedicated workbench QA database required");
      pool = new Pool({ max: 1 });
      service = new CatalogService(pool, {
        hasUserAccess: vi.fn().mockResolvedValue(true),
      });
      await pool.query(`create schema product; create schema metering; create schema tenancy; create schema account;
      create table product.products(id uuid, product_code text, deleted_at timestamptz,
        is_customer_visible boolean default true, maintenance_window_id uuid, maintenance_until timestamptz);
      create table product.plan_versions(id uuid);
      create table product.plan_components(plan_version_id uuid, product_id uuid, component_role text, tier text);
      create table tenancy.workspaces(id uuid, tenant_id uuid, deleted_at timestamptz);
      create table metering.subscriptions(id uuid, workspace_id uuid, tenant_id uuid, plan_version_id uuid,
        status text, start_at timestamptz, end_at timestamptz, trial_end_at timestamptz, deleted_at timestamptz);
      create table metering.subscription_entitlement_overrides(subscription_id uuid, product_id uuid,
        override_tier_code text, expires_at timestamptz);
      create table account.user_product_favorites(product_id uuid, user_id uuid);`);
    });
    beforeEach(async () => {
      await pool.query("begin");
      await pool.query("insert into tenancy.workspaces values($1,$2,null)", [
        WORKSPACE,
        ORG,
      ]);
      await pool.query(
        "insert into product.products(id,product_code) values($1,'covered')",
        [PRODUCT],
      );
      await pool.query("insert into product.plan_versions values($1)", [PLAN]);
      await pool.query(
        "insert into product.plan_components values($1,$2,'primary','team')",
        [PLAN, PRODUCT],
      );
      await pool.query(
        `insert into metering.subscriptions(id,workspace_id,tenant_id,plan_version_id,status,start_at,end_at)
      values($1,$2,$3,$4,'active',now()-interval '1 month',now()+interval '1 month')`,
        [PRODUCT, WORKSPACE, ORG, PLAN],
      );
    });
    afterEach(async () => {
      await pool.query("rollback");
    });
    afterAll(async () => {
      await pool?.end();
    });

    // ============================================================================
    // Product visibility is independent from member entry permission.
    // ============================================================================
    it.each(["1 year", "1 day"])(
      "retains expired subscriptions at %s",
      async (age) => {
        await pool.query(
          "update metering.subscriptions set status='expired',end_at=now()-$1::interval",
          [age],
        );
        expect(await service.subscriptions(WORKSPACE, ORG, USER)).toHaveLength(
          1,
        );
      },
    );
    it("hides expired subscriptions beyond the anniversary without deleting them", async () => {
      await pool.query(
        "update metering.subscriptions set status='expired',end_at=now()-interval '1 year 1 second'",
      );
      expect(await service.subscriptions(WORKSPACE, ORG, USER)).toEqual([]);
      expect(
        (
          await pool.query(
            "select count(*)::int as count from metering.subscriptions",
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("keeps bundled coverage without admitting public-only products", async () => {
      await pool.query(
        "update product.plan_components set component_role='bundled',tier=null",
      );
      await pool.query(
        "insert into product.products(id,product_code) values($1,'public-only')",
        [OTHER],
      );
      expect(await service.subscriptions(WORKSPACE, ORG, USER)).toMatchObject([
        { productCode: "covered", bundled: true, tier: null },
      ]);
    });
    it("never mixes another workspace or tenant into coverage", async () => {
      expect(await service.subscriptions(OTHER, ORG, USER)).toEqual([]);
      expect(await service.subscriptions(WORKSPACE, OTHER, USER)).toEqual([]);
    });
    it("keeps denied member applications visible", async () => {
      const denied = new CatalogService(pool, {
        hasUserAccess: vi.fn().mockResolvedValue(false),
      });
      expect(await denied.subscriptions(WORKSPACE, ORG, USER)).toMatchObject([
        { productCode: "covered", access: "denied" },
      ]);
    });
  },
);
