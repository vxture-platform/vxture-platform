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
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import type {
  PlatformPermissionType,
  PlatformRolePermissionRecord,
  PlatformRoleRecord,
} from "../types/governance.types";
import { RequireStepUp } from "../auth/step-up.decorator";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { pgErrorCode, withTransaction, type Queryable } from "../db/tx";

const MFA_MIN_LEVELS: ReadonlySet<string> = new Set([
  "disabled",
  "optional",
  "required",
]);

@Controller("api/admin-roles")
export class AdminRolesRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly roPool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get()
  async listAdminRoles(
    @Req() req: Request & RequestContext,
  ): Promise<PlatformRoleRecord[]> {
    assertCanManageAdminRoles(req);

    const [roleRows, permissionRows] = await Promise.all([
      this.roPool.query<PlatformRoleRow>(PLATFORM_ROLE_SQL),
      this.roPool.query<PlatformRolePermissionRow>(
        `${PLATFORM_ROLE_PERMISSION_SQL} ${PLATFORM_ROLE_PERMISSION_ORDER_SQL}`,
      ),
    ]);
    const permissionsByRole = groupBy(
      permissionRows.rows,
      (row) => row.role_id,
    );

    return roleRows.rows.map((role) => ({
      id: role.id,
      roleCode: role.role_code,
      rank: Number(role.rank ?? 0),
      nameI18nKey: role.role_name_key,
      nameEn: role.role_name,
      descriptionI18nKey: role.description_key,
      description: role.description,
      isSystem: role.is_system,
      statusCode: normalizeRoleStatusCode(role.status_code, role.status),
      status: role.status,
      sort: role.sort,
      adminCount: role.admin_count,
      activeAdminCount: role.active_admin_count,
      permissionCount: role.permission_count,
      menuPermissionCount: role.menu_permission_count,
      buttonPermissionCount: role.button_permission_count,
      apiPermissionCount: role.api_permission_count,
      createdBy: role.created_by,
      createdByName: role.created_by_name,
      createdAt: toIso(role.created_at),
      updatedAt: toIso(role.updated_at),
      permissions: (permissionsByRole.get(role.id) ?? []).map(mapPermissionRow),
    }));
  }

  @Put(":roleId/permissions")
  @RequireStepUp()
  async replaceAdminRolePermissions(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
    @Body() body: ReplaceRolePermissionsBody,
  ): Promise<PlatformRoleRecord> {
    assertCanManageAdminRoles(req);

    const actorId = requireUuid(
      req.operator?.id,
      "Invalid platform admin principal",
    );
    const targetRoleId = requireUuid(roleId, "Invalid role id");
    const permissionIds = normalizePermissionIds(body?.permissionIds);
    const client = await this.rwPool.connect();

    try {
      await client.query("begin");

      const roleResult = await client.query<PlatformRoleIdentityRow>(
        `
          select
            r.id,
            r.role_code,
            r.status as status_code,
            exists (
              select 1
              from admin.operator_account a
              where a.id = $2
                and a.role_id = r.id
                and a.deleted_at is null
            ) as is_actor_role
          from admin.operator_role r
          where r.id = $1
          for update
        `,
        [targetRoleId, actorId],
      );
      const role = roleResult.rows[0];
      if (!role) {
        throw new NotFoundException("Platform role not found");
      }
      if (role.status_code === "archived") {
        throw new BadRequestException("Archived roles cannot be authorized");
      }

      const permissionResult = await client.query<PermissionIntegrityRow>(
        `
          select id, parent_id, perm_code, is_active as status
          from admin.operator_permission
          where id = any($1::uuid[])
        `,
        [permissionIds],
      );
      if (permissionResult.rowCount !== permissionIds.length) {
        throw new BadRequestException(
          "Permission set contains unknown permission ids",
        );
      }

      const permissionIdSet = new Set(permissionIds);
      for (const permission of permissionResult.rows) {
        if (!permission.status) {
          throw new BadRequestException(
            `Disabled permission cannot be authorized: ${permission.perm_code}`,
          );
        }
        if (
          permission.parent_id &&
          !permissionIdSet.has(permission.parent_id)
        ) {
          throw new BadRequestException(
            `Permission ancestor is required: ${permission.perm_code}`,
          );
        }
      }

      // Anti-escalation invariant (PR #609 security review, Finding 1): an actor
      // holding operator:role.manage may re-arrange permissions on any role, but
      // may only ADD a permission the actor DOES NOT already hold to a role that
      // already carries it — i.e. "cannot grant what you don't hold." Without
      // this, operator:role.manage alone (currently super_admin-only, but this
      // endpoint's whole purpose is to let super_admin delegate a narrower role
      // holding just this one capability) would let the holder self-attach
      // operator:account.manage (or any other permission) to their own role and
      // silently escalate, bypassing the entire rank model this PR establishes.
      // Removals are never gated here — dropping a permission is a downgrade,
      // not an escalation (the is_actor_role self-lock below still applies).
      const currentPermRes = await client.query<{ permission_id: string }>(
        `select permission_id from admin.operator_role_permission where role_id = $1`,
        [targetRoleId],
      );
      const currentPermissionIds = new Set(
        currentPermRes.rows.map((r) => r.permission_id),
      );
      const newlyAddedIds = permissionIds.filter(
        (id) => !currentPermissionIds.has(id),
      );
      if (newlyAddedIds.length) {
        const actorPermRes = await client.query<{ permission_id: string }>(
          `
            select rp.permission_id
              from admin.operator_account a
              join admin.operator_role_permission rp on rp.role_id = a.role_id
              join admin.operator_permission p on p.id = rp.permission_id
             where a.id = $1 and a.deleted_at is null and p.is_active = true
          `,
          [actorId],
        );
        const actorPermissionIds = new Set(
          actorPermRes.rows.map((r) => r.permission_id),
        );
        const newlyAddedSet = new Set(newlyAddedIds);
        const ungranted = permissionResult.rows.filter(
          (permission) =>
            newlyAddedSet.has(permission.id) &&
            !actorPermissionIds.has(permission.id),
        );
        if (ungranted.length) {
          throw new ForbiddenException(
            `Cannot grant permission(s) you do not hold: ${ungranted
              .map((permission) => permission.perm_code)
              .join(", ")}`,
          );
        }
      }

      if (
        role.is_actor_role &&
        !permissionResult.rows.some(
          (permission) => permission.perm_code === "operator:role.manage",
        )
      ) {
        throw new ForbiddenException(
          "Cannot remove operator:role.manage from the active administrator role",
        );
      }

      await client.query(
        `
          delete from admin.operator_role_permission
          where role_id = $1
            and not (permission_id = any($2::uuid[]))
        `,
        [targetRoleId, permissionIds],
      );

      if (permissionIds.length) {
        await client.query(
          `
            insert into admin.operator_role_permission (role_id, permission_id, created_by)
            select $1::uuid, selected.permission_id, $3::uuid
            from unnest($2::uuid[]) as selected(permission_id)
            on conflict (role_id, permission_id) do nothing
          `,
          [targetRoleId, permissionIds, actorId],
        );
      }

      await client.query(
        `
          update admin.operator_role
          set updated_by = $2,
              updated_at = now()
          where id = $1
        `,
        [targetRoleId, actorId],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const [roleRows, permissionRows] = await Promise.all([
      this.roPool.query<PlatformRoleRow>(
        `${PLATFORM_ROLE_SQL_WITH_FILTER} where r.id = $1 ${PLATFORM_ROLE_SQL_GROUP_ORDER}`,
        [targetRoleId],
      ),
      this.roPool.query<PlatformRolePermissionRow>(
        `${PLATFORM_ROLE_PERMISSION_SQL} where rp.role_id = $1 ${PLATFORM_ROLE_PERMISSION_ORDER_SQL}`,
        [targetRoleId],
      ),
    ]);
    const updatedRole = roleRows.rows[0];
    if (!updatedRole) {
      throw new NotFoundException("Platform role not found");
    }
    const permissionsByRole = groupBy(
      permissionRows.rows,
      (row) => row.role_id,
    );
    return mapRoleRow(updatedRole, permissionsByRole);
  }

  // ── B9-P1a write path（追加，非凭据）──────────────────────────────────────
  // POST /api/admin-roles — create a custom operator role.
  //   body: { roleCode: string(<=64, unique), nameEn: string(<=128),
  //           nameI18nKey?: string(<=128, default 'operator.role.<roleCode>'),
  //           description?: string(<=255, default ''),
  //           mfaMinLevel?: 'disabled'|'optional'|'required' (default 'optional'),
  //           sort?: int (default 999) }
  //   status forced 'active'; is_system forced false; created_by/updated_by = operator.
  //   Duplicate roleCode → 409. response: PlatformRoleRecord.
  @Post()
  @RequireStepUp()
  async createAdminRole(
    @Req() req: Request & RequestContext,
    @Body() body: CreateAdminRoleBody,
  ): Promise<PlatformRoleRecord> {
    assertCanManageAdminRoles(req);
    const actorId = requireUuid(
      req.operator?.id,
      "Invalid platform admin principal",
    );
    const input = normalizeCreateRoleInput(body);

    return withTransaction(this.rwPool, async (client) => {
      let roleId: string;
      try {
        const inserted = await client.query<{ id: string }>(ROLE_INSERT_SQL, [
          input.roleCode,
          input.nameEn,
          input.nameI18nKey,
          input.description,
          input.sort,
          input.mfaMinLevel,
          actorId,
        ]);
        roleId = inserted.rows[0]!.id;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new ConflictException("role_code already exists");
        }
        throw error;
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.role.create",
        resourceType: "operator_role",
        resourceId: roleId,
        after: { roleCode: input.roleCode, nameEn: input.nameEn },
      });
      return this.fetchRoleRecord(client, roleId);
    });
  }

  // PUT /api/admin-roles/:roleId — edit metadata (name/description/mfa/sort).
  //   body: { nameEn?, nameI18nKey?, description?, mfaMinLevel?, sort? } — omitted
  //   fields keep their current value (COALESCE). is_system roles allow ONLY sort;
  //   any other field on a system role → 403. response: PlatformRoleRecord.
  @Put(":roleId")
  @RequireStepUp()
  async updateAdminRole(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
    @Body() body: UpdateAdminRoleBody,
  ): Promise<PlatformRoleRecord> {
    assertCanManageAdminRoles(req);
    const actorId = requireUuid(
      req.operator?.id,
      "Invalid platform admin principal",
    );
    const targetRoleId = requireUuid(roleId, "Invalid role id");
    const input = normalizeUpdateRoleInput(body);

    return withTransaction(this.rwPool, async (client) => {
      const existing = await client.query<{ is_system: boolean }>(
        `select is_system from admin.operator_role where id = $1 for update`,
        [targetRoleId],
      );
      const role = existing.rows[0];
      if (!role) {
        throw new NotFoundException("Platform role not found");
      }
      // is_system 禁改关键字段：仅允许 sort。
      if (
        role.is_system &&
        (input.nameEn !== null ||
          input.nameI18nKey !== null ||
          input.description !== null ||
          input.mfaMinLevel !== null)
      ) {
        throw new ForbiddenException(
          "System roles allow only sort to be changed",
        );
      }

      await client.query(ROLE_UPDATE_SQL, [
        targetRoleId,
        input.nameEn,
        input.nameI18nKey,
        input.description,
        input.mfaMinLevel,
        input.sort,
        actorId,
      ]);
      await insertOperatorAuditLog(client, req, {
        action: "operator.role.update",
        resourceType: "operator_role",
        resourceId: targetRoleId,
      });
      return this.fetchRoleRecord(client, targetRoleId);
    });
  }

  // POST /api/admin-roles/:roleId/copy — clone a role + its granted permissions.
  //   body: { roleCode: string(<=64, unique), nameEn?: string, nameI18nKey?: string,
  //           description?: string } — non-code fields default to the source role.
  //   New role: is_system=false, status='active', mfa_min_level/sort copied from
  //   source. Duplicate roleCode → 409. response: PlatformRoleRecord (the new role).
  @Post(":roleId/copy")
  @RequireStepUp()
  async copyAdminRole(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
    @Body() body: CopyAdminRoleBody,
  ): Promise<PlatformRoleRecord> {
    assertCanManageAdminRoles(req);
    const actorId = requireUuid(
      req.operator?.id,
      "Invalid platform admin principal",
    );
    const sourceRoleId = requireUuid(roleId, "Invalid role id");
    const newRoleCode = requireRoleCode(body?.roleCode);
    const overrides = normalizeCopyOverrides(body);

    return withTransaction(this.rwPool, async (client) => {
      const source = await client.query<CopySourceRow>(ROLE_COPY_SOURCE_SQL, [
        sourceRoleId,
      ]);
      const src = source.rows[0];
      if (!src) {
        throw new NotFoundException("Platform role not found");
      }

      // Anti-escalation invariant (PR #609 security review, Finding 1 —
      // second bypass): cloning silently copies EVERY permission from the
      // source role with no check on what the actor holds. Without this, an
      // operator:role.manage holder who does not themselves hold
      // operator:account.manage could copy super_admin's role (rank is never
      // set on a copy — always 0) and hand the clone to a THIRD, lower-rank
      // operator via changeAdminRole (self-assignment is separately forbidden
      // there, but assigning a rank-0 role to someone else passes the
      // rank>rank gate trivially) — smuggling super_admin-equivalent
      // capabilities past the "only super_admin grants operator:account
      // .manage" invariant via a proxy account instead of the actor's own.
      // Mirrors replaceAdminRolePermissions's "cannot grant what you don't
      // hold" rule exactly.
      const sourcePermRes = await client.query<{
        permission_id: string;
        perm_code: string;
      }>(
        `
          select rp.permission_id, p.perm_code
            from admin.operator_role_permission rp
            join admin.operator_permission p on p.id = rp.permission_id
           where rp.role_id = $1
        `,
        [sourceRoleId],
      );
      if (sourcePermRes.rows.length) {
        const actorPermRes = await client.query<{ permission_id: string }>(
          `
            select rp.permission_id
              from admin.operator_account a
              join admin.operator_role_permission rp on rp.role_id = a.role_id
              join admin.operator_permission p on p.id = rp.permission_id
             where a.id = $1 and a.deleted_at is null and p.is_active = true
          `,
          [actorId],
        );
        const actorPermissionIds = new Set(
          actorPermRes.rows.map((r) => r.permission_id),
        );
        const ungranted = sourcePermRes.rows.filter(
          (permission) => !actorPermissionIds.has(permission.permission_id),
        );
        if (ungranted.length) {
          throw new ForbiddenException(
            `Cannot copy a role holding permission(s) you do not hold: ${ungranted
              .map((permission) => permission.perm_code)
              .join(", ")}`,
          );
        }
      }

      let newRoleId: string;
      try {
        const inserted = await client.query<{ id: string }>(ROLE_INSERT_SQL, [
          newRoleCode,
          overrides.nameEn ?? src.role_name,
          overrides.nameI18nKey ?? src.role_name_key,
          overrides.description ?? src.description,
          src.sort,
          src.mfa_min_level,
          actorId,
        ]);
        newRoleId = inserted.rows[0]!.id;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new ConflictException("role_code already exists");
        }
        throw error;
      }

      // Clone every granted permission from the source role.
      await client.query(ROLE_COPY_PERMISSIONS_SQL, [
        newRoleId,
        actorId,
        sourceRoleId,
      ]);
      await insertOperatorAuditLog(client, req, {
        action: "operator.role.copy",
        resourceType: "operator_role",
        resourceId: newRoleId,
        after: { roleCode: newRoleCode, copiedFrom: sourceRoleId },
      });
      return this.fetchRoleRecord(client, newRoleId);
    });
  }

  // POST /api/admin-roles/:roleId/toggle-status — flip active⇄disabled.
  //   body: none. is_system roles cannot be toggled (禁停) → 403.
  //   response: PlatformRoleRecord.
  @Post(":roleId/toggle-status")
  @RequireStepUp()
  async toggleAdminRoleStatus(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
  ): Promise<PlatformRoleRecord> {
    assertCanManageAdminRoles(req);
    const actorId = requireUuid(
      req.operator?.id,
      "Invalid platform admin principal",
    );
    const targetRoleId = requireUuid(roleId, "Invalid role id");

    return withTransaction(this.rwPool, async (client) => {
      const existing = await client.query<{
        is_system: boolean;
        status: string;
      }>(
        `select is_system, status from admin.operator_role where id = $1 for update`,
        [targetRoleId],
      );
      const role = existing.rows[0];
      if (!role) {
        throw new NotFoundException("Platform role not found");
      }
      if (role.is_system) {
        throw new ForbiddenException("System roles cannot be disabled");
      }
      const nextStatus = role.status === "active" ? "disabled" : "active";

      await client.query(ROLE_STATUS_SQL, [targetRoleId, nextStatus, actorId]);
      await insertOperatorAuditLog(client, req, {
        action: "operator.role.status.update",
        resourceType: "operator_role",
        resourceId: targetRoleId,
        after: { status: nextStatus },
      });
      return this.fetchRoleRecord(client, targetRoleId);
    });
  }

  // DELETE /api/admin-roles/:roleId — hard delete (lock-death guarded).
  //   is_system roles cannot be deleted → 403. Any operator_account (incl.
  //   soft-deleted, FK is RESTRICT) referencing the role → 409 「角色使用中」.
  //   operator_role_permission is cleared first. response: { id, status: 'deleted' }.
  @Delete(":roleId")
  @RequireStepUp()
  async deleteAdminRole(
    @Req() req: Request & RequestContext,
    @Param("roleId") roleId: string,
  ): Promise<{ id: string; status: "deleted" }> {
    assertCanManageAdminRoles(req);
    requireUuid(req.operator?.id, "Invalid platform admin principal");
    const targetRoleId = requireUuid(roleId, "Invalid role id");

    return withTransaction(this.rwPool, async (client) => {
      const existing = await client.query<{ is_system: boolean }>(
        `select is_system from admin.operator_role where id = $1 for update`,
        [targetRoleId],
      );
      const role = existing.rows[0];
      if (!role) {
        throw new NotFoundException("Platform role not found");
      }
      if (role.is_system) {
        throw new ForbiddenException("System roles cannot be deleted");
      }

      // Lock-death guard: RESTRICT FK means any referencing account blocks delete.
      const inUse = await client.query(
        `select 1 from admin.operator_account where role_id = $1 limit 1`,
        [targetRoleId],
      );
      if (inUse.rowCount && inUse.rowCount > 0) {
        throw new ConflictException("Role is in use by one or more operators");
      }

      // Clear the join table before removing the role (RESTRICT FK).
      await client.query(
        `delete from admin.operator_role_permission where role_id = $1`,
        [targetRoleId],
      );
      await client.query(`delete from admin.operator_role where id = $1`, [
        targetRoleId,
      ]);
      await insertOperatorAuditLog(client, req, {
        action: "operator.role.delete",
        resourceType: "operator_role",
        resourceId: targetRoleId,
        before: { roleId: targetRoleId },
      });
      return { id: targetRoleId, status: "deleted" as const };
    });
  }

  private async fetchRoleRecord(
    db: Queryable,
    roleId: string,
  ): Promise<PlatformRoleRecord> {
    const [roleRows, permissionRows] = await Promise.all([
      db.query<PlatformRoleRow>(
        `${PLATFORM_ROLE_SQL_WITH_FILTER} where r.id = $1 ${PLATFORM_ROLE_SQL_GROUP_ORDER}`,
        [roleId],
      ),
      db.query<PlatformRolePermissionRow>(
        `${PLATFORM_ROLE_PERMISSION_SQL} where rp.role_id = $1 ${PLATFORM_ROLE_PERMISSION_ORDER_SQL}`,
        [roleId],
      ),
    ]);
    const role = roleRows.rows[0];
    if (!role) {
      throw new NotFoundException("Platform role not found");
    }
    const permissionsByRole = groupBy(
      permissionRows.rows,
      (row) => row.role_id,
    );
    return mapRoleRow(role, permissionsByRole);
  }
}

function assertCanManageAdminRoles(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes("operator:role.manage")) {
    throw new ForbiddenException("Missing operator:role.manage capability");
  }
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return groups;
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function requireUuid(value: string | undefined, message: string) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new UnauthorizedException(message);
  }
  return value;
}

function normalizePermissionIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BadRequestException("permissionIds must be an array");
  }
  if (value.length > 1000) {
    throw new BadRequestException(
      "Too many permissions in one authorization request",
    );
  }

  const ids = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        item,
      )
    ) {
      throw new BadRequestException(
        "permissionIds contains an invalid permission id",
      );
    }
    ids.add(item);
  }
  return [...ids];
}

function normalizeRoleStatusCode(
  value: string | null,
  legacyStatus: boolean,
): PlatformRoleRecord["statusCode"] {
  if (value === "active" || value === "disabled" || value === "archived") {
    return value;
  }
  return legacyStatus ? "active" : "disabled";
}

function mapPermissionRow(
  row: PlatformRolePermissionRow,
): PlatformRolePermissionRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    permCode: row.perm_code,
    permName: row.perm_name,
    permType: row.perm_type,
    status: row.status,
    description: row.description,
    routePath: row.route_path,
  };
}

function mapRoleRow(
  role: PlatformRoleRow,
  permissionsByRole: Map<string, PlatformRolePermissionRow[]>,
): PlatformRoleRecord {
  return {
    id: role.id,
    roleCode: role.role_code,
    rank: Number(role.rank ?? 0),
    nameI18nKey: role.role_name_key,
    nameEn: role.role_name,
    descriptionI18nKey: role.description_key,
    description: role.description,
    isSystem: role.is_system,
    statusCode: normalizeRoleStatusCode(role.status_code, role.status),
    status: role.status,
    sort: role.sort,
    adminCount: role.admin_count,
    activeAdminCount: role.active_admin_count,
    permissionCount: role.permission_count,
    menuPermissionCount: role.menu_permission_count,
    buttonPermissionCount: role.button_permission_count,
    apiPermissionCount: role.api_permission_count,
    createdBy: role.created_by,
    createdByName: role.created_by_name,
    createdAt: toIso(role.created_at),
    updatedAt: toIso(role.updated_at),
    permissions: (permissionsByRole.get(role.id) ?? []).map(mapPermissionRow),
  };
}

interface ReplaceRolePermissionsBody {
  permissionIds?: unknown;
}

interface PlatformRoleIdentityRow {
  id: string;
  role_code: string;
  status_code: PlatformRoleRecord["statusCode"];
  is_actor_role: boolean;
}

interface PermissionIntegrityRow {
  id: string;
  parent_id: string | null;
  perm_code: string;
  status: boolean;
}

interface PlatformRoleRow {
  id: string;
  role_code: string;
  rank: number;
  role_name_key: string;
  role_name: string;
  description_key: string | null;
  description: string;
  is_system: boolean;
  status_code: string | null;
  status: boolean;
  sort: number;
  admin_count: number;
  active_admin_count: number;
  permission_count: number;
  menu_permission_count: number;
  button_permission_count: number;
  api_permission_count: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PlatformRolePermissionRow {
  role_id: string;
  id: string;
  parent_id: string | null;
  perm_code: string;
  perm_name: string;
  perm_type: PlatformPermissionType;
  status: boolean;
  description: string;
  route_path: string | null;
}

const PLATFORM_ROLE_SQL_WITH_FILTER = `
  select
    r.id,
    r.role_code,
    r.role_name_key,
    r.role_name,
    r.rank,
    r.description_key,
    r.description,
    r.is_system,
    r.status as status_code,
    r.status,
    r.sort,
    r.created_by,
    coalesce(nullif(creator.display_name, ''), nullif(creator.username, ''), r.created_by::text) as created_by_name,
    r.created_at,
    r.updated_at,
    count(distinct a.id) filter (where a.deleted_at is null)::int as admin_count,
    count(distinct a.id) filter (
      where a.deleted_at is null
        and a.status = 'active'
    )::int as active_admin_count,
    count(distinct p.id) filter (where p.is_active = true)::int as permission_count,
    count(distinct p.id) filter (where p.is_active = true and p.perm_type = 'MENU')::int as menu_permission_count,
    count(distinct p.id) filter (where p.is_active = true and p.perm_type = 'BUTTON')::int as button_permission_count,
    count(distinct p.id) filter (where p.is_active = true and p.perm_type = 'API')::int as api_permission_count
  from admin.operator_role r
  left join admin.operator_account creator
    on creator.id = r.created_by
  left join admin.operator_account a
    on a.role_id = r.id
  left join admin.operator_role_permission rp
    on rp.role_id = r.id
  left join admin.operator_permission p
    on p.id = rp.permission_id
`;

const PLATFORM_ROLE_SQL_GROUP_ORDER = `
  group by r.id, creator.id
  order by r.sort asc, r.created_at asc
`;

const PLATFORM_ROLE_SQL = `${PLATFORM_ROLE_SQL_WITH_FILTER} where r.is_workforce_visible = true ${PLATFORM_ROLE_SQL_GROUP_ORDER}`;

const PLATFORM_ROLE_PERMISSION_SQL = `
  select
    rp.role_id,
    p.id,
    p.parent_id,
    p.perm_code,
    p.perm_name,
    p.perm_type,
    p.is_active as status,
    p.description,
    nullif(p.route_path, '') as route_path
  from admin.operator_role_permission rp
  join admin.operator_permission p
    on p.id = rp.permission_id
`;

const PLATFORM_ROLE_PERMISSION_ORDER_SQL = `
  order by rp.role_id, p.sort asc, p.perm_type asc, p.perm_code asc
`;

// ── B9-P1a write SQL（仅真实列，逐列对 80_admin.sql 核对）───────────────────

// status forced 'active'; is_system forced false. $7 = created_by = updated_by.
const ROLE_INSERT_SQL = `
insert into admin.operator_role
  (role_code, status, role_name, role_name_key, description, is_system, sort, mfa_min_level, created_by, updated_by)
values
  ($1, 'active', $2, $3, $4, false, $5, $6, $7, $7)
returning id
`;

// Partial edit via COALESCE: null params keep the current value. is_system guard
// is enforced in the handler (only sort may change for system roles).
const ROLE_UPDATE_SQL = `
update admin.operator_role
set role_name       = coalesce($2, role_name),
    role_name_key = coalesce($3, role_name_key),
    description   = coalesce($4, description),
    mfa_min_level = coalesce($5, mfa_min_level),
    sort          = coalesce($6, sort),
    updated_by    = $7,
    updated_at    = now()
where id = $1
`;

// $2 ∈ 'active'|'disabled' (computed in the handler).
const ROLE_STATUS_SQL = `
update admin.operator_role
set status     = $2,
    updated_by = $3,
    updated_at = now()
where id = $1
`;

const ROLE_COPY_SOURCE_SQL = `
select role_code, role_name, role_name_key, description, mfa_min_level, sort
from admin.operator_role
where id = $1
`;

// operator_role_permission has no updated_* columns (composite-PK join, no update
// semantics — 80_admin.sql). Clone only role_id/permission_id/created_by.
const ROLE_COPY_PERMISSIONS_SQL = `
insert into admin.operator_role_permission (role_id, permission_id, created_by)
select $1::uuid, permission_id, $2::uuid
from admin.operator_role_permission
where role_id = $3
`;

interface CreateAdminRoleBody {
  roleCode?: unknown;
  nameEn?: unknown;
  nameI18nKey?: unknown;
  description?: unknown;
  mfaMinLevel?: unknown;
  sort?: unknown;
}

interface UpdateAdminRoleBody {
  nameEn?: unknown;
  nameI18nKey?: unknown;
  description?: unknown;
  mfaMinLevel?: unknown;
  sort?: unknown;
}

interface CopyAdminRoleBody {
  roleCode?: unknown;
  nameEn?: unknown;
  nameI18nKey?: unknown;
  description?: unknown;
}

interface CopySourceRow {
  role_code: string;
  role_name: string;
  role_name_key: string;
  description: string;
  mfa_min_level: string;
  sort: number;
}

interface NormalizedCreateRole {
  roleCode: string;
  nameEn: string;
  nameI18nKey: string;
  description: string;
  mfaMinLevel: string;
  sort: number;
}

interface NormalizedUpdateRole {
  nameEn: string | null;
  nameI18nKey: string | null;
  description: string | null;
  mfaMinLevel: string | null;
  sort: number | null;
}

function requireRoleCode(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("roleCode is required");
  }
  const trimmed = value.trim();
  if (trimmed.length > 64) {
    throw new BadRequestException("roleCode exceeds 64 characters");
  }
  return trimmed;
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

function optionalMfaLevel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !MFA_MIN_LEVELS.has(value)) {
    throw new BadRequestException(
      "mfaMinLevel must be one of disabled/optional/required",
    );
  }
  return value;
}

function optionalSort(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException("sort must be a non-negative integer");
  }
  return value;
}

function normalizeCreateRoleInput(
  body: CreateAdminRoleBody,
): NormalizedCreateRole {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const roleCode = requireRoleCode(body.roleCode);
  return {
    roleCode,
    nameEn: requireBoundedText(body.nameEn, "nameEn", 128),
    nameI18nKey:
      optionalBoundedText(body.nameI18nKey, "nameI18nKey", 128) ??
      `operator.role.${roleCode}`,
    description:
      optionalBoundedText(body.description, "description", 255) ?? "",
    mfaMinLevel: optionalMfaLevel(body.mfaMinLevel) ?? "optional",
    sort: optionalSort(body.sort) ?? 999,
  };
}

function normalizeUpdateRoleInput(
  body: UpdateAdminRoleBody,
): NormalizedUpdateRole {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const input: NormalizedUpdateRole = {
    nameEn: optionalBoundedText(body.nameEn, "nameEn", 128),
    nameI18nKey: optionalBoundedText(body.nameI18nKey, "nameI18nKey", 128),
    description: optionalBoundedText(body.description, "description", 255),
    mfaMinLevel: optionalMfaLevel(body.mfaMinLevel),
    sort: optionalSort(body.sort),
  };
  if (
    input.nameEn === null &&
    input.nameI18nKey === null &&
    input.description === null &&
    input.mfaMinLevel === null &&
    input.sort === null
  ) {
    throw new BadRequestException("No editable role fields provided");
  }
  return input;
}

function normalizeCopyOverrides(body: CopyAdminRoleBody): {
  nameEn: string | null;
  nameI18nKey: string | null;
  description: string | null;
} {
  return {
    nameEn: optionalBoundedText(body?.nameEn, "nameEn", 128),
    nameI18nKey: optionalBoundedText(body?.nameI18nKey, "nameI18nKey", 128),
    description: optionalBoundedText(body?.description, "description", 255),
  };
}
