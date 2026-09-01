/**
 * notification-logs.router.ts - 通知投递台账路由(support.notification_logs)
 * @package @vxture/bff-arche
 *
 * Description: 通知投递台账只读接口。接 support.notification_logs,left join
 *   tenancy.tenants 补租户名。回执字段(delivered_at/opened_at/provider_message_id)
 *   由投递 webhook 回写。纯读,无写路径。能力守卫:notification:log.read。
 *   —— 从 admin-bff 平移至治理台 arche-bff(三平面拆分 PR②);共享帮手改用
 *   arche-bff 的 router.shared,会话主体改判 req.operator。
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
import type { NotificationLogRecord } from "../types/governance.types";
import { LIST_LIMIT, parseIso, toIso, toIsoOrNull } from "./router.shared";

const CHANNELS = new Set(["email", "sms", "inapp", "webhook", "push"]);
const STATUSES = new Set([
  "queued",
  "sent",
  "delivered",
  "opened",
  "failed",
  "bounced",
]);

@Controller("api/notification-logs")
export class NotificationLogsRouter {
  constructor(@Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool) {}

  // Contract: GET /api/notification-logs?channel=&status=&from=ISO&to=ISO&search=
  //   from/to filter on created_at; search matches recipient/template/reference.
  //   Most-recent LIST_LIMIT rows.
  @Get()
  async listNotificationLogs(
    @Req() req: Request & RequestContext,
    @Query("channel") channel?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("search") search?: string,
  ): Promise<NotificationLogRecord[]> {
    assertCanReadNotificationLogs(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (channel) {
      if (!CHANNELS.has(channel)) {
        throw new BadRequestException("invalid channel");
      }
      params.push(channel);
      where.push(`n.channel = $${params.length}`);
    }
    if (status) {
      if (!STATUSES.has(status)) {
        throw new BadRequestException("invalid status");
      }
      params.push(status);
      where.push(`n.status = $${params.length}`);
    }
    if (from) {
      params.push(parseIso(from, "from"));
      where.push(`n.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(parseIso(to, "to"));
      where.push(`n.created_at <= $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(n.recipient ilike $${params.length} or n.template_code ilike $${params.length}` +
          ` or n.reference_id ilike $${params.length})`,
      );
    }
    params.push(LIST_LIMIT);

    const { rows } = await this.pool.query<NotificationLogRow>(
      `${NOTIFICATION_LOG_SELECT} where ${where.join(" and ")}
       order by n.created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapNotificationLogRow);
  }
}

function assertCanReadNotificationLogs(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("notification:log.read")) {
    throw new ForbiddenException("Missing notification:log.read capability");
  }
}

const NOTIFICATION_LOG_SELECT = `
select
  n.id,
  n.tenant_id,
  t.name as tenant_name,
  n.account_id,
  n.channel,
  n.template_code,
  n.status,
  n.reference_type,
  n.reference_id,
  n.recipient,
  n.subject,
  n.provider,
  n.provider_message_id,
  n.error_message,
  n.retry_count,
  n.delivered_at,
  n.opened_at,
  n.created_at
from support.notification_logs n
left join tenancy.tenants t on t.id = n.tenant_id
`;

interface NotificationLogRow {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  account_id: string | null;
  channel: string;
  template_code: string;
  status: string;
  reference_type: string | null;
  reference_id: string | null;
  recipient: string;
  subject: string | null;
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  delivered_at: Date | string | null;
  opened_at: Date | string | null;
  created_at: Date | string | null;
}

function mapNotificationLogRow(row: NotificationLogRow): NotificationLogRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    accountId: row.account_id,
    channel: row.channel,
    templateCode: row.template_code,
    status: row.status,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    recipient: row.recipient,
    subject: row.subject,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    errorMessage: row.error_message,
    retryCount: Number(row.retry_count ?? 0),
    deliveredAt: toIsoOrNull(row.delivered_at),
    openedAt: toIsoOrNull(row.opened_at),
    createdAt: toIso(row.created_at),
  };
}
