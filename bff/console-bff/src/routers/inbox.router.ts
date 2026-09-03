/**
 * inbox.router.ts — 站内消息收件箱（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）。
 * @package @vxture/bff-console
 *
 * 读 support.inbox_messages（收件人 = 当前用户），只认 account_id 归属；写只有 read_at。
 * 生产者是 @vxture/service-notification（订阅 / 订单 / 退款事件），这里不发消息。
 */
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";

export interface InboxMessage {
  id: string;
  templateCode: string;
  title: string;
  body: string;
  link: string | null;
  referenceType: string;
  referenceId: string;
  readAt: string | null;
  createdAt: string;
}

interface InboxRow {
  id: string;
  template_code: string;
  title: string;
  body: string;
  link: string | null;
  reference_type: string;
  reference_id: string;
  read_at: Date | null;
  created_at: Date;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRow(r: InboxRow): InboxMessage {
  return {
    id: r.id,
    templateCode: r.template_code,
    title: r.title,
    body: r.body,
    link: r.link,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    readAt: r.read_at ? r.read_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

@Controller("api/me/inbox")
export class InboxRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  private userId(req: Request & RequestContext): string {
    if (!req.user) throw new UnauthorizedException("No active session");
    return req.user.id;
  }

  private async unreadCount(userId: string): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      `select count(*)::text as n from support.inbox_messages
        where account_id = $1 and read_at is null`,
      [userId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** 列表：created_at 倒序，`before` = 上一页最后一条的 createdAt（ISO）做游标。 */
  @Get()
  async list(
    @Req() req: Request & RequestContext,
    @Query("limit") limitRaw?: string,
    @Query("before") before?: string,
  ): Promise<{
    items: InboxMessage[];
    nextBefore: string | null;
    unreadCount: number;
  }> {
    const userId = this.userId(req);
    const parsed = Number(limitRaw);
    const limit =
      Number.isFinite(parsed) && parsed > 0
        ? Math.min(Math.floor(parsed), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const beforeAt =
      before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
    const res = await this.pool.query<InboxRow>(
      `select id, template_code, title, body, link, reference_type, reference_id, read_at, created_at
         from support.inbox_messages
        where account_id = $1
          and ($2::timestamptz is null or created_at < $2::timestamptz)
        order by created_at desc, id desc
        limit $3`,
      [userId, beforeAt, limit + 1],
    );
    const page = res.rows.slice(0, limit);
    const items = page.map(mapRow);
    const nextBefore =
      res.rows.length > limit && page.length > 0
        ? page[page.length - 1]!.created_at.toISOString()
        : null;
    return { items, nextBefore, unreadCount: await this.unreadCount(userId) };
  }

  @Get("unread-count")
  async unread(
    @Req() req: Request & RequestContext,
  ): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.unreadCount(this.userId(req)) };
  }

  @Post("read-all")
  async readAll(
    @Req() req: Request & RequestContext,
  ): Promise<{ updated: number }> {
    const res = await this.pool.query(
      `update support.inbox_messages set read_at = now()
        where account_id = $1 and read_at is null`,
      [this.userId(req)],
    );
    return { updated: res.rowCount ?? 0 };
  }

  @Post(":id/read")
  async read(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    const userId = this.userId(req);
    if (!UUID_RE.test(id)) throw new NotFoundException("消息不存在");
    const res = await this.pool.query<{ id: string }>(
      `update support.inbox_messages set read_at = coalesce(read_at, now())
        where id = $1 and account_id = $2 returning id`,
      [id, userId],
    );
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException("消息不存在");
    return { ok: true };
  }
}
