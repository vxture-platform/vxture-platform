/**
 * maintenance-windows.router.ts — 维护窗口读写。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 自 admin-bff 迁入（2026-08-07，批 A）。**行为逐条保持不变**，只换了宿主与主体
 * 类型：能力码仍是 `release:maintenance.read|manage`，状态机仍是
 *   scheduled →(start) in_progress →(complete) completed
 *   scheduled|in_progress →(cancel) cancelled
 * 无删除（表无 deleted_at，终态即归档留存对账）。
 *
 * scheduled 全字段可编；in_progress 仅 end_at 顺延 + description/impact 追记；
 * 终态只读。状态转移走**条件 UPDATE**（0 行 = 404 还是 409 再查一次区分），
 * 写 = 事务 + 事务内审计。锚点列 id / created_by / created_at 永不出现在 SET
 * （deploy/database/ddl/98_column_locks.sql）。
 *
 * 设计权威仍是 docs/product/platform/admin/governance-write-paths.md §3.3/§4。
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import {
  LIST_LIMIT,
  normalizeStringArray,
  optionalText,
  parseIso,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
  toIsoOrNull,
} from "./router.shared";

export interface MaintenanceWindowItem {
  id: string;
  severity: "minor" | "major" | "critical";
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  title: string;
  description: string | null;
  impactDescription: string | null;
  affectedServices: string[];
  startAt: string;
  endAt: string;
  actualEndAt: string | null;
  createdBy: string;
  createdByName: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const WINDOW_SEVERITIES: ReadonlySet<MaintenanceWindowItem["severity"]> =
  new Set(["minor", "major", "critical"]);

const WINDOW_STATUSES: ReadonlySet<MaintenanceWindowItem["status"]> = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

@Controller("api/maintenance-windows")
export class MaintenanceWindowsRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // GET /api/maintenance-windows?status=a,b&from=ISO&to=ISO
  //   from/to 过滤 start_at；取最近 LIST_LIMIT 行。
  @Get()
  async listMaintenanceWindows(
    @Req() req: Request & RequestContext,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<MaintenanceWindowItem[]> {
    assertCanReadMaintenanceWindows(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (status) {
      const statuses = status.split(",").map((v) => v.trim());
      for (const s of statuses) {
        if (!WINDOW_STATUSES.has(s as MaintenanceWindowItem["status"])) {
          throw new BadRequestException(
            "status must be of scheduled/in_progress/completed/cancelled",
          );
        }
      }
      params.push(statuses);
      where.push(`w.status = any($${params.length}::varchar[])`);
    }
    if (from) {
      params.push(parseIso(from, "from"));
      where.push(`w.start_at >= $${params.length}`);
    }
    if (to) {
      params.push(parseIso(to, "to"));
      where.push(`w.start_at <= $${params.length}`);
    }
    params.push(LIST_LIMIT);

    const { rows } = await this.pool.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where ${where.join(" and ")}
       order by w.start_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapMaintenanceWindowRow);
  }

  @Get(":id")
  async getMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    assertCanReadMaintenanceWindows(req);
    const windowId = requireUuid(id, "Invalid maintenance window id");
    const { rows } = await this.pool.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where w.id = $1`,
      [windowId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Maintenance window not found");
    }
    return mapMaintenanceWindowRow(rows[0]);
  }

  // POST /api/maintenance-windows
  //   body: { title(<=256), startAt: ISO, endAt: ISO(> startAt；过去的窗口允许
  //           补录), severity?, description?, impactDescription?,
  //           affectedServices?: string[] }。status 起始 'scheduled'。
  @Post()
  async createMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Body() body: MaintenanceWindowWriteBody,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const createdBy = requireOperatorId(req);
    const input = normalizeMaintenanceWindowInput(body);

    return withTransaction(this.rwPool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        MAINTENANCE_WINDOW_INSERT_SQL,
        [
          input.severity,
          input.title,
          input.description,
          input.impactDescription,
          input.affectedServices,
          input.startAt,
          input.endAt,
          createdBy,
        ],
      );
      const created = rows[0];
      if (!created) {
        throw new BadRequestException(
          "Maintenance window insert returned no row",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.create",
        resourceType: "maintenance_window",
        resourceId: created.id,
        after: {
          title: input.title,
          severity: input.severity,
          startAt: input.startAt,
          endAt: input.endAt,
        },
      });
      return this.fetchMaintenanceWindow(client, created.id);
    });
  }

  // PUT /api/maintenance-windows/:id
  //   scheduled：全字段可编；in_progress：end_at 只可顺延 + 描述追记；终态 409。
  @Put(":id")
  async updateMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: MaintenanceWindowWriteBody,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      const current = await client.query<{
        status: MaintenanceWindowItem["status"];
        start_at: Date;
        end_at: Date;
      }>(
        `select status, start_at, end_at from admin.maintenance_windows
         where id = $1 for update`,
        [windowId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new NotFoundException("Maintenance window not found");
      }

      if (row.status === "scheduled") {
        const input = normalizeMaintenanceWindowInput(body);
        await client.query(MAINTENANCE_WINDOW_FULL_UPDATE_SQL, [
          windowId,
          input.severity,
          input.title,
          input.description,
          input.impactDescription,
          input.affectedServices,
          input.startAt,
          input.endAt,
          updatedBy,
        ]);
      } else if (row.status === "in_progress") {
        const description = optionalText(
          body.description,
          "description",
          10000,
        );
        const impactDescription = optionalText(
          body.impactDescription,
          "impactDescription",
          10000,
        );
        let endAt: string | null = null;
        if (
          body.endAt !== undefined &&
          body.endAt !== null &&
          body.endAt !== ""
        ) {
          endAt = parseIso(body.endAt, "endAt");
          // 只可顺延（设计 §3.3）：进行中的窗口提前结束叫"完成"（记 actual_end_at），
          // 不是把计划结束时间改短。
          if (new Date(endAt) < new Date(row.end_at)) {
            throw new BadRequestException(
              "endAt of an in_progress window can only be extended",
            );
          }
        }
        await client.query(MAINTENANCE_WINDOW_LIVE_UPDATE_SQL, [
          windowId,
          endAt,
          description,
          impactDescription,
          updatedBy,
        ]);
      } else {
        throw new ConflictException(
          "Completed/cancelled maintenance windows are read-only",
        );
      }

      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.update",
        resourceType: "maintenance_window",
        resourceId: windowId,
        before: {
          status: row.status,
          startAt: toIso(row.start_at),
          endAt: toIso(row.end_at),
        },
      });
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  // POST /api/maintenance-windows/:id/start — scheduled → in_progress（手动触发，无调度器）
  @Post(":id/start")
  async startMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    return this.transitionMaintenanceWindow(
      req,
      id,
      "start",
      MAINTENANCE_WINDOW_START_SQL,
      "Only a scheduled window can be started",
    );
  }

  // POST /api/maintenance-windows/:id/complete { actualEndAt?: ISO }
  //   in_progress → completed；actual_end_at 取 body 值或 now()。
  @Post(":id/complete")
  async completeMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body?: { actualEndAt?: unknown },
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "Invalid maintenance window id");
    const actualEndAt =
      body?.actualEndAt === undefined ||
      body.actualEndAt === null ||
      body.actualEndAt === ""
        ? null
        : parseIso(body.actualEndAt, "actualEndAt");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(MAINTENANCE_WINDOW_COMPLETE_SQL, [
        windowId,
        actualEndAt,
        updatedBy,
      ]);
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(
          client,
          windowId,
          "Only an in_progress window can be completed",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.complete",
        resourceType: "maintenance_window",
        resourceId: windowId,
        after: { actualEndAt },
      });
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  // POST /api/maintenance-windows/:id/cancel — scheduled|in_progress → cancelled
  //   （取消一个进行中的窗口会记 actual_end_at）。
  @Post(":id/cancel")
  async cancelMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    return this.transitionMaintenanceWindow(
      req,
      id,
      "cancel",
      MAINTENANCE_WINDOW_CANCEL_SQL,
      "Maintenance window is already terminal",
    );
  }

  private async transitionMaintenanceWindow(
    req: Request & RequestContext,
    id: string,
    verb: "start" | "cancel",
    sql: string,
    conflictMessage: string,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(sql, [windowId, updatedBy]);
      if (rowCount === 0) {
        await this.throwNotFoundOrConflict(client, windowId, conflictMessage);
      }
      await insertOperatorAuditLog(client, req, {
        action: `governance.maintenance.${verb}`,
        resourceType: "maintenance_window",
        resourceId: windowId,
      });
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  /** 条件 UPDATE 影响 0 行有两种可能：行不存在（404），或状态不允许（409）。 */
  private async throwNotFoundOrConflict(
    db: Pick<Pool, "query">,
    windowId: string,
    conflictMessage: string,
  ): Promise<never> {
    const { rowCount } = await db.query(
      `select 1 from admin.maintenance_windows where id = $1`,
      [windowId],
    );
    if (rowCount === 0) {
      throw new NotFoundException("Maintenance window not found");
    }
    throw new ConflictException(conflictMessage);
  }

  private async fetchMaintenanceWindow(
    db: Pick<Pool, "query">,
    id: string,
  ): Promise<MaintenanceWindowItem> {
    const { rows } = await db.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where w.id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException("Maintenance window not found");
    }
    return mapMaintenanceWindowRow(rows[0]);
  }
}

const MAINTENANCE_WINDOW_SELECT = `
select
  w.id,
  w.severity,
  w.status,
  w.title,
  w.description,
  w.impact_description,
  w.affected_services,
  w.start_at,
  w.end_at,
  w.actual_end_at,
  w.created_by,
  coalesce(nullif(o.display_name, ''), o.username) as created_by_name,
  w.updated_by,
  w.created_at,
  w.updated_at
from admin.maintenance_windows w
left join admin.operator_account o on o.id = w.created_by
`;

const MAINTENANCE_WINDOW_INSERT_SQL = `
insert into admin.maintenance_windows
  (severity, status, title, description, impact_description,
   affected_services, start_at, end_at, created_by)
values
  ($1, 'scheduled', $2, $3, $4, $5::varchar[], $6, $7, $8)
returning id
`;

// scheduled only —— 锚点列（id/created_by/created_at）永不进 SET。
const MAINTENANCE_WINDOW_FULL_UPDATE_SQL = `
update admin.maintenance_windows
set severity           = $2,
    title              = $3,
    description        = $4,
    impact_description = $5,
    affected_services  = $6::varchar[],
    start_at           = $7,
    end_at             = $8,
    updated_by         = $9,
    updated_at         = now()
where id = $1 and status = 'scheduled'
`;

// in_progress 实时更新：顺延 end_at（$2 为 null 则保持）+ 描述追记。
const MAINTENANCE_WINDOW_LIVE_UPDATE_SQL = `
update admin.maintenance_windows
set end_at             = coalesce($2, end_at),
    description        = coalesce($3, description),
    impact_description = coalesce($4, impact_description),
    updated_by         = $5,
    updated_at         = now()
where id = $1 and status = 'in_progress'
`;

const MAINTENANCE_WINDOW_START_SQL = `
update admin.maintenance_windows
set status = 'in_progress', updated_by = $2, updated_at = now()
where id = $1 and status = 'scheduled'
`;

const MAINTENANCE_WINDOW_COMPLETE_SQL = `
update admin.maintenance_windows
set status = 'completed',
    actual_end_at = coalesce($2, now()),
    updated_by = $3,
    updated_at = now()
where id = $1 and status = 'in_progress'
`;

const MAINTENANCE_WINDOW_CANCEL_SQL = `
update admin.maintenance_windows
set actual_end_at = case when status = 'in_progress' then now() else actual_end_at end,
    status = 'cancelled',
    updated_by = $2,
    updated_at = now()
where id = $1 and status in ('scheduled', 'in_progress')
`;

interface MaintenanceWindowRow {
  id: string;
  severity: MaintenanceWindowItem["severity"];
  status: MaintenanceWindowItem["status"];
  title: string;
  description: string | null;
  impact_description: string | null;
  affected_services: string[] | null;
  start_at: Date | string;
  end_at: Date | string;
  actual_end_at: Date | string | null;
  created_by: string;
  created_by_name: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MaintenanceWindowWriteBody {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  impactDescription?: unknown;
  affectedServices?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}

interface NormalizedMaintenanceWindowInput {
  severity: MaintenanceWindowItem["severity"];
  title: string;
  description: string | null;
  impactDescription: string | null;
  affectedServices: string[];
  startAt: string;
  endAt: string;
}

function mapMaintenanceWindowRow(
  row: MaintenanceWindowRow,
): MaintenanceWindowItem {
  return {
    id: row.id,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    impactDescription: row.impact_description,
    affectedServices: row.affected_services ?? [],
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    actualEndAt: toIsoOrNull(row.actual_end_at),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function normalizeMaintenanceWindowInput(
  body: MaintenanceWindowWriteBody,
): NormalizedMaintenanceWindowInput {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  if (
    body.severity !== undefined &&
    body.severity !== null &&
    !(
      typeof body.severity === "string" &&
      WINDOW_SEVERITIES.has(body.severity as MaintenanceWindowItem["severity"])
    )
  ) {
    throw new BadRequestException(
      "severity must be one of minor/major/critical",
    );
  }
  const severity =
    body.severity === undefined || body.severity === null
      ? "minor"
      : (body.severity as MaintenanceWindowItem["severity"]);

  const startAt = parseIso(body.startAt, "startAt");
  const endAt = parseIso(body.endAt, "endAt");
  if (new Date(endAt) <= new Date(startAt)) {
    throw new BadRequestException("endAt must be after startAt");
  }
  return {
    severity,
    title: requireText(body.title, "title", 256),
    description: optionalText(body.description, "description", 10000),
    impactDescription: optionalText(
      body.impactDescription,
      "impactDescription",
      10000,
    ),
    affectedServices: normalizeStringArray(
      body.affectedServices,
      "affectedServices",
    ),
    startAt,
    endAt,
  };
}

// ── 能力门（能力码沿用既有 release:maintenance.*，迁移不改）──────────────

function assertCanReadMaintenanceWindows(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("release:maintenance.read") &&
      !req.capabilities.includes("release:maintenance.manage"))
  ) {
    throw new ForbiddenException("Missing release:maintenance.read capability");
  }
}

function assertCanManageMaintenanceWindows(
  req: Request & RequestContext,
): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (
    !req.capabilities ||
    !req.capabilities.includes("release:maintenance.manage")
  ) {
    throw new ForbiddenException(
      "Missing release:maintenance.manage capability",
    );
  }
}
