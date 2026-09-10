/**
 * pg-provisioning.repository.ts - provisioning state + delivery queue (P4)
 * @package @vxture/service-provisioning
 * @layer Infrastructure
 *
 * Owns provisioning.provisionings (state + monotonic version) and
 * provisioning.webhook_deliveries (the at-least-once queue with DB lease).
 * See docs/design/identity-platform-rp-integration.md §3/§5.
 */
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PROVISIONING_PG_POOL } from "../tokens";
import type {
  ClaimedDelivery,
  DeliveryEventType,
  EnqueueEventInput,
  EnqueueProvisioningInput,
  GenericEventPayload,
  ProvisioningPayload,
} from "../types/provisioning.types";

interface ClaimRow {
  id: string;
  workspace_id: string;
  tenant_id: string;
  application_id: string;
  event_type: DeliveryEventType;
  payload: ProvisioningPayload | GenericEventPayload;
  attempts: number;
}

interface WebhookCfgRow {
  product_id: string;
  webhook_url: string | null;
  webhook_secret_ref: string | null;
  webhook_secret_enc: string | null;
}

@Injectable()
export class PgProvisioningRepository {
  constructor(@Inject(PROVISIONING_PG_POOL) private readonly pool: Pool) {}

  /**
   * Atomically bump the (workspace, product) provisioning state + version and
   * enqueue a webhook delivery whose payload carries the new version as `seq`.
   * Returns the delivery id + seq. One transaction so state and queue never
   * diverge. The row is UNIQUE per (workspace_id, product_id) — each workspace
   * has its own space in the external product.
   */
  async enqueue(
    input: EnqueueProvisioningInput,
  ): Promise<{ deliveryId: string; seq: number }> {
    const isProvision = input.event === "tenant.provisioned";
    const occurredAt = input.occurredAt ?? Math.floor(Date.now() / 1000);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const upsert = await client.query<{ id: string; version: number }>(
        `insert into provisioning.provisionings
           (workspace_id, tenant_id, product_id, status, version,
            provisioned_at, deprovisioned_at, created_at, updated_at)
         values ($1, $2, $3, $4, 1,
                 case when $5 then now() else null end,
                 case when $5 then null else now() end, now(), now())
         on conflict (workspace_id, product_id) do update set
           status = excluded.status,
           version = provisioning.provisionings.version + 1,
           provisioned_at = case when $5 then now()
             else provisioning.provisionings.provisioned_at end,
           deprovisioned_at = case when $5
             then provisioning.provisionings.deprovisioned_at else now() end,
           updated_at = now()
         returning id, version`,
        [
          input.workspaceId,
          input.tenantId,
          input.applicationId,
          isProvision ? "provisioned" : "deprovisioned",
          isProvision,
        ],
      );
      const provisioningId = upsert.rows[0]!.id;
      const seq = upsert.rows[0]!.version;
      const deliveryId = randomUUID();
      // Deterministic per-workspace idempotency key. version bumps on every
      // enqueue, so this stays unique across repeat events; including
      // workspace_id prevents cross-workspace key collisions (see
      // data_commerce_220 §idempotency).
      const idempotencyKey = `${input.workspaceId}:${input.applicationId}:${input.event}:${seq}`;
      const payload: ProvisioningPayload = {
        id: deliveryId,
        type: input.event,
        occurred_at: occurredAt,
        seq,
        workspace_id: input.workspaceId,
        tenant_id: input.tenantId,
        application: input.appCode,
        plan: input.plan ?? null,
        data: {},
      };
      await client.query(
        `insert into provisioning.webhook_deliveries
           (id, idempotency_key, provisioning_id, provisioning_version,
            workspace_id, tenant_id, product_id, event_type, payload,
            status, attempts, next_retry_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
                 'pending', 0, now(), now())`,
        [
          deliveryId,
          idempotencyKey,
          provisioningId,
          seq,
          input.workspaceId,
          input.tenantId,
          input.applicationId,
          input.event,
          JSON.stringify(payload),
        ],
      );
      await client.query("commit");
      return { deliveryId, seq };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Enqueue a version-less notification event (subscription_changed /
   * grant.invalidated) on the same delivery queue — no state-machine bump,
   * provisioning_id/version NULL (data_commerce_220 §2 left them nullable for
   * exactly this). Idempotent on the caller-derived key. Products without a
   * product_webhooks registration are skipped (nothing to notify — otherwise
   * every enqueue would retry to dead-letter against a missing endpoint).
   * Returns the delivery id, or null when skipped / already enqueued.
   */
  async enqueueEvent(input: EnqueueEventInput): Promise<string | null> {
    const occurredAt = input.occurredAt ?? Math.floor(Date.now() / 1000);
    const deliveryId = randomUUID();
    const payload: GenericEventPayload = {
      id: deliveryId,
      type: input.event,
      occurred_at: occurredAt,
      workspace_id: input.workspaceId,
      tenant_id: input.tenantId,
      application: input.appCode,
      data: input.data,
    };
    const res = await this.pool.query<{ id: string }>(
      `insert into provisioning.webhook_deliveries
         (id, idempotency_key, provisioning_id, provisioning_version,
          workspace_id, tenant_id, product_id, event_type, payload,
          status, attempts, next_retry_at, created_at)
       select $1, $2, null, null, $3, $4, $5, $6, $7::jsonb,
              'pending', 0, now(), now()
        where exists (select 1 from product.product_webhooks pw
                       where pw.product_id = $5)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        deliveryId,
        input.idempotencyKey,
        input.workspaceId,
        input.tenantId,
        input.applicationId,
        input.event,
        JSON.stringify(payload),
      ],
    );
    return res.rows[0]?.id ?? null;
  }

  /**
   * Claim up to `batchSize` due deliveries for this instance via FOR UPDATE SKIP
   * LOCKED + a lease, then join each row's app webhook config. Concurrent
   * dispatchers never claim the same row.
   */
  async claimBatch(
    leaseSeconds: number,
    batchSize: number,
  ): Promise<ClaimedDelivery[]> {
    const claimed = await this.pool.query<ClaimRow>(
      `update provisioning.webhook_deliveries d
       set status = 'delivering',
           leased_until = now() + ($1 * interval '1 second'),
           last_attempt_at = now()
       from (
         select id from provisioning.webhook_deliveries
         where status = 'pending'
           and (next_retry_at is null or next_retry_at <= now())
         order by created_at asc
         limit $2
         for update skip locked
       ) c
       where d.id = c.id
       returning d.id, d.workspace_id, d.tenant_id,
                 d.product_id as application_id, d.event_type,
                 d.payload, d.attempts`,
      [leaseSeconds, batchSize],
    );
    if (claimed.rows.length === 0) return [];

    // Webhook endpoint + secret live in product.product_webhooks, keyed by
    // product_id (one row per product).
    const productIds = [...new Set(claimed.rows.map((r) => r.application_id))];
    const cfgs = await this.pool.query<WebhookCfgRow>(
      `select product_id, webhook_url, webhook_secret_ref, webhook_secret_enc
         from product.product_webhooks
        where product_id = any($1::uuid[])`,
      [productIds],
    );
    const cfgByProduct = new Map(cfgs.rows.map((c) => [c.product_id, c]));

    return claimed.rows.map((r) => {
      const cfg = cfgByProduct.get(r.application_id);
      return {
        id: r.id,
        workspaceId: r.workspace_id,
        tenantId: r.tenant_id,
        applicationId: r.application_id,
        eventType: r.event_type,
        payload: r.payload,
        attempts: r.attempts,
        webhookUrl: cfg?.webhook_url ?? null,
        webhookSecretRef: cfg?.webhook_secret_ref ?? null,
        webhookSecretEnc: cfg?.webhook_secret_enc ?? null,
      };
    });
  }

  /** Mark a delivery delivered (2xx). */
  async markDelivered(id: string, responseCode: number | null): Promise<void> {
    await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='delivered', response_code=$2, leased_until=null
       where id=$1`,
      [id, responseCode],
    );
  }

  /** Return a delivery to the queue with the next retry time. */
  async markRetry(
    id: string,
    attempts: number,
    nextRetryAt: Date,
    responseCode: number | null,
  ): Promise<void> {
    await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='pending', attempts=$2, next_retry_at=$3,
             response_code=$4, leased_until=null
       where id=$1`,
      [id, attempts, nextRetryAt, responseCode],
    );
  }

  /** Mark a delivery permanently failed (retries exhausted). */
  async markFailed(
    id: string,
    attempts: number,
    responseCode: number | null,
  ): Promise<void> {
    await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='failed', attempts=$2, response_code=$3, leased_until=null
       where id=$1`,
      [id, attempts, responseCode],
    );
  }

  /** Recover rows whose lease expired (crashed/stuck dispatcher) back to pending. */
  async recoverExpiredLeases(): Promise<number> {
    const res = await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='pending', leased_until=null
       where status='delivering' and leased_until < now()`,
    );
    return res.rowCount ?? 0;
  }
}
