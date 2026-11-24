/**
 * session.service.ts — durable realm-isolated central-session authority.
 *
 * Redis carries the interactive session, while session.auth_sessions controls
 * durable validity and revocation. A missing durable row cannot authorize SSO.
 * Workforce use requires an explicit rollout; all mutations bind their realm.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-24
 */
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import type { Pool } from "pg";
import { SESSION_PG_POOL } from "./tokens";

export interface CreateSessionInput {
  userId: string;
  realm: "customer" | "workforce";
  authMethod: string;
  ip?: string | null;
  userAgent?: string | null;
  absTtlSeconds?: number;
  expiresAt?: Date;
  /** Share the caller's central sid across durable and interactive stores. */
  sid?: string;
}

export interface SessionRecord {
  sid: string;
  userId: string;
  realm: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_PG_POOL) private readonly pool: Pool,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Create an active central session; returns the sid (for the vx_sid cookie). */
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const sid = input.sid ?? randomUUID();
    const ttl = input.absTtlSeconds ?? this.config.auth.OIDC_SESSION_ABS_TTL;
    const r = await this.pool.query<{ expires_at: Date }>(
      `insert into session.auth_sessions
         (sid, user_id, realm, auth_method, ip_address, user_agent, status, last_active_at, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, 'active', now(), coalesce($8::timestamptz, now() + ($7 || ' seconds')::interval), now())
       returning expires_at`,
      [
        sid,
        input.userId,
        input.realm,
        input.authMethod,
        input.ip ?? null,
        input.userAgent ?? null,
        String(ttl),
        input.expiresAt ?? null,
      ],
    );
    return {
      sid,
      userId: input.userId,
      realm: input.realm,
      expiresAt: r.rows[0]!.expires_at,
    };
  }

  /** Resolve an active, unexpired session by sid. */
  async get(sid: string): Promise<SessionRecord | null> {
    const r = await this.pool.query<{
      sid: string;
      user_id: string;
      realm: string;
      expires_at: Date;
    }>(
      `select sid, user_id, realm, expires_at
         from session.auth_sessions
        where sid = $1 and status = 'active' and expires_at > now()
        limit 1`,
      [sid],
    );
    const row = r.rows[0];
    return row
      ? {
          sid: row.sid,
          userId: row.user_id,
          realm: row.realm,
          expiresAt: row.expires_at,
        }
      : null;
  }

  /** Revoke a session (logout). */
  async revoke(
    sid: string,
    realm: "customer" | "workforce" = "customer",
  ): Promise<void> {
    await this.pool.query(
      `update session.auth_sessions set status = 'revoked', revoked_at = now()
        where sid = $1 and realm=$2 and status='active'`,
      [sid, realm],
    );
  }

  /** Revoke every durable workforce session, including sessions absent from Redis. */
  async revokeOperatorSessions(operatorId: string): Promise<string[]> {
    const result = await this.pool.query<{ sid: string }>(
      `update session.auth_sessions set status='revoked',revoked_at=now()
       where realm='workforce' and user_id=$1 and status='active' returning sid`,
      [operatorId],
    );
    return result.rows.map((row) => row.sid);
  }

  // ========================================================================
  // Durable binding and context: serialize against every revocation writer.
  // ========================================================================

  /**
   * Bind a verified customer session before exposing an authorization code.
   * @param sid Central session identifier.
   * @param userId Customer owner already authenticated by the caller.
   * @param clientId Enabled customer OIDC client from trusted registration.
   * @returns Resolves after the binding commits.
   * @throws BadRequestException If either the session or client is no longer valid.
   */
  async bindClient(
    sid: string,
    userId: string,
    clientId: string,
    realm: "customer" | "workforce" = "customer",
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query(
        `select sid from session.auth_sessions
          where sid=$1 and user_id=$2 and realm=$3
            and status='active' and expires_at>now() for update`,
        [sid, userId, realm],
      );
      if (!session.rowCount) throw new BadRequestException("invalid_grant");
      const bound = await client.query(
        `insert into session.oidc_session_clients(sid,client_id,release_channel,logout_uri)
         select $1,client_id,release_channel,
                case when slo_participation='back_channel' then back_channel_logout_uri end
           from appoidc.oidc_clients
          where client_id=$2 and realm=$3 and status='active'
         on conflict(sid,client_id) do update
           set release_channel=excluded.release_channel,logout_uri=excluded.logout_uri`,
        [sid, clientId, realm],
      );
      if (!bound.rowCount) throw new BadRequestException("invalid_grant");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Read retained customer bindings even after the session or Redis expires.
   * @param sid Central session identifier.
   * @returns Recipient client identifiers, without credentials or endpoints.
   */
  async getClients(
    sid: string,
    realm: "customer" | "workforce" = "customer",
  ): Promise<string[]> {
    const result = await this.pool.query<{ client_id: string }>(
      `select b.client_id from session.oidc_session_clients b
        join session.auth_sessions s on s.sid=b.sid
        where b.sid=$1 and s.realm=$2`,
      [sid, realm],
    );
    return result.rows.map((row) => row.client_id);
  }

  /**
   * Read a customer record for logout, including already ended sessions.
   * @param sid Central session identifier.
   * @returns Customer owner or null; never reads workforce authority.
   */
  async customerOwner(sid: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      "select user_id from session.auth_sessions where sid=$1 and realm='customer'",
      [sid],
    );
    return result.rows[0]?.user_id ?? null;
  }

  /** Retain the workforce owner for idempotent logout after revocation or expiry. */
  async workforceOwner(sid: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      "select user_id from session.auth_sessions where sid=$1 and realm='workforce'",
      [sid],
    );
    return result.rows[0]?.user_id ?? null;
  }

  /** Filter cache candidates against durable workforce authority in one read. */
  async activeWorkforceOwners(
    sids: readonly string[],
  ): Promise<Map<string, string>> {
    if (!sids.length) return new Map();
    const result = await this.pool.query<{ sid: string; user_id: string }>(
      `select sid,user_id from session.auth_sessions where sid=any($1::text[])
       and realm='workforce' and status='active' and expires_at>now()`,
      [sids],
    );
    return new Map(result.rows.map((row) => [row.sid, row.user_id]));
  }

  /**
   * Persist a revalidated current context without extending session lifetime.
   * @param sid Customer session identifier.
   * @param context Tenant/workspace selected by the membership authority.
   * @returns Nothing; an unchanged selection does not advance the version.
   * @throws BadRequestException If the session has ended.
   */
  async setContext(
    sid: string,
    context: { orgId: string; workspaceId: string | null },
  ): Promise<void> {
    const result = await this.pool.query(
      `update session.auth_sessions set active_org_id=$2,active_workspace_id=$3,
         context_version=context_version + case when
           active_org_id is distinct from $2::uuid or active_workspace_id is distinct from $3::uuid
           then 1 else 0 end
       where sid=$1 and realm='customer' and status='active' and expires_at>now()`,
      [sid, context.orgId, context.workspaceId],
    );
    if (!result.rowCount) throw new BadRequestException("invalid_grant");
  }

  /**
   * Read the durable current context; null allows legacy context migration.
   * @param sid Central customer session identifier.
   * @returns A coherent tenant/workspace pair or null.
   */
  async getContext(
    sid: string,
  ): Promise<{ orgId: string; workspaceId: string | null } | null> {
    const result = await this.pool.query<{
      active_org_id: string | null;
      active_workspace_id: string | null;
    }>(
      `select active_org_id,active_workspace_id from session.auth_sessions
        where sid=$1 and realm='customer' and status='active' and expires_at>now()`,
      [sid],
    );
    const row = result.rows[0];
    return row?.active_org_id
      ? { orgId: row.active_org_id, workspaceId: row.active_workspace_id }
      : null;
  }

  /**
   * Fail closed for missing, expired or revoked customer session records.
   * This store is customer-only; workforce uses its own central session checks.
   */
  async isRevoked(sid: string): Promise<boolean> {
    const r = await this.pool.query<{
      status: string;
      realm: string;
      unexpired: boolean;
    }>(
      `select status, realm, expires_at > now() as unexpired
         from session.auth_sessions where sid = $1 limit 1`,
      [sid],
    );
    const row = r.rows[0];
    return (
      !row ||
      row.realm !== "customer" ||
      row.status !== "active" ||
      row.unexpired !== true
    );
  }

  /** Keep durable last_active_at roughly current without extending validity. */
  async touch(sid: string): Promise<void> {
    await this.pool.query(
      `update session.auth_sessions set last_active_at = now()
        where sid = $1 and status = 'active'`,
      [sid],
    );
  }
}
