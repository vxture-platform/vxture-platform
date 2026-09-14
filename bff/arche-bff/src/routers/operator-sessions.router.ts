/**
 * operator-sessions.router.ts — 在线会话：现在谁登录着（只读，现状）。
 * @package @vxture/bff-arche
 * @layer Application
 * @category Router
 *
 * **在线 = IdP 中央会话仍在**（auth-bff `GET /internal/operator/sessions`）。此前按
 * `admin.operator_refresh_token` 里还有 active 行判在线，结果登录着的人（包括看这一页的
 * 本人）不在列表里：刷新令牌链会被并发刷新的重放判定整条吊销，中央会话却仍在、静默 SSO
 * 照样放行。能回答「谁在线」的只有中央会话。
 *
 * 历史（登录记录、失败、锁定、异常告警）归「安全审计 / 登录记录」，见 sign-in-logs.router。
 * 强制下线走平台用户的写口（`operator:account.manage` + step-up），本 router 不开写路径。
 *
 * 能力码 `operator:session.read`。会话在 Redis，不在库里：排序在内存里做，列表截在 `LIST_LIMIT`。
 */
import { createHash } from "node:crypto";
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
import {
  OperatorAdminService,
  type IdpOperatorSession,
} from "../auth/operator-admin.service";
import { invalidRequest } from "../errors/api-error";
import { ARCHE_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { LIST_LIMIT } from "./router.shared";

export const SESSION_READ = "operator:session.read";

export interface OperatorSessionRecord {
  /** sha256(sid) 前 32 位。sid 本身是会话 cookie 的值，不下发。 */
  sessionRef: string;
  operatorId: string;
  /** 账号已被删除时为 null。 */
  operatorName: string | null;
  username: string | null;
  roleName: string | null;
  /** 这个会话登录过的平台（client_id）。 */
  clients: string[];
  authMethod: string;
  startedAt: string;
  expiresAt: string;
  /** 就是发起本次请求的这个会话。 */
  isCurrent: boolean;
  /** 会话属于本人（强制下线不对本人开放）。 */
  isSelf: boolean;
}

export interface OperatorSessionSummary {
  activeSessions: number;
  onlineOperators: number;
}

/** 与 auth-bff operator-sessions-internal.router 的同名函数同一算法（各写一份，不共享代码）。 */
export function sessionRefOf(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 32);
}

type SortValue = string | number | null;

const SESSION_SORT: Readonly<
  Record<string, (row: OperatorSessionRecord) => SortValue>
> = {
  operator: (row) => row.operatorName ?? row.username,
  role: (row) => row.roleName,
  clients: (row) => row.clients.join(","),
  authMethod: (row) => row.authMethod,
  startedAt: (row) => row.startedAt,
  expiresAt: (row) => row.expiresAt,
};

/** 在线会话的汇总：会话数与在线账号数。概览与本页共用这一处口径。 */
export function summarizeSessions(
  sessions: readonly IdpOperatorSession[],
): OperatorSessionSummary {
  return {
    activeSessions: sessions.length,
    onlineOperators: new Set(sessions.map((s) => s.operatorId)).size,
  };
}

@Controller("api/operator-sessions")
export class OperatorSessionsRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OperatorAdminService) private readonly idp: OperatorAdminService,
  ) {}

  // GET /api/operator-sessions/summary
  @Get("summary")
  async summary(
    @Req() req: Request & RequestContext,
  ): Promise<OperatorSessionSummary> {
    assertCanReadSessions(req);
    return summarizeSessions(await this.idp.listOperatorSessions());
  }

  // GET /api/operator-sessions/active?sort=&order=
  @Get("active")
  async active(
    @Req() req: Request & RequestContext,
    @Query("sort") sort?: string,
    @Query("order") order?: string,
  ): Promise<OperatorSessionRecord[]> {
    const operator = assertCanReadSessions(req);
    const compare = sessionComparator(sort, order);
    const sessions = await this.idp.listOperatorSessions();
    const names = await this.operatorNames(sessions);
    const currentRef = req.sessionId ? sessionRefOf(req.sessionId) : null;

    return sessions
      .map((session): OperatorSessionRecord => {
        const account = names.get(session.operatorId);
        return {
          sessionRef: session.sessionRef,
          operatorId: session.operatorId,
          operatorName: account?.operator_name ?? null,
          username: account?.username ?? null,
          roleName: account?.role_name ?? null,
          clients: session.clients,
          authMethod: session.authMethod,
          startedAt: session.createdAt,
          expiresAt: session.expiresAt,
          isCurrent: session.sessionRef === currentRef,
          isSelf: session.operatorId === operator.id,
        };
      })
      .sort(compare)
      .slice(0, LIST_LIMIT);
  }

  private async operatorNames(
    sessions: readonly IdpOperatorSession[],
  ): Promise<Map<string, AccountRow>> {
    const ids = [...new Set(sessions.map((s) => s.operatorId))];
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<AccountRow>(
      `select o.id::text as id,
              coalesce(nullif(o.display_name, ''), o.username) as operator_name,
              o.username,
              r.role_name
         from admin.operator_account o
         left join admin.operator_role r on r.id = o.role_id
        where o.id::text = any($1::text[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }
}

/** 排序白名单与方向校验同 `listOrderBy`；默认登录时间倒序。 */
function sessionComparator(
  sort: string | undefined,
  order: string | undefined,
): (a: OperatorSessionRecord, b: OperatorSessionRecord) => number {
  const byStartedDesc = (a: OperatorSessionRecord, b: OperatorSessionRecord) =>
    b.startedAt.localeCompare(a.startedAt);
  if (sort === undefined || sort === "") return byStartedDesc;
  const accessor = SESSION_SORT[sort];
  if (!accessor) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `sort must be one of ${Object.keys(SESSION_SORT).join(" / ")}`,
      "sort",
    );
  }
  if (
    order !== undefined &&
    order !== "" &&
    order !== "asc" &&
    order !== "desc"
  ) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "order must be asc or desc",
      "order",
    );
  }
  const direction = order === "asc" ? 1 : -1;
  return (a, b) => {
    const left = accessor(a);
    const right = accessor(b);
    /* 空值恒在最后，与 SQL 侧的 nulls last 一致。 */
    if (left === null && right === null) return byStartedDesc(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    const diff =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "zh-Hans-CN");
    return diff === 0 ? byStartedDesc(a, b) : diff * direction;
  };
}

function assertCanReadSessions(
  req: Request & RequestContext,
): NonNullable<RequestContext["operator"]> {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes(SESSION_READ)) {
    throw new ForbiddenException(`Missing ${SESSION_READ} capability`);
  }
  return req.operator;
}

interface AccountRow {
  id: string;
  operator_name: string;
  username: string;
  role_name: string | null;
}
