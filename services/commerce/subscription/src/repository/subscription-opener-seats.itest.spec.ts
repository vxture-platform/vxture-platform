/**
 * Verify opener grants with actual PostgreSQL triggers and seat enforcement.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { PgProductSeatRepository } from "./pg-product-seat.repository";

const U = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const W = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const V = "55555555-5555-4555-8555-555555555555";
const S = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const ddl = readFileSync(
  "../../../deploy/database/ddl/95_triggers.sql",
  "utf8",
);
const migration = readFileSync(
  "../../../deploy/database/migrations/2026-11-15-subscription-opener-seats-01-install.sql",
  "utf8",
);
const backfill = readFileSync(
  "../../../deploy/database/migrations/2026-11-15-subscription-opener-seats-02-backfill.sql",
  "utf8",
);
const preflight = readFileSync(
  "../../../deploy/database/verify/subscription-opener-seats.sql",
  "utf8",
);

// ============================================================================
// Disposable database only; production and normal development data are excluded.
// ============================================================================
describe.skipIf(process.env.SUBSCRIPTION_OPENER_ITEST !== "1")(
  "transactional subscription opener seats",
  () => {
    let pool: Pool;
    beforeAll(async () => {
      if (!process.env.PGDATABASE?.startsWith("opener_seat_qa_"))
        throw new Error("Dedicated QA database required");
      pool = new Pool();
      await pool.query(`
        CREATE SCHEMA account; CREATE SCHEMA tenancy; CREATE SCHEMA metering; CREATE SCHEMA product;
        CREATE TABLE account.users(id uuid PRIMARY KEY,status text,deleted_at timestamptz,account text DEFAULT 'opener');
        CREATE TABLE tenancy.tenants(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
        CREATE TABLE tenancy.tenant_memberships(tenant_id uuid,user_id uuid,status text);
        CREATE TABLE tenancy.workspaces(id uuid PRIMARY KEY,tenant_id uuid,status text,deleted_at timestamptz);
        CREATE TABLE tenancy.workspace_memberships(workspace_id uuid,user_id uuid,status text);
        CREATE TABLE product.products(id uuid PRIMARY KEY,deleted_at timestamptz,product_code text DEFAULT 'cospace');
        CREATE TABLE product.plan_components(plan_version_id uuid,product_id uuid,quota jsonb);
        CREATE TABLE metering.subscriptions(id uuid PRIMARY KEY,workspace_id uuid,tenant_id uuid,
          plan_version_id uuid,status text,created_by_type text,created_by_id uuid,deleted_at timestamptz);
        CREATE TABLE metering.product_seats(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,
          user_id uuid,product_id uuid,subscription_id uuid,granted_by uuid,revoked_at timestamptz,revoked_by uuid);
        CREATE UNIQUE INDEX uidx_product_seats_live ON metering.product_seats
          (workspace_id,product_id,user_id) WHERE revoked_at IS NULL;
      `);
      const start = ddl.indexOf(
        "CREATE OR REPLACE FUNCTION metering.resolve_seat_max",
      );
      const end = ddl.indexOf("-- Subscription openers consume", start);
      await pool.query(ddl.slice(start, end));
      await pool.query(migration);
    });
    afterAll(async () => pool?.end());
    beforeEach(async () => {
      await pool.query(`TRUNCATE account.users,tenancy.tenants,tenancy.tenant_memberships,
        tenancy.workspaces,tenancy.workspace_memberships,product.products,
        product.plan_components,metering.subscriptions,metering.product_seats`);
      await pool.query(
        "INSERT INTO account.users(id,status,deleted_at) VALUES($1,'active',NULL)",
        [U],
      );
      await pool.query("INSERT INTO tenancy.tenants VALUES($1,'active',NULL)", [
        T,
      ]);
      await pool.query(
        "INSERT INTO tenancy.tenant_memberships VALUES($1,$2,'active')",
        [T, U],
      );
      await pool.query(
        "INSERT INTO tenancy.workspaces VALUES($1,$2,'active',NULL)",
        [W, T],
      );
      await pool.query(
        "INSERT INTO tenancy.workspace_memberships VALUES($1,$2,'active')",
        [W, U],
      );
      await pool.query(
        "INSERT INTO product.products(id,deleted_at) VALUES($1,NULL)",
        [P],
      );
      await pool.query(
        `INSERT INTO product.plan_components VALUES($1,$2,'{"seat.max":5}')`,
        [V, P],
      );
    });
    async function open(actor = "customer", status = "active") {
      return pool.query(
        `INSERT INTO metering.subscriptions VALUES($1,$2,$3,$4,$5,$6,$7,NULL)`,
        [S, W, T, V, status, actor, U],
      );
    }
    async function count() {
      return Number(
        (
          await pool.query(
            "SELECT count(*) FROM metering.product_seats WHERE revoked_at IS NULL",
          )
        ).rows[0].count,
      );
    }
    it("installs the same functions in DDL and repeatable migration", async () => {
      const block = ddl.slice(
        ddl.indexOf("-- BEGIN SUBSCRIPTION OPENER SEATS"),
        ddl.indexOf("-- END SUBSCRIPTION OPENER SEATS") +
          "-- END SUBSCRIPTION OPENER SEATS".length,
      );
      expect(migration).toContain(block);
      await pool.query(migration);
      await open();
      expect(await count()).toBe(1);
      await expect(
        new PgProductSeatRepository(pool).hasUserAccess({
          subject: `usr_${U}`,
          orgId: T,
          workspaceId: W,
          productCode: "cospace",
        }),
      ).resolves.toBe(true);
      expect(
        (
          await pool.query(
            "SELECT user_id,granted_by FROM metering.product_seats",
          )
        ).rows[0],
      ).toEqual({ user_id: U, granted_by: null });
    });
    it.each(["active", "trialing", "expiring", "overdue"])(
      "grants customer opener on %s",
      async (status) => {
        await open("customer", status);
        expect(await count()).toBe(1);
      },
    );
    it.each(["system", "operator"])(
      "never grants the %s actor as a customer",
      async (actor) => {
        await open(actor);
        expect(await count()).toBe(0);
      },
    );
    it("does not grant before activation; activation and repeated updates grant once", async () => {
      await open("customer", "suspended");
      expect(await count()).toBe(0);
      await pool.query(
        "UPDATE metering.subscriptions SET status='active' WHERE id=$1",
        [S],
      );
      await pool.query(
        "UPDATE metering.subscriptions SET status='active' WHERE id=$1",
        [S],
      );
      expect(await count()).toBe(1);
    });
    it("grants bundled components and preserves seats across version switches", async () => {
      await pool.query(
        "INSERT INTO product.products(id,deleted_at) VALUES($1,NULL)",
        [OTHER],
      );
      await pool.query(
        `INSERT INTO product.plan_components VALUES($1,$2,'{"seat.max":5}')`,
        [V, OTHER],
      );
      await open();
      expect(await count()).toBe(2);
      await pool.query(
        `INSERT INTO product.plan_components SELECT $1,product_id,quota FROM product.plan_components`,
        [OTHER],
      );
      await pool.query(
        "UPDATE metering.subscriptions SET plan_version_id=$1 WHERE id=$2",
        [OTHER, S],
      );
      expect(await count()).toBe(2);
    });
    it("preserves explicit administrative revocation on retry", async () => {
      await open();
      await pool.query(
        "UPDATE metering.product_seats SET revoked_at=now(),revoked_by=$1",
        [OTHER],
      );
      await pool.query(
        "UPDATE metering.subscriptions SET status='active' WHERE id=$1",
        [S],
      );
      expect(await count()).toBe(0);
    });
    it("does not block organization renewal after the original purchaser leaves", async () => {
      await open();
      await pool.query("DELETE FROM tenancy.workspace_memberships");
      await pool.query(
        "UPDATE metering.subscriptions SET status='overdue' WHERE id=$1",
        [S],
      );
      await pool.query(
        "UPDATE metering.subscriptions SET status='suspended' WHERE id=$1",
        [S],
      );
      await pool.query("DELETE FROM metering.product_seats");
      await pool.query(
        "UPDATE metering.subscriptions SET status='active' WHERE id=$1",
        [S],
      );
      expect(await count()).toBe(0);
    });
    it("backfills existing customer openers exactly once without changing other actors", async () => {
      await pool.query(
        "ALTER TABLE metering.subscriptions DISABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      await open();
      await pool.query(
        `INSERT INTO metering.subscriptions VALUES($1,$2,$3,$4,'active','operator',$5,NULL)`,
        [OTHER, W, T, V, OTHER],
      );
      await pool.query(
        "ALTER TABLE metering.subscriptions ENABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      await pool.query(backfill);
      await pool.query(backfill);
      expect(await count()).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT user_id,subscription_id FROM metering.product_seats",
          )
        ).rows,
      ).toEqual([{ user_id: U, subscription_id: S }]);
    });
    it("backfill does not restore explicit revocations", async () => {
      await open();
      await pool.query(
        "UPDATE metering.product_seats SET revoked_at=now(),revoked_by=$1",
        [OTHER],
      );
      await pool.query(backfill);
      expect(await count()).toBe(0);
    });
    it("production preflight reports identity and capacity without assigning a seat", async () => {
      await pool.query(
        "ALTER TABLE metering.subscriptions DISABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      await open();
      await pool.query(
        "ALTER TABLE metering.subscriptions ENABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      const report = await pool.query(preflight);
      const statements = report as unknown as {
        rows: Record<string, unknown>[];
      }[];
      expect(statements.flatMap((statement) => statement.rows)).toContainEqual(
        expect.objectContaining({
          account: "opener",
          eligible_opener: true,
          seat_max: 5,
          occupied: "0",
          opener_assigned: false,
        }),
      );
      expect(await count()).toBe(0);
    });
    it("rolls back the whole backfill when one bundled product is full", async () => {
      await pool.query(
        "INSERT INTO product.products(id,deleted_at) VALUES($1,NULL)",
        [OTHER],
      );
      await pool.query(
        `INSERT INTO product.plan_components VALUES($1,$2,'{"seat.max":1}')`,
        [V, OTHER],
      );
      await pool.query(
        "ALTER TABLE metering.subscriptions DISABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      await open();
      await pool.query(
        "ALTER TABLE metering.subscriptions ENABLE TRIGGER trg_subscriptions_grant_opener_seats",
      );
      await pool.query(
        `INSERT INTO metering.product_seats(workspace_id,user_id,product_id,subscription_id) VALUES($1,$2,$2,$3)`,
        [W, OTHER, S],
      );
      const client = await pool.connect();
      try {
        await expect(client.query(backfill)).rejects.toMatchObject({
          code: "VX409",
        });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(await count()).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT * FROM metering.product_seats WHERE user_id=$1",
            [U],
          )
        ).rowCount,
      ).toBe(0);
    });
    it.each([
      "DELETE FROM tenancy.workspace_memberships",
      "UPDATE tenancy.tenant_memberships SET status='suspended'",
      "UPDATE account.users SET status='suspended'",
      "UPDATE tenancy.workspaces SET status='archived'",
    ])("invalid opener rolls back subscription: %s", async (sql) => {
      await pool.query(sql);
      await expect(open()).rejects.toMatchObject({ code: "VX403" });
      expect(
        (await pool.query("SELECT * FROM metering.subscriptions")).rowCount,
      ).toBe(0);
      expect(await count()).toBe(0);
    });
    it("respects the seat limit and rolls back activation if full", async () => {
      await pool.query(
        `INSERT INTO metering.subscriptions VALUES($1,$2,$3,$4,'active','system',NULL,NULL)`,
        [OTHER, W, T, V],
      );
      await pool.query(
        `UPDATE product.plan_components SET quota='{"seat.max":1}'`,
      );
      await pool.query(
        `INSERT INTO metering.product_seats(workspace_id,user_id,product_id,subscription_id) VALUES($1,$2,$3,$4)`,
        [W, OTHER, P, OTHER],
      );
      await expect(open()).rejects.toMatchObject({ code: "VX409" });
      expect(
        (
          await pool.query("SELECT * FROM metering.subscriptions WHERE id=$1", [
            S,
          ])
        ).rowCount,
      ).toBe(0);
      expect(await count()).toBe(1);
    });
  },
);
