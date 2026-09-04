/**
 * session.service.ts — central session (durable mirror in session.auth_sessions).
 *
 * docs/design/platform-data-architecture-schema.md §4 identity (auth_session §4.9, central session)
 * (auth_session = central session mirror; Redis is the primary cache, fronted by
 * the existing redis.service and wired in Task 4.4). This service owns the durable
 * record + the `sid` that the vx_sid cookie carries.
 */
import { Inject, Injectable } from "@nestjs/common";
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
  /**
   * 用调用方给定的 sid 落镜像行(OIDC 中央会话的 sid 由 Redis 侧先生成,镜像行必须
   * 同号,console「活跃会话」按它列设备、按它下线)。不给则本件自取。
   */
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
       values ($1, $2, $3, $4, $5, $6, 'active', now(), now() + ($7 || ' seconds')::interval, now())
       returning expires_at`,
      [
        sid,
        input.userId,
        input.realm,
        input.authMethod,
        input.ip ?? null,
        input.userAgent ?? null,
        String(ttl),
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
  async revoke(sid: string): Promise<void> {
    await this.pool.query(
      `update session.auth_sessions set status = 'revoked', revoked_at = now() where sid = $1`,
      [sid],
    );
  }

  /**
   * 镜像行**存在且**已不是 active(console「下线此设备」只翻镜像行,Redis 不知情)。
   * 没有镜像行的老会话(本改动之前登录的)一律视为未吊销——这是「有行才判」,
   * 不是「无行即拒」,否则上线一刻全站被踢。
   */
  async isRevoked(sid: string): Promise<boolean> {
    const r = await this.pool.query<{ status: string }>(
      `select status from session.auth_sessions where sid = $1 limit 1`,
      [sid],
    );
    const row = r.rows[0];
    return Boolean(row && row.status !== "active");
  }

  /** Keep the durable mirror's last_active_at roughly current (best-effort). */
  async touch(sid: string): Promise<void> {
    await this.pool.query(
      `update session.auth_sessions set last_active_at = now()
        where sid = $1 and status = 'active'`,
      [sid],
    );
  }
}
