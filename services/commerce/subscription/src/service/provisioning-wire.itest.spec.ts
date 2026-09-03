/**
 * provisioning-wire.itest.spec.ts — subscription→provisioning wire integration
 * test (product_310 P2.3b). Real repositories + real enqueue against a local
 * Postgres with the 18-schema DDL + catalog seed applied. Gated by
 * SUBSCRIPTION_ITEST so CI (no DB) skips it. Run locally:
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 *
 * Expects the arda-free plan from seed-catalog (locked here) and creates its
 * own tenant/workspace fixture rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  PgProvisioningRepository,
  ProvisioningService,
} from "@vxture/service-provisioning";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import { SubscriptionService } from "./subscription.service";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
const TENANT = "00000000-0000-4000-aaaa-00000000023b";
const WORKSPACE = "00000000-0000-4000-bbbb-00000000023b";
const USER = "00000000-0000-4000-cccc-00000000023b";

describe.skipIf(!RUN)("subscription → provisioning wire (live DB)", () => {
  let pool: Pool;
  let service: SubscriptionService;
  let planVersionId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const provisioning = new ProvisioningService(
      new PgProvisioningRepository(pool),
      // enqueue-only usage: dispatch config/secrets/alerts are never exercised
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
       values ($1, 'p23b-itest', '+8613800000232', now(), 'web')
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants (id, name, type, owner_user_id)
       values ($1, 'P23b Org', 'organization', $2) on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await pool.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default)
       values ($1, $2, 'P23b WS', true) on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );
    // subscriptions require a locked plan_version (entitlement chain contract)
    const pv = await pool.query<{ id: string }>(
      `update product.plan_versions pv set is_locked = true
       from product.plans p
       where pv.plan_id = p.id and p.plan_code = 'arda-free'
       returning pv.id`,
    );
    planVersionId = pv.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createSubscription enqueues tenant.provisioned for arda", async () => {
    const record = await service.createSubscription({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      planVersionId,
      cycleType: "month",
      startAt: new Date(),
      createdBy: USER,
    });
    subscriptionId = record.id;
    expect(record.status).toBe("active");

    const deliveries = await pool.query<{
      event_type: string;
      payload: { application: string; plan: string | null; seq: number };
    }>(
      `select event_type, payload from provisioning.webhook_deliveries
       where workspace_id = $1
         and event_type in ('tenant.provisioned','tenant.deprovisioned')
       order by created_at asc`,
      [WORKSPACE],
    );
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]!.event_type).toBe("tenant.provisioned");
    expect(deliveries.rows[0]!.payload.application).toBe("arda");
    expect(deliveries.rows[0]!.payload.plan).toBe("arda-free");

    const state = await pool.query<{ status: string; version: number }>(
      `select status, version from provisioning.provisionings where workspace_id = $1`,
      [WORKSPACE],
    );
    expect(state.rows[0]).toMatchObject({ status: "provisioned", version: 1 });
  });

  it("cancelSubscription enqueues tenant.deprovisioned (last coverage)", async () => {
    await service.cancelSubscription(subscriptionId);

    const deliveries = await pool.query<{ event_type: string }>(
      `select event_type from provisioning.webhook_deliveries
       where workspace_id = $1
         and event_type in ('tenant.provisioned','tenant.deprovisioned')
       order by created_at asc`,
      [WORKSPACE],
    );
    expect(deliveries.rows.map((r) => r.event_type)).toEqual([
      "tenant.provisioned",
      "tenant.deprovisioned",
    ]);

    const state = await pool.query<{ status: string; version: number }>(
      `select status, version from provisioning.provisionings where workspace_id = $1`,
      [WORKSPACE],
    );
    expect(state.rows[0]).toMatchObject({
      status: "deprovisioned",
      version: 2,
    });
  });

  it("a second covering subscription suppresses deprovisioning", async () => {
    // two fresh subs on the same version; cancelling one keeps arda provisioned
    const a = await service.createSubscription({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      planVersionId,
      cycleType: "month",
      startAt: new Date(),
      createdBy: USER,
    });
    await service.createSubscription({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      planVersionId,
      cycleType: "month",
      startAt: new Date(),
      createdBy: USER,
    });
    const before = await pool.query<{ n: string }>(
      `select count(*) as n from provisioning.webhook_deliveries
       where workspace_id = $1 and event_type = 'tenant.deprovisioned'`,
      [WORKSPACE],
    );
    await service.cancelSubscription(a.id);
    const after = await pool.query<{ n: string }>(
      `select count(*) as n from provisioning.webhook_deliveries
       where workspace_id = $1 and event_type = 'tenant.deprovisioned'`,
      [WORKSPACE],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n); // no new deprovision
  });
});
