import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  RequestContext,
  SupportTicketRecord,
  TenantOperationTicket,
} from "../types/console.types";
import { industryLabel } from "@vxture/core-utils";

@Controller("api/tickets")
export class TicketsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
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

  // Contract: POST /api/tickets/:id/comments
  //   body: { body: string }  (the reply text)
  //   appends ticket_comments row: event_type='comment', actor_type='operator',
  //     actor_id = operator, actor_name = operator display name, payload={body}.
  //   response: TicketCommentRecord.  404 if ticket not found.
  @Post(":id/comments")
  async addTicketComment(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { body?: unknown },
  ): Promise<TicketCommentRecord> {
    assertCanManageTickets(req);
    const actor = requireActor(req);
    const ref = requireTicketRef(id);
    const text = requireTicketText(body?.body, "body", 10000);

    const { rows } = await this.rwPool.query<TicketCommentRow>(
      TICKET_COMMENT_INSERT_SQL,
      [ref, actor.id, actor.name, text],
    );
    if (!rows[0]) {
      throw new NotFoundException("Ticket not found");
    }
    return mapTicketCommentRow(rows[0]);
  }

  // Contract: POST /api/tickets/:id/assign
  //   body: { assigneeId: string(uuid), assigneeName: string, note?: string }
  //   updates tickets.assignee_id/assignee_name and appends a ticket_comments row
  //     (event_type='assigned', actor_type='operator', payload={assignee_id,assignee_name,note}).
  //   Transactional. response: SupportTicketRecord (refreshed).  404 if ticket not found.
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
        JSON.stringify({
          assignee_id: assigneeId,
          assignee_name: assigneeName,
          note,
        }),
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
      typeof body?.status === "string" && TICKET_STATUSES.has(body.status)
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

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");
      const ticketRes = await client.query<{ id: string; status: string }>(
        TICKET_LOCK_STATUS_SQL,
        [ref],
      );
      const ticket = ticketRes.rows[0];
      if (!ticket) {
        throw new NotFoundException("Ticket not found");
      }
      await client.query(TICKET_STATUS_UPDATE_SQL, [ticket.id, status]);
      await client.query(TICKET_EVENT_INSERT_SQL, [
        ticket.id,
        "status_changed",
        actor.id,
        actor.name,
        JSON.stringify({ from: ticket.status, to: status, note }),
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
const TICKET_COMMENT_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload)
select t.id, 'comment', 'operator', $2::uuid, $3, jsonb_build_object('body', $4::text)
from support.tickets t
where (t.id::text = $1 or t.ticket_no = $1)
  and t.deleted_at is null
returning id, ticket_id, event_type, actor_type, actor_id, actor_name, payload, created_at
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
const TICKET_LOCK_STATUS_SQL = `
select id, status
from support.tickets
where (id::text = $1 or ticket_no = $1)
  and deleted_at is null
for update
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
const TICKET_EVENT_INSERT_SQL = `
insert into support.ticket_comments
  (ticket_id, event_type, actor_type, actor_id, actor_name, payload)
values ($1, $2, 'operator', $3::uuid, $4, $5::jsonb)
`;

const TICKET_STATUSES: ReadonlySet<string> = new Set([
  "open",
  "pending",
  "in_progress",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
]);

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const TICKET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AssignTicketBody {
  assigneeId?: unknown;
  assigneeName?: unknown;
  note?: unknown;
}

interface ChangeTicketStatusBody {
  status?: unknown;
  note?: unknown;
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
