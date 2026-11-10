/**
 * password-reset.repository.ts — one-time password-reset tokens in
 * session.password_reset_tokens.
 *
 * Email-link reset (D-BE=A): the raw token travels only in the emailed link;
 * the DB stores only its SHA-256 hash. A token is single-use (used_at) and
 * short-lived (expires_at, 15 min). Consume is a single atomic UPDATE so a
 * token cannot be replayed or raced.
 * @package @vxture/bff-auth
 * @layer Application
 * @category repository
 * @author AI-Generated
 * @date 2026-11-10
 */
import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { SESSION_PG_POOL } from "./tokens";

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

@Injectable()
export class PasswordResetRepository {
  constructor(@Inject(SESSION_PG_POOL) private readonly pool: Pool) {}

  /** Issue a one-time reset token (stores only its SHA-256 hash); returns the raw token. */
  async issue(
    userId: string,
    ttlSeconds: number,
    email: string,
  ): Promise<string | null> {
    const raw = randomBytes(32).toString("hex");
    const result = await this.pool.query(
      `insert into session.password_reset_tokens
         (user_id, token_hash, expires_at, created_at)
       select u.id, $2, now() + ($3 || ' seconds')::interval, now()
         from account.users u
        where u.id = $1 and lower(trim(u.email)) = $4
          and u.email_verified_at is not null
          and u.email_verified_at <= now()
          and u.status in ('active', 'deleting') and u.deleted_at is null
       returning user_id`,
      [userId, hashResetToken(raw), String(ttlSeconds), email],
    );
    return result.rowCount === 1 ? raw : null;
  }

  /**
   * Atomically consume a token: stamps used_at and returns the user_id only if the
   * token exists, is unused and unexpired, and still predates no security change.
   * Consumption is one-shot; the subsequent domain password write is separate.
   */
  async consume(rawToken: string): Promise<string | null> {
    const r = await this.pool.query<{ user_id: string }>(
      `update session.password_reset_tokens t set used_at = now()
        where t.token_hash = $1 and t.used_at is null and t.expires_at > now()
          and exists (
            select 1 from account.users u
              left join credential.user_credentials c on c.user_id = u.id
             where u.id = t.user_id and u.deleted_at is null
               and u.status in ('active', 'deleting')
               and u.email is not null and u.email_verified_at is not null
               and u.email_verified_at <= t.created_at
               and (c.password_changed_at is null or c.password_changed_at <= t.created_at)
          )
        returning t.user_id`,
      [hashResetToken(rawToken)],
    );
    return r.rows[0]?.user_id ?? null;
  }
}
