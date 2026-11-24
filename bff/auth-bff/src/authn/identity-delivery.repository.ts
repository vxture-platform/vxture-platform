/**
 * Fenced change-event delivery leases and immutable signed payload material.
 * @package @vxture/bff-auth
 * @layer Application
 * @category repository
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { SESSION_PG_POOL } from "./tokens";
import { IdentityRecoveryRepository } from "./identity-recovery.repository";

export interface ChangeDelivery {
  id: string;
  stream_id: string;
  sequence: string;
  receiver_uri: string;
  client_id: string;
  issuer: string;
  attempts: number;
  lease_id: string;
  retry_until: Date;
  event_payload: Record<string, unknown> | null;
}

// ============================================================================
// Work is created in the fact transaction, never from the notification payload.
// ============================================================================
@Injectable()
export class IdentityDeliveryRepository {
  /** @returns Number of durable deadlines emitted in this bounded pass. */
  async emitDue(): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      "select session.emit_due_identity_boundaries() as count",
    );
    return result.rows[0]!.count;
  }
  constructor(
    @Inject(SESSION_PG_POOL) private readonly pool: Pool,
    @Inject(IdentityRecoveryRepository)
    private readonly recovery: IdentityRecoveryRepository,
  ) {}
  /** @returns Dedicated LISTEN connection. */
  listen(): Promise<PoolClient> {
    return this.pool.connect();
  }
  /** @returns Bounded recoverable leases; disabled receivers do not send. */
  async claim(): Promise<ChangeDelivery[]> {
    const result = await this.pool.query<ChangeDelivery>(
      `with batch as (
      select d.id from session.identity_change_deliveries d
      join session.identity_change_receivers r on r.stream_id=d.stream_id and r.enabled
      join session.identity_recovery_streams scope on scope.stream_id=d.stream_id
      where (scope.realm='customer' or $2::boolean) and d.status='pending' and d.available_at<=now() and (d.lease_until is null or d.lease_until<=now())
      order by d.available_at,d.id for update of d skip locked limit 10
    ), claimed as (
      update session.identity_change_deliveries d set lease_id=$1,lease_until=now()+interval '60 seconds',attempts=attempts+1
      from batch where d.id=batch.id returning d.*
    ) select d.*,s.client_id,s.issuer from claimed d join session.identity_recovery_streams s on s.stream_id=d.stream_id`,
      [randomUUID(), process.env.WORKFORCE_IDENTITY_SYNC_ENABLED === "true"],
    );
    return result.rows;
  }
  /** @param job Leased immutable recipient. @returns Whether current registration still matches. */
  async registered(job: ChangeDelivery): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from session.identity_change_receivers r
      join session.identity_change_streams changes on changes.stream_id=r.stream_id and changes.enabled
      join session.identity_recovery_streams s on s.stream_id=r.stream_id and s.enabled
      join appoidc.oidc_clients c on c.client_id=s.client_id
      where r.stream_id=$1 and r.receiver_uri=$2 and r.enabled and c.realm=s.realm and s.realm IN ('customer','workforce')
        and (s.realm='customer' or $3::boolean) and c.client_kind='platform' and c.status='active' and c.token_endpoint_auth_method='client_secret_basic'
        and c.slo_participation='back_channel' and c.release_channel=s.release_channel and c.back_channel_logout_uri=s.logout_uri`,
      [
        job.stream_id,
        job.receiver_uri,
        process.env.WORKFORCE_IDENTITY_SYNC_ENABLED === "true",
      ],
    );
    return Boolean(result.rowCount);
  }
  /** @param job Claimed delivery. @returns Stable event including its first delivery cursor. @throws Error On lost lease or recovery failure. */
  async payload(job: ChangeDelivery): Promise<Record<string, unknown>> {
    if (job.event_payload) return job.event_payload;
    const event = await this.recovery.deliveryEvent(
      job.client_id,
      job.issuer,
      job.sequence,
    );
    const result = await this.pool.query<{
      event_payload: Record<string, unknown>;
    }>(
      `update session.identity_change_deliveries
      set event_payload=coalesce(event_payload,$3::jsonb) where id=$1 and lease_id=$2 and lease_until>now() and status='pending' returning event_payload`,
      [job.id, job.lease_id, JSON.stringify(event)],
    );
    if (!result.rows[0]) throw new Error("Change delivery lease lost");
    return result.rows[0].event_payload;
  }
  /** @returns Whether the completion still owns an unexpired lease. */
  async finish(
    job: ChangeDelivery,
    status: "pending" | "delivered" | "quarantined",
    error: string | null,
    delaySeconds = 0,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update session.identity_change_deliveries set status=$3::varchar,last_error=$4,
      available_at=now()+($5::double precision*interval '1 second'),
      delivered_at=case when $3::varchar='delivered' then now() else null end,lease_id=null,lease_until=null
      where id=$1 and lease_id=$2 and lease_until>now() and status='pending'`,
      [job.id, job.lease_id, status, error, delaySeconds],
    );
    return result.rowCount === 1;
  }

  /** @param job Failed immutable recipient. @returns Completion of receiver suspension after an authentication rejection. */
  async suspend(job: ChangeDelivery): Promise<void> {
    await this.pool.query(
      `update session.identity_change_receivers set enabled=false
      where stream_id=$1 and receiver_uri=$2`,
      [job.stream_id, job.receiver_uri],
    );
  }
}
