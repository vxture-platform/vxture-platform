/**
 * refresh-token.repository.ts — opaque refresh tokens in session.refresh_tokens.
 *
 * docs/design/identity-platform-architecture.md §4: opaque refresh, server-stored, rotation,
 * replay detection. The raw token is never stored — only its SHA-256 hash. A
 * presented token whose status is not 'active' is a reuse/replay → the whole
 * session chain is revoked.
 */
import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { TOKEN_PG_POOL } from "./tokens";

export interface RefreshRecord {
  id: string;
  userId: string;
  sessionId: string;
  clientId: string;
  status: string;
  expiresAt: Date;
}

export interface RefreshInsert {
  /** Subject id (tenant user id, or operator id for the operator store). */
  userId: string;
  sessionId: string;
  clientId: string;
  tokenHash: string;
  ttlSeconds: number;
  rotatedFrom?: string | null;
}

/**
 * Realm-agnostic opaque-refresh store. The tenant realm persists to
 * session.refresh_tokens; the operator realm to admin.operator_refresh_token —
 * hard-isolated, no cross-read (identity-platform-operator.md §1, §6). TokenService
 * routes by realm so operator refresh tokens never land in identity.*.
 */
export interface RefreshStore {
  insert(input: RefreshInsert): Promise<string>;
  findByHash(tokenHash: string): Promise<RefreshRecord | null>;
  markRotated(id: string): Promise<boolean>;
  /**
   * 吊销一条会话上还活着的 refresh 令牌。
   *
   * `clientId` 给了就**只吊这个客户端的那一支**（行业话法：token family）。
   * 不给则整条会话——只有真登出与管理员强制下线该用后者。
   *
   * 2026-09-30 之前这个参数不存在，重放检测一律扫整条会话，
   * 于是一次并发双刷会把同一用户**所有门户、所有标签页**一起踢下线。
   */
  revokeSession(sessionId: string, clientId?: string): Promise<void>;
  /**
   * 轮换链上的直接后继：给一枚已 rotated 的令牌，返回它那枚**仍然 active**
   * 的子令牌的签发时刻（没有就 null）。
   *
   * 它是宽限窗口的判据：子令牌刚生成 ⇒ 这是一次**并发双刷**，不是重放。
   * `rotated_from` 列一直在库里，在此之前**只写从不读**。
   */
  findActiveChildIssuedAt(id: string): Promise<Date | null>;
}

interface RefreshRow {
  id: string;
  user_id: string;
  session_id: string;
  client_id: string;
  status: string;
  expires_at: Date;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

@Injectable()
export class RefreshTokenRepository implements RefreshStore {
  constructor(@Inject(TOKEN_PG_POOL) private readonly pool: Pool) {}

  /** Insert a new active refresh token (hash only); returns the row id. */
  async insert(input: RefreshInsert): Promise<string> {
    const r = await this.pool.query<{ id: string }>(
      `insert into session.refresh_tokens
         (user_id, session_id, client_id, token_hash, rotated_from, status, expires_at, created_at)
       values ($1, $2, $3, $4, $5, 'active', now() + ($6 || ' seconds')::interval, now())
       returning id`,
      [
        input.userId,
        input.sessionId,
        input.clientId,
        input.tokenHash,
        input.rotatedFrom ?? null,
        String(input.ttlSeconds),
      ],
    );
    return r.rows[0]!.id;
  }

  async findByHash(tokenHash: string): Promise<RefreshRecord | null> {
    const r = await this.pool.query<RefreshRow>(
      `select id, user_id, session_id, client_id, status, expires_at
         from session.refresh_tokens where token_hash = $1 limit 1`,
      [tokenHash],
    );
    const row = r.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          sessionId: row.session_id,
          clientId: row.client_id,
          status: row.status,
          expiresAt: row.expires_at,
        }
      : null;
  }

  /** Mark a token rotated; returns true if it was active (false ⇒ concurrent/replay). */
  async markRotated(id: string): Promise<boolean> {
    const r = await this.pool.query(
      `update session.refresh_tokens set status = 'rotated'
        where id = $1 and status = 'active'`,
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Revoke every still-live token for a session, or just one client's family. */
  async revokeSession(sessionId: string, clientId?: string): Promise<void> {
    await this.pool.query(
      `update session.refresh_tokens set status = 'revoked'
        where session_id = $1
          and status in ('active', 'rotated')
          and ($2::text is null or client_id = $2)`,
      [sessionId, clientId ?? null],
    );
  }

  async findActiveChildIssuedAt(id: string): Promise<Date | null> {
    const r = await this.pool.query<{ created_at: Date }>(
      `select created_at from session.refresh_tokens
        where rotated_from = $1 and status = 'active'
        order by created_at desc limit 1`,
      [id],
    );
    return r.rows[0]?.created_at ?? null;
  }

  static newRawToken(): string {
    return randomBytes(32).toString("hex");
  }
}
