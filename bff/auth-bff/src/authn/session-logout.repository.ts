/**
 * Durable customer logout work with fenced worker leases.
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

export interface LogoutDelivery {
  realm?: "customer" | "workforce";
  id: string;
  event_id: string;
  sid: string;
  user_id: string;
  client_id: string;
  release_channel: string;
  logout_uri: string;
  attempts: number;
  lease_id: string;
  created_at: Date;
  retry_until: Date;
}

// ============================================================================
// The queue survives worker crashes and Redis loss. No token is stored here.
// ============================================================================

@Injectable()
export class SessionLogoutRepository {
  constructor(@Inject(SESSION_PG_POOL) private readonly pool: Pool) {}

  /** @returns A dedicated connection for transactional notification hints. */
  listen(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /** @returns Number of expired customer sessions transitioned in this bounded pass. */
  async expire(): Promise<number> {
    const result = await this.pool.query(
      `with batch as (
         select sid from session.auth_sessions where (realm='customer' or ($1::boolean and realm='workforce'))
           and status='active' and expires_at<=now()
         order by expires_at for update skip locked limit 100
       ) update session.auth_sessions s set status='expired'
         from batch where s.sid=batch.sid`,
      [process.env.WORKFORCE_IDENTITY_SYNC_ENABLED === "true"],
    );
    return result.rowCount ?? 0;
  }

  /** @returns At most ten leased deliveries; abandoned leases can be reclaimed. */
  async claim(): Promise<LogoutDelivery[]> {
    const result = await this.pool.query<LogoutDelivery>(
      `with batch as (
         select id from session.logout_deliveries where status='pending'
           and available_at<=now() and (lease_until is null or lease_until<=now())
         order by available_at,id for update skip locked limit 10
       ) update session.logout_deliveries d
         set lease_id=$1,lease_until=now()+interval '60 seconds',attempts=attempts+1
         from batch where d.id=batch.id returning d.*`,
      [randomUUID()],
    );
    return result.rows;
  }

  /**
   * Recheck endpoint and channel against current registration before delivery.
   * @param delivery Immutable binding captured when the session was authorized.
   * @returns Whether the endpoint is still an enabled customer recipient.
   */
  async registered(delivery: LogoutDelivery): Promise<boolean> {
    const result = await this.pool.query(
      `select client_id from appoidc.oidc_clients where client_id=$1
         and realm=$4 and status='active' and release_channel=$2
         and slo_participation='back_channel' and back_channel_logout_uri=$3`,
      [
        delivery.client_id,
        delivery.release_channel,
        delivery.logout_uri,
        delivery.realm ?? "customer",
      ],
    );
    return Boolean(result.rowCount);
  }

  /**
   * Finish only the attempt that still owns the lease.
   * @param delivery Claimed job.
   * @param status Durable completion state.
   * @param error Safe diagnostic code, never response body or credentials.
   * @param delaySeconds Delay before retry, bounded by the delivery policy.
   * @returns Whether this worker still owned the lease.
   */
  async finish(
    delivery: LogoutDelivery,
    status: "pending" | "delivered" | "quarantined",
    error: string | null,
    delaySeconds = 0,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update session.logout_deliveries set status=$3::varchar,last_error=$4,
         available_at=now()+($5::double precision * interval '1 second'),
         delivered_at=case when $3::varchar='delivered' then now() else null end,
         lease_id=null,lease_until=null
       where id=$1 and lease_id=$2 and lease_until>now() and status='pending'`,
      [delivery.id, delivery.lease_id, status, error, delaySeconds],
    );
    return result.rowCount === 1;
  }
}
