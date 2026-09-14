/**
 * sign-in-logs.router.ts — 登录记录：运营账号的每一次登录尝试（只读，历史）。
 * @package @vxture/bff-arche
 * @layer Application
 * @category Router
 *
 * 数据源 `admin.operator_login_attempt`（登录服务 auth-bff 写，只追加）。与「在线会话」
 * 分开：那边回答「现在谁登录着」，这边回答「谁在什么时候、从哪儿、登没登成」——
 * 是审计，归「安全审计」。
 *
 * **什么算登录失败**：登录服务写入的结果是 success / bad_credential / mfa_required /
 * mfa_failed / locked。`mfa_required` 是密码通过、等待二次验证的正常中间步骤，
 * 不是失败——算进去会让每一次正常的 MFA 登录都多一次「失败」。
 *
 * **异常告警**：登录服务在异常登录（新地点 / 新设备）与二次验证失败激增时写一条审计事件
 * （`support.audit_logs`，action = AnomalousLogin / LoginFailureSpike）。汇总里给 24 小时
 * 告警数，明细在审计日志（`/audit-logs?result=alert`）。
 *
 * 能力码 `audit:sign_in_log.read`。排序参与取数（`listOrderBy`），列表截在 `LIST_LIMIT`。
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

export const SIGN_IN_LOG_READ = "audit:sign_in_log.read";

/** 失败 = 不是成功、也不是「等二次验证」这一正常中间步骤。 */
export const SIGN_IN_FAILED_SQL =
  "la.result not in ('success', 'mfa_required')";

/** 登录服务写的两类登录告警（support.audit_logs.action）。 */
export const LOGIN_ALERT_ACTIONS = ["AnomalousLogin", "LoginFailureSpike"];
export const LOGIN_ALERT_SQL =
  "a.action in ('AnomalousLogin', 'LoginFailureSpike')";

export interface OperatorSignInRecord {
  id: string;
  operatorId: string | null;
  /** 找不到账号（标识打错、账号已删）时为 null，界面显示登录时用的标识。 */
  operatorName: string | null;
  identifier: string;
  authMethod: string;
  /** success / mfa_required / bad_credential / mfa_failed / locked（开放集，登录服务决定）。 */
  result: string;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
}

export interface SignInLogSummary {
  failed24h: number;
  locked24h: number;
  alerts24h: number;
}

const SIGN_IN_SORT: Readonly<Record<string, string>> = {
  operator: "coalesce(nullif(o.display_name, ''), o.username, la.identifier)",
  method: "la.auth_method",
  result: "la.result",
  ip: "la.ip_address",
  time: "la.created_at",
};

@Controller("api/sign-in-logs")
export class SignInLogsRouter {
  constructor(@Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool) {}

  // GET /api/sign-in-logs/summary
  @Get("summary")
  async summary(
    @Req() req: Request & RequestContext,
  ): Promise<SignInLogSummary> {
    assertCanReadSignInLogs(req);
    const [attempts, alerts] = await Promise.all([
      this.pool.query<{ failed: number; locked: number }>(
        `select count(*) filter (where ${SIGN_IN_FAILED_SQL})::int as failed,
                count(*) filter (where la.result = 'locked')::int as locked
           from admin.operator_login_attempt la
          where la.created_at > now() - interval '24 hours'`,
      ),
      this.pool.query<{ alerts: number }>(
        `select count(*)::int as alerts
           from support.audit_logs a
          where ${LOGIN_ALERT_SQL}
            and a.created_at > now() - interval '24 hours'`,
      ),
    ]);
    return {
      failed24h: attempts.rows[0]?.failed ?? 0,
      locked24h: attempts.rows[0]?.locked ?? 0,
      alerts24h: alerts.rows[0]?.alerts ?? 0,
    };
  }

  // GET /api/sign-in-logs?result=success|failure&from=ISO&to=ISO&sort=&order=
  //   result=failure = 凭证错误、二次验证失败、被锁定（mfa_required 是中间步骤，不算失败）。
  @Get()
  async list(
    @Req() req: Request & RequestContext,
    @Query("result") result?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sort") sort?: string,
    @Query("order") order?: string,
  ): Promise<OperatorSignInRecord[]> {
    assertCanReadSignInLogs(req);
    const orderBy = listOrderBy(
      sort,
      order,
      SIGN_IN_SORT,
      "la.created_at desc, la.id",
    );
    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (result === "success") where.push("la.result = 'success'");
    else if (result === "failure") where.push(SIGN_IN_FAILED_SQL);
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
}

function assertCanReadSignInLogs(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes(SIGN_IN_LOG_READ)) {
    throw new ForbiddenException(`Missing ${SIGN_IN_LOG_READ} capability`);
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
