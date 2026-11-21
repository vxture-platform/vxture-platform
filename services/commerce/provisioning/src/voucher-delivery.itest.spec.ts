/**
 * voucher-delivery.itest.spec.ts - Platform notification acceptance on a private database.
 * @package @vxture/service-provisioning
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 * Run through scripts/tests/voucher-acceptance.mjs; never supply an existing database.
 */
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise the existing encrypted webhook-key implementation.
import { deriveSecretKey, encryptSecret } from "@vxture/core-utils";
import { PgProvisioningRepository } from "./repository/pg-provisioning.repository";
import { ProvisioningService } from "./service/provisioning.service";
import { signWebhook, verifyWebhook } from "./signer";
import type {
  DispatchConfig,
  EnqueueEventInput,
  GenericEventPayload,
  ProvisioningAlertSink,
} from "./types/provisioning.types";

// ===========================================================================
// A matching per-run database marker is required before any fixture mutation.
// ===========================================================================
const enabled = process.env["VOUCHER_NOTIFICATION_ITEST"] === "1";

/** Validate the generated connection before opening it. @throws {Error} For any unbound target. */
function isolatedConnection(
  raw: string | undefined,
  runId: string | undefined,
) {
  assert.ok(
    raw && runId,
    "The isolated notification runner must supply its context",
  );
  assert.match(runId, /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}$/);
  const url = new URL(raw);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/voucher_notifications");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535);
  return { url, marker: `codex-voucher-notifications:${runId}` };
}

interface ReceivedDelivery {
  raw: string;
  delivery: string;
  event: string;
  signature: string;
  valid: boolean;
  payload: GenericEventPayload | null;
  status: number;
}

interface DeliveryRow {
  status: string;
  attempts: number;
  response_code: number | null;
  leased_until: Date | null;
  delivered_at: Date | null;
  updated_at: Date;
  created_at: Date;
  next_retry_at: Date | null;
  provisioning_id: string | null;
  provisioning_version: number | null;
  payload: GenericEventPayload;
}

describe.skipIf(!enabled)("S06 platform voucher notification delivery", () => {
  const user = randomUUID(),
    tenant = randomUUID(),
    workspace = randomUUID();
  const product = randomUUID(),
    appCode = "s06-notification-fixture";
  const secret = randomBytes(32).toString("hex");
  const master = randomBytes(32).toString("hex");
  const received: ReceivedDelivery[] = [];
  const applied = new Set<string>();
  const alerts: Parameters<ProvisioningAlertSink["deliveryFailed"]>[0][] = [];
  const cfg: DispatchConfig = {
    maxAttempts: 2,
    backoffBaseSec: 30,
    backoffCapSec: 60,
    leaseSeconds: 30,
    batchSize: 3,
    timeoutMs: 2000,
  };
  let owner: Pool, customer: Pool, admin: Pool, worker: Pool, shared: Pool;
  let repo: PgProvisioningRepository;
  let service: ProvisioningService, second: ProvisioningService;
  let server: Server, endpoint: string;
  let receiverFailure = 0,
    applyBeforeFailure = false;
  let identityVerified = false;
  const previousMaster = process.env["PLATFORM_WEBHOOK_ENC_KEY"];

  function dispatcher(pool: Pool) {
    return new ProvisioningService(
      new PgProvisioningRepository(pool),
      cfg,
      { resolve: (ref) => (ref === "S06_TEST_SECRET" ? secret : null) },
      {
        deliveryFailed: (input) => {
          alerts.push(input);
        },
      },
    );
  }

  beforeAll(async () => {
    const connection = isolatedConnection(
      process.env["DATABASE_URL"],
      process.env["VOUCHER_NOTIFICATION_RUN_ID"],
    );
    owner = new Pool({
      connectionString: connection.url.href,
      connectionTimeoutMillis: 3000,
    });
    const identity = await owner.query<{
      db: string;
      role: string;
      marker: string | null;
    }>(`select current_database() db, current_user role,
      shobj_description(oid, 'pg_database') marker
      from pg_database where datname=current_database()`);
    expect(identity.rows).toEqual([
      {
        db: "voucher_notifications",
        role: "postgres",
        marker: connection.marker,
      },
    ]);
    identityVerified = true;
    const rolePool = (role: string) => {
      const url = new URL(connection.url);
      url.username = role;
      return new Pool({
        connectionString: url.href,
        max: 6,
        connectionTimeoutMillis: 3000,
      });
    };
    customer = rolePool("svc_console_bff");
    admin = rolePool("svc_admin_bff");
    worker = rolePool("svc_platform_api");
    shared = rolePool("platform_svc");
    repo = new PgProvisioningRepository(customer);
    process.env["PLATFORM_WEBHOOK_ENC_KEY"] = master;
    service = dispatcher(admin);
    second = dispatcher(worker);

    // The receiver applies only authenticated deliveries and deduplicates by delivery id.
    server = createServer((req, res) => {
      const chunks: string[] = [];
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => chunks.push(chunk));
      req.on("end", () => {
        const raw = chunks.join("");
        const header = (name: string) => {
          const value = req.headers[name];
          return typeof value === "string" ? value : "";
        };
        const signature = header("x-vxture-signature");
        const delivery = header("x-vxture-delivery");
        const event = header("x-vxture-event");
        const valid = verifyWebhook(
          secret,
          raw,
          signature,
          Math.floor(Date.now() / 1000),
        );
        const payload = valid ? (JSON.parse(raw) as GenericEventPayload) : null;
        const authenticated =
          valid &&
          payload !== null &&
          payload.id === delivery &&
          payload.type === event;
        const status = !authenticated ? 401 : receiverFailure || 200;
        if (authenticated && (status === 200 || applyBeforeFailure))
          applied.add(delivery);
        received.push({
          raw,
          delivery,
          event,
          signature,
          valid,
          payload,
          status,
        });
        res.writeHead(status).end(status === 200 ? "ok" : "rejected");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    endpoint = `http://127.0.0.1:${address.port}/platform-notification-test`;
    await owner.query(
      "insert into account.users(id,account,phone,phone_verified_at) values($1,$2,$3,now())",
      [user, `s06-${user}`, `+1999${randomInt(100000000, 999999999)}`],
    );
    await owner.query(
      "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'S06 test tenant','organization',$2)",
      [tenant, user],
    );
    await owner.query(
      "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'S06 test workspace')",
      [workspace, tenant],
    );
    await owner.query(
      "insert into product.products(id,product_code,product_name,product_type,status) values($1,$2,'S06 receiver fixture','agent','active')",
      [product, appCode],
    );
  }, 20000);

  beforeEach(async () => {
    assert.ok(
      identityVerified,
      "Fixture mutation requires a verified disposable database",
    );
    // This database belongs only to this suite; no other acceptance group uses it.
    await owner.query(
      "delete from provisioning.webhook_deliveries; delete from provisioning.provisionings",
    );
    await owner.query(
      `insert into product.product_webhooks(product_id,webhook_url,webhook_secret_ref)
       values($1,$2,'S06_TEST_SECRET') on conflict(product_id) do update
       set webhook_url=excluded.webhook_url,webhook_secret_ref=excluded.webhook_secret_ref,webhook_secret_enc=null`,
      [product, endpoint],
    );
    received.length = 0;
    applied.clear();
    alerts.length = 0;
    receiverFailure = 0;
    applyBeforeFailure = false;
  });

  afterAll(async () => {
    if (previousMaster === undefined)
      delete process.env["PLATFORM_WEBHOOK_ENC_KEY"];
    else process.env["PLATFORM_WEBHOOK_ENC_KEY"] = previousMaster;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await Promise.all(
      [shared, worker, admin, customer, owner].map(async (pool) => pool?.end()),
    );
  });

  const input = (key = randomUUID()): EnqueueEventInput => ({
    workspaceId: workspace,
    tenantId: tenant,
    applicationId: product,
    appCode,
    event: "subscription_changed",
    idempotencyKey: `s06:${key}`,
    data: { products: [appCode], reason: "voucher-acceptance" },
  });
  const row = async (id: string) => {
    const result = await owner.query<DeliveryRow>(
      "select * from provisioning.webhook_deliveries where id=$1",
      [id],
    );
    const found = result.rows[0];
    assert.ok(found, "Expected persisted notification delivery");
    return found;
  };
  const makeDue = async (id: string) => {
    await owner.query(
      "update provisioning.webhook_deliveries set next_retry_at=now()-interval '1 second' where id=$1",
      [id],
    );
  };

  // ===========================================================================
  // Atomic outbox writes and real HMAC delivery under the runtime role grants.
  // ===========================================================================
  it("rejects nonlocal or unmarked runner contexts before connecting", () => {
    const runId = process.env["VOUCHER_NOTIFICATION_RUN_ID"];
    expect(() => isolatedConnection(undefined, runId)).toThrow();
    expect(() =>
      isolatedConnection(
        "postgresql://postgres@existing.invalid:5432/voucher_notifications",
        runId,
      ),
    ).toThrow();
    expect(() =>
      isolatedConnection(
        "postgresql://postgres@127.0.0.1:5432/postgres",
        runId,
      ),
    ).toThrow();
    expect(() =>
      isolatedConnection(process.env["DATABASE_URL"], "unbound-run"),
    ).toThrow();
  });

  it("publishes a transaction's durable notification only after commit", async () => {
    const client = await customer.connect();
    let id: string | null = null;
    try {
      await client.query("begin");
      id = await repo.enqueueEvent(input(), client);
      expect(id).toBeTypeOf("string");
      expect(
        (
          await owner.query(
            "select id from provisioning.webhook_deliveries where id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
      expect((await service.dispatchPending()).claimed).toBe(0);
      await client.query("commit");
    } finally {
      await client.query("rollback");
      client.release();
    }
    const queued = await row(id!);
    expect(queued.status).toBe("pending");
    expect(queued.provisioning_id).toBeNull();
    expect(queued.provisioning_version).toBeNull();
    expect((await service.dispatchPending()).delivered).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      delivery: id,
      event: "subscription_changed",
      valid: true,
      status: 200,
    });
    expect(received[0]?.payload).toEqual(queued.payload);
    expect(received[0]?.payload).toMatchObject({
      workspace_id: workspace,
      tenant_id: tenant,
      application: appCode,
    });
    const delivered = await row(id!);
    expect(delivered.status).toBe("delivered");
    expect(delivered.delivered_at).toBeInstanceOf(Date);
    expect(delivered.leased_until).toBeNull();
    expect(delivered.updated_at.getTime()).toBeGreaterThanOrEqual(
      delivered.created_at.getTime(),
    );
  });

  it("rolls back lifecycle state and both queue writes with the caller transaction", async () => {
    const client = await customer.connect();
    try {
      await client.query("begin");
      await repo.enqueue(
        { ...input(), event: "tenant.provisioned", plan: "test-plan" },
        client,
      );
      await repo.enqueueEvent(input(), client);
      expect(
        (
          await client.query(
            "select count(*)::int n from provisioning.webhook_deliveries",
          )
        ).rows[0]?.n,
      ).toBe(2);
      await client.query("rollback");
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(
      (
        await owner.query(
          "select count(*)::int n from provisioning.provisionings",
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await owner.query(
          "select count(*)::int n from provisioning.webhook_deliveries",
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect((await service.dispatchPending()).claimed).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("concurrent duplicate notification requests produce one durable delivery", async () => {
    const event = input();
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => repo.enqueueEvent(event)),
    );
    const inserted = ids.filter((id) => id !== null);
    expect(inserted).toHaveLength(1);
    expect(
      (
        await owner.query(
          "select count(*)::int n from provisioning.webhook_deliveries",
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect((await service.dispatchPending()).delivered).toBe(1);
    expect(applied.size).toBe(1);
    expect((await service.dispatchPending()).claimed).toBe(0);
    expect(received).toHaveLength(1);
  });

  it("two runtime workers claim each pending delivery once without overlapping leases", async () => {
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => repo.enqueueEvent(input())),
    );
    const results = [];
    for (let round = 0; round < 2; round++)
      results.push(
        ...(await Promise.all([
          service.dispatchPending(),
          second.dispatchPending(),
        ])),
      );
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(12);
    expect(results.reduce((sum, result) => sum + result.delivered, 0)).toBe(12);
    expect(received).toHaveLength(12);
    expect(new Set(received.map((delivery) => delivery.delivery))).toEqual(
      new Set(ids),
    );
    expect(
      received.every((delivery) => delivery.valid && delivery.status === 200),
    ).toBe(true);
    expect(applied.size).toBe(12);
    expect((await service.dispatchPending()).claimed).toBe(0);
  });

  it("the current shared runtime role also preserves signed notification delivery", async () => {
    const sharedRepo = new PgProvisioningRepository(shared);
    const id = await sharedRepo.enqueueEvent(input());
    expect((await dispatcher(shared).dispatchPending()).delivered).toBe(1);
    expect(received[0]).toMatchObject({
      delivery: id,
      valid: true,
      status: 200,
    });
    expect((await row(id!)).status).toBe("delivered");
  });

  it("the receiver rejects unsigned, wrong-key, tampered and expired requests before applying them", async () => {
    const id = randomUUID();
    const body = JSON.stringify({ id, type: "subscription_changed", data: {} });
    const now = Math.floor(Date.now() / 1000);
    const signed = signWebhook(secret, body, now).header;
    for (const [raw, signature] of [
      [body, ""],
      [body, signWebhook("incorrect-test-key", body, now).header],
      [body + " ", signed],
      [body, signWebhook(secret, body, now - 3600).header],
    ]) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-vxture-signature": signature!,
          "x-vxture-delivery": id,
          "x-vxture-event": "subscription_changed",
        },
        body: raw!,
      });
      expect(response.status).toBe(401);
      await response.text();
    }
    expect(applied.size).toBe(0);
    expect(received.every((delivery) => !delivery.valid)).toBe(true);
  });

  // ===========================================================================
  // Retries use the same delivery id; transport remains at-least-once.
  // ===========================================================================
  it("persists retry timing after 5xx and later delivers the unchanged event", async () => {
    const id = await repo.enqueueEvent(input());
    receiverFailure = 503;
    const firstAt = Date.now();
    expect((await service.dispatchPending()).retried).toBe(1);
    const pending = await row(id!);
    expect(pending).toMatchObject({
      status: "pending",
      attempts: 1,
      response_code: 503,
      leased_until: null,
    });
    assert.ok(pending.next_retry_at);
    expect(pending.next_retry_at.getTime()).toBeGreaterThan(firstAt);
    expect((await service.dispatchPending()).claimed).toBe(0);
    expect(applied.size).toBe(0);
    await makeDue(id!);
    receiverFailure = 0;
    expect((await second.dispatchPending()).delivered).toBe(1);
    expect(received).toHaveLength(2);
    expect(received[1]?.delivery).toBe(received[0]?.delivery);
    expect(received[1]?.raw).toBe(received[0]?.raw);
    expect((await row(id!)).status).toBe("delivered");
    expect(alerts).toHaveLength(0);
  });

  it("a lost acknowledgement may redeliver but the receiver applies the delivery id once", async () => {
    const id = await repo.enqueueEvent(input());
    receiverFailure = 500;
    applyBeforeFailure = true;
    expect((await service.dispatchPending()).retried).toBe(1);
    expect(applied.size).toBe(1);
    await makeDue(id!);
    receiverFailure = 0;
    expect((await second.dispatchPending()).delivered).toBe(1);
    expect(received.map((delivery) => delivery.delivery)).toEqual([id, id]);
    expect(applied.size).toBe(1);
    expect((await service.dispatchPending()).claimed).toBe(0);
  });

  it("respects active leases and recovers an expired lease without changing the event", async () => {
    const id = await repo.enqueueEvent(input());
    const queued = await row(id!);
    await owner.query(
      "update provisioning.webhook_deliveries set status='delivering',leased_until=now()+interval '1 hour' where id=$1",
      [id],
    );
    expect((await second.dispatchPending()).claimed).toBe(0);
    expect(received).toHaveLength(0);
    await owner.query(
      "update provisioning.webhook_deliveries set leased_until=now()-interval '1 second' where id=$1",
      [id],
    );
    expect(await second.dispatchPending()).toMatchObject({
      recovered: 1,
      delivered: 1,
    });
    expect(received[0]?.payload).toEqual(queued.payload);
    expect((await row(id!)).leased_until).toBeNull();
    expect((await service.dispatchPending()).claimed).toBe(0);
  });

  it("retry exhaustion persists failure, alerts once and stops automatic claims", async () => {
    const id = await repo.enqueueEvent(input());
    receiverFailure = 503;
    expect((await service.dispatchPending()).retried).toBe(1);
    await makeDue(id!);
    expect((await second.dispatchPending()).failed).toBe(1);
    expect(await row(id!)).toMatchObject({
      status: "failed",
      attempts: 2,
      response_code: 503,
      leased_until: null,
    });
    expect(alerts).toEqual([
      {
        deliveryId: id,
        tenantId: tenant,
        appCode,
        eventType: "subscription_changed",
        attempts: 2,
        lastResponseCode: 503,
      },
    ]);
    expect((await service.dispatchPending()).claimed).toBe(0);
    expect(alerts).toHaveLength(1);
    expect(received).toHaveLength(2);
  });

  it("a missing signing secret fails closed without sending an unsigned request", async () => {
    await owner.query(
      "update product.product_webhooks set webhook_secret_ref='S06_MISSING_SECRET' where product_id=$1",
      [product],
    );
    const id = await repo.enqueueEvent(input());
    expect((await service.dispatchPending()).retried).toBe(1);
    expect(await row(id!)).toMatchObject({
      status: "pending",
      attempts: 1,
      response_code: null,
    });
    expect(received).toHaveLength(0);
    expect(applied.size).toBe(0);
  });

  it("decrypts a persisted signing key and rejects corrupt ciphertext without falling back", async () => {
    await owner.query(
      "update product.product_webhooks set webhook_secret_enc=$2 where product_id=$1",
      [product, encryptSecret(secret, deriveSecretKey(master))],
    );
    const valid = await repo.enqueueEvent(input());
    expect((await service.dispatchPending()).delivered).toBe(1);
    expect(received[0]).toMatchObject({ delivery: valid, valid: true });
    await owner.query(
      "update product.product_webhooks set webhook_secret_enc=$2 where product_id=$1",
      [
        product,
        encryptSecret(secret, deriveSecretKey("different-test-master")),
      ],
    );
    const invalid = await repo.enqueueEvent(input());
    expect((await service.dispatchPending()).retried).toBe(1);
    expect((await row(invalid!)).status).toBe("pending");
    expect(received).toHaveLength(1);
    expect(applied.size).toBe(1);
  });

  it("an unregistered product is skipped without a fabricated notification or endpoint", async () => {
    await owner.query(
      "delete from product.product_webhooks where product_id=$1",
      [product],
    );
    expect(await repo.enqueueEvent(input())).toBeNull();
    expect((await service.dispatchPending()).claimed).toBe(0);
    expect(received).toHaveLength(0);
  });
});
