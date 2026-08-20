/**
 * audit.router.ts - 租户审计日志路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 租户侧操作轨迹(owner 2026-08-21 P1)读侧:
 *   GET /api/audit/logs — 本租户的审计流水(support.audit_logs 按 tenant_id
 *   过滤,现成覆盖索引 (tenant_id, created_at DESC);近 90 天、上限 200)。
 * 写入侧 = 各写端点的 auditCustomerAction 钩子(../audit/audit-log)。
 * actor 解引用 account.users 显示名(边界#2 读侧解引用,与用量记录同法);
 * capability 门 tenant.audit.read(← tenant.settings.manage,owner/manager)。
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
import type { RequestContext } from "../types/console.types";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

export interface ConsoleAuditLogView {
  /** 行 key(不展示) */
  id: string;
  at: string;
  /** 操作人显示名(运营/系统动作按 actor 类型标注) */
  actorName: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: "success" | "failure" | "denied";
  ipAddress: string | null;
}

@Controller("api/audit")
export class AuditRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  @Get("logs")
  async listLogs(
    @Req() req: Request & RequestContext,
    @Query("result") resultRaw?: string,
    @Query("days") daysRaw?: string,
  ): Promise<ConsoleAuditLogView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.capabilities?.includes("tenant.audit.read")) {
      throw new ForbiddenException("无权查看审计日志");
    }
    const daysNum = Number(daysRaw);
    const days =
      Number.isInteger(daysNum) && daysNum >= 1 ? Math.min(daysNum, 90) : 90;
    const result =
      resultRaw === "success" || resultRaw === "failure" ? resultRaw : null;

    const res = await this.pool.query<{
      id: string;
      created_at: Date;
      actor_type: string;
      actor_name: string | null;
      action: string;
      resource_type: string;
      resource_id: string;
      result: string;
      ip_address: string | null;
    }>(
      `select al.id, al.created_at, al.actor_type,
              coalesce(up.display_name, u.account) as actor_name,
              al.action, al.resource_type, al.resource_id, al.result,
              al.ip_address
         from support.audit_logs al
         left join account.users u
           on u.id = al.actor_id and al.actor_type = 'customer'
         left join account.user_profiles up
           on up.user_id = al.actor_id and al.actor_type = 'customer'
        where al.tenant_id = $1
          and al.created_at >= now() - make_interval(days => $2)
          and ($3::text is null
               or (al.result = $3)
               or ($3 = 'failure' and al.result = 'denied'))
        order by al.created_at desc
        limit 200`,
      [req.tenant.id, days, result],
    );
    return res.rows.map((r) => ({
      id: r.id,
      at: r.created_at.toISOString(),
      actorName: r.actor_name,
      actorType: r.actor_type,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      result:
        r.result === "success"
          ? "success"
          : r.result === "denied"
            ? "denied"
            : "failure",
      ipAddress: r.ip_address,
    }));
  }
}
