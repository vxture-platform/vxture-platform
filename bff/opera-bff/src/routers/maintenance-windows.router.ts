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
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { withTransaction } from "../db/tx";
import {
  conflict,
  internalError,
  invalidRequest,
  notEntitled,
  notFound,
  unauthenticated,
} from "../errors/api-error";
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
  /**
   * product_251 B-3：字段名统一叫 `state`。窗口的四态不是「启用/停用」，但 B-3
   * 的下半句同样适用——**一个产品内不得混用多个字段名**：产品目录与 OIDC 客户端
   * 都叫 `state` 了，这里再叫 `status`，运营者面对的仍然是两个词。
   * DB 列 `admin.maintenance_windows.status` 不动，只换接口字段名。
   */
  state: "scheduled" | "in_progress" | "completed" | "cancelled";
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

const WINDOW_STATES: ReadonlySet<MaintenanceWindowItem["state"]> = new Set([
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

  // GET /api/maintenance-windows?state=a,b&from=ISO&to=ISO
  //   from/to 过滤 start_at；取最近 LIST_LIMIT 行。
  @Get()
  async listMaintenanceWindows(
    @Req() req: Request & RequestContext,
    @Query("state") state?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<MaintenanceWindowItem[]> {
    assertCanReadMaintenanceWindows(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (state) {
      const states = state.split(",").map((v) => v.trim());
      for (const s of states) {
        if (!WINDOW_STATES.has(s as MaintenanceWindowItem["state"])) {
          throw invalidRequest(
            "VALIDATION_INVALID_VALUE",
            "state must be of scheduled/in_progress/completed/cancelled",
            "state",
          );
        }
      }
      params.push(states);
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
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");
    const { rows } = await this.pool.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where w.id = $1`,
      [windowId],
    );
    if (!rows[0]) {
      throw notFound(
        "MAINTENANCE_WINDOW_NOT_FOUND",
        "Maintenance window not found",
      );
    }
    return mapMaintenanceWindowRow(rows[0]);
  }

  // POST /api/maintenance-windows
  //   body: { title(<=256), startAt: ISO, endAt: ISO(> startAt；过去的窗口允许
  //           补录), severity?, description?, impactDescription?,
  //           affectedServices?: string[] }。state 起始 'scheduled'。
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
        /* 库没有按要求插进去——这是本方故障。原来这里回 400，运营者会以为是
           自己填错了，然后反复改一个永远改不好的输入。 */
        throw internalError(
          "MAINTENANCE_WINDOW_INSERT_FAILED",
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

  /**
   * PUT /api/maintenance-windows/:id
   *   scheduled：全字段可编（真·全量替换）；in_progress：end_at 只可顺延 + 描述追记；终态 409。
   *
   * **同一个 URL 在两个状态下语义不同**——这是有意的业务规则，不是失误：一个正在跑的
   * 维护窗口，改标题改开始时间没有意义（它已经开始了）。但语义不同必须**说得出来**：
   * 原来 in_progress 分支把 `title`/`severity`/`startAt`/`affectedServices` **静默丢弃**，
   * 返回 200 和一行看起来正常的数据，运营者以为改了。这正是 product_251 P3 说的那类——
   * 「静默地做与请求不同的事，比报错更糟」。
   *
   * 现在的规则（B-1）：**送来的锁定字段与库里不同就拒**，相同则视为无操作放行。
   * 后者不能少——控制台编辑框在 live 模式下是 disabled 而不是不提交，它送的是原值。
   */
  @Put(":id")
  async updateMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: MaintenanceWindowWriteBody,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      const current = await client.query<{
        status: MaintenanceWindowItem["state"];
        severity: MaintenanceWindowItem["severity"];
        title: string;
        affected_services: string[];
        start_at: Date;
        end_at: Date;
      }>(
        `select status, severity, title, affected_services, start_at, end_at
           from admin.maintenance_windows
          where id = $1 for update`,
        [windowId],
      );
      const row = current.rows[0];
      if (!row) {
        throw notFound(
          "MAINTENANCE_WINDOW_NOT_FOUND",
          "Maintenance window not found",
        );
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
        assertLiveEditable(body, row);
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
            throw invalidRequest(
              "MAINTENANCE_WINDOW_END_AT_NOT_EXTENDABLE",
              "endAt of an in_progress window can only be extended",
              "endAt",
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
        throw conflict(
          "MAINTENANCE_WINDOW_READ_ONLY",
          "Completed/cancelled maintenance windows are read-only",
        );
      }

      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.update",
        resourceType: "maintenance_window",
        resourceId: windowId,
        before: {
          state: row.status,
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
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");
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
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");

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
      throw notFound(
        "MAINTENANCE_WINDOW_NOT_FOUND",
        "Maintenance window not found",
      );
    }
    throw conflict("MAINTENANCE_WINDOW_INVALID_TRANSITION", conflictMessage);
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
      throw notFound(
        "MAINTENANCE_WINDOW_NOT_FOUND",
        "Maintenance window not found",
      );
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
  status: MaintenanceWindowItem["state"];
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
    state: row.status,
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

/**
 * in_progress 下哪些字段动不了（product_251 B-1 / P3）。
 *
 * **只拦「要改」，不拦「提到了」**：控制台的编辑框在 live 模式下是 disabled 而不是
 * 不提交，送来的是原值。把「送了原值」也拦掉，等于让人在界面上根本存不了描述。
 */
export function assertLiveEditable(
  body: MaintenanceWindowWriteBody,
  row: {
    severity: MaintenanceWindowItem["severity"];
    title: string;
    affected_services: string[];
    start_at: Date;
  },
): void {
  const locked: string[] = [];

  if (typeof body.title === "string" && body.title.trim() !== row.title) {
    locked.push("title");
  }
  if (
    body.severity !== undefined &&
    body.severity !== null &&
    body.severity !== row.severity
  ) {
    locked.push("severity");
  }
  if (body.startAt !== undefined && body.startAt !== null) {
    /* 解析失败也算"不同"——一个连格式都不对的值肯定不是库里那个。 */
    const sent = new Date(String(body.startAt)).getTime();
    if (Number.isNaN(sent) || sent !== row.start_at.getTime()) {
      locked.push("startAt");
    }
  }
  if (Array.isArray(body.affectedServices)) {
    /* 按**集合**比，不按顺序——2026-08-16 联调证伪了原来的按序比较：送
       `['beta','alpha']` 而库里是 `['alpha','beta']` 会被拒，可运营者一个服务都
       没改。`affectedServices` 回答的是「哪些服务受影响」，先后不承载任何语义。
       **误拒比漏拒更伤**：漏拒是少挡一次，误拒是让人对着一个自己没做过的改动
       找半天，还找不到。 */
    const key = (xs: readonly string[]) =>
      [...new Set(xs.map((v) => String(v).trim()))].sort().join(" ");
    if (key(body.affectedServices) !== key(row.affected_services ?? [])) {
      locked.push("affectedServices");
    }
  }

  if (locked.length > 0) {
    throw conflict(
      "MAINTENANCE_WINDOW_LIVE_FIELDS_LOCKED",
      `进行中的窗口不能改这些字段：${locked.join(" / ")}。` +
        `只能顺延结束时间、追记描述与影响说明；要改其它内容请先取消这个窗口再重建。`,
    );
  }
}

function normalizeMaintenanceWindowInput(
  body: MaintenanceWindowWriteBody,
): NormalizedMaintenanceWindowInput {
  if (!body || typeof body !== "object") {
    throw invalidRequest(
      "VALIDATION_BODY_REQUIRED",
      "Request body is required",
    );
  }
  if (
    body.severity !== undefined &&
    body.severity !== null &&
    !(
      typeof body.severity === "string" &&
      WINDOW_SEVERITIES.has(body.severity as MaintenanceWindowItem["severity"])
    )
  ) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "severity must be one of minor/major/critical",
      "severity",
    );
  }
  const severity =
    body.severity === undefined || body.severity === null
      ? "minor"
      : (body.severity as MaintenanceWindowItem["severity"]);

  const startAt = parseIso(body.startAt, "startAt");
  const endAt = parseIso(body.endAt, "endAt");
  if (new Date(endAt) <= new Date(startAt)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "endAt must be after startAt",
      "endAt",
    );
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
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("release:maintenance.read") &&
      !req.capabilities.includes("release:maintenance.manage"))
  ) {
    throw notEntitled("release:maintenance.read");
  }
}

function assertCanManageMaintenanceWindows(
  req: Request & RequestContext,
): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    !req.capabilities.includes("release:maintenance.manage")
  ) {
    throw notEntitled("release:maintenance.manage");
  }
}
