/**
 * audit-log.ts — 操作者写操作的审计留痕。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 落 `support.audit_logs`，`actor_type='operator'`——admin realm 没有自己的审计表
 * （见 deploy/database/ddl/80_admin.sql 头部与 90_cross_schema_fk.sql §5）。opera
 * 与 admin 写的是**同一张审计表**：审计是平台级事实，不该因为操作发自哪个门户而
 * 分家；查审计的人要的是"谁在什么时候改了什么"，不是"从哪个界面改的"。
 *
 * 必须在写事务内调用（传事务 client），审计行与写操作同生共死。
 */
import { extractClientIp } from "@vxture/core-utils";
import type { Request } from "express";
import type { Queryable } from "../db/tx";
import type { RequestContext } from "../types/request-context";

export interface OperatorAuditEntry {
  /** 点分动词，如 `governance.maintenance.create`（首段即模块）。 */
  action: string;
  /** 资源种类，如 `maintenance_window`。 */
  resourceType: string;
  /** 受影响行的 id。 */
  resourceId: string;
  result?: "success" | "failure" | "denied";
  before?: unknown;
  after?: unknown;
}

const OPERATOR_AUDIT_INSERT_SQL = `
insert into support.audit_logs
  (actor_type, actor_id, action, result, resource_type, resource_id, before, after, ip_address, user_agent)
values
  ('operator', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
`;

export async function insertOperatorAuditLog(
  db: Queryable,
  req: Request & RequestContext,
  entry: OperatorAuditEntry,
): Promise<void> {
  const actorId = req.operator?.id;
  // actor_id 是 NOT NULL。调用方上游已经守过会话；这里跳过而不是崩，避免一笔
  // 已经写成的业务操作因为主体缺失而回滚。
  if (!actorId) return;

  await db.query(OPERATOR_AUDIT_INSERT_SQL, [
    actorId,
    entry.action,
    entry.result ?? "success",
    entry.resourceType,
    entry.resourceId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    truncate(extractClientIp(req), 64),
    truncate(headerValue(req, "user-agent"), 512),
  ]);
}

function headerValue(req: Request, name: string): string | null {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function truncate(
  value: string | null | undefined,
  max: number,
): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}
