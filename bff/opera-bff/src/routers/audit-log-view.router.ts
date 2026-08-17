/**
 * audit-log-view.router.ts — 平台运营审计留痕只读视图。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 读 `support.audit_logs`（`actor_type='operator'`），Security/Audit 与
 * Dashboard「最近事件」共用同一份真实数据——审计是平台级事实，opera 与 admin
 * 写的是同一张表（见 `../audit/audit-log.ts` 文件头），这里只是给它开一个读口。
 * `actor_id` 落 `admin.operator_account.id`（域内无 FK，裸值），LEFT JOIN 取
 * 显示名，账号已删除/找不到时回退 actor_id 本身，不让一行留痕因为找不到人就
 * 从列表里消失。
 *
 * 只读、零新增写路径；只要求已登录 operator，不设专属能力码——与
 * product-health.router.ts / job-scheduler.router.ts 同一口径（见后者文件头
 * "没有专属能力码就不额外设卡"）。
 */
import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { unauthenticated } from "../errors/api-error";
import type { Request } from "express";
import type { Pool } from "pg";
import { OPERA_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { toIso } from "./router.shared";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * 字段名取自 product_251 X-3 的统一审计记录，**不是本仓自选的**：
 * `eventId · occurredAt · actorId · actorConsole · objectType · objectId ·
 * action · outcome`。
 *
 * 原来是 `id/time/actor/result/resourceType/resourceId`——审计页因此摆了三张互不
 * 相干的表（Atlas/Runos/Platform），因为同一个概念在三家有三个名字。改名的收益不
 * 在这一个接口好不好看，在于那三张表终于可以合成一张。
 *
 * `actorName` 与 `errorCode` 是 X-3 之外的附加字段——规范给的是**必须有**的下限，
 * 不是上限；显示名让人不必拿 UUID 去查是谁。
 */
export interface AuditLogEntry {
  eventId: string;
  occurredAt: string;
  actorId: string;
  /** 从哪个管理面发起。历史行没有这一列，回 null 而不是猜一个。 */
  actorConsole: string | null;
  actorName: string;
  action: string;
  outcome: string;
  objectType: string;
  objectId: string;
  errorCode: string | null;
}

interface AuditLogRow {
  id: string;
  created_at: Date | string;
  actor_id: string;
  actor_console: string | null;
  actor_name: string | null;
  action: string;
  result: string;
  resource_type: string;
  resource_id: string;
  error_code: string | null;
}

@Controller("api/audit-logs")
export class AuditLogViewRouter {
  constructor(@Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async list(
    @Req() req: Request & RequestContext,
    @Query("limit") limitParam?: string,
  ): Promise<AuditLogEntry[]> {
    if (!req.operator) {
      throw unauthenticated("AUTH_NO_SESSION", "No active session");
    }
    const limit = clampLimit(limitParam);

    const { rows } = await this.pool.query<AuditLogRow>(
      `select a.id, a.created_at, a.actor_id, a.actor_console, a.action,
              a.result, a.resource_type, a.resource_id, a.error_code,
              coalesce(o.display_name, o.username) as actor_name
       from support.audit_logs a
       left join admin.operator_account o on o.id = a.actor_id
       where a.actor_type = 'operator'
       order by a.created_at desc
       limit $1`,
      [limit],
    );

    return rows.map(mapRow);
  }
}

function clampLimit(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

function mapRow(row: AuditLogRow): AuditLogEntry {
  return {
    eventId: row.id,
    occurredAt: toIso(row.created_at),
    actorId: row.actor_id,
    actorConsole: row.actor_console,
    actorName:
      row.actor_name && row.actor_name.trim() !== ""
        ? row.actor_name
        : row.actor_id,
    action: row.action,
    outcome: row.result,
    objectType: row.resource_type,
    objectId: row.resource_id,
    errorCode: row.error_code,
  };
}
