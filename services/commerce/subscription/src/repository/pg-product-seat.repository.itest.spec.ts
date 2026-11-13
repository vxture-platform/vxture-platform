/**
 * Exercise the actual application-access query against isolated PostgreSQL facts.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { PgProductSeatRepository } from "./pg-product-seat.repository";
const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const PLAN = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
// ============================================================================
// The runner creates a dedicated database; this suite never touches platform data.
// ============================================================================
describe.skipIf(process.env.SUBSCRIPTION_SEAT_ITEST !== "1")(
  "user product access PostgreSQL",
  () => {
    let pool: Pool;
    let repo: PgProductSeatRepository;
    beforeAll(async () => {
      if (!process.env.PGDATABASE?.startsWith("product_access_qa_"))
        throw Error("Dedicated QA database required");
      pool = new Pool();
      repo = new PgProductSeatRepository(pool);
      await pool.query(`create schema account; create schema tenancy; create schema metering; create schema product;
   create table account.users(id uuid primary key,user_no bigint,status text,deleted_at timestamptz);
   create table tenancy.tenants(id uuid primary key,status text,deleted_at timestamptz);
   create table tenancy.tenant_memberships(tenant_id uuid,user_id uuid,status text);
   create table tenancy.workspaces(id uuid primary key,tenant_id uuid,status text,deleted_at timestamptz);
   create table tenancy.workspace_memberships(workspace_id uuid,user_id uuid,status text);
   create table metering.product_seats(workspace_id uuid,user_id uuid,product_id uuid,revoked_at timestamptz);
   create table product.products(id uuid primary key,product_code text,deleted_at timestamptz);
   create table product.plan_components(plan_version_id uuid,product_id uuid);
   create table metering.subscriptions(workspace_id uuid,tenant_id uuid,plan_version_id uuid,status text,deleted_at timestamptz);`);
    });
    afterAll(async () => {
      await pool?.end();
    });
    beforeEach(async () => {
      await pool.query(
        `truncate account.users,tenancy.tenants,tenancy.tenant_memberships,tenancy.workspaces,tenancy.workspace_memberships,metering.product_seats,product.products,product.plan_components,metering.subscriptions`,
      );
      await pool.query(
        `insert into account.users values($1,1234567890,'active',null);
   `,
        [USER],
      );
      await pool.query(`insert into tenancy.tenants values($1,'active',null)`, [
        ORG,
      ]);
      await pool.query(
        `insert into tenancy.tenant_memberships values($1,$2,'active')`,
        [ORG, USER],
      );
      await pool.query(
        `insert into tenancy.workspaces values($1,$2,'active',null)`,
        [WS, ORG],
      );
      await pool.query(
        `insert into tenancy.workspace_memberships values($1,$2,'active')`,
        [WS, USER],
      );
      await pool.query(
        `insert into product.products values($1,'cospace',null)`,
        [PRODUCT],
      );
      await pool.query(`insert into product.plan_components values($1,$2)`, [
        PLAN,
        PRODUCT,
      ]);
      await pool.query(
        `insert into metering.subscriptions values($1,$2,$3,'active',null)`,
        [WS, ORG, PLAN],
      );
      await pool.query(
        `insert into metering.product_seats values($1,$2,$3,null)`,
        [WS, USER, PRODUCT],
      );
    });
    const input = {
      subject: `usr_${USER}`,
      orgId: ORG,
      workspaceId: WS,
      productCode: "cospace",
    };
    it("recognizes the OIDC UUID subject, independently from its visible user number", async () => {
      expect(await repo.hasUserAccess(input)).toBe(true);
      expect(
        await repo.hasUserAccess({ ...input, subject: "usr_1234567890" }),
      ).toBe(false);
    });
    it.each(["subject", "orgId", "workspaceId", "productCode"] as const)(
      "does not cross %s",
      async (key) => {
        expect(
          await repo.hasUserAccess({
            ...input,
            [key]:
              key === "subject"
                ? `usr_${OTHER}`
                : key === "productCode"
                  ? "other"
                  : OTHER,
          }),
        ).toBe(false);
      },
    );
    it.each([
      "update metering.product_seats set revoked_at=now()",
      "delete from metering.product_seats",
      "update account.users set status='disabled'",
      "update account.users set deleted_at=now()",
      "update tenancy.tenant_memberships set status='removed'",
      "update tenancy.workspace_memberships set status='suspended'",
      "update tenancy.tenants set status='suspended'",
      "update tenancy.workspaces set status='archived'",
      "update product.products set deleted_at=now()",
      "update metering.subscriptions set status='expired'",
      "update metering.subscriptions set deleted_at=now()",
    ])("denies invalidated authority: %s", async (sql) => {
      await pool.query(sql);
      expect(await repo.hasUserAccess(input)).toBe(false);
    });
    it("allows a trial and rejects coverage of another component", async () => {
      await pool.query("update metering.subscriptions set status='trialing'");
      expect(await repo.hasUserAccess(input)).toBe(true);
      await pool.query("update product.plan_components set product_id=$1", [
        OTHER,
      ]);
      expect(await repo.hasUserAccess(input)).toBe(false);
    });
  },
);
