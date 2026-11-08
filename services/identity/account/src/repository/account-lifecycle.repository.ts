/**
 * Durable customer lifecycle work with account-row fencing.
 * @package @vxture/service-account
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-07
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ACCOUNT_PG_POOL } from "../tokens";

// ============================================================================
// Durable work contracts (no cross-domain imports)
// ============================================================================

export interface CustomerLifecyclePayload {
  sessions: { sid: string; clients: string[] | null }[];
}
export interface CustomerLifecycleOperation {
  id: string;
  userId: string;
  status: "pending" | "completed" | "purge_ready" | "cancelled";
  attempts: number;
  payload: CustomerLifecyclePayload;
}
interface OperationRow {
  id: string;
  user_id: string;
  status: CustomerLifecycleOperation["status"];
  attempts: number;
  payload: CustomerLifecyclePayload;
}
function map(row: OperationRow): CustomerLifecycleOperation {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
  };
}

// ============================================================================
// Independent checkpoints survive partial external cleanup and process failure
// ============================================================================

@Injectable()
export class AccountLifecycleRepository {
  constructor(@Inject(ACCOUNT_PG_POOL) private readonly pool: Pool) {}

  /**
   * Read the latest request without exposing delivery metadata to the browser.
   * @param userId - Authenticated customer identifier.
   * @returns Latest lifecycle operation or null.
   * @throws {Error} When persistence is unavailable.
   */
  async getForUser(userId: string): Promise<CustomerLifecycleOperation | null> {
    const result = await this.pool.query<OperationRow>(
      `select id,user_id,status,attempts,payload from account.lifecycle_operations
        where user_id=$1 order by created_at desc,id desc limit 1`,
      [userId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  /**
   * List due work; execution performs its own account-state check and lock.
   * @param limit - Bounded batch size.
   * @returns Pending operation identifiers.
   * @throws {Error} When persistence is unavailable.
   */
  async listPending(limit = 20): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `select l.id from account.lifecycle_operations l join account.users u on u.id=l.user_id
        where (l.status='pending' or (l.status='completed' and l.deletion_requested_at + interval '720 hours'<=clock_timestamp()) or (l.status='purge_ready' and l.updated_at<now()-interval '60 seconds')) and l.next_attempt_at<=now()
          and u.status='deleting' and u.deleted_at is null
          and u.deletion_requested_at=l.deletion_requested_at
        order by l.next_attempt_at,l.id limit $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Fence cleanup against recovery, purge and other workers using the account row.
   * Checkpoints commit independently before destructive external effects. A crash
   * therefore keeps logout recipients even after the Redis session was removed.
   * @param id - Server-owned operation identifier.
   * @param work - Idempotent adapters, with a durable checkpoint callback.
   * @returns Whether a pending operation completed.
   * @throws {Error} On adapter or persistence failure; the request remains retryable.
   */
  async run(
    id: string,
    work: (
      operation: CustomerLifecycleOperation,
      save: (payload: CustomerLifecyclePayload) => Promise<void>,
    ) => Promise<void>,
  ): Promise<boolean> {
    // The lock connection must not exhaust the pool needed for durable checkpoints.
    if (this.pool.options?.max === 1)
      throw new Error(
        "Account lifecycle cleanup requires at least two pool connections",
      );
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query("begin");
      const result = await client.query<OperationRow>(
        `select l.id,l.user_id,l.status,l.attempts,l.payload
           from account.users u join account.lifecycle_operations l on l.user_id=u.id
          where l.id=$1 and (l.status='pending' or (l.status='completed' and l.deletion_requested_at + interval '720 hours'<=clock_timestamp()) or (l.status='purge_ready' and l.updated_at<now()-interval '60 seconds')) and u.status='deleting' and u.deleted_at is null
            and l.deletion_requested_at=u.deletion_requested_at
          for no key update of u skip locked`,
        [id],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("rollback");
        return false;
      }
      locked = true;
      await work(map(row), async (payload) => {
        await this.pool.query(
          `update account.lifecycle_operations set payload=$2::jsonb,updated_at=now()
            where id=$1 and status in ('pending','completed','purge_ready')`,
          [id, JSON.stringify(payload)],
        );
      });
      await this.pool.query(
        `update account.lifecycle_operations set status=case when deletion_requested_at + interval '720 hours'<=clock_timestamp() then 'purge_ready' else 'completed' end,last_error=null,updated_at=now()
          where id=$1 and status in ('pending','completed','purge_ready')`,
        [id],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      try {
        if (locked)
          await this.pool.query(
            `update account.lifecycle_operations set status='pending',attempts=attempts+1,last_error='cleanup_failed',
           next_attempt_at=now()+least(3600,30*power(2,least(attempts,7)))*interval '1 second',updated_at=now()
          where id=$1 and status in ('pending','completed','purge_ready')`,
            [id],
          );
      } finally {
        await client.query("rollback");
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
