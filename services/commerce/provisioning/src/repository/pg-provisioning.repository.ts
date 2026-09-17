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
  ProvisioningAckInput,
  ProvisioningAckResult,
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

  /**
   * Mark a delivery delivered (2xx).
   *
   * `delivered_at` 与 `updated_at` 都要手写（2026-09-17）：provisioning 域两表**没有
   * 任何触发器**（`95_triggers.sql` 的 provisioning 段明写「无」），而表上那个
   * `NOT NULL DEFAULT now()` 只在 INSERT 时生效。不写的后果都不报错：
   *   · `delivered_at` 永远为 NULL——建了一列却没人写，拿它当判据的检查永远不满足；
   *   · `updated_at` 停在创建时间——一行重试好几次、最后投成，运维查「它最后一次
   *     动是什么时候」会得到错答案。
   */
  async markDelivered(id: string, responseCode: number | null): Promise<void> {
    await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='delivered', response_code=$2, leased_until=null,
             delivered_at=now(), updated_at=now()
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
             response_code=$4, leased_until=null, updated_at=now()
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
         set status='failed', attempts=$2, response_code=$3, leased_until=null,
             updated_at=now()
       where id=$1`,
      [id, attempts, responseCode],
    );
  }

  /** Recover rows whose lease expired (crashed/stuck dispatcher) back to pending. */
  async recoverExpiredLeases(): Promise<number> {
    const res = await this.pool.query(
      `update provisioning.webhook_deliveries
         set status='pending', leased_until=null, updated_at=now()
       where status='delivering' and leased_until < now()`,
    );
    return res.rowCount ?? 0;
  }
  /**
   * 记下产品侧的开通回执——「这个工作区的空间，我建好了」。
   *
   * ── 为什么它只写 metadata，不碰状态机 ──
   * `provisionings.status` 的实际含义是**平台已下令**，不是产品已就绪:`enqueue` 的
   * upsert 当场就写 `provisioned`，DDL 上那个 `pending` 默认值在代码里从来不经过。
   * 本期不改这件事——一旦把 `provisioned` 的写入时机推迟到回执，所有还没实现回执的
   * 产品会全部卡在 `pending`，而 opera 的开通信号读的正是 `status='provisioned'`，
   * 等于用一次平台升级把在产的产品全判成没开通过。回执先只记事实，等产品侧铺开再切。
   *
   * 落点是 `metadata` 的 `ack` 子对象——`54_provisioning.sql` 给这一列写的注释
   * （「开通上下文（区域/初始化参数/产品侧 space_id 回执）」）预留的就是它，而在此之前
   * **全仓没有任何一处读写过这一列**。它已在 `98_column_locks.sql` 的 GRANT 白名单里，
   * 所以这条写入不需要迁移，也不会撞列级锁。
   *
   * 幂等取投递 id。同一条投递重复回执不覆盖首次时间，返回 `replayed`——与 C3 consume
   * 同义。投递 id 为空时不做幂等:那是产品按通则做定期对账补发的回执，每次记最新的。
   *
   * 锚点列（`id` / `created_at`）一个都不碰;`status` / `version` / `provisioned_at`
   * 同样不碰——`version` 是投递的排序键（产品那边的 `seq`），动它会让对方的乱序丢弃判错。
   *
   * @returns 没有这个 (workspace, product) 的开通行时回 null（平台从没对它下过令）。
   */
  async recordAck(
    input: ProvisioningAckInput,
  ): Promise<ProvisioningAckResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      /* `for update` 锁住这一行:读出「上一次回执」与随后的写必须是同一个决定，
         否则两条并发回执会各自读到「没记过」然后互相覆盖。 */
      const found = await client.query<{
        id: string;
        prev_at: string | null;
        prev_delivery: string | null;
      }>(
        `select id,
                metadata->'ack'->>'at'         as prev_at,
                metadata->'ack'->>'deliveryId' as prev_delivery
           from provisioning.provisionings
          where workspace_id = $1 and product_id = $2
          for update`,
        [input.workspaceId, input.applicationId],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      const deliveryId = input.deliveryId ?? null;
      if (deliveryId !== null && row.prev_delivery === deliveryId) {
        if (row.prev_at === null) {
          /* 同一条投递记过、却没有时间戳:这一列只有本方法写，形状对不上说明它被
             外部改过。抛出来，不要兜一个「现在」冒充首次回执时间。 */
          throw new Error(
            `provisionings.metadata.ack malformed (id=${row.id}): deliveryId present, at missing`,
          );
        }
        await client.query("rollback");
        return { ackedAt: row.prev_at, replayed: true };
      }
      const ackedAt = new Date().toISOString();
      const ack = {
        at: ackedAt,
        status: input.status,
        deliveryId,
        ...(input.detail ? { detail: input.detail } : {}),
      };
      await client.query(
        `update provisioning.provisionings
            set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb),
                                     '{ack}', $2::jsonb, true),
                updated_at = now()
          where id = $1`,
        [row.id, JSON.stringify(ack)],
      );
      await client.query("commit");
      return { ackedAt, replayed: false };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
}
