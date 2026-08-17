/**
 * audit-log.ts — central audit trail for operator (platform admin) writes.
 * @package @vxture/bff-admin
 *
 * Every successful operator write appends one row to support.audit_logs with
 * actor_type='operator' (admin realm has no audit table of its own — see
 * deploy/database/ddl/80_admin.sql header + 90_cross_schema_fk.sql §5).
 *
 * Call this INSIDE the write transaction (pass the txn client) so the audit row
 * is atomic with the write: if the audit insert fails the whole write rolls back.
 * Only real support.audit_logs columns are used (see 72_support.sql).
 */
import type { Request } from "express";
import { extractClientIp } from "@vxture/core-utils";
import type { Queryable } from "../db/tx";
import type { RequestContext } from "../types/console.types";

export interface OperatorAuditEntry {
  /** Dotted verb, e.g. 'operator.role.create' (module = first segment). */
  action: string;
  /** Logical resource kind, e.g. 'operator_role'. */
  resourceType: string;
  /** Affected row id (visible/heterogeneous key — never an FK target). */
  resourceId: string;
  result?: "success" | "failure" | "denied";
  /** Optional before/after snapshots (stored as jsonb). */
  before?: unknown;
  after?: unknown;
}

// actor_type fixed 'operator'; actor_id/action/resource_type/resource_id NOT NULL;
// result defaults 'success'; before/after jsonb + ip_address/user_agent nullable.
// actor_console fixed 'admin' (product_251 X-3): this process serves exactly one
// console, so the value is a constant here rather than a caller-supplied field.
const OPERATOR_AUDIT_INSERT_SQL = `
insert into support.audit_logs
  (actor_type, actor_console, actor_id, action, result, resource_type, resource_id, before, after, ip_address, user_agent)
values
  ('operator', 'admin', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
`;

export async function insertOperatorAuditLog(
  db: Queryable,
  req: Request & RequestContext,
  entry: OperatorAuditEntry,
): Promise<void> {
  const actorId = req.user?.id;
  // actor_id is NOT NULL; callers guard the session upstream, but skip rather
  // than crash a committed write if the principal is somehow absent.
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
