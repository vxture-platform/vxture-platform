import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import {
  ticketEventReference,
  type NotificationDispatcher,
  type TicketTemplateCode,
} from "@vxture/service-notification";
import { ADMIN_CUSTOMER_NOTIFIER } from "../providers/commerce-services.provider";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  RequestContext,
  SupportTicketRecord,
  TenantOperationTicket,
} from "../types/console.types";
import { industryLabel } from "@vxture/core-utils";
import {
  TICKET_EVENT_INTERNAL_NOTE,
  TICKET_EVENT_REPLY,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@vxture-platform/shared";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { pgErrorCode, withTransaction } from "../db/tx";

@Controller("api/tickets")
export class TicketsRouter {
  private readonly logger = new Logger(TicketsRouter.name);

  /* 三个令牌都显式写出来：esbuild 打包不保留装饰器元数据，少一个 `@Inject`
     编译得过、启动烟测也过，到线上才以 undefined 现形（tenants.router 同一段话）。
     分发器就是「客户会不会收到工单通知」的唯一开关——漏掉它，三条通知一句话都不发，
     而那种缺口没有任何运行时信号。 */
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
    @Inject(ADMIN_CUSTOMER_NOTIFIER)
    private readonly notifier: NotificationDispatcher,
  ) {}

  @Get()
  async listTickets(
    @Req() req: Request & RequestContext,
  ): Promise<SupportTicketRecord[]> {
    assertCanManageTickets(req);

    const tableCheck = await this.pool.query<{ table_name: string | null }>(
      "select to_regclass('support.tickets')::text as table_name",
    );
    if (!tableCheck.rows[0]?.table_name) {
      throw new BadGatewayException(
        "Support ticket database is not connected. Confirm the schema design before enabling ticket data.",
      );
    }

    const ticketRows =
      await this.pool.query<SupportTicketRow>(SUPPORT_TICKET_SQL);
    return ticketRows.rows.map(mapSupportTicketRow);
  }

  /**
   * Contract: POST /api/tickets —— 运营代客建单。
   *
   * **这是全仓第一个能往 `support.tickets` 写入行的入口**（建立此端点前该表恒空：
   * admin 与 console 都没有建单路径，seed 引用它但不造数据）。
   *
   * body: { tenantCode: string(tenant_no), title, description,
   *         category?, priority?, reporterName?, accountCode?(user_no) }
   * response: SupportTicketRecord。租户解不出来 → 404；账号与租户对不上 → 400。
   *
   * ── `source` 取 'admin'，不取 'console' ──
   * 值域是 ('console','website','email','admin','api')（chk_tickets_source）。
   * 这一列答的是「这行是从哪个渠道进来的」，不是「这事是谁的」。运营代客录入，
   * 进来的渠道就是运营后台 ⇒ 'admin'。写 'console' 会声称客户自己在客户端提了单，
   * 而客户端**根本没有提单入口**——那是一句查不出来的假话：日后按 source 统计
   * 自助率时，它会把我们代录的量算成客户自助量。渠道值域里没有「电话」，
   * 客户是怎么找过来的由 `reporter_name` 与正文承载，不靠 source 硬编一个。
   *
   * ── 报单者：租户必填，账号可空，且空是有含义的 ──
   * owner 裁决「工单可见范围 = 租户级」：同租户成员都看得见，所以**读取不需要
   * account_id**。于是 `accountCode` 是可选的，留空表示「这张单属于这个租户，
   * 没有指名到人」——不是缺数据。
   *   · 给了 `accountCode`：必须是该租户的成员（`tenancy.tenant_memberships`，
   *     排除 removed），否则 400。跨租户挂人会让 A 的工单署上 B 的成员。
   *     `reporter_name` 取该账号的 display_name（权威），取不到再退回运营录的名字。
   *   · 没给：`account_id` 留 NULL，`reporter_name` 就是运营录的那个名字（可空）。
   *     **不拿租户主联系人顶上**——那会把这通电话记到一个也许没打过电话的人头上。
   *
   * ── `accountCode` 今天只有 API 这一面：**界面不送它，本仓没有调用方** ──
   * admin 建单弹窗的 `CreateTicketInput` 刻意没有这个字段（理由写在那个接口上：
   * 电话 / 群里反馈的场合，运营手里没有客户的用户码），所以下面那条 accountCode
   * 分支在本仓只有 spec 走它。**保留是明示的取舍，不是忘了接**：字段既然在
   * 请求体的形状里，收到了就必须校验——收下却不校验才是让「A 的工单署上 B 的
   * 成员」真的发生的那种写法。
   * follow-up（本批不做，方向待 owner 裁定）：要么给建单弹窗补一个可选的
   * 「报单账号」选择器（运营手里确实有用户码的场合用它），要么连字段一起删掉。
   * 那是一次产品裁定——工单要不要能指名到人——不该由一次收尾清理顺手带出来。
   */
  @Post()
  async createTicket(
    @Req() req: Request & RequestContext,
    @Body() body: CreateTicketBody,
  ): Promise<SupportTicketRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const tenantNo = requirePrincipalNo(body?.tenantCode, "tenantCode");
    const title = requireTicketText(body?.title, "title", 200);
    const description = requireTicketText(
      body?.description,
      "description",
      10000,
    );
    const category =
      optionalTicketText(body?.category, "category", 64) ?? "general";
    const priority = requireTicketPriority(body?.priority);
    const typedReporter = optionalTicketText(
      body?.reporterName,
      "reporterName",
      100,
    );
    const accountNo =
      body?.accountCode === undefined || body?.accountCode === null
        ? null
        : requirePrincipalNo(body.accountCode, "accountCode");

    const ticketNo = await withTransaction(this.rwPool, async (client) => {
      const tenantRes = await client.query<{ id: string }>(RESOLVE_TENANT_SQL, [
        tenantNo,
      ]);
      const tenantId = tenantRes.rows[0]?.id;
      if (!tenantId) {
        throw new NotFoundException("Tenant not found");
      }

      let accountId: string | null = null;
      let reporterName = typedReporter;
      if (accountNo !== null) {
        const accountRes = await client.query<{
          id: string;
          display_name: string | null;
        }>(RESOLVE_TENANT_MEMBER_SQL, [accountNo, tenantId]);
        const account = accountRes.rows[0];
        if (!account) {
          throw new BadRequestException(
            "accountCode is not a member of this tenant",
          );
        }
        accountId = account.id;
        reporterName = account.display_name?.trim() || typedReporter;
      }

      const no = ticketCode();
      try {
        await client.query(TICKET_INSERT_SQL, [
          tenantId,
          accountId,
          no,
          category,
          priority,
          TICKET_SOURCE_OPERATOR_LOGGED,
          title,
          description,
          reporterName,
        ]);
      } catch (error) {
        // 单号是随机 10 位 + 唯一约束兜底（uq_tickets_ticket_no）。撞号是天文数字级
        // 的小概率，但撞上时必须是一个能看懂的 409，而不是裸 500。
        if (pgErrorCode(error) === "23505") {
          throw new ConflictException("Ticket number collision, please retry");
        }
        throw error;
      }

      // 建单事件：时间线的第一行，记下是哪个运营代录的。
      // payload 里**不放 uuid**（这段 payload 会原样出到浏览器）。
      // 这个词刻意不在 CUSTOMER_VISIBLE_TICKET_EVENT_TYPES 里：建单这件事由工单
      // 自己的 created_at 回答一次就够，且这里的 source/reporter 是内部口径。
      await client.query(TICKET_EVENT_BY_NO_INSERT_SQL, [
        no,
        "created",
        actor.id,
        actor.name,
        JSON.stringify({
          source: TICKET_SOURCE_OPERATOR_LOGGED,
          reporter_name: reporterName,
          on_behalf_of_customer: true,
        }),
      ]);

      // 审计与写入同一事务（审计失败则整条回滚）。resource_id 用可视码 ticket_no，
      // 不用 uuid——审计页是人读的。
      await insertOperatorAuditLog(client, req, {
        action: "ticket.create",
        resourceType: "support_ticket",
        resourceId: no,
        tenantId,
        after: {
          title,
          category,
          priority,
          source: TICKET_SOURCE_OPERATOR_LOGGED,
        },
      });
      return no;
    });

    return this.fetchTicketDetail(ticketNo);
  }

  // ── B8 detail / timeline / write path（追加）─────────────────────────────
  // :id 接受 ticket.id(uuid) 或 ticket.ticket_no（前端记录 id = ticket_no ?? id）。

  // Contract: GET /api/tickets/:id
  //   response: SupportTicketRecord（同 list 元素形状）。404 if not found / soft-deleted.
  @Get(":id")
  async getTicket(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<SupportTicketRecord> {
    assertCanManageTickets(req);
    return this.fetchTicketDetail(id);
  }

  // Contract: GET /api/tickets/:id/comments
  //   response: TicketCommentRecord[] ascending by created_at (timeline).
  //     TicketCommentRecord = { id, ticketId, eventType, actorType, actorId|null,
  //       actorName, payload: object, createdAt }
  //
  // **这条读取刻意不带可见性过滤：运营面要看见全部**，包含 internal_note。
  // 内部备注就是写给这一屏看的，过滤掉它等于把运营自己的笔记藏起来。
  // 客户面的读取是**另一条**查询，必须带
  // `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 过滤（值域在 @vxture-platform/shared），
  // 由 lint:ticket-visibility 盯着。两条读取的作用域不同，不要合并成一条。
  @Get(":id/comments")
  async listTicketComments(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TicketCommentRecord[]> {
    assertCanManageTickets(req);
    const ref = requireTicketRef(id);
    const { rows } = await this.pool.query<TicketCommentRow>(
      TICKET_COMMENTS_SQL,
      [ref],
    );
    return rows.map(mapTicketCommentRow);
  }

  /**
   * 运营写流水的两个端点。**一条流水给谁看，只由它的 event_type 决定**
   * （值域权威：`CUSTOMER_VISIBLE_TICKET_EVENT_TYPES`，见 @vxture-platform/shared）。
   *
   * ── 为什么是两条路径，而不是一个端点加一个布尔 ──
   * `POST :id/comments { body, internal: true }` 这种形状，漏传就落到默认档，
   * 而默认档写错方向的代价是**内部话印给客户**。布尔还会被前端某次重构顺手丢掉，
   * 类型上完全合法。改成两条路径之后，「这行给谁看」写在 URL 里，调用点自己
   * 就说清楚了，混不了：
   *
   *   POST :id/notes    → internal_note  客户永远看不见（运营的内部备注）
   *   POST :id/replies  → reply          写给客户读的正式回复
   *
   * ── 默认必须是安全的那一档 ──
   * 旧端点 `POST :id/comments` 留着当**别名，写 internal_note**：它的 body 里
   * 没有任何字段说明这是给谁看的，而「没说」只能解释成最保守的那一档。
   * 顺带这也正是 owner 的裁决：运营的普通评论就是内部备注。
   * **本仓已经没有调用方**：portals/admin 那个 `addTicketComment` 客户端方法连同
   * 它唯一的调用点已在本分支删掉，admin 现在只调 `:id/notes` 与 `:id/replies`
   *（除了本文件的 spec，没有别处打这条路由）。它留着只为给可能还在打它的
   * 外部 / 历史客户端一个安全默认：那些请求一句没说这行给谁看，就落 internal_note。
   *
   * 它原先写的是 `comment`——那个词是**客户自己发言**的词。运营的话借客户的词写进
   * 同一条时间线，日后没有任何办法把两者分开。
   */

  // Contract: POST /api/tickets/:id/notes
  //   body: { body: string }
  //   appends ticket_comments: event_type='internal_note', actor_type='operator',
  //     payload={body}.  客户面读取永不返回它。
  //   response: TicketCommentRecord.  404 if ticket not found.
  @Post(":id/notes")
  async addInternalNote(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { body?: unknown },
  ): Promise<TicketCommentRecord> {
    return this.appendOperatorComment(
      req,
      id,
      body?.body,
      TICKET_EVENT_INTERNAL_NOTE,
    );
  }

  // Contract: POST /api/tickets/:id/replies
  //   body: { body: string }
  //   appends ticket_comments: event_type='reply', actor_type='operator',
  //     payload={body}.  **客户读得到**（CUSTOMER_VISIBLE_TICKET_EVENT_TYPES）。
  //   response: TicketCommentRecord.  404 if ticket not found.
  @Post(":id/replies")
  async addTicketReply(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { body?: unknown },
  ): Promise<TicketCommentRecord> {
    return this.appendOperatorComment(req, id, body?.body, TICKET_EVENT_REPLY);
  }

  // Contract: POST /api/tickets/:id/comments  —— 旧入口，等价于 :id/notes。
  //   body 说不出给谁看 ⇒ 落安全档 internal_note（见上面那段头注）。
  //   本仓无调用方，只为外部 / 历史客户端保留这个安全默认。
  @Post(":id/comments")
  async addTicketComment(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { body?: unknown },
  ): Promise<TicketCommentRecord> {
    return this.appendOperatorComment(
      req,
      id,
      body?.body,
      TICKET_EVENT_INTERNAL_NOTE,
    );
  }

  /**
   * 两个词共用一条写入路径：差别只有 event_type，其余一个字都不该分叉。
   *
   * ── 只有 `reply` 那一档发客户通知 ──
   * 判据与可见性完全同一条：**给谁看只由 event_type 决定**。`internal_note` 客户看不见，
   * 给它发一条「工单有新回复」就是把一件他永远读不到的事通告给他——而他点进详情页什么
   * 也找不到（那一屏按 `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 过滤）。所以这里**按词分档，
   * 不按端点分**：旧的 `:id/comments` 别名落 internal_note，于是它也自然不发通知，
   * 不必在那边另写一次判断。
   */
  private async appendOperatorComment(
    req: Request & RequestContext,
    id: string,
    rawBody: unknown,
    eventType: typeof TICKET_EVENT_INTERNAL_NOTE | typeof TICKET_EVENT_REPLY,
  ): Promise<TicketCommentRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const ref = requireTicketRef(id);
    const text = requireTicketText(rawBody, "body", 10000);

    const { rows } = await this.rwPool.query<TicketCommentRow>(
      TICKET_COMMENT_INSERT_SQL,
      [ref, actor.id, actor.name, text, eventType],
    );
    const written = rows[0];
    if (!written) {
      throw new NotFoundException("Ticket not found");
    }
    /* 落库之后才发（这条 insert 是单语句，返回即已提交）。`internal_note` 不发，见头注。
       正文 `text` **不进通知**：回复全文只在工单详情页留一份，见 dispatch/templates.ts。 */
    if (eventType === TICKET_EVENT_REPLY) {
      await this.notifyTicketEvent("ticket.replied", async () => ({
        /* 这条 insert…select 的 `returning` 只拿得到 ticket_comments 自己的列（pg 的限制），
           所以租户与可视工单码要再查一次。这一步也在 `notifyTicketEvent` 的 try 里面：
           它要碰库，而库出问题不该反过来让运营刚写成的那条回复失败。 */
        target: await this.notifyTargetOf(written.ticket_id),
        /* 锚里的时刻取**这一行流水自己的 created_at**，不另取一个 `new Date()`：
           两处各算一次就有两个时刻，而锚是「哪一次」的唯一判据。 */
        at: eventMoment(written.created_at),
      }));
    }
    return mapTicketCommentRow(written);
  }

  // Contract: POST /api/tickets/:id/assign
  //   body: { assigneeId: string(uuid), assigneeName: string, note?: string }
  //   updates tickets.assignee_id/assignee_name and appends a ticket_comments row
  //     (event_type='assigned', actor_type='operator', payload={assignee_name,note}).
  //   Transactional. response: SupportTicketRecord (refreshed).  404 if ticket not found.
  //
  // ── payload 里**不放坐席的 uuid**（2026-09-29 修）──
  // 这段 payload 被时间线读取原样投影给浏览器（`mapTicketCommentRow` 的 `payload` 字段），
  // 而本仓的规则是客户端任何地方都不出现 uuid。`assignee_id` 写进 `support.tickets` 那一列
  // （那是库内的外键，不上屏），时间线上要的是**名字**——人读时间线认的是人名。
  // 这条流水的 event_type `assigned` 不在 CUSTOMER_VISIBLE_TICKET_EVENT_TYPES 里，所以它
  // 到不了客户那一屏；但「到不了客户那屏」不等于「可以放 uuid」：运营那一屏也是浏览器。
  // 这不是删一个字段而已 —— 它是那道规则在这条路径上唯一的破口，删掉之后这个端点的响应与
  // 时间线里再没有 uuid（`insertSelectParam` 那条 spec 现在也钉着它）。
  @Post(":id/assign")
  async assignTicket(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: AssignTicketBody,
  ): Promise<SupportTicketRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const ref = requireTicketRef(id);
    const assigneeId = requireUuid(
      typeof body?.assigneeId === "string" ? body.assigneeId : undefined,
      "Invalid assigneeId",
    );
    const assigneeName = requireTicketText(
      body?.assigneeName,
      "assigneeName",
      100,
    );
    const note =
      typeof body?.note === "string" && body.note.trim().length > 0
        ? body.note.trim()
        : null;

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");
      const ticketRes = await client.query<{ id: string }>(TICKET_LOCK_SQL, [
        ref,
      ]);
      const ticket = ticketRes.rows[0];
      if (!ticket) {
        throw new NotFoundException("Ticket not found");
      }
      await client.query(TICKET_ASSIGN_UPDATE_SQL, [
        ticket.id,
        assigneeId,
        assigneeName,
      ]);
      await client.query(TICKET_EVENT_INSERT_SQL, [
        ticket.id,
        "assigned",
        actor.id,
        actor.name,
        // 坐席 uuid 不进 payload（见上面那段）：它在 tickets.assignee_id 那一列。
        JSON.stringify({ assignee_name: assigneeName, note }),
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return this.fetchTicketDetail(id);
  }

  // Contract: POST /api/tickets/:id/status
  //   body: { status: 'open'|'pending'|'in_progress'|'resolved'|'closed'|'reopened'|'cancelled',
  //           note?: string }
  //   updates tickets.status + derived timestamps:
  //     first_response_at = coalesce(existing, now()) when status enters
  //       in_progress/pending/resolved/closed;
  //     resolved_at = now() when 'resolved', cleared when reopened/open;
  //     closed_at   = now() when 'closed',   cleared when reopened/open.
  //   appends ticket_comments (event_type='status_changed', payload={from,to,note}).
  //   Transactional. response: SupportTicketRecord (refreshed).  404 if ticket not found.
  //
  // status='closed' **转交 closeTicket**（必填 reason、终态 409），见那个方法的头注。
  // note 写进 status_changed 的 payload，而 status_changed 是**客户看得见**的事件类型
  // ⇒ 这句话客户读得到。内部原因写 `POST :id/notes`（internal_note）。
  @Post(":id/status")
  async changeTicketStatus(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ChangeTicketStatusBody,
  ): Promise<SupportTicketRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const ref = requireTicketRef(id);
    const status =
      typeof body?.status === "string" &&
      WRITABLE_TICKET_STATUSES.has(body.status)
        ? body.status
        : (() => {
            throw new BadRequestException(
              "status must be one of open/pending/in_progress/resolved/closed/reopened/cancelled",
            );
          })();
    const note =
      typeof body?.note === "string" && body.note.trim().length > 0
        ? body.note.trim()
        : null;

    // 「关闭」只有一套规则（必填原因、终态不可重复关闭），而规则长在两处的下场是
    // 后面那处永远被前面那处绕过。所以这个通用端点收到 'closed' 时不自己处理，
    // 转交 closeTicket——入口两个，判据一个。
    if (status === "closed") {
      return this.closeTicket(req, id, note);
    }

    /* commit 成功之后才发通知，所以这里先把通知要的三样存下来（租户、可视工单码、这一行流水
       的时刻）：commit 之后作用域里就只剩 `ref`，而 ref 可能是 uuid。 */
    let notice: { target: TicketNotifyTarget; at: Date | null } | null = null;
    const client = await this.rwPool.connect();
    try {
      await client.query("begin");
      const ticketRes = await client.query<TicketLockRow>(
        TICKET_LOCK_STATUS_SQL,
        [ref],
      );
      const ticket = ticketRes.rows[0];
      if (!ticket) {
        throw new NotFoundException("Ticket not found");
      }
      await client.query(TICKET_STATUS_UPDATE_SQL, [ticket.id, status]);
      const event = await client.query<{ created_at: Date | string | null }>(
        TICKET_EVENT_INSERT_SQL,
        [
          ticket.id,
          "status_changed",
          actor.id,
          actor.name,
          JSON.stringify({ from: ticket.status, to: status, note }),
        ],
      );
      await client.query("commit");
      /* 七个状态里只有 `resolved` 有模板，其余四个（open / pending / in_progress /
         reopened）一条都不发 —— 客户在那几档上没有任何下一步，理由逐条写在
         dispatch/templates.ts 的工单那一段。`closed` 走上面那条转交，不在这里。
         判据写成一次显式比较，不查一张「状态 → 模板」的表：今天只有一档，多一张表就是
         多一处会漂的映射。 */
      if (status === "resolved") {
        notice = {
          target: notifyTargetOfRow(ticket),
          at: eventMoment(event.rows[0]?.created_at),
        };
      }
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    if (notice) {
      const pending = notice;
      await this.notifyTicketEvent("ticket.resolved", async () => pending);
    }
    return this.fetchTicketDetail(id);
  }

  /**
   * Contract: POST /api/tickets/:id/close
   *   body: { reason: string }   —— 必填，**客户看得见**（见下）。
   *   response: SupportTicketRecord（刷新后）。404 无此单；409 已是终态。
   *
   * ── resolved 与 closed 今天各是什么意思 ──
   * 七个状态里这两个最容易被当成同一件事的两档，实际是两个轴：
   *   · `resolved` 是**对答案的判断**：我方认为问题已解决，落 `resolved_at`。
   *     它是**可逆**的——`reopened` 会把 resolved_at 与 closed_at 一起清掉。
   *     客户回来说「没好」，单子继续。
   *   · `closed` 是**对工作的裁定**：这张单不再处理了，落 `closed_at`，终态。
   * 所以不要求「必须先 resolved 再 closed」：那会把一个判断硬塞成另一个判断的
   * 前置。运营在电话里当场答完就关掉，是真实发生的事，逼他先点一次「已解决」
   * 只会让「已解决」这个词失去含义。**全新的单可以直接关**，代价由必填原因承担。
   *
   * ── 转移规则只卡关闭这一件事，不顺手建状态机 ──
   * 已经 `closed` → 409：再关一次会覆盖 closed_at、并在时间线上追加第二条
   * 「关闭」，那是一条骗人的记录（看起来关了两次）。
   * 已经 `cancelled` → 409：撤单与关单是两个不同的终态，把撤掉的单标成「已关闭」
   * 会声称我们处理过它。其余五个状态都可以进 closed。
   * **重开仍然走通用的 `:id/status`（status='reopened'），本端点不管重开**：
   * 客户回头找上来时必须能接着同一张单谈，另开一张会把历史断掉；权限与关闭同一
   * 道（platform.tenant.manage），也就是只有运营能重开。谁能重开如果要收得更紧，
   * 那是一次独立的权限裁定，不该由「加个关闭端点」顺手带出来。
   *
   * ── reason 是给客户看的 ──
   * 它写进 `status_changed` 的 payload.note，而 `status_changed` 在
   * CUSTOMER_VISIBLE_TICKET_EVENT_TYPES 里 ⇒ **客户读得到这句话**。
   * 内部原因不要写在这里，写在 `POST :id/notes`（internal_note，客户看不见）。
   */
  @Post(":id/close")
  async closeTicketEndpoint(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: CloseTicketBody,
  ): Promise<SupportTicketRecord> {
    const reason =
      typeof body?.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : null;
    return this.closeTicket(req, id, reason);
  }

  /** 关闭的唯一实现。`:id/close` 与 `:id/status`(closed) 都落到这里。 */
  private async closeTicket(
    req: Request & RequestContext,
    id: string,
    reason: string | null,
  ): Promise<SupportTicketRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const ref = requireTicketRef(id);
    if (!reason) {
      throw new BadRequestException("reason is required to close a ticket");
    }
    if (reason.length > 1000) {
      throw new BadRequestException("reason exceeds 1000 characters");
    }

    /* `withTransaction` 返回即已 commit（它自己在回调抛出时 rollback 并重抛），所以把通知
       要的三样从事务里带出来，在外面发。**不在事务里发**：通知失败不该回滚一次已经做成的关闭，
       而通知成功也不该被随后的回滚变成一句假话。 */
    const notice = await withTransaction(
      this.rwPool,
      async (client: PoolClient) => {
        const ticketRes = await client.query<TicketLockRow>(
          TICKET_LOCK_STATUS_SQL,
          [ref],
        );
        const ticket = ticketRes.rows[0];
        if (!ticket) {
          throw new NotFoundException("Ticket not found");
        }
        if (ticket.status === "closed") {
          throw new ConflictException("Ticket is already closed");
        }
        if (ticket.status === "cancelled") {
          throw new ConflictException(
            "Ticket was cancelled; a cancelled ticket cannot be closed",
          );
        }
        await client.query(TICKET_STATUS_UPDATE_SQL, [ticket.id, "closed"]);
        const event = await client.query<{ created_at: Date | string | null }>(
          TICKET_EVENT_INSERT_SQL,
          [
            ticket.id,
            "status_changed",
            actor.id,
            actor.name,
            JSON.stringify({ from: ticket.status, to: "closed", note: reason }),
          ],
        );
        await insertOperatorAuditLog(client, req, {
          action: "ticket.close",
          resourceType: "support_ticket",
          resourceId: ref,
          before: { status: ticket.status },
          after: { status: "closed", reason },
        });
        return {
          target: notifyTargetOfRow(ticket),
          at: eventMoment(event.rows[0]?.created_at),
        };
      },
    );
    /* 关闭原因 `reason` **不进通知**：它已经写在 `status_changed` 的 payload 里，而那个词是
       客户看得见的 ⇒ 工单详情页上就有这句话。通知里再存一份就是同一段话的第二个副本。 */
    await this.notifyTicketEvent("ticket.closed", async () => notice);
    return this.fetchTicketDetail(id);
  }

  /**
   * 客户通知（工单线批 2，owner 裁决 6：通知走现有消息中心，点开跳转到工单详情页）。
   *
   * ── 永不抛 ──
   * 三处调用点都在**写入已提交之后**，所以这里出的任何岔子都只该是一行日志：运营刚按下的
   * 那个「回复 / 标记处理完成 / 关闭」已经做成了，让一条通知把它变成 500 是本末倒置
   * （与 SubscriptionService 的 `emit`、tenants.router 的 `notifyVerificationReviewed`
   * 同一条纪律）。解析收件对象那一步（要查一次库）也在 try 里面，理由同上。
   *
   * ── 三样缺一就不发，而且要留下日志 ──
   * 租户、可视工单码、事件时刻。缺任何一样时**不凑**：
   *   · 没有可视工单码 —— 那就只剩 uuid 可写，而 `reference_id` 被客户收件箱的读路径原样
   *     投影给浏览器。宁可不发，也不让一个 uuid 过客户端那条线。
   *   · 没有时刻 —— 锚就只到工单这一层，第二条回复起会被收件箱那个唯一键静默压掉，
   *     而那种压掉没有任何症状。
   * 所以缺就跳过并记一行 —— **不是静默 return**：一条发不出去的通知必须留下痕迹，否则
   * 「客户没收到」这件事在库里、日志里、屏幕上三处都看不出来。
   *
   * ── 收件人 ──
   * 报单账号（有的话）+ 租户 owner（分发器恒定追加）。工单的可见范围是**租户级**
   * （owner 第 1 条裁决），所以 owner 那一半不是多余的；而报单人必须在里面——他才是在等
   * 这句回复的那个人，而 `support.tickets.account_id` 可以是 NULL（运营代客建单时电话里
   * 那个人未必有账号，见 `createTicket` 头注），NULL 时就只剩 owner。
   */
  private async notifyTicketEvent(
    code: TicketTemplateCode,
    resolve: () => Promise<{
      target: TicketNotifyTarget | null;
      at: Date | null;
    }>,
  ): Promise<void> {
    try {
      const { target, at } = await resolve();
      const ticketNo = target?.ticketNo ?? null;
      if (!target?.tenantId || !ticketNo || !at) {
        this.logger.warn(
          `${code}: customer notice skipped — ticket=${ticketNo ?? "?"} ` +
            `tenant=${target?.tenantId ? "ok" : "missing"} at=${at ? "ok" : "missing"}`,
        );
        return;
      }
      await this.notifier.notify({
        tenantId: target.tenantId,
        templateCode: code,
        /* 去重锚由 @vxture/service-notification 的 `ticketEventReference` 产出，本文件不自己
           拼：锚少了时刻，第二条回复起全被收件箱唯一键压掉，而形状写在文档里让调用方各自拼
           就是几份会漂的副本（那是 `securityEventStamp` 立下的规矩，理由一字不差）。 */
        reference: ticketEventReference(code, ticketNo, at),
        /* 参数只有可视码。回复正文 / 处理说明 / 关闭原因一个字都不传——内容只在工单详情页
           留一份，而通知这一层看不见 `event_type`，分辨不出手上那段话给谁看。 */
        params: { ticketNo },
        ...(target.accountId ? { recipients: [target.accountId] } : {}),
        /* console 内的相对路径（分发器给邮件那一半补绝对前缀）。地址栏走可视码。 */
        link: `/tickets/${encodeURIComponent(ticketNo)}`,
      });
    } catch (error) {
      this.logger.warn(`${code}: customer notice failed — ${String(error)}`);
    }
  }

  /**
   * 通知的收件对象（租户 / 报单账号 / 可视工单码），按工单 uuid 查。时刻不在这里——它来自
   * 那一行流水自己的 `created_at`（见三处调用点）。
   *
   * 只有回复那条路径需要它：`insert…select` 的 `returning` 在 pg 里只拿得到被插入表自己的
   * 列，所以那条语句带不回 `tickets.tenant_id`。状态变更两条路径在事务里已经锁了工单行，
   * 直接从那一行取（`notifyTargetOfRow`），不多查一次。
   *
   * **走写池（主库）而不是 `this.pool`**：只读池可能指向 `REPORTING_RO_DATABASE_URL`
   * （见 pools.module.ts），而运营刚建完单立刻回复是真实会发生的顺序——从带延迟的副本上查，
   * 那张单可能还不在，于是通知被跳过。这是一次按主键的点查，落在主库上没有代价。
   */
  private async notifyTargetOf(
    ticketId: string,
  ): Promise<TicketNotifyTarget | null> {
    const { rows } = await this.rwPool.query<TicketLockRow>(
      TICKET_NOTIFY_TARGET_SQL,
      [ticketId],
    );
    const row = rows[0];
    return row ? notifyTargetOfRow(row) : null;
  }

  private async fetchTicketDetail(id: string): Promise<SupportTicketRecord> {
    const ref = requireTicketRef(id);
    const { rows } = await this.pool.query<SupportTicketRow>(
      SUPPORT_TICKET_DETAIL_SQL,
      [ref],
    );
    if (!rows[0]) {
      throw new NotFoundException("Ticket not found");
    }
    return mapSupportTicketRow(rows[0]);
  }
}

function assertCanManageTickets(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (
    !req.capabilities ||
    !req.capabilities.includes("platform.tenant.manage")
  ) {
    throw new ForbiddenException("Missing platform.tenant.manage capability");
  }
}

function normalizeTicketStatus(
  status: string,
): TenantOperationTicket["status"] {
  if (status === "open" || status === "new") return "open";
  if (
    status === "processing" ||
    status === "in_progress" ||
    status === "pending"
  )
    return "processing";
  if (status === "blocked" || status === "waiting") return "blocked";
  return "closed";
}

function normalizeTicketPriority(
  priority: string,
): TenantOperationTicket["priority"] {
  if (priority === "p0" || priority === "urgent" || priority === "critical")
    return "p0";
  if (priority === "p1" || priority === "high") return "p1";
  if (priority === "p3" || priority === "low") return "p3";
  return "p2";
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapSupportTicketRow(row: SupportTicketRow): SupportTicketRecord {
  return {
    id: row.ticket_no ?? row.id,
    title: row.title,
    status: normalizeTicketStatus(row.status),
    priority: normalizeTicketPriority(row.priority),
    updatedAt: toIso(row.updated_at),
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.display_name ?? row.tenant_name,
    tenantType: row.tenant_type === "individual" ? "individual" : "company",
    tenantStatus: row.tenant_status,
    tenantRiskLevel:
      row.risk_level === "high"
        ? "high"
        : row.risk_level === "follow_up" || row.risk_level === "medium"
          ? "follow_up"
          : "normal",
    region: [row.province, row.city].filter(Boolean).join(" / ") || "未设置",
    // 所属行业:console 存的是 core-utils 清单码,这里翻成中文标签;历史自由文本原样显示
    industry: row.industry ? industryLabel(row.industry) : "未设置",
    ownerName: row.owner_name ?? "未设置",
  };
}

// 18-schema remap（cutover 后）：support.ticket→support.tickets、tenant.tenant→tenancy.tenants，
// 展示字段迁 tenancy.tenant_profiles。退役 tenant.tenant_setting（原供 risk_level）无后继 → 默认 'normal'
// （见 docs/product/platform/admin/admin-app-completion-plan.md Q3）。tenant_type 值 personal/organization
// 归一到前端口径 individual/company。新库无 province/city → region 走空态兜底。
const SUPPORT_TICKET_SQL = `
select
  ticket.id,
  ticket.ticket_no,
  ticket.title,
  ticket.status,
  ticket.priority,
  ticket.updated_at,
  tenant.id as tenant_id,
  tenant.tenant_no::text as tenant_code,
  tenant.name as tenant_name,
  tenant.name as display_name,
  case when tenant.type = 'personal' then 'individual' else 'company' end as tenant_type,
  tenant.status as tenant_status,
  'normal'::text as risk_level,
  null::text as province,
  null::text as city,
  profile.industry,
  coalesce(ticket.assignee_name, ticket.reporter_name, pc.name) as owner_name
from support.tickets ticket
join tenancy.tenants tenant on tenant.id = ticket.tenant_id
left join tenancy.tenant_profiles profile on profile.tenant_id = tenant.id
left join lateral (
  select c.name
  from tenancy.tenant_contacts c
  where c.tenant_id = tenant.id and c.contact_type = 'primary'
  order by c.created_at asc
  limit 1
) pc on true
where ticket.deleted_at is null
order by
  case ticket.priority
    when 'p0' then 0
    when 'urgent' then 0
    when 'critical' then 0
    when 'p1' then 1
    when 'high' then 1
    when 'p2' then 2
    when 'medium' then 2
    else 3
  end,
  ticket.updated_at desc
`;

interface SupportTicketRow {
  id: string;
  ticket_no: string | null;
  title: string;
  status: string;
  priority: string;
  updated_at: Date | string | null;
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  display_name: string | null;
  tenant_type: "company" | "individual";
  tenant_status: SupportTicketRecord["tenantStatus"];
  risk_level: string;
  province: string | null;
  city: string | null;
  industry: string | null;
  owner_name: string | null;
}

// ── B8 detail / timeline / write path helpers（追加）──────────────────────

// 复用 list 的列/口径，仅换 where：按 ticket.id(uuid) 或 ticket_no 命中，取 1 行。
const SUPPORT_TICKET_DETAIL_SQL = `
select
  ticket.id,
  ticket.ticket_no,
  ticket.title,
  ticket.status,
  ticket.priority,
  ticket.updated_at,
  tenant.id as tenant_id,
  tenant.tenant_no::text as tenant_code,
  tenant.name as tenant_name,
  tenant.name as display_name,
  case when tenant.type = 'personal' then 'individual' else 'company' end as tenant_type,
  tenant.status as tenant_status,
  'normal'::text as risk_level,
  null::text as province,
  null::text as city,
  profile.industry,
  coalesce(ticket.assignee_name, ticket.reporter_name, pc.name) as owner_name
from support.tickets ticket
join tenancy.tenants tenant on tenant.id = ticket.tenant_id
left join tenancy.tenant_profiles profile on profile.tenant_id = tenant.id
left join lateral (
  select c.name
  from tenancy.tenant_contacts c
  where c.tenant_id = tenant.id and c.contact_type = 'primary'
  order by c.created_at asc
  limit 1
) pc on true
where (ticket.id::text = $1 or ticket.ticket_no = $1)
  and ticket.deleted_at is null
limit 1
`;

// 时间线：升序（append-only 事件流）。
const TICKET_COMMENTS_SQL = `
select
  c.id,
  c.ticket_id,
  c.event_type,
  c.actor_type,
  c.actor_id,
  c.actor_name,
  c.payload,
  c.created_at
from support.ticket_comments c
join support.tickets t on t.id = c.ticket_id
where (t.id::text = $1 or t.ticket_no = $1)
  and t.deleted_at is null
order by c.created_at asc, c.id asc
`;

// append reply：单语句 insert…select 解析工单 id，命中 0 行 → 404（应用层判 rowCount）。
// $5 = event_type，来自 TICKET_EVENT_INTERNAL_NOTE / TICKET_EVENT_REPLY（值域在 @shared，
// 绑参不内联——这条 SQL 里不许出现那两个词的字面量，见 lint:ticket-visibility）。
const TICKET_COMMENT_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload)
select t.id, $5::text, 'operator', $2::uuid, $3, jsonb_build_object('body', $4::text)
from support.tickets t
where (t.id::text = $1 or t.ticket_no = $1)
  and t.deleted_at is null
returning id, ticket_id, event_type, actor_type, actor_id, actor_name, payload, created_at
`;

// 建单：按可视码 tenant_no 解析租户（地址栏/请求体里都不出现 uuid）。
const RESOLVE_TENANT_SQL = `
select id
from tenancy.tenants
where tenant_no = $1::bigint
  and deleted_at is null
limit 1
`;

// 建单：按可视码 user_no 解析报单账号，**且必须是本租户成员**。
// 不过滤 users.status —— 'deleting' 的账号也可能来报单（读路径一律滤 active 会把
// deleting 整批藏掉，那是另一处踩过的坑）；只排除已移除的成员关系与软删账号。
const RESOLVE_TENANT_MEMBER_SQL = `
select u.id, p.display_name
from account.users u
join tenancy.tenant_memberships m
  on m.user_id = u.id
 and m.tenant_id = $2::uuid
 and m.status <> 'removed'
left join account.user_profiles p on p.user_id = u.id
where u.user_no = $1::bigint
  and u.deleted_at is null
limit 1
`;

// 建单插入。id / created_at 走列默认值；status 走 DEFAULT 'open'。
// source 走 $6 绑参而不是写死 'admin'：那个值同时要进审计与建单事件的 payload，
// 写死在 SQL 里就成了两处各存一份，改了一处另一处照旧、且两处都不报错。
// 取值理由见 createTicket 头注。
const TICKET_INSERT_SQL = `
insert into support.tickets
  (tenant_id, account_id, ticket_no, category, priority, source,
   title, description, reporter_name)
values
  ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
`;

// 建单事件：此刻还没有 ticket uuid 在手（id 是列默认值生成的），按 ticket_no 解析。
const TICKET_EVENT_BY_NO_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload)
select t.id, $2::text, 'operator', $3::uuid, $4, $5::jsonb
from support.tickets t
where t.ticket_no = $1
  and t.deleted_at is null
`;

// 事务内锁定工单行（assign）。
const TICKET_LOCK_SQL = `
select id
from support.tickets
where (id::text = $1 or ticket_no = $1)
  and deleted_at is null
for update
`;

// 事务内锁定工单行 + 取旧 status（status change，用于 payload.from）。
// 另取三列给客户通知用：tenant_id（分发器要它）、account_id（报单人，收件人之一，可为 NULL）、
// ticket_no（**可视码**，进文案、进去重锚、进跳转链接——这三处都不许出现 uuid）。
// 在这条已经 `for update` 的查询上多取三列，比 commit 之后再查一次省一趟往返，
// 也免掉「读到的是不是刚写的那一行」这个问题。
const TICKET_LOCK_STATUS_SQL = `
select id, status, tenant_id, account_id, ticket_no
from support.tickets
where (id::text = $1 or ticket_no = $1)
  and deleted_at is null
for update
`;

// 客户通知的收件对象，按工单 uuid 点查。只有回复那条路径用它——理由见 notifyTargetOf。
const TICKET_NOTIFY_TARGET_SQL = `
select id, status, tenant_id, account_id, ticket_no
from support.tickets
where id = $1::uuid
  and deleted_at is null
limit 1
`;

const TICKET_ASSIGN_UPDATE_SQL = `
update support.tickets
set assignee_id = $2::uuid,
    assignee_name = $3,
    updated_at = now()
where id = $1
`;

// 状态迁移 + 派生时间戳。first_response 首触即锁，resolved/closed 按目标态置/清。
// $2 统一 ::text —— 否则 status=$2(varchar) 与 $2='resolved'(text) 令 pg 推不出单一参数类型
// （parse 期 "inconsistent types deduced" 报错，非仅 PREPARE，运行时同样炸）。
const TICKET_STATUS_UPDATE_SQL = `
update support.tickets
set status = $2::text,
    first_response_at = coalesce(
      first_response_at,
      case when $2::text in ('in_progress','pending','resolved','closed') then now() else null end
    ),
    resolved_at = case
      when $2::text = 'resolved' then now()
      when $2::text in ('reopened','open') then null
      else resolved_at
    end,
    closed_at = case
      when $2::text = 'closed' then now()
      when $2::text in ('reopened','open') then null
      else closed_at
    end,
    updated_at = now()
where id = $1
`;

// 事务内事件插入（assigned / status_changed）。$1=ticket uuid（已解析）。
// `returning created_at`：客户通知的去重锚要一个「哪一次」的时刻，而它必须是**这一行流水
// 自己的**那个，不是应用侧另取的 `new Date()`——两处各算一次就有两个时刻，而锚是唯一判据。
const TICKET_EVENT_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload)
values ($1, $2, 'operator', $3::uuid, $4, $5::jsonb)
returning created_at
`;

/**
 * 可写入的状态集。取 @shared 的值域本身（2026-09-21）——这里原先是第三份
 * 手抄的七值（另两份在 admin 的 `TicketStatusInput` 与 DB CHECK）。三份一致是
 * 巧合；现在 `lint:catalog-domains` 逐值对 `chk_tickets_status`，漂不开了。
 */
const WRITABLE_TICKET_STATUSES: ReadonlySet<string> = new Set(TICKET_STATUSES);

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const TICKET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `support.tickets.source` 在运营代录这条路径上的取值。
 * 值域见 chk_tickets_source；为什么是 'admin' 见 createTicket 头注。
 */
const TICKET_SOURCE_OPERATOR_LOGGED = "admin";

/** 可视码：TK-{YYYYMM}-{10 位}。唯一约束 uq_tickets_ticket_no 兜底防重。 */
function ticketCode(): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `TK-${ym}-${suffix}`;
}

/**
 * 主体可视码（tenant_no / user_no）：bigint 列，先用形状挡一道。
 * 非数字串交给 `= $1::bigint` 会在转型时抛 22P02 —— 出去是 500 而不是一句人能看懂的
 * 400（tenants.router 的 resolveTenantId 踩过同一颗雷）。19 位是 bigint 量级上限。
 */
function requirePrincipalNo(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestException(`${field} is required`);
  }
  const text = String(value).trim();
  if (!/^\d{1,19}$/.test(text)) {
    throw new BadRequestException(`${field} must be a visible principal code`);
  }
  return text;
}

/** 可选文本：缺省/空串 → null；给了就按上限校验（与 requireTicketText 同口径）。 */
function optionalTicketText(
  value: unknown,
  field: string,
  maxLen: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) {
    throw new BadRequestException(`${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}

/** 优先级：缺省走列默认 p2；给了就必须在 @shared 的值域里（对账 chk_tickets_priority）。 */
function requireTicketPriority(value: unknown): string {
  if (value === undefined || value === null || value === "") return "p2";
  if (
    typeof value !== "string" ||
    !(TICKET_PRIORITIES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException(
      `priority must be one of ${TICKET_PRIORITIES.join("/")}`,
    );
  }
  return value;
}

interface CreateTicketBody {
  tenantCode?: unknown;
  accountCode?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  priority?: unknown;
  reporterName?: unknown;
}

interface CloseTicketBody {
  reason?: unknown;
}

interface AssignTicketBody {
  assigneeId?: unknown;
  assigneeName?: unknown;
  note?: unknown;
}

interface ChangeTicketStatusBody {
  status?: unknown;
  note?: unknown;
}

/** 事务里锁到的那一行工单（status change / close），以及按 uuid 点查回来的同一形状。 */
interface TicketLockRow {
  id: string;
  status: string;
  tenant_id: string | null;
  account_id: string | null;
  ticket_no: string | null;
}

/**
 * 客户通知的收件对象。**只带 uuid 与可视码各自该在的那一半**：
 * `tenantId` / `accountId` 是分发器内部要的（它按 account_id 落 support.inbox_messages），
 * `ticketNo` 是唯一会上屏、进文案、进去重锚、进链接的那个值。
 */
interface TicketNotifyTarget {
  tenantId: string | null;
  accountId: string | null;
  ticketNo: string | null;
}

function notifyTargetOfRow(row: TicketLockRow): TicketNotifyTarget {
  return {
    tenantId: row.tenant_id,
    accountId: row.account_id,
    ticketNo: row.ticket_no,
  };
}

/**
 * 流水行的 `created_at` → 去重锚要的那个 Date。
 *
 * 认不出来就回 null，**不回落成 `new Date()`**：回落是第二个时刻来源，而这个值的全部用处
 * 就是当「哪一次」的唯一判据。拿不到时上层会跳过通知并记一行日志（见 notifyTicketEvent），
 * 那比发一条锚不可信的通知好——锚错了的症状是第二条回复起被收件箱唯一键静默压掉。
 */
function eventMoment(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

interface TicketCommentRow {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string;
  payload: Record<string, unknown> | null;
  created_at: Date | string | null;
}

interface TicketCommentRecord {
  id: string;
  ticketId: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

function mapTicketCommentRow(row: TicketCommentRow): TicketCommentRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    payload: row.payload ?? {},
    createdAt: toIso(row.created_at),
  };
}

function requireActor(req: Request & RequestContext): {
  id: string;
  name: string;
} {
  const id = req.user?.id;
  if (!id || !TICKET_UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform operator principal");
  }
  const name =
    (req.user?.displayName && req.user.displayName.trim()) ||
    (req.user?.name && req.user.name.trim()) ||
    "operator";
  return { id, name };
}

// :id 是 uuid 或 ticket_no。仅做基本清洗（拒空/过长），SQL 侧参数化按两键匹配。
function requireTicketRef(id: string): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 64) {
    throw new BadRequestException("Invalid ticket id");
  }
  return id.trim();
}

function requireUuid(value: string | undefined, message: string): string {
  if (!value || !TICKET_UUID_RE.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

function requireTicketText(
  value: unknown,
  field: string,
  maxLen: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new BadRequestException(`${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}
