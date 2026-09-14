/**
 * operator-sessions.router.ts — 运营账号的登录记录与在线会话（只读）。
 * @package @vxture/bff-arche
 * @layer Application
 * @category Router
 *
 * 数据源是登录服务（auth-bff）写下的两张表，此前治理面一眼都看不到：
 *
 *   admin.operator_login_attempt   每一次登录尝试（成功、密码错、被锁…），开放集
 *   admin.operator_refresh_token   刷新令牌的轮换链；同一 session_id 的行是一次会话
 *
 * 「平台用户」页能对单个人强制下线、重置 MFA，但回答不了「现在谁在线」「昨晚有没有
 * 人在撞密码」——这两个问题正是本页的全部职责。强制下线仍走平台用户的写口
 * （`/api/platform-admins/:id/force-logout`，要 `operator:account.manage` 与 step-up），
 * 本 router 不开第二条写路径。
 *
 * 能力码 `operator:session.read`。排序参与取数（`listOrderBy`），两张表都截在
 * `LIST_LIMIT` 条。
 */
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ARCHE_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { LIST_LIMIT, listOrderBy, parseIso, toIso } from "./router.shared";

export const SESSION_READ = "operator:session.read";

export interface OperatorSignInRecord {
  id: string;
  operatorId: string | null;
  /** 找不到账号（标识打错、账号已删）时为 null，界面显示登录时用的标识。 */
  operatorName: string | null;
  identifier: string;
  authMethod: string;
  /** success / bad_credentials / locked …（开放集，登录服务决定）。 */
  result: string;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
}

export interface OperatorSessionRecord {
  sessionId: string;
  operatorId: string;
  operatorName: string;
  username: string;
  roleName: string | null;
  clientId: string;
  startedAt: string;
  lastRefreshedAt: string;
  expiresAt: string;
}

export interface OperatorSessionSummary {
  activeSessions: number;
  onlineOperators: number;
  failedSignIns24h: number;
  lockedSignIns24h: number;
}

const SIGN_IN_SORT: Readonly<Record<string, string>> = {
  operator: "coalesce(nullif(o.display_name, ''), o.username, la.identifier)",
  method: "la.auth_method",
  result: "la.result",
  ip: "la.ip_address",
  time: "la.created_at",
};

const SESSION_SORT: Readonly<Record<string, string>> = {
  operator: "coalesce(nullif(o.display_name, ''), o.username)",
  client: "max(t.client_id)",
  startedAt: "min(t.created_at)",
  lastRefreshedAt: "max(t.created_at)",
  expiresAt: "max(t.expires_at)",
};

@Controller("api/operator-sessions")
export class OperatorSessionsRouter {
  constructor(@Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool) {}

  // GET /api/operator-sessions/summary
  @Get("summary")
  async summary(
    @Req() req: Request & RequestContext,
  ): Promise<OperatorSessionSummary> {
    assertCanReadSessions(req);
    const [sessions, attempts] = await Promise.all([
      this.pool.query<{ active_sessions: number; online_operators: number }>(
        `select count(distinct t.session_id)::int as active_sessions,
                count(distinct t.operator_id)::int as online_operators
           from admin.operator_refresh_token t
          where t.status = 'active' and t.expires_at > now()`,
      ),
      this.pool.query<{ failed: number; locked: number }>(
        `select count(*) filter (where la.result <> 'success')::int as failed,
                count(*) filter (where la.result = 'locked')::int as locked
           from admin.operator_login_attempt la
          where la.created_at > now() - interval '24 hours'`,
      ),
    ]);
    return {
      activeSessions: sessions.rows[0]?.active_sessions ?? 0,
      onlineOperators: sessions.rows[0]?.online_operators ?? 0,
      failedSignIns24h: attempts.rows[0]?.failed ?? 0,
      lockedSignIns24h: attempts.rows[0]?.locked ?? 0,
    };
  }

  // GET /api/operator-sessions/sign-ins?result=success|failure&from=ISO&to=ISO&sort=&order=
  //   result=failure 覆盖一切非 success（密码错、被锁、MFA 失败…）。
  @Get("sign-ins")
  async signIns(
    @Req() req: Request & RequestContext,
    @Query("result") result?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sort") sort?: string,
    @Query("order") order?: string,
  ): Promise<OperatorSignInRecord[]> {
    assertCanReadSessions(req);
    const orderBy = listOrderBy(
      sort,
      order,
      SIGN_IN_SORT,
      "la.created_at desc, la.id",
    );
    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (result === "success") where.push("la.result = 'success'");
    else if (result === "failure") where.push("la.result <> 'success'");
    if (from) {
      params.push(parseIso(from, "from"));
      where.push(`la.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(parseIso(to, "to"));
      where.push(`la.created_at <= $${params.length}`);
    }
    params.push(LIST_LIMIT);

    const { rows } = await this.pool.query<SignInRow>(
      `select la.id, la.operator_id, la.identifier, la.auth_method, la.result,
              la.ip_address, la.user_agent, la.created_at,
              coalesce(nullif(o.display_name, ''), o.username) as operator_name
         from admin.operator_login_attempt la
         left join admin.operator_account o on o.id = la.operator_id
        where ${where.join(" and ")}
        ${orderBy} limit $${params.length}`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      identifier: row.identifier,
      authMethod: row.auth_method,
      result: row.result,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: toIso(row.created_at),
    }));
  }

  // GET /api/operator-sessions/active?sort=&order=
  //   一个 session_id 是一次会话：开始 = 链上最早一行，最近续期 = 最晚一行，
  //   还有一行 active 且未过期才算在线。
  @Get("active")
  async active(
    @Req() req: Request & RequestContext,
    @Query("sort") sort?: string,
    @Query("order") order?: string,
  ): Promise<OperatorSessionRecord[]> {
    assertCanReadSessions(req);
    const orderBy = listOrderBy(
      sort,
      order,
      SESSION_SORT,
      "max(t.created_at) desc, t.session_id",
    );
    const { rows } = await this.pool.query<SessionRow>(
      `select t.session_id, t.operator_id,
              max(t.client_id) as client_id,
              min(t.created_at) as started_at,
              max(t.created_at) as last_refreshed_at,
              max(t.expires_at) filter (where t.status = 'active') as expires_at,
              coalesce(nullif(o.display_name, ''), o.username) as operator_name,
              o.username,
              r.role_name
         from admin.operator_refresh_token t
         join admin.operator_account o on o.id = t.operator_id
         left join admin.operator_role r on r.id = o.role_id
        group by t.session_id, t.operator_id, o.display_name, o.username, r.role_name
       having bool_or(t.status = 'active' and t.expires_at > now())
        ${orderBy} limit $1`,
      [LIST_LIMIT],
    );
    return rows.map((row) => ({
      sessionId: row.session_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      username: row.username,
      roleName: row.role_name,
      clientId: row.client_id,
      startedAt: toIso(row.started_at),
      lastRefreshedAt: toIso(row.last_refreshed_at),
      expiresAt: toIso(row.expires_at),
    }));
  }
}

function assertCanReadSessions(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes(SESSION_READ)) {
    throw new ForbiddenException(`Missing ${SESSION_READ} capability`);
  }
}

interface SignInRow {
  id: string;
  operator_id: string | null;
  operator_name: string | null;
  identifier: string;
  auth_method: string;
  result: string;
  ip_address: string;
  user_agent: string | null;
  created_at: Date | string;
}

interface SessionRow {
  session_id: string;
  operator_id: string;
  operator_name: string;
  username: string;
  role_name: string | null;
  client_id: string;
  started_at: Date | string;
  last_refreshed_at: Date | string;
  expires_at: Date | string;
}
