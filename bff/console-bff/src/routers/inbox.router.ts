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
import { SelfScope } from "../auth/capability";

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

@SelfScope()
@Controller("api/me/inbox")
export class InboxRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  private userId(req: Request & RequestContext): string {
    if (!req.user) throw new UnauthorizedException("No active session");
    return req.user.id;
  }

  private async unreadCount(userId: string): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      // 已删的不算未读:铃铛角标上那个数必须与列表里看得见的条数对得上,
      // 否则会出现「角标 3 条未读、点进去一条也没有」。
      `select count(*)::text as n from support.inbox_messages
        where account_id = $1 and read_at is null and deleted_at is null`,
      [userId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /**
   * 列表：**未读置顶**，其次 created_at 倒序（owner 2026-09-09）。
   *
   * 已删（`deleted_at is not null`）不返回。删除是软删——通知的送达记录要留着，
   * dispatcher 的去重依赖它（唯一键 收件人 × 模板 × 业务引用），硬删会让同一条
   * 通知重新发一遍。
   *
   * ── 游标为什么还是 created_at ──
   * 排序键是 `(read_at is null) desc, created_at desc`，而游标只带 created_at。
   * 这在「翻页期间有消息被标已读」时会漏行——但列表在前端是**一次性拉完**的
   * （owner：没删除的全部显示），翻页只在超过上限时才发生，且那时用户还没开始
   * 标已读。把游标做成复合键要多带一个状态位，收益不抵复杂度；**限度写在这里**，
   * 真出现万级消息再改。
   */
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
          and deleted_at is null
          and ($2::timestamptz is null or created_at < $2::timestamptz)
        order by (read_at is null) desc, created_at desc, id desc
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
        where account_id = $1 and read_at is null and deleted_at is null`,
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

  /**
   * 删除一条消息（软删，owner 2026-09-09）。
   *
   * 幂等：已删的再删一次仍返回 ok，不报 404——重复点击、或两个标签页各点一次，
   * 都不该看到错误。真正的「不存在」（别人的消息、乱造的 id）仍是 404。
   *
   * 删除**不影响 dispatcher 的送达去重**：那条记录还在，只是不再出现在列表里。
   */
  @Post(":id/delete")
  async remove(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    const userId = this.userId(req);
    if (!UUID_RE.test(id)) throw new NotFoundException("消息不存在");
    const res = await this.pool.query<{ id: string }>(
      `update support.inbox_messages
          set deleted_at = coalesce(deleted_at, now())
        where id = $1 and account_id = $2 returning id`,
      [id, userId],
    );
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException("消息不存在");
    return { ok: true };
  }
}
