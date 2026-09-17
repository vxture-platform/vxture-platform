/**
 * dispatch.itest.spec.ts - provisioning deliverer integration test (P4)
 *
 * Exercises the real ProvisioningService + PgProvisioningRepository against a
 * local Postgres and an in-process mock receiver. Gated by PROVISION_ITEST so
 * CI (no DB) skips it. Run locally:
 *   PROVISION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgProvisioningRepository } from "./repository/pg-provisioning.repository";
import { ProvisioningService } from "./service/provisioning.service";
import { verifyWebhook } from "./signer";
import type {
  DispatchConfig,
  ProvisioningPayload,
} from "./types/provisioning.types";

const RUN = process.env.PROVISION_ITEST === "1";
// product.products id (the xuanzhen product, created as a fixture below).
const XUANZHEN_APP = "00000000-0000-4000-a000-0000000003a1";
const TENANT = "00000000-0000-4000-aaaa-0000000000f4";
const WORKSPACE = "00000000-0000-4000-bbbb-0000000000f4";
const USER = "00000000-0000-4000-cccc-0000000000f4";
const SECRET = "whsec_itest_0001";
const PORT = 4577;

interface Received {
  payload: ProvisioningPayload;
  signatureValid: boolean;
  event: string;
  delivery: string;
}

describe.skipIf(!RUN)("provisioning deliverer (integration)", () => {
  let pool: Pool;
  let service: ProvisioningService;
  let server: Server;
  const received: Received[] = [];
  // controllable: fail the next N deliveries with 500 (retry testing)
  let failNext = 0;

  const cfg: DispatchConfig = {
    maxAttempts: 3,
    backoffBaseSec: 1, // small so retries fire quickly in-test
    backoffCapSec: 2,
    leaseSeconds: 30,
    batchSize: 50,
    timeoutMs: 3000,
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const repo = new PgProvisioningRepository(pool);
    service = new ProvisioningService(
      repo,
      cfg,
      { resolve: (ref) => (ref === "ITEST_SECRET" ? SECRET : null) },
      { deliveryFailed: () => {} },
    );

    // ── Fixture chain (idempotent): user → tenant → workspace → product →
    //    product_webhooks. provisionings/webhook_deliveries have real cross-schema
    //    FKs onto these (see 90_cross_schema_fk.sql), so all must exist first.
    await pool.query(
      `insert into account.users
         (id, account, phone, phone_verified_at, status, created_at, updated_at)
       values ($1, 'itest_provisioning_user', '+199900000f4', now(), 'active', now(), now())
       on conflict (id) do nothing`,
      [USER],
    );
    await pool.query(
      `insert into tenancy.tenants
         (id, name, type, owner_user_id, status, created_at, updated_at)
       values ($1, 'Provisioning ITest Tenant', 'organization', $2, 'active', now(), now())
       on conflict (id) do nothing`,
      [TENANT, USER],
    );
    await pool.query(
      `insert into tenancy.workspaces
         (id, tenant_id, name, is_default, status, created_at, updated_at)
       values ($1, $2, 'Provisioning ITest Workspace', false, 'active', now(), now())
       on conflict (id) do nothing`,
      [WORKSPACE, TENANT],
    );
    await pool.query(
      `insert into product.products
         (id, product_code, product_type, category_id, product_name, status, created_at, updated_at)
       values ($1, 'xuanzhen', 'agent', null, 'Xuanzhen', 'active', now(), now())
       on conflict (id) do nothing`,
      [XUANZHEN_APP],
    );
    // Point the xuanzhen product's webhook at the mock receiver.
    await pool.query(
      `insert into product.product_webhooks
         (product_id, webhook_url, webhook_secret_ref, created_at, updated_at)
       values ($1, $2, 'ITEST_SECRET', now(), now())
       on conflict (product_id) do update set
         webhook_url = excluded.webhook_url,
         webhook_secret_ref = excluded.webhook_secret_ref,
         updated_at = now()`,
      [XUANZHEN_APP, `http://127.0.0.1:${PORT}/provisioning/webhook`],
    );
    // Clean any prior test state for this workspace (mutable queue rows only;
    // webhook_deliveries.provisioning_id → provisionings, so drop deliveries first).
    await pool.query(
      `delete from provisioning.webhook_deliveries where workspace_id=$1`,
      [WORKSPACE],
    );
    await pool.query(
      `delete from provisioning.provisionings where workspace_id=$1`,
      [WORKSPACE],
    );

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const sig = req.headers["x-vxture-signature"] as string;
        const valid = verifyWebhook(
          SECRET,
          raw,
          sig,
          Math.floor(Date.now() / 1000),
        );
        received.push({
          payload: JSON.parse(raw),
          signatureValid: valid,
          event: req.headers["x-vxture-event"] as string,
          delivery: req.headers["x-vxture-delivery"] as string,
        });
        if (failNext > 0) {
          failNext--;
          res.statusCode = 500;
          res.end("fail");
          return;
        }
        res.statusCode = 200;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  });

  afterAll(async () => {
    // Null-safe: if beforeAll threw before these were assigned, skip teardown
    // so the real setup error surfaces instead of a TypeError here.
    if (server) {
      // Force-destroy any keep-alive sockets so the worker doesn't hang on a
      // lingering handle (fetch/undici keeps client connections warm).
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    if (pool) await pool.end();
  });

  it("delivers a signed tenant.provisioned (seq=1) and marks it delivered", async () => {
    const { deliveryId, seq } = await service.onSubscriptionActivated({
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      applicationId: XUANZHEN_APP,
      appCode: "xuanzhen",
      plan: "pro",
    });
    expect(seq).toBe(1);

    const result = await service.dispatchPending();
    expect(result.delivered).toBe(1);

    const got = received.find((r) => r.delivery === deliveryId);
    expect(got).toBeTruthy();
    expect(got!.signatureValid).toBe(true);
    expect(got!.event).toBe("tenant.provisioned");
    expect(got!.payload.application).toBe("xuanzhen");
    expect(got!.payload.seq).toBe(1);
    expect(got!.payload.plan).toBe("pro");

    const row = await pool.query(
      `select status, attempts, delivered_at, updated_at, created_at
         from provisioning.webhook_deliveries where id=$1`,
      [deliveryId],
    );
    expect(row.rows[0].status).toBe("delivered");
    /* 两个时间戳真落库（2026-09-17）。provisioning 域两表没有触发器，
       `updated_at` 那个 DEFAULT now() 只在 INSERT 时生效——不手写就永远停在创建时间。
       这是唯一能验「真的写进去了」的地方（单测只看得到 SQL 文本）。 */
    expect(row.rows[0].delivered_at).not.toBeNull();
    expect(new Date(row.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(row.rows[0].created_at).getTime(),
    );
  });

  it("bumps seq monotonically on the next event (ordering source)", async () => {
    const { seq } = await service.onSubscriptionDeactivated({
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      applicationId: XUANZHEN_APP,
      appCode: "xuanzhen",
    });
    expect(seq).toBe(2);
    const result = await service.dispatchPending();
    expect(result.delivered).toBe(1);
    const got = received.filter((r) => r.payload.seq === 2);
    expect(got.length).toBeGreaterThan(0);
    expect(got[0]!.event).toBe("tenant.deprovisioned");
  });

  it("does not re-claim already-delivered rows", async () => {
    const result = await service.dispatchPending();
    expect(result.claimed).toBe(0);
  });

  it("retries on 5xx then succeeds (backoff), reaching delivered", async () => {
    failNext = 1; // first attempt 500
    const { deliveryId } = await service.onSubscriptionActivated({
      workspaceId: WORKSPACE,
      tenantId: TENANT,
      applicationId: XUANZHEN_APP,
      appCode: "xuanzhen",
      plan: "pro",
    });
    const first = await service.dispatchPending();
    expect(first.retried).toBe(1);
    let row = await pool.query(
      `select status, attempts, next_retry_at from provisioning.webhook_deliveries where id=$1`,
      [deliveryId],
    );
    expect(row.rows[0].status).toBe("pending");
    expect(row.rows[0].attempts).toBe(1);

    // Wait out the 1s backoff, then it should deliver.
    await new Promise((r) => setTimeout(r, 1200));
    const second = await service.dispatchPending();
    expect(second.delivered).toBeGreaterThanOrEqual(1);
    row = await pool.query(
      `select status from provisioning.webhook_deliveries where id=$1`,
      [deliveryId],
    );
    expect(row.rows[0].status).toBe("delivered");
  });

  it("recovers an expired lease back to pending", async () => {
    // Insert a stuck 'delivering' row with an expired lease. idempotency_key +
    // workspace_id are NOT NULL; a random key keeps it distinct from real rows.
    const stuck = await pool.query(
      `insert into provisioning.webhook_deliveries
         (idempotency_key, workspace_id, tenant_id, product_id, event_type,
          payload, status, attempts, leased_until, created_at)
       values (gen_random_uuid()::text, $1, $2, $3, 'tenant.provisioned',
               '{}'::jsonb, 'delivering', 0, now() - interval '1 minute', now())
       returning id`,
      [WORKSPACE, TENANT, XUANZHEN_APP],
    );
    const id = stuck.rows[0].id;
    const repo = new PgProvisioningRepository(pool);
    const recovered = await repo.recoverExpiredLeases();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const row = await pool.query(
      `select status from provisioning.webhook_deliveries where id=$1`,
      [id],
    );
    expect(row.rows[0].status).toBe("pending");
    // cleanup
    await pool.query(
      `delete from provisioning.webhook_deliveries where id=$1`,
      [id],
    );
  });
});
