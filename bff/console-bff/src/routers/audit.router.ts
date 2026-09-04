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
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import type { RequestContext } from "../types/console.types";
import { RequireCapability } from "../auth/capability";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/** 分页口径与账单页一致(批 6):默认 20、上限 100、页码上限防越界扫描。 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;
/** 动作码形状:`域.对象.动作`,只做形状校验(前端从受管清单里选)。 */
const ACTION_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** 服务端分页的一页(与账单页同一形状,批 6)。 */
export interface ConsoleAuditLogPage {
  items: ConsoleAuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

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

@RequireCapability("tenant.audit.read")
@Controller("api/audit")
export class AuditRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  @Get("logs")
  async listLogs(
    @Req() req: Request & RequestContext,
    @Query("result") resultRaw?: string,
    @Query("days") daysRaw?: string,
    @Query("action") actionRaw?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ): Promise<ConsoleAuditLogPage> {
    // 权限门在类级 @RequireCapability("tenant.audit.read")(全局守卫),这里只剩上下文校验。
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const daysNum = Number(daysRaw);
    const days =
      Number.isInteger(daysNum) && daysNum >= 1 ? Math.min(daysNum, 90) : 90;
    const result =
      resultRaw === "success" || resultRaw === "failure" ? resultRaw : null;
    // 动作码是受管字典里的值,只做形状校验(前端从同一份清单里选)。
    const action =
      typeof actionRaw === "string" && ACTION_RE.test(actionRaw)
        ? actionRaw
        : null;
    const page = parsePositiveInt(pageRaw, 1, MAX_PAGE);
    const pageSize = parsePositiveInt(
      pageSizeRaw,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    // 批 6:此前是 `limit 200` 硬顶、无分页也无总数——超过 200 条的租户看不到更早的
    // 记录,而且界面上没有任何提示。改为服务端分页 + 总数,口径与账单页一致。
    // 计数与列表共用同一套谓词(含时间窗),不让 count 扫穿所有月分区。
    const where = `al.tenant_id = $1
          and al.created_at >= now() - make_interval(days => $2)
          and ($3::text is null
               or (al.result = $3)
               or ($3 = 'failure' and al.result = 'denied'))
          and ($4::text is null or al.action = $4)`;
    const params = [req.tenant.id, days, result, action];

    const counted = await this.pool.query<{ total: string }>(
      `select count(*)::text as total from support.audit_logs al where ${where}`,
      params,
    );
    const total = Number(counted.rows[0]?.total ?? 0);

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
        where ${where}
        order by al.created_at desc, al.id desc
        limit $5 offset $6`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return {
      items: res.rows.map((r) => ({
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
      })),
      total,
      page,
      pageSize,
    };
  }
}
