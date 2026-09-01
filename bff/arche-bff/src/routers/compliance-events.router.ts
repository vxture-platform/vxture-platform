/**
 * compliance-events.router.ts - 合规事件路由
 * @package @vxture/bff-arche
 *
 * Description: admin.compliance_events 读写（TD-021）。设计权威 =
 *   docs/product/platform/admin/governance-write-paths.md §3.2/§4。
 *   状态机 open→(assign)in_review→resolved / open|in_review→dismissed，
 *   终态不可重开；转移全部走条件 UPDATE（合法前态进 WHERE，0 行 = 409），
 *   不做 read-then-write（TD-019 教训）。所有写 = 事务 + 事务内审计。
 *
 * @author AI-Generated
 * @date 2026-07-05
 * @version 1.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { withTransaction } from "../db/tx";
import { ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import type { ComplianceEventItem } from "../types/governance.types";
import {
  GOVERNANCE_LIST_LIMIT,
  normalizeStringArray,
  optionalText,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
} from "./governance.shared";

const EVENT_STATUSES: ReadonlySet<ComplianceEventItem["status"]> = new Set([
  "open",
  "in_review",
  "resolved",
  "dismissed",
]);

/** Serialized detail jsonb cap（design §4.2）。 */
const DETAIL_MAX_BYTES = 16 * 1024;

@Controller("api/compliance-events")
export class ComplianceEventsRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // Contract: GET /api/compliance-events?status=a,b&tenantId=&eventType=&tag=
  //   Most-recent GOVERNANCE_LIST_LIMIT non-deleted rows, filtered server-side.
  @Get()
  async listComplianceEvents(
    @Req() req: Request & RequestContext,
    @Query("status") status?: string,
    @Query("tenantId") tenantId?: string,
    @Query("eventType") eventType?: string,
    @Query("tag") tag?: string,
  ): Promise<ComplianceEventItem[]> {
    assertCanReadComplianceEvents(req);

    const where: string[] = ["e.deleted_at is null"];
    const params: unknown[] = [];
    if (status) {
      const statuses = status.split(",").map((v) => v.trim());
      for (const s of statuses) {
        if (!EVENT_STATUSES.has(s as ComplianceEventItem["status"])) {
          throw new BadRequestException(
            "status must be of open/in_review/resolved/dismissed",
          );
        }
      }
      params.push(statuses);
      where.push(`e.status = any($${params.length}::varchar[])`);
    }
    if (tenantId) {
      params.push(requireUuid(tenantId, "Invalid tenantId filter"));
      where.push(`e.tenant_id = $${params.length}`);
    }
    if (eventType) {
      params.push(eventType.trim());
      where.push(`e.event_type = $${params.length}`);
    }
    if (tag) {
      params.push(tag.trim());
      where.push(`$${params.length} = any(e.tags)`);
    }
    params.push(GOVERNANCE_LIST_LIMIT);

    const { rows } = await this.pool.query<ComplianceEventRow>(
      `${COMPLIANCE_EVENT_SELECT} where ${where.join(" and ")}
       order by e.created_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapComplianceEventRow);
  }

  @Get(":id")
  async getComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ComplianceEventItem> {
    assertCanReadComplianceEvents(req);
    const eventId = requireUuid(id, "Invalid compliance event id");
    const { rows } = await this.pool.query<ComplianceEventRow>(
      `${COMPLIANCE_EVENT_SELECT} where e.id = $1 and e.deleted_at is null`,
      [eventId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Compliance event not found");
    }
    return mapComplianceEventRow(rows[0]);
  }

  // Contract: POST /api/compliance-events
  //   body: { eventType: string(<=64), tenantId?: uuid|null (null = platform-level),
  //           regulationCode?, evidenceUrl? (http/https only), detail?: object,
  //           tags?: string[] }. status starts 'open'.
  @Post()
  async createComplianceEvent(
    @Req() req: Request & RequestContext,
    @Body() body: ComplianceEventWriteBody,
  ): Promise<ComplianceEventItem> {
    assertCanManageComplianceEvents(req);
    requireOperatorId(req);
    const input = normalizeComplianceEventInput(body);

    return withTransaction(this.rwPool, async (client) => {
      if (input.tenantId) {
        // Row existence only (incl. soft-deleted) — governance records outlive
        // tenant closure (boundary #3).
        const tenant = await client.query(
          `select 1 from tenancy.tenants where id = $1`,
          [input.tenantId],
        );
        if (tenant.rowCount === 0) {
          throw new BadRequestException("tenantId does not reference a tenant");
        }
      }
      const { rows } = await client.query<{ id: string }>(
        COMPLIANCE_EVENT_INSERT_SQL,
        [
          input.tenantId,
          input.eventType,
          input.regulationCode,
          input.evidenceUrl,
          input.detail,
          input.tags,
        ],
      );
      const created = rows[0];
      if (!created) {
        throw new BadRequestException(
          "Compliance event insert returned no row",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.compliance.create",
        resourceType: "compliance_event",
        resourceId: created.id,
        after: { tenantId: input.tenantId, eventType: input.eventType },
      });
      return this.fetchComplianceEvent(client, created.id);
    });
  }

  // Contract: PUT /api/compliance-events/:id — editable while non-terminal only.
  //   body: same fields as POST（tenantId 可改，含改为 null=平台级）。
  @Put(":id")
  async updateComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ComplianceEventWriteBody,
  ): Promise<ComplianceEventItem> {
    assertCanManageComplianceEvents(req);
    requireOperatorId(req);
    const eventId = requireUuid(id, "Invalid compliance event id");
    const input = normalizeComplianceEventInput(body);

    return withTransaction(this.rwPool, async (client) => {
      if (input.tenantId) {
        const tenant = await client.query(
          `select 1 from tenancy.tenants where id = $1`,
          [input.tenantId],
        );
        if (tenant.rowCount === 0) {
          throw new BadRequestException("tenantId does not reference a tenant");
        }
      }
      const { rowCount } = await client.query(COMPLIANCE_EVENT_UPDATE_SQL, [
        eventId,
        input.tenantId,
        input.eventType,
        input.regulationCode,
        input.evidenceUrl,
        input.detail,
        input.tags,
      ]);
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(
          client,
          eventId,
          "Compliance event is terminal and read-only",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.compliance.update",
        resourceType: "compliance_event",
        resourceId: eventId,
        after: { eventType: input.eventType, tenantId: input.tenantId },
      });
      return this.fetchComplianceEvent(client, eventId);
    });
  }

  // Contract: POST /api/compliance-events/:id/assign { handlerId: uuid }
  //   handler must be an active operator; open → in_review (re-assign while
  //   in_review keeps the status).
  @Post(":id/assign")
  async assignComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { handlerId?: unknown },
  ): Promise<ComplianceEventItem> {
    assertCanManageComplianceEvents(req);
    requireOperatorId(req);
    const eventId = requireUuid(id, "Invalid compliance event id");
    const handlerId = requireUuid(
      typeof body?.handlerId === "string" ? body.handlerId : undefined,
      "handlerId is required (uuid)",
    );

    return withTransaction(this.rwPool, async (client) => {
      const handler = await client.query(
        `select 1 from admin.operator_account
         where id = $1 and status = 'active' and deleted_at is null`,
        [handlerId],
      );
      if (handler.rowCount === 0) {
        throw new BadRequestException(
          "handlerId does not reference an active operator",
        );
      }
      const { rowCount } = await client.query(COMPLIANCE_EVENT_ASSIGN_SQL, [
        eventId,
        handlerId,
      ]);
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(
          client,
          eventId,
          "Compliance event is terminal — cannot assign",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.compliance.assign",
        resourceType: "compliance_event",
        resourceId: eventId,
        after: { handlerId },
      });
      return this.fetchComplianceEvent(client, eventId);
    });
  }

  // Contract: POST /api/compliance-events/:id/resolve — in_review + handler set only.
  @Post(":id/resolve")
  async resolveComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ComplianceEventItem> {
    return this.transitionComplianceEvent(
      req,
      id,
      "resolved",
      COMPLIANCE_EVENT_RESOLVE_SQL,
      "Only an in_review event with a handler can be resolved",
    );
  }

  // Contract: POST /api/compliance-events/:id/dismiss — open|in_review only.
  @Post(":id/dismiss")
  async dismissComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ComplianceEventItem> {
    return this.transitionComplianceEvent(
      req,
      id,
      "dismissed",
      COMPLIANCE_EVENT_DISMISS_SQL,
      "Compliance event is already terminal",
    );
  }

  // Contract: DELETE /api/compliance-events/:id → soft delete, terminal rows only
  //   (open/in_review must be resolved/dismissed first — delete is not a third
  //   way to close an event; design §3.2).
  @Delete(":id")
  async deleteComplianceEvent(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; status: "deleted" }> {
    assertCanManageComplianceEvents(req);
    requireOperatorId(req);
    const eventId = requireUuid(id, "Invalid compliance event id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(
        `update admin.compliance_events
         set deleted_at = now(), updated_at = now()
         where id = $1 and deleted_at is null
           and status in ('resolved', 'dismissed')`,
        [eventId],
      );
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(
          client,
          eventId,
          "Only resolved/dismissed events can be deleted",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.compliance.delete",
        resourceType: "compliance_event",
        resourceId: eventId,
      });
      return { id: eventId, status: "deleted" as const };
    });
  }

  private async transitionComplianceEvent(
    req: Request & RequestContext,
    id: string,
    target: "resolved" | "dismissed",
    sql: string,
    conflictMessage: string,
  ): Promise<ComplianceEventItem> {
    assertCanManageComplianceEvents(req);
    requireOperatorId(req);
    const eventId = requireUuid(id, "Invalid compliance event id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(sql, [eventId]);
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(client, eventId, conflictMessage);
      }
      await insertOperatorAuditLog(client, req, {
        action: `governance.compliance.${target === "resolved" ? "resolve" : "dismiss"}`,
        resourceType: "compliance_event",
        resourceId: eventId,
        after: { status: target },
      });
      return this.fetchComplianceEvent(client, eventId);
    });
  }

  /** Conditional UPDATE hit 0 rows: 404 if the row is gone, 409 otherwise. */
  private async throwNotFoundOrConflict(
    db: Pick<Pool, "query">,
    eventId: string,
    conflictMessage: string,
  ): Promise<never> {
    const { rowCount } = await db.query(
      `select 1 from admin.compliance_events where id = $1 and deleted_at is null`,
      [eventId],
    );
    if (rowCount === 0) {
      throw new NotFoundException("Compliance event not found");
    }
    throw new ConflictException(conflictMessage);
  }

  private async fetchComplianceEvent(
    db: Pick<Pool, "query">,
    id: string,
  ): Promise<ComplianceEventItem> {
    const { rows } = await db.query<ComplianceEventRow>(
      `${COMPLIANCE_EVENT_SELECT} where e.id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException("Compliance event not found");
    }
    return mapComplianceEventRow(rows[0]);
  }
}

const COMPLIANCE_EVENT_SELECT = `
select
  e.id,
  e.tenant_id,
  t.name as tenant_name,
  e.event_type,
  e.status,
  e.regulation_code,
  e.evidence_url,
  e.handler_id,
  coalesce(nullif(o.display_name, ''), o.username) as handler_name,
  e.detail,
  e.tags,
  e.created_at,
  e.updated_at
from admin.compliance_events e
left join tenancy.tenants t on t.id = e.tenant_id
left join admin.operator_account o on o.id = e.handler_id
`;

const COMPLIANCE_EVENT_INSERT_SQL = `
insert into admin.compliance_events
  (tenant_id, event_type, status, regulation_code, evidence_url, detail, tags)
values
  ($1, $2, 'open', $3, $4, $5::jsonb, $6::text[])
returning id
`;

// Non-terminal rows only（terminal = read-only, GQ4）。
const COMPLIANCE_EVENT_UPDATE_SQL = `
update admin.compliance_events
set tenant_id       = $2,
    event_type      = $3,
    regulation_code = $4,
    evidence_url    = $5,
    detail          = $6::jsonb,
    tags            = $7::text[],
    updated_at      = now()
where id = $1 and deleted_at is null
  and status in ('open', 'in_review')
`;

// open → in_review on first assign; re-assign while in_review keeps status.
const COMPLIANCE_EVENT_ASSIGN_SQL = `
update admin.compliance_events
set handler_id = $2,
    status     = case when status = 'open' then 'in_review' else status end,
    updated_at = now()
where id = $1 and deleted_at is null
  and status in ('open', 'in_review')
`;

const COMPLIANCE_EVENT_RESOLVE_SQL = `
update admin.compliance_events
set status = 'resolved', updated_at = now()
where id = $1 and deleted_at is null
  and status = 'in_review' and handler_id is not null
`;

const COMPLIANCE_EVENT_DISMISS_SQL = `
update admin.compliance_events
set status = 'dismissed', updated_at = now()
where id = $1 and deleted_at is null
  and status in ('open', 'in_review')
`;

interface ComplianceEventRow {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  event_type: string;
  status: ComplianceEventItem["status"];
  regulation_code: string | null;
  evidence_url: string | null;
  handler_id: string | null;
  handler_name: string | null;
  detail: unknown;
  tags: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ComplianceEventWriteBody {
  tenantId?: unknown;
  eventType?: unknown;
  regulationCode?: unknown;
  evidenceUrl?: unknown;
  detail?: unknown;
  tags?: unknown;
}

interface NormalizedComplianceEventInput {
  tenantId: string | null;
  eventType: string;
  regulationCode: string | null;
  evidenceUrl: string | null;
  detail: string | null;
  tags: string[];
}

function mapComplianceEventRow(row: ComplianceEventRow): ComplianceEventItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    eventType: row.event_type,
    status: row.status,
    regulationCode: row.regulation_code,
    evidenceUrl: row.evidence_url,
    handlerId: row.handler_id,
    handlerName: row.handler_name,
    detail: row.detail ?? null,
    tags: row.tags ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function normalizeComplianceEventInput(
  body: ComplianceEventWriteBody,
): NormalizedComplianceEventInput {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const tenantId =
    body.tenantId === undefined ||
    body.tenantId === null ||
    body.tenantId === ""
      ? null
      : requireUuid(
          typeof body.tenantId === "string" ? body.tenantId : undefined,
          "tenantId must be a uuid",
        );
  // evidence_url is rendered as a link — http(s) only（design §4.2 修订 3）。
  let evidenceUrl: string | null = null;
  if (
    body.evidenceUrl !== undefined &&
    body.evidenceUrl !== null &&
    body.evidenceUrl !== ""
  ) {
    const url = requireText(body.evidenceUrl, "evidenceUrl", 2048);
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException("evidenceUrl must be http(s)");
    }
    evidenceUrl = url;
  }
  let detail: string | null = null;
  if (body.detail !== undefined && body.detail !== null) {
    if (typeof body.detail !== "object" || Array.isArray(body.detail)) {
      throw new BadRequestException("detail must be a JSON object");
    }
    const serialized = JSON.stringify(body.detail);
    if (Buffer.byteLength(serialized, "utf8") > DETAIL_MAX_BYTES) {
      throw new BadRequestException("detail exceeds 16KB");
    }
    detail = serialized;
  }
  return {
    tenantId,
    eventType: requireText(body.eventType, "eventType", 64),
    regulationCode: optionalText(body.regulationCode, "regulationCode", 64),
    evidenceUrl,
    detail,
    tags: normalizeStringArray(body.tags, "tags"),
  };
}

// ── capability guards（能力码见 governance-write-paths.md §4.3 / seed-catalog）──

function assertCanReadComplianceEvents(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("compliance:event.read") &&
      !req.capabilities.includes("compliance:event.manage"))
  ) {
    throw new ForbiddenException("Missing compliance:event.read capability");
  }
}

function assertCanManageComplianceEvents(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    !req.capabilities.includes("compliance:event.manage")
  ) {
    throw new ForbiddenException("Missing compliance:event.manage capability");
  }
}
