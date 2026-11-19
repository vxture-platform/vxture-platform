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
   create table account.user_profiles(user_id uuid primary key,display_name text);
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
        `truncate account.user_profiles,account.users,tenancy.tenants,tenancy.tenant_memberships,tenancy.workspaces,tenancy.workspace_memberships,metering.product_seats,product.products,product.plan_components,metering.subscriptions`,
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
      expect((await repo.listAuthorizedUsers(input, null, 100))?.items).toEqual(
        [],
      );
      expect(
        await repo.listAuthorizedUsers(
          { ...input, requesterSubject: input.subject },
          null,
          100,
        ),
      ).toBeNull();
    });
    it.each(["active", "trialing", "expiring", "overdue"])(
      "allows %s coverage and rejects another component",
      async (status) => {
        await pool.query("update metering.subscriptions set status=$1", [
          status,
        ]);
        expect(await repo.hasUserAccess(input)).toBe(true);
        expect(
          (await repo.listAuthorizedUsers(input, null, 100))?.items,
        ).toEqual([{ subject: input.subject, displayName: null }]);
        await pool.query("update product.plan_components set product_id=$1", [
          OTHER,
        ]);
        expect(await repo.hasUserAccess(input)).toBe(false);
        expect(
          (await repo.listAuthorizedUsers(input, null, 100))?.items,
        ).toEqual([]);
      },
    );

    // ========================================================================
    // Product roster: live identities, minimal projection and paging
    // ========================================================================
    it("returns the exact OIDC subject without the public user number or account data", async () => {
      const page = await repo.listAuthorizedUsers(input, null, 100);
      expect(page).toEqual({
        items: [{ subject: input.subject, displayName: null }],
        version: expect.stringMatching(/^[a-f0-9]{32}$/),
        hasMore: false,
      });
      expect(
        await repo.listAuthorizedUsers(
          { ...input, requesterSubject: input.subject },
          null,
          100,
        ),
      ).toEqual(page);
    });
    it.each([null, "", "  ", "CoSpace Manager"])(
      "handles display name %j without a private account fallback",
      async (name) => {
        await pool.query("insert into account.user_profiles values ($1,$2)", [
          USER,
          name,
        ]);
        expect(
          (await repo.listAuthorizedUsers(input, null, 100))?.items[0]
            ?.displayName,
        ).toBe(name?.trim() || null);
      },
    );
    it.each(["orgId", "workspaceId", "productCode"] as const)(
      "isolates roster %s",
      async (key) => {
        expect(
          (
            await repo.listAuthorizedUsers(
              {
                ...input,
                [key]: key === "productCode" ? "another-product" : OTHER,
              },
              null,
              100,
            )
          )?.items,
        ).toEqual([]);
      },
    );
    it("requires an explicit seat even when every active workspace member has subscription coverage", async () => {
      await pool.query(
        "insert into account.users values ($1,9876543210,'active',null)",
        [OTHER],
      );
      await pool.query(
        "insert into tenancy.tenant_memberships values ($1,$2,'active')",
        [ORG, OTHER],
      );
      await pool.query(
        "insert into tenancy.workspace_memberships values ($1,$2,'active')",
        [WS, OTHER],
      );
      expect(
        (await repo.listAuthorizedUsers(input, null, 100))?.items,
      ).toHaveLength(1);
      expect(
        await repo.hasUserAccess({ ...input, subject: `usr_${OTHER}` }),
      ).toBe(false);
      await pool.query(
        "insert into metering.product_seats values ($1,$2,$3,null)",
        [WS, OTHER, PRODUCT],
      );
      const first = await repo.listAuthorizedUsers(input, null, 1);
      const second = await repo.listAuthorizedUsers(
        input,
        first!.items[0]!.subject,
        1,
      );
      expect(first?.hasMore).toBe(true);
      expect(second?.hasMore).toBe(false);
      expect(first?.version).toBe(second?.version);
      expect(
        [...first!.items, ...second!.items].map((item) => item.subject),
      ).toEqual([input.subject, `usr_${OTHER}`]);
      const before = first?.version;
      await pool.query(
        "update metering.product_seats set revoked_at=now() where user_id=$1",
        [OTHER],
      );
      expect(
        (await repo.listAuthorizedUsers(input, null, 100))?.version,
      ).not.toBe(before);
    });
    it("changes the revision for a name edit but not for a repeated identical read", async () => {
      const before = await repo.listAuthorizedUsers(input, null, 100);
      expect((await repo.listAuthorizedUsers(input, null, 100))?.version).toBe(
        before?.version,
      );
      await pool.query(
        "insert into account.user_profiles values ($1,'New Name')",
        [USER],
      );
      expect(
        (await repo.listAuthorizedUsers(input, null, 100))?.version,
      ).not.toBe(before?.version);
    });
    it("rejects an OBO reader whose verified subject is not eligible", async () => {
      expect(
        await repo.listAuthorizedUsers(
          { ...input, requesterSubject: `usr_${OTHER}` },
          null,
          100,
        ),
      ).toBeNull();
    });
    it("does not collapse database faults into an empty roster", async () => {
      await pool.query(
        "alter table account.user_profiles rename to unavailable_profiles",
      );
      try {
        await expect(
          repo.listAuthorizedUsers(input, null, 100),
        ).rejects.toThrow();
      } finally {
        await pool.query(
          "alter table account.unavailable_profiles rename to user_profiles",
        );
      }
    });
    it.each([0, -1, 201, 1.5, NaN])(
      "rejects unbounded internal page size %s",
      async (limit) => {
        await expect(
          repo.listAuthorizedUsers(input, null, limit),
        ).rejects.toThrow(RangeError);
      },
    );
  },
);
