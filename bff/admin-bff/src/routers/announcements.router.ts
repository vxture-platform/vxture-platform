/**
 * announcements.router.ts - 通知公告路由
 * @package @vxture/bff-admin
 *
 * Description: 平台公告读接口，接 admin.announcements（18-schema）。
 *   写路径（增删改/发布/归档）见 admin-app-completion-plan.md B8。
 *
 * @author AI-Generated
 * @date 2026-07-04
 * @version 2.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  AnnouncementBroadcast,
  AnnouncementRecord,
  RequestContext,
} from "../types/console.types";

@Controller("api/announcements")
export class AnnouncementsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get()
  async listAnnouncements(
    @Req() req: Request & RequestContext,
  ): Promise<AnnouncementRecord[]> {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    const { rows } = await this.pool.query<AnnouncementRow>(ANNOUNCEMENTS_SQL);
    return rows.map(mapAnnouncementRow);
  }

  // ── B8 write path（追加）────────────────────────────────────────────────
  // Contract: POST /api/announcements
  //   body: { announcementType: 'system'|'maintenance'|'marketing'|'security',
  //           severity?: 'info'|'warning'|'critical' (default 'info'),
  //           title: string(<=256), content: string,
  //           targetPlans?: string[] (plan_code, default []),
  //           targetTenantTypes?: string[] ('personal'|'organization', default []),
  //           publishAt: string(ISO, required), expiresAt?: string(ISO)|null }
  //   status is forced 'draft'; created_by = acting operator.
  //   response: AnnouncementRecord (see console.types).
  @Post()
  async createAnnouncement(
    @Req() req: Request & RequestContext,
    @Body() body: AnnouncementWriteBody,
  ): Promise<AnnouncementRecord> {
    assertCanManageAnnouncements(req);
    const createdBy = requireOperatorId(req);
    const input = normalizeAnnouncementInput(body);

    const { rows } = await this.rwPool.query<AnnouncementRow>(
      ANNOUNCEMENT_INSERT_SQL,
      [
        input.announcementType,
        input.severity,
        input.title,
        input.content,
        input.targetPlans,
        input.targetTenantTypes,
        input.publishAt,
        input.expiresAt,
        createdBy,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new BadRequestException("Announcement insert returned no row");
    }
    return mapAnnouncementRow(row);
  }

  // Contract: PUT /api/announcements/:id
  //   body: same editable fields as POST (announcementType/severity/title/content/
  //         targetPlans/targetTenantTypes/publishAt/expiresAt). status is NOT changed
  //         here (use publish/archive). Only non-deleted rows are editable.
  //   response: AnnouncementRecord.
  @Put(":id")
  async updateAnnouncement(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: AnnouncementWriteBody,
  ): Promise<AnnouncementRecord> {
    assertCanManageAnnouncements(req);
    requireOperatorId(req);
    const announcementId = requireUuid(id, "Invalid announcement id");
    const input = normalizeAnnouncementInput(body);

    const { rows } = await this.rwPool.query<AnnouncementRow>(
      ANNOUNCEMENT_UPDATE_SQL,
      [
        announcementId,
        input.announcementType,
        input.severity,
        input.title,
        input.content,
        input.targetPlans,
        input.targetTenantTypes,
        input.publishAt,
        input.expiresAt,
      ],
    );
    if (!rows[0]) {
      throw new NotFoundException("Announcement not found");
    }
    return mapAnnouncementRow(rows[0]);
  }

  // Contract: POST /api/announcements/:id/publish → status = 'published'.
  //   body: none. response: AnnouncementRecord.
  @Post(":id/publish")
  async publishAnnouncement(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<AnnouncementRecord> {
    return this.transitionAnnouncement(req, id, "published");
  }

  // Contract: POST /api/announcements/:id/archive → status = 'archived'.
  //   body: none. response: AnnouncementRecord.
  @Post(":id/archive")
  async archiveAnnouncement(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<AnnouncementRecord> {
    return this.transitionAnnouncement(req, id, "archived");
  }

  // Contract: DELETE /api/announcements/:id → soft delete (deleted_at = now()).
  //   body: none. response: { id, status: 'deleted', deletedAt: string(ISO) }.
  @Delete(":id")
  async deleteAnnouncement(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; status: "deleted"; deletedAt: string }> {
    assertCanManageAnnouncements(req);
    requireOperatorId(req);
    const announcementId = requireUuid(id, "Invalid announcement id");

    const { rows } = await this.rwPool.query<{ id: string; deleted_at: Date }>(
      ANNOUNCEMENT_SOFT_DELETE_SQL,
      [announcementId],
    );
    if (!rows[0]) {
      throw new NotFoundException("Announcement not found");
    }
    return {
      id: rows[0].id,
      status: "deleted",
      deletedAt: toIso(rows[0].deleted_at),
    };
  }

  private async transitionAnnouncement(
    req: Request & RequestContext,
    id: string,
    status: "published" | "archived",
  ): Promise<AnnouncementRecord> {
    assertCanManageAnnouncements(req);
    requireOperatorId(req);
    const announcementId = requireUuid(id, "Invalid announcement id");

    const { rows } = await this.rwPool.query<AnnouncementRow>(
      ANNOUNCEMENT_STATUS_SQL,
      [announcementId, status],
    );
    if (!rows[0]) {
      throw new NotFoundException("Announcement not found");
    }
    return mapAnnouncementRow(rows[0]);
  }
}

const ANNOUNCEMENTS_SQL = `
select
  id,
  announcement_type,
  severity,
  status,
  title,
  content,
  target_plans,
  target_tenant_types,
  publish_at,
  expires_at,
  meta,
  created_at,
  updated_at
from admin.announcements
where deleted_at is null
order by publish_at desc
`;

/** meta.broadcast_at / meta.broadcast（P2-h 推送作业写入）→ 展示结构；没推过 = null。 */
function toBroadcast(
  meta: Record<string, unknown> | null | undefined,
): AnnouncementBroadcast | null {
  const at = meta?.broadcast_at;
  if (typeof at !== "string") return null;
  const b = (meta?.broadcast ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
  return {
    at,
    tenants: n(b.tenants),
    inbox: n(b.inbox),
    emails: n(b.emails),
    skipped: typeof b.skipped === "string" ? b.skipped : null,
  };
}

const ANNOUNCEMENT_TYPES: ReadonlySet<AnnouncementRecord["type"]> = new Set([
  "system",
  "maintenance",
  "marketing",
  "security",
]);

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapAnnouncementRow(row: AnnouncementRow): AnnouncementRecord {
  const type = ANNOUNCEMENT_TYPES.has(
    row.announcement_type as AnnouncementRecord["type"],
  )
    ? (row.announcement_type as AnnouncementRecord["type"])
    : "system";
  const severity =
    row.severity && ANNOUNCEMENT_SEVERITIES.has(row.severity)
      ? (row.severity as AnnouncementRecord["severity"])
      : "info";
  const targetPlans = row.target_plans ?? [];
  const targetTenantTypes = row.target_tenant_types ?? [];
  // targetScope 由 target_plans/target_tenant_types 派生：都为空=全量，否则=自定义。
  const hasTargets = targetPlans.length > 0 || targetTenantTypes.length > 0;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    type,
    severity,
    status: row.status,
    targetScope: hasTargets ? "custom" : "all",
    targetPlans,
    targetTenantTypes,
    publishAt: toIso(row.publish_at),
    publishedAt: row.status === "published" ? toIso(row.publish_at) : null,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    broadcast: toBroadcast(row.meta),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface AnnouncementRow {
  meta?: Record<string, unknown> | null;
  id: string;
  announcement_type: string;
  severity: string | null;
  status: AnnouncementRecord["status"];
  title: string;
  content: string;
  target_plans: string[] | null;
  target_tenant_types: string[] | null;
  publish_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

// ── B8 write path helpers（追加）──────────────────────────────────────────

const ANNOUNCEMENT_RETURNING = `
  id,
  announcement_type,
  severity,
  status,
  title,
  content,
  target_plans,
  target_tenant_types,
  publish_at,
  expires_at,
  meta,
  created_at,
  updated_at
`;

// status forced 'draft' on create（DDL chk_announcements_status）。target_* 空数组=全量。
const ANNOUNCEMENT_INSERT_SQL = `
insert into admin.announcements
  (announcement_type, severity, status, title, content,
   target_plans, target_tenant_types, publish_at, expires_at, created_by)
values
  ($1, $2, 'draft', $3, $4,
   $5::varchar[], $6::varchar[], $7, $8, $9)
returning ${ANNOUNCEMENT_RETURNING}
`;

// PUT 只改内容/投放字段，不动 status（发布/归档走独立端点）。
const ANNOUNCEMENT_UPDATE_SQL = `
update admin.announcements
set announcement_type   = $2,
    severity            = $3,
    title               = $4,
    content             = $5,
    target_plans        = $6::varchar[],
    target_tenant_types = $7::varchar[],
    publish_at          = $8,
    expires_at          = $9,
    updated_at          = now()
where id = $1 and deleted_at is null
returning ${ANNOUNCEMENT_RETURNING}
`;

// $2 ∈ 'published'|'archived'（校验在应用层）。
const ANNOUNCEMENT_STATUS_SQL = `
update admin.announcements
set status = $2, updated_at = now()
where id = $1 and deleted_at is null
returning ${ANNOUNCEMENT_RETURNING}
`;

const ANNOUNCEMENT_SOFT_DELETE_SQL = `
update admin.announcements
set deleted_at = now(), updated_at = now()
where id = $1 and deleted_at is null
returning id, deleted_at
`;

const ANNOUNCEMENT_SEVERITIES: ReadonlySet<string> = new Set([
  "info",
  "warning",
  "critical",
]);

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AnnouncementWriteBody {
  announcementType?: unknown;
  severity?: unknown;
  title?: unknown;
  content?: unknown;
  targetPlans?: unknown;
  targetTenantTypes?: unknown;
  publishAt?: unknown;
  expiresAt?: unknown;
}

interface NormalizedAnnouncementInput {
  announcementType: string;
  severity: string;
  title: string;
  content: string;
  targetPlans: string[];
  targetTenantTypes: string[];
  publishAt: string;
  expiresAt: string | null;
}

// Publishing/deleting platform-wide announcements is an authored write; gate on
// content:announcement.manage (granted to super_admin/admin/operation per
// data_admin_200 §4.3). The list read stays session-only (low-risk internal content).
function assertCanManageAnnouncements(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("content:announcement.manage")) {
    throw new ForbiddenException(
      "Missing content:announcement.manage capability",
    );
  }
}

function requireOperatorId(req: Request & RequestContext): string {
  const id = req.user?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform operator principal");
  }
  return id;
}

function requireUuid(value: string | undefined, message: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

function requireText(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new BadRequestException(`${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new BadRequestException(`${field} contains an invalid value`);
    }
    out.push(item.trim());
  }
  return out;
}

function parseIso(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required (ISO timestamp)`);
  }
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) {
    throw new BadRequestException(`${field} is not a valid timestamp`);
  }
  return ts.toISOString();
}

function normalizeAnnouncementInput(
  body: AnnouncementWriteBody,
): NormalizedAnnouncementInput {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const announcementType =
    typeof body.announcementType === "string" ? body.announcementType : "";
  if (!ANNOUNCEMENT_TYPES.has(announcementType as AnnouncementRecord["type"])) {
    throw new BadRequestException(
      "announcementType must be one of system/maintenance/marketing/security",
    );
  }
  const severity =
    body.severity === undefined || body.severity === null
      ? "info"
      : typeof body.severity === "string" &&
          ANNOUNCEMENT_SEVERITIES.has(body.severity)
        ? body.severity
        : (() => {
            throw new BadRequestException(
              "severity must be one of info/warning/critical",
            );
          })();

  const expiresAt =
    body.expiresAt === undefined || body.expiresAt === null
      ? null
      : parseIso(body.expiresAt, "expiresAt");

  return {
    announcementType,
    severity,
    title: requireText(body.title, "title", 256),
    content: requireText(body.content, "content", 100000),
    targetPlans: normalizeStringArray(body.targetPlans, "targetPlans"),
    targetTenantTypes: normalizeStringArray(
      body.targetTenantTypes,
      "targetTenantTypes",
    ),
    publishAt: parseIso(body.publishAt, "publishAt"),
    expiresAt,
  };
}
