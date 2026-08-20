/**
 * audit-log.ts — 租户侧审计写钩子(owner 2026-08-21 P1)。
 * @package @vxture/bff-console
 * @layer Application
 * @category Audit
 *
 * console 此前对 support.audit_logs **零写入**(P1 勘察结论)——租户审计日志
 * 页要有内容,先补写入侧。形状对齐 admin-bff 的 insertOperatorAuditLog,
 * 三处不同:actor_type='customer'、actor_console='console'(本进程只服务
 * 一个面,常量;X-3 口径)、**tenant_id 必填**(租户视图的过滤键,72_support
 * 现成索引 (tenant_id, created_at DESC))。
 *
 * 失败自吞(fire-and-forget):审计写挂掉不允许拖垮业务写;失败进程内
 * console.error 留痕。append-only 表,只 INSERT。
 */

import type { Request } from "express";
import type { Pool } from "pg";
import type { RequestContext } from "../types/console.types";

export interface CustomerAuditEntry {
  /** 点分动词,如 'tenant.member.invite' / 'subscription.cancel'。 */
  action: string;
  /** 逻辑资源类型,如 'member' / 'subscription' / 'addon_order'。 */
  resourceType: string;
  /** 受影响标识——一律可视码/业务键,绝不当 FK 用。 */
  resourceId: string;
  result?: "success" | "failure" | "denied";
  before?: unknown;
  after?: unknown;
  errorCode?: string;
}

const CUSTOMER_AUDIT_INSERT_SQL = `
insert into support.audit_logs
  (actor_type, actor_console, actor_id, tenant_id, action, result,
   resource_type, resource_id, error_code, before, after,
   request_id, ip_address, user_agent)
values
  ('customer', 'console', $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
   $10, $11, $12)
`;

function truncate(v: string | null | undefined, max: number): string | null {
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return truncate(first?.trim() || req.socket?.remoteAddress || null, 64);
}

/**
 * 记一条租户侧审计(fire-and-forget)。session/tenant 缺失时静默跳过——
 * 上游守卫已 401,这里不重复裁决,也不让审计缺席炸掉已提交的业务写。
 */
export function auditCustomerAction(
  pool: Pool,
  req: Request & RequestContext,
  entry: CustomerAuditEntry,
): void {
  const actorId = req.user?.id;
  const tenantId = req.tenant?.id ?? null;
  if (!actorId) return;
  void pool
    .query(CUSTOMER_AUDIT_INSERT_SQL, [
      actorId,
      tenantId,
      entry.action,
      entry.result ?? "success",
      entry.resourceType,
      truncate(entry.resourceId, 128),
      truncate(entry.errorCode ?? null, 64),
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      truncate(
        (req.headers["x-request-id"] as string | undefined) ?? null,
        128,
      ),
      clientIp(req),
      truncate(req.headers["user-agent"] ?? null, 512),
    ])
    .catch((err) => {
      console.error(
        `[console-audit] write failed for ${entry.action}: ${String(err)}`,
      );
    });
}
