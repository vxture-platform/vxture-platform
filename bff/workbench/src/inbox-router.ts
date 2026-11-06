/**
 * Account-owned inbox projection and explicit, same-origin read acknowledgements.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-06
 */
import { Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { SessionService } from "./auth/session-service";
import { CONFIG, INBOX_WRITE_POOL, PRIMARY_POOL } from "./tokens";
import type { WorkbenchConfig } from "./config";
import { failure } from "./errors";

interface InboxRow {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// ============================================================================
// Inbox ownership is account-wide, matching Console; no browser identity hints.
// ============================================================================
@Controller("api/me/inbox")
export class InboxRouter {
  constructor(
    @Inject(SessionService) private readonly auth: SessionService,
    @Inject(PRIMARY_POOL) private readonly pool: Pool,
    @Inject(INBOX_WRITE_POOL) private readonly writer: Pool,
    @Inject(CONFIG) private readonly config: WorkbenchConfig,
  ) {}

  private assertWrite(req: Request): void {
    if (
      req.headers.origin !== this.config.origin ||
      req.headers["x-workbench-request"] !== "1" ||
      (req.headers["sec-fetch-site"] &&
        req.headers["sec-fetch-site"] !== "same-origin")
    ) {
      throw failure(
        403,
        "WORKBENCH_REQUEST_FORBIDDEN",
        "Same-origin request required",
      );
    }
  }

  /**
   * Read the eight latest messages and unread total for the verified account.
   * @param req - Cookie-authenticated request.
   * @returns Account-owned recent messages, without exposing another recipient.
   * @throws When authentication or storage is unavailable.
   */
  @Get()
  async list(@Req() req: Request) {
    const { user } = await this.auth.authenticate(req);
    const [messages, unread] = await Promise.all([
      this.pool.query<InboxRow>(
        `select id, title, body, link, read_at, created_at from support.inbox_messages
         where account_id = $1 and deleted_at is null
         order by (read_at is null) desc, created_at desc, id desc limit 8`,
        [user.userId],
      ),
      this.pool.query<{ n: string }>(
        `select count(*)::text as n from support.inbox_messages
         where account_id = $1 and read_at is null and deleted_at is null`,
        [user.userId],
      ),
    ]);
    return {
      items: messages.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.read_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      })),
      unreadCount: Number(unread.rows[0]?.n ?? 0),
    };
  }

  // ========================================================================
  // Only explicit read-state updates are allowed; no delivery or deletion API.
  // ========================================================================
  /**
   * Acknowledge all non-deleted messages belonging to this account.
   * @param req - Same-origin authenticated request.
   * @returns Number of previously unread messages updated.
   * @throws When the source or identity is invalid.
   */
  @Post("read-all")
  async readAll(@Req() req: Request) {
    this.assertWrite(req);
    const { user } = await this.auth.authenticate(req);
    const result = await this.writer.query(
      `update support.inbox_messages set read_at = now()
       where account_id = $1 and read_at is null and deleted_at is null`,
      [user.userId],
    );
    return { updated: result.rowCount ?? 0 };
  }

  /**
   * Idempotently acknowledge one visible message owned by the current account.
   * @param req - Same-origin authenticated request.
   * @param id - Untrusted message identifier.
   * @returns Success when this recipient owns the non-deleted message.
   * @throws When source, identity or ownership checks fail.
   */
  @Post(":id/read")
  async read(@Req() req: Request, @Param("id") id: string) {
    this.assertWrite(req);
    const { user } = await this.auth.authenticate(req);
    if (!UUID.test(id))
      throw failure(404, "WORKBENCH_NOT_FOUND", "Message not found");
    const result = await this.writer.query(
      `update support.inbox_messages set read_at = coalesce(read_at, now())
       where id = $1 and account_id = $2 and deleted_at is null returning id`,
      [id, user.userId],
    );
    if (!result.rowCount)
      throw failure(404, "WORKBENCH_NOT_FOUND", "Message not found");
    return { ok: true };
  }
}
