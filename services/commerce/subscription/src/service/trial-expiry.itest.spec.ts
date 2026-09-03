/**
 * trial-expiry.itest.spec.ts — live-DB integration test for the D10 trial
 * ruling (product_310 D10 / product_220 §3):
 *
 *   1. the sweep transitions a lapsed never-paid trial trialing → expired
 *      through the existing updateSubscription wiring;
 *   2. the C2 representative-status predicate then surfaces the product as
 *      null (never-subscribed semantics) — while a lapsed PAID subscription
 *      still surfaces 'expired';
 *   3. the live-coverage gate hides the lapsed trial's pools from both the
 *      C2 pool view and the consume candidate set without retiring them
 *      (read-side gating — admin renew revives with no re-materialization).
 *
 * Gated (needs a seeded platform DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { SubscriptionService } from "./subscription.service";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import { ProvisioningService } from "@vxture/service-provisioning";
import { PgProvisioningRepository } from "@vxture/service-provisioning";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";

const USER = "00000000-0000-4000-8000-00000000d101";
const TENANT = "00000000-0000-4000-8000-00000000d102";
const WORKSPACE = "00000000-0000-4000-8000-00000000d103";

/**
 * Mirror of the C2 representative-status query
 * (bff/auth-bff/src/platform/platform-entitlements.service.ts
 * querySubscriptionStatuses) — asserted here at the SQL level because the
 * ruling is a DB-semantics contract, not a bff implementation detail.
 */
const REPRESENTATIVE_SQL = `
  SELECT DISTINCT prod.product_code, ts.status
  FROM metering.subscriptions ts
  JOIN product.plan_versions pv ON pv.id = ts.plan_version_id
  JOIN product.plan_components pc
    ON pc.plan_version_id = pv.id AND pc.component_role = 'primary'
  JOIN product.products prod ON prod.id = pc.product_id
  WHERE ts.workspace_id = $1
    AND prod.product_code = ANY($2::text[])
    AND ts.deleted_at IS NULL
    AND NOT (ts.subscription_kind = 'trial'
             AND ts.status IN ('expired', 'cancelled'))`;

/** Mirror of the C2 pool query's live-coverage gate (queryPools). */
const GATED_POOLS_SQL = `
  SELECT qp.metric_key
  FROM metering.quota_pools qp
  WHERE qp.workspace_id = $1
    AND qp.status = 'active'
    AND (qp.expires_at IS NULL OR qp.expires_at > NOW())
    AND (qp.subscription_id IS NULL OR EXISTS (
           SELECT 1 FROM metering.subscriptions ts
            WHERE ts.id = qp.subscription_id
              AND ts.status IN ('active', 'trialing')
              AND ts.deleted_at IS NULL))`;

describe.runIf(RUN)("trial expiry sweep + D10 null semantics (live DB)", () => {
  let pool: Pool;
  let service: SubscriptionService;
  let trialId: string;
  let paidId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const provisioning = new ProvisioningService(
      new PgProvisioningRepository(pool),
      // enqueue-only usage: dispatch config/secrets/alerts never exercised
      {
        maxAttempts: 1,
        backoffBaseSec: 1,
        backoffCapSec: 1,
        leaseSeconds: 1,
        batchSize: 1,
        timeoutMs: 1000,
      },
      { resolve: () => null },
      { deliveryFailed: () => {} },
    );
    service = new SubscriptionService(
      new PgSubscriptionRepository(pool),
      provisioning,
    );

    await pool.query(
      `insert into account.users (id, account, phone, phone_verified_at, source)
       values ($1, 'd10-itest', '+8613800000461', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'D10 Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await pool.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default)
       values ($1, $2, 'D10 WS', true) on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );
    // clean prior-run state (histories are append-only; neutralize). Soft-
    // delete rather than cancel: this suite asserts representative-status
    // absence, and a prior run's expired PAID contrast row would otherwise
    // leak into the null assertion on reruns.
    await pool.query(
      `update metering.subscriptions set deleted_at = now(), updated_at = now()
        where workspace_id = $1 and deleted_at is null`,
      [WORKSPACE],
    );
    await pool.query(
      `update metering.quota_pools set status = 'retired', retired_at = now()
        where workspace_id = $1 and status = 'active'`,
      [WORKSPACE],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("materializes a lapsed never-paid trial fixture on arda-beta-trial", async () => {
    const pv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans p on p.id = pv.plan_id
        where p.plan_code = 'arda-beta-trial' and pv.is_locked = true`,
    );
    expect(pv.rows).toHaveLength(1);

    // create through the engine (pools materialize), then shape it into the
    // trial fixture (the engine's create path only mints kind='paid' today —
    // trial rows are operator-issued, product_310 beta ruling).
    const record = await service.createSubscription({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      planVersionId: pv.rows[0]!.id,
      cycleType: "month",
      startAt: new Date(),
      createdBy: USER,
    });
    trialId = record.id;
    await pool.query(
      `update metering.subscriptions
          set subscription_kind = 'trial', status = 'trialing',
              trial_end_at = now() - interval '1 day', auto_renew = false
        where id = $1`,
      [trialId],
    );

    const pools = await pool.query(
      `select 1 from metering.quota_pools where subscription_id = $1 and status = 'active'`,
      [trialId],
    );
    expect(pools.rows.length).toBeGreaterThan(0);
  });

  it("while trialing: representative = trialing, pools visible", async () => {
    const rep = await pool.query(REPRESENTATIVE_SQL, [WORKSPACE, ["arda"]]);
    expect(rep.rows.map((r) => r.status)).toContain("trialing");
    const pools = await pool.query(GATED_POOLS_SQL, [WORKSPACE]);
    expect(pools.rows.length).toBeGreaterThan(0);
  });

  it("sweep transitions the lapsed trial to expired via the engine", async () => {
    const swept = await service.sweepLapsedTrials();
    expect(swept).toBeGreaterThanOrEqual(1);

    const row = await pool.query<{ status: string }>(
      `select status from metering.subscriptions where id = $1`,
      [trialId],
    );
    expect(row.rows[0]!.status).toBe("expired");

    // history row carries the system actor
    const hist = await pool.query<{ actor_type: string; to_status: string }>(
      `select actor_type, to_status from metering.subscription_histories
        where subscription_id = $1 order by created_at desc limit 1`,
      [trialId],
    );
    expect(hist.rows[0]).toMatchObject({
      actor_type: "system",
      to_status: "expired",
    });

    // idempotent: nothing left to sweep for this fixture
    const again = await pool.query(
      `select id from metering.subscriptions
        where subscription_kind = 'trial' and status = 'trialing'
          and trial_end_at <= now() and workspace_id = $1`,
      [WORKSPACE],
    );
    expect(again.rows).toHaveLength(0);
  });

  it("after expiry: D10 representative = null (row excluded), pools gated not retired", async () => {
    const rep = await pool.query(REPRESENTATIVE_SQL, [WORKSPACE, ["arda"]]);
    // the expired trial row must NOT surface — with no other primary
    // subscription the product falls out of the map entirely (= null)
    expect(rep.rows.filter((r) => r.product_code === "arda")).toHaveLength(0);

    // pools: still physically active (no retirement write)...
    const raw = await pool.query(
      `select 1 from metering.quota_pools where subscription_id = $1 and status = 'active'`,
      [trialId],
    );
    expect(raw.rows.length).toBeGreaterThan(0);
    // ...but invisible through the live-coverage gate (C2 + consume twin)
    const gated = await pool.query(GATED_POOLS_SQL, [WORKSPACE]);
    expect(gated.rows).toHaveLength(0);
  });

  it("contrast: a lapsed PAID subscription still surfaces 'expired'", async () => {
    const pv = await pool.query<{ id: string }>(
      `select pv.id from product.plan_versions pv
         join product.plans p on p.id = pv.plan_id
        where p.plan_code = 'arda-pro' and pv.is_locked = true`,
    );
    const record = await service.createSubscription({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      planVersionId: pv.rows[0]!.id,
      cycleType: "month",
      startAt: new Date(),
      createdBy: USER,
    });
    paidId = record.id;
    await service.updateSubscription(paidId, {
      status: "expired",
      operatorType: "system",
    });

    const rep = await pool.query(REPRESENTATIVE_SQL, [WORKSPACE, ["arda"]]);
    expect(rep.rows.map((r) => r.status)).toContain("expired");
  });
});
