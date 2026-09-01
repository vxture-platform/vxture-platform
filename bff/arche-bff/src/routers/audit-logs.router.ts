/**
 * audit-logs.router.ts - 审计日志路由(support.audit_logs,只读)
 * @package @vxture/bff-arche
 *
 * Description: 平台操作审计读接口,接 support.audit_logs(中央审计)。actor 为
 *   operator 时 join admin.operator_account 补名/邮箱。服务端筛选/导出契约见下。
 *   能力守卫:audit:read(super_admin/admin/auditor)。纯读,无写路径。
 *   —— 从 admin-bff 平移至治理台 arche-bff(三平面拆分 PR②),SQL 与契约不变;
 *   会话主体改判 req.operator(arche 数据面中间件挂的是 operator,不是 user)。
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
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
import type { AuditLogRecord } from "../types/governance.types";

const AUDIT_LOG_LIMIT = 500;

@Controller("api/audit-logs")
export class AuditLogsRouter {
  constructor(@Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool) {}

  // Contract: GET /api/audit-logs
  //   Default (no query params): most-recent AUDIT_LOG_LIMIT rows.
  //   Optional server-side filters (all AND-combined, all optional):
  //     from     ISO timestamp → created_at >= from
  //     to       ISO timestamp → created_at <= to
  //     actorId  uuid          → actor_id = actorId
  //     action   string        → action prefix match (action LIKE action%)
  //     module   string        → action first-segment = module OR (no dot AND resource_type = module)
  //     result   'success'|'failure'|'denied' → result match ('failure' also matches 'denied')
  //   response: AuditLogRecord[].
  @Get()
  async listAuditLogs(
    @Req() req: Request & RequestContext,
    @Query() query: AuditLogQuery,
  ): Promise<AuditLogRecord[]> {
    assertCanReadAuditLogs(req);

    const filters = normalizeAuditLogFilters(query);
    // Preserve exact default behavior when no filters are supplied.
    if (filters.params.length === 0) {
      const { rows } = await this.pool.query<AuditLogRow>(AUDIT_LOG_SQL, [
        AUDIT_LOG_LIMIT,
      ]);
      return rows.map(mapAuditLogRow);
    }

    const params = [...filters.params, AUDIT_LOG_LIMIT];
    const sql =
      `${AUDIT_LOG_SELECT_BASE} where ${filters.conditions.join(" and ")}` +
      ` order by a.created_at desc limit $${params.length}`;
    const { rows } = await this.pool.query<AuditLogRow>(sql, params);
    return rows.map(mapAuditLogRow);
  }
}

// Central audit trail exposes actor identities + IPs; gate on the dedicated
// audit:read code (granted to super_admin/admin/auditor per data_admin_200 §4.3).
function assertCanReadAuditLogs(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("audit:read")) {
    throw new ForbiddenException("Missing audit:read capability");
  }
}

// Base select shared by the filtered path (mirrors AUDIT_LOG_SQL sans where/order/limit).
const AUDIT_LOG_SELECT_BASE = `
select
  a.id,
  a.actor_type,
  a.actor_id,
  a.action,
  a.result,
  a.resource_type,
  a.resource_id,
  a.error_code,
  a.ip_address,
  a.created_at,
  op.display_name as operator_name,
  op.email        as operator_email
from support.audit_logs a
left join admin.operator_account op
  on op.id = a.actor_id and a.actor_type = 'operator'
`;

// 版本位/变体位刻意不卡:判据与理由见 router.shared.ts 的 `UUID_RE` 注释
//(校验器不该比存储层更严;种子 id 的变体位是段值本身,如 …-4000-d000-…)。
const AUDIT_LOG_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditLogQuery {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  module?: string;
  result?: string;
}

// Builds a parameterized WHERE. Same param value may be referenced by two
// placeholders (module), which is fine since it is pushed once per placeholder.
function normalizeAuditLogFilters(query: AuditLogQuery): {
  conditions: string[];
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const pushParam = (value: unknown): number => {
    params.push(value);
    return params.length;
  };

  if (query.from !== undefined && query.from !== "") {
    conditions.push(
      `a.created_at >= $${pushParam(parseIsoParam(query.from, "from"))}`,
    );
  }
  if (query.to !== undefined && query.to !== "") {
    conditions.push(
      `a.created_at <= $${pushParam(parseIsoParam(query.to, "to"))}`,
    );
  }
  if (query.actorId !== undefined && query.actorId !== "") {
    if (!AUDIT_LOG_UUID_RE.test(query.actorId)) {
      throw new BadRequestException("actorId must be a uuid");
    }
    conditions.push(`a.actor_id = $${pushParam(query.actorId)}::uuid`);
  }
  if (query.action !== undefined && query.action !== "") {
    conditions.push(`a.action like $${pushParam(query.action)} || '%'`);
  }
  if (query.module !== undefined && query.module !== "") {
    const idx = pushParam(query.module);
    conditions.push(
      `(a.action like $${idx} || '.%' or (a.action not like '%.%' and a.resource_type = $${idx}))`,
    );
  }
  if (query.result !== undefined && query.result !== "") {
    if (query.result === "failure") {
      // Front-end two-state failure covers both failure and denied.
      conditions.push(`a.result in ('failure','denied')`);
    } else if (query.result === "success" || query.result === "denied") {
      conditions.push(`a.result = $${pushParam(query.result)}`);
    } else {
      throw new BadRequestException(
        "result must be one of success/failure/denied",
      );
    }
  }

  return { conditions, params };
}

function parseIsoParam(value: string, field: string): string {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) {
    throw new BadRequestException(`${field} is not a valid timestamp`);
  }
  return ts.toISOString();
}

// operator actor 关联 admin.operator_account 补 display_name/email;其余 actor(customer/system/api)
// 无平台账号,名以 actor_type 兜底。audit_logs 按月分区,默认取最近 N 条。
const AUDIT_LOG_SQL = `
select
  a.id,
  a.actor_type,
  a.actor_id,
  a.action,
  a.result,
  a.resource_type,
  a.resource_id,
  a.error_code,
  a.ip_address,
  a.created_at,
  op.display_name as operator_name,
  op.email        as operator_email
from support.audit_logs a
left join admin.operator_account op
  on op.id = a.actor_id and a.actor_type = 'operator'
order by a.created_at desc
limit $1
`;

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  // module = action 首段(如 'tenant.member.invite' → 'tenant'),无点则用 resource_type。
  const module = row.action.includes(".")
    ? (row.action.split(".")[0] ?? row.resource_type)
    : row.resource_type;
  return {
    id: row.id,
    operatorId: row.actor_id,
    operatorName: row.operator_name ?? row.actor_type,
    operatorEmail: row.operator_email ?? "",
    action: row.action,
    targetType: row.resource_type,
    targetId: row.resource_id ?? null,
    targetLabel: null,
    module,
    ip: row.ip_address ?? null,
    // audit_logs.result ∈ success/failure/denied;前端二态:denied 归 failure。
    result: row.result === "success" ? "success" : "failure",
    errorMessage: row.error_code ?? null,
    createdAt: toIso(row.created_at),
  };
}

interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  result: "success" | "failure" | "denied";
  resource_type: string;
  resource_id: string | null;
  error_code: string | null;
  ip_address: string | null;
  created_at: Date | string | null;
  operator_name: string | null;
  operator_email: string | null;
}
