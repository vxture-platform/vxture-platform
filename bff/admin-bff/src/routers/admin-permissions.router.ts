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
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  PlatformAdminPermissionRecord,
  PlatformPermissionType,
  RequestContext,
} from "../types/console.types";
import { RequireStepUp } from "../auth/step-up.decorator";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { pgErrorCode, withTransaction, type Queryable } from "../db/tx";

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("api/admin-permissions")
export class AdminPermissionsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get()
  async listAdminPermissions(
    @Req() req: Request & RequestContext,
  ): Promise<PlatformAdminPermissionRecord[]> {
    assertCanViewAdminPermissions(req);

    const result = await this.pool.query<PlatformAdminPermissionRow>(
      PLATFORM_PERMISSION_SQL,
    );
    return result.rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      permCode: row.perm_code,
      permName: row.perm_name,
      permType: row.perm_type,
      isSystem: row.is_system,
      status: row.status,
      description: row.description,
      icon: row.icon,
      sort: row.sort,
      routePath: row.route_path,
      component: row.component,
      roleCount: row.role_count,
      activeRoleCount: row.active_role_count,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));
  }

  // ── B9-P1a write path（追加，非凭据）──────────────────────────────────────
  // POST /api/admin-permissions — create a permission (tree) node.
  //   body: { permCode: string(<=64, unique), permType: string(<=20, e.g. MENU/
  //           BUTTON/API), permName: string(<=64), parentId?: uuid|null,
  //           routePath?: string(<=255)|null, component?: string(<=255)|null,
  //           icon?: string(<=64)|null, description?: string(<=255, default ''),
  //           sort?: int (default 999) }
  //   is_active forced true. Duplicate permCode → 409; unknown parentId → 400.
  //   response: PlatformAdminPermissionRecord.
  @Post()
  @RequireStepUp()
  async createAdminPermission(
    @Req() req: Request & RequestContext,
    @Body() body: CreatePermissionBody,
  ): Promise<PlatformAdminPermissionRecord> {
    assertCanManageAdminPermissions(req);
    const actorId = requireOperatorId(req);
    const input = normalizeCreatePermissionInput(body);

    return withTransaction(this.rwPool, async (client) => {
      let permissionId: string;
      try {
        const inserted = await client.query<{ id: string }>(
          PERMISSION_INSERT_SQL,
          [
            input.parentId,
            input.permCode,
            input.permType,
            input.permName,
            input.routePath,
            input.component,
            input.icon,
            input.description,
            input.sort,
            actorId,
          ],
        );
        permissionId = inserted.rows[0]!.id;
      } catch (error) {
        throw mapPermissionWriteError(error);
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.permission.create",
        resourceType: "operator_permission",
        resourceId: permissionId,
        after: { permCode: input.permCode, permType: input.permType },
      });
      return this.fetchPermissionRecord(client, permissionId);
    });
  }

  // PUT /api/admin-permissions/:id — edit a permission node. Omitted fields keep
  //   their current value (COALESCE); nullable fields (parentId/routePath/component/
  //   icon) cannot be cleared to null here — see openIssues. Duplicate permCode →
  //   409; unknown parentId → 400. response: PlatformAdminPermissionRecord.
  @Put(":id")
  @RequireStepUp()
  async updateAdminPermission(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: UpdatePermissionBody,
  ): Promise<PlatformAdminPermissionRecord> {
    assertCanManageAdminPermissions(req);
    const actorId = requireOperatorId(req);
    const permissionId = requireUuid(id, "Invalid permission id");
    const input = normalizeUpdatePermissionInput(body);

    return withTransaction(this.rwPool, async (client) => {
      let updated;
      try {
        updated = await client.query<{ id: string }>(PERMISSION_UPDATE_SQL, [
          permissionId,
          input.permCode,
          input.permType,
          input.permName,
          input.parentId,
          input.routePath,
          input.component,
          input.icon,
          input.description,
          input.sort,
          actorId,
        ]);
      } catch (error) {
        throw mapPermissionWriteError(error);
      }
      if (!updated.rows[0]) {
        throw new NotFoundException("Permission not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.permission.update",
        resourceType: "operator_permission",
        resourceId: permissionId,
      });
      return this.fetchPermissionRecord(client, permissionId);
    });
  }

  // POST /api/admin-permissions/:id/toggle — flip is_active.
  //   body: none. Minimal implementation: flips ONLY this node's is_active — it
  //   does NOT cascade to child nodes and does NOT unlink the permission from any
  //   role that references it (see openIssues). response: PlatformAdminPermissionRecord.
  @Post(":id/toggle")
  @RequireStepUp()
  async toggleAdminPermission(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<PlatformAdminPermissionRecord> {
    assertCanManageAdminPermissions(req);
    const actorId = requireOperatorId(req);
    const permissionId = requireUuid(id, "Invalid permission id");

    return withTransaction(this.rwPool, async (client) => {
      const toggled = await client.query<{ id: string; is_active: boolean }>(
        PERMISSION_TOGGLE_SQL,
        [permissionId, actorId],
      );
      const row = toggled.rows[0];
      if (!row) {
        throw new NotFoundException("Permission not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.permission.toggle",
        resourceType: "operator_permission",
        resourceId: permissionId,
        after: { isActive: row.is_active },
      });
      return this.fetchPermissionRecord(client, permissionId);
    });
  }

  private async fetchPermissionRecord(
    db: Queryable,
    permissionId: string,
  ): Promise<PlatformAdminPermissionRecord> {
    const result = await db.query<PlatformAdminPermissionRow>(
      PLATFORM_PERMISSION_BY_ID_SQL,
      [permissionId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Permission not found");
    }
    return mapAdminPermissionRow(row);
  }
}

function assertCanManageAdminPermissions(req: Request & RequestContext): void {
  // Mirror the read guard capability set + step-up (see @RequireStepUp on writes).
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("operator:role.manage")) {
    throw new ForbiddenException("Missing operator:role.manage capability");
  }
}

function requireOperatorId(req: Request & RequestContext): string {
  const id = req.user?.id;
  if (!id || !UUID_RE.test(id)) {
    throw new UnauthorizedException("Invalid platform admin principal");
  }
  return id;
}

function requireUuid(value: string | undefined, message: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

// perm_code unique → 409; parent_id FK → 400. Other errors pass through.
function mapPermissionWriteError(error: unknown): unknown {
  const code = pgErrorCode(error);
  if (code === "23505") {
    return new ConflictException("perm_code already exists");
  }
  if (code === "23503") {
    return new BadRequestException("parentId references an unknown permission");
  }
  return error;
}

function requireBoundedText(
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

function optionalBoundedText(
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

function optionalParentId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestException("parentId must be a uuid");
  }
  return value;
}

// Reserved perm_code values that must never be creatable through this endpoint.
// These are legacy flat-string markers (no longer resolved by auth.service.ts's
// permission normalizer, which no longer has an architect-fallback bypass) —
// blocked here anyway as defense-in-depth so a plausible-sounding custom
// permission (e.g. "can access the admin dashboard") can never collide with a
// magic string any current or future capability-normalization code might key
// off of. See security review of PR #609 (架构师 fallback finding).
const RESERVED_PERM_CODES = new Set([
  "system:admin",
  "admin:manage",
  "operator:account.manage",
  "operator:role.manage",
]);

function assertNotReservedPermCode(permCode: string): void {
  if (RESERVED_PERM_CODES.has(permCode)) {
    throw new BadRequestException(
      `permCode "${permCode}" is reserved and cannot be created via this endpoint`,
    );
  }
}

function optionalSort(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException("sort must be a non-negative integer");
  }
  return value;
}

function normalizeCreatePermissionInput(
  body: CreatePermissionBody,
): NormalizedCreatePermission {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const permCode = requireBoundedText(body.permCode, "permCode", 64);
  assertNotReservedPermCode(permCode);
  return {
    permCode,
    permType: requireBoundedText(body.permType, "permType", 20),
    permName: requireBoundedText(body.permName, "permName", 64),
    parentId: optionalParentId(body.parentId),
    routePath: optionalBoundedText(body.routePath, "routePath", 255),
    component: optionalBoundedText(body.component, "component", 255),
    icon: optionalBoundedText(body.icon, "icon", 64),
    description:
      optionalBoundedText(body.description, "description", 255) ?? "",
    sort: optionalSort(body.sort) ?? 999,
  };
}

function normalizeUpdatePermissionInput(
  body: UpdatePermissionBody,
): NormalizedUpdatePermission {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const permCode = optionalBoundedText(body.permCode, "permCode", 64);
  if (permCode !== null) {
    assertNotReservedPermCode(permCode);
  }
  const input: NormalizedUpdatePermission = {
    permCode,
    permType: optionalBoundedText(body.permType, "permType", 20),
    permName: optionalBoundedText(body.permName, "permName", 64),
    parentId: optionalParentId(body.parentId),
    routePath: optionalBoundedText(body.routePath, "routePath", 255),
    component: optionalBoundedText(body.component, "component", 255),
    icon: optionalBoundedText(body.icon, "icon", 64),
    description: optionalBoundedText(body.description, "description", 255),
    sort: optionalSort(body.sort),
  };
  const hasAny =
    input.permCode !== null ||
    input.permType !== null ||
    input.permName !== null ||
    input.parentId !== null ||
    input.routePath !== null ||
    input.component !== null ||
    input.icon !== null ||
    input.description !== null ||
    input.sort !== null;
  if (!hasAny) {
    throw new BadRequestException("No editable permission fields provided");
  }
  return input;
}

function mapAdminPermissionRow(
  row: PlatformAdminPermissionRow,
): PlatformAdminPermissionRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    permCode: row.perm_code,
    permName: row.perm_name,
    permType: row.perm_type,
    isSystem: row.is_system,
    status: row.status,
    description: row.description,
    icon: row.icon,
    sort: row.sort,
    routePath: row.route_path,
    component: row.component,
    roleCount: row.role_count,
    activeRoleCount: row.active_role_count,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface CreatePermissionBody {
  permCode?: unknown;
  permType?: unknown;
  permName?: unknown;
  parentId?: unknown;
  routePath?: unknown;
  component?: unknown;
  icon?: unknown;
  description?: unknown;
  sort?: unknown;
}

interface UpdatePermissionBody {
  permCode?: unknown;
  permType?: unknown;
  permName?: unknown;
  parentId?: unknown;
  routePath?: unknown;
  component?: unknown;
  icon?: unknown;
  description?: unknown;
  sort?: unknown;
}

interface NormalizedCreatePermission {
  permCode: string;
  permType: string;
  permName: string;
  parentId: string | null;
  routePath: string | null;
  component: string | null;
  icon: string | null;
  description: string;
  sort: number;
}

interface NormalizedUpdatePermission {
  permCode: string | null;
  permType: string | null;
  permName: string | null;
  parentId: string | null;
  routePath: string | null;
  component: string | null;
  icon: string | null;
  description: string | null;
  sort: number | null;
}

function assertCanViewAdminPermissions(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes("operator:role.manage")) {
    throw new ForbiddenException("Missing operator:role.manage capability");
  }
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

interface PlatformAdminPermissionRow {
  id: string;
  parent_id: string | null;
  perm_code: string;
  perm_name: string;
  perm_type: PlatformPermissionType;
  is_system: boolean;
  status: boolean;
  description: string;
  icon: string | null;
  sort: number;
  route_path: string | null;
  component: string | null;
  role_count: number;
  active_role_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const PLATFORM_PERMISSION_SQL = `
  select
    p.id,
    p.parent_id,
    p.perm_code,
    p.perm_name,
    p.perm_type,
    p.is_system,
    p.is_active as status,
    p.description,
    p.icon,
    p.sort,
    nullif(p.route_path, '') as route_path,
    nullif(p.component, '') as component,
    p.created_at,
    p.updated_at,
    count(distinct rp.role_id)::int as role_count,
    count(distinct rp.role_id) filter (
      where r.status = 'active'
    )::int as active_role_count
  from admin.operator_permission p
  left join admin.operator_role_permission rp
    on rp.permission_id = p.id
  left join admin.operator_role r
    on r.id = rp.role_id
  group by p.id
  order by p.perm_type asc, p.sort asc, p.perm_code asc
`;

// Single-row enrichment (same shape as the list) for write-endpoint responses.
const PLATFORM_PERMISSION_BY_ID_SQL = `
  select
    p.id,
    p.parent_id,
    p.perm_code,
    p.perm_name,
    p.perm_type,
    p.is_system,
    p.is_active as status,
    p.description,
    p.icon,
    p.sort,
    nullif(p.route_path, '') as route_path,
    nullif(p.component, '') as component,
    p.created_at,
    p.updated_at,
    count(distinct rp.role_id)::int as role_count,
    count(distinct rp.role_id) filter (
      where r.status = 'active'
    )::int as active_role_count
  from admin.operator_permission p
  left join admin.operator_role_permission rp
    on rp.permission_id = p.id
  left join admin.operator_role r
    on r.id = rp.role_id
  where p.id = $1
  group by p.id
`;

// ── B9-P1a write SQL（仅真实列，逐列对 80_admin.sql 核对）───────────────────

// is_active forced true; created_by/updated_by NOT NULL → $10 (operator).
const PERMISSION_INSERT_SQL = `
insert into admin.operator_permission
  (parent_id, perm_code, perm_type, perm_name, route_path, component, icon, description, is_active, sort, created_by, updated_by)
values
  ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $10)
returning id
`;

// Partial edit via COALESCE: null params keep the current value (nullable columns
// therefore cannot be cleared to NULL through this endpoint — see openIssues).
const PERMISSION_UPDATE_SQL = `
update admin.operator_permission
set perm_code   = coalesce($2, perm_code),
    perm_type   = coalesce($3, perm_type),
    perm_name   = coalesce($4, perm_name),
    parent_id   = coalesce($5, parent_id),
    route_path  = coalesce($6, route_path),
    component   = coalesce($7, component),
    icon        = coalesce($8, icon),
    description = coalesce($9, description),
    sort        = coalesce($10, sort),
    updated_by  = $11,
    updated_at  = now()
where id = $1
returning id
`;

// Minimal toggle: flip only this node's is_active. No cascade to children, no
// role unlink (see openIssues).
const PERMISSION_TOGGLE_SQL = `
update admin.operator_permission
set is_active  = not is_active,
    updated_by = $2,
    updated_at = now()
where id = $1
returning id, is_active
`;
