/**
 * customer-mfa.repository.ts - separate customer factor persistence with atomic replay guards.
 * @package @vxture/service-account
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-08
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ACCOUNT_PG_POOL } from "../tokens";

export interface CustomerFactor {
  secret: string;
  version: string;
}

// ============================================================================
// Customer-only factors
// ============================================================================
@Injectable()
export class CustomerMfaRepository {
  constructor(@Inject(ACCOUNT_PG_POOL) private readonly pool: Pool) {}

  /** Encrypted factor material is never included in account projections. */
  async read(userId: string): Promise<CustomerFactor | null> {
    const result = await this.pool.query<CustomerFactor>(
      "select totp_secret as secret, version::text as version from credential.user_mfas where user_id=$1 and totp_enabled=true",
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /** Initial activation must not replace an existing factor. */
  async activate(
    userId: string,
    secret: string,
    hashes: string[],
    counter: number,
    sid: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select id from account.users where id=$1 for update",
        [userId],
      );
      const result = await client.query(
        `insert into credential.user_mfas(user_id, totp_secret, totp_enabled, policy, last_counter)
         select id, $2, true, 'required', $3 from account.users where id=$1 and status='active' and deleted_at is null
           and exists(select 1 from session.auth_sessions where sid=$4 and user_id=$1 and realm='customer' and status='active' and expires_at>now())
         on conflict(user_id) do update set totp_secret=$2,totp_enabled=true,policy='required',last_counter=$3,
           version=gen_random_uuid(),updated_at=now() where credential.user_mfas.totp_enabled=false returning user_id`,
        [userId, secret, counter, sid],
      );
      if (result.rows.length !== 1) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        "delete from credential.user_recovery_codes where user_id=$1",
        [userId],
      );
      await client.query(
        "insert into credential.user_recovery_codes(user_id,code_hash) select $1, unnest($2::text[])",
        [userId, hashes],
      );
      // Activation invalidates every existing single-factor session atomically.
      await client.query(
        "update session.auth_sessions set status='revoked',revoked_at=now() where user_id=$1 and realm='customer' and status='active'",
        [userId],
      );
      await client.query(
        "update session.refresh_tokens set status='revoked' where user_id=$1 and status='active'",
        [userId],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Consume a time step exactly once, including concurrent requests. */
  async consumeCounter(
    userId: string,
    version: string,
    counter: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "update credential.user_mfas set last_counter=$3,updated_at=now() where user_id=$1 and version=$2::uuid and totp_enabled=true and last_counter<$3 returning user_id",
      [userId, version, counter],
    );
    return result.rows.length === 1;
  }

  /** Recovery hashes are removed atomically; plaintext codes are never stored. */
  async consumeRecovery(
    userId: string,
    version: string,
    hash: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "update credential.user_recovery_codes r set used_at=now() where r.user_id=$1 and r.code_hash=$3 and r.used_at is null and exists(select 1 from credential.user_mfas m where m.user_id=r.user_id and m.version=$2::uuid and m.totp_enabled=true) returning r.user_id",
      [userId, version, hash],
    );
    return result.rows.length === 1;
  }

  /** Removal requires proof of the exact factor version verified by the caller. */
  async remove(userId: string, version: string): Promise<boolean> {
    const result = await this.pool.query(
      "update credential.user_mfas set totp_enabled=false,totp_secret=null,version=gen_random_uuid(),updated_at=now() where user_id=$1 and version=$2::uuid returning user_id",
      [userId, version],
    );
    return result.rows.length === 1;
  }
}
