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
import { ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import type { PlatformAdminRecord } from "../types/governance.types";
import { RequireStepUp } from "../auth/step-up.decorator";
import { OperatorAdminService } from "../auth/operator-admin.service";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { pgErrorCode, withTransaction, type Queryable } from "../db/tx";

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("api/platform-admins")
export class PlatformAdminsRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ARCHE_BFF_RW_POOL) private readonly rwPool: Pool,
    @Inject(OperatorAdminService)
    private readonly operatorAdmin: OperatorAdminService,
  ) {}

  // Capability-only gate, no per-request rank floor — deliberate (PR #609
  // security review, Finding 1): the review flagged that this list/overview
  // pair checks capability only, unlike every mutation endpoint's rank gate.
  // The actual escalation vector (a low-rank operator:role.manage holder
  // self-granting operator:account.manage) is closed at its root in
  // admin-roles.router.ts (replaceAdminRolePermissions / copyAdminRole can no
  // longer grant a permission the actor doesn't already hold) — so reaching
  // this capability now REQUIRES already legitimately holding it. Adding a
  // blanket rank floor here would regress a legitimate need instead: any
  // operator:account.manage holder (even a delegated, lower-rank one) needs
  // the full roster to compute canManage / know who they may act on.
  @Get()
  async listPlatformAdmins(
    @Req() req: Request & RequestContext,
  ): Promise<PlatformAdminRecord[]> {
    assertCanManagePlatformAdmins(req);
    const actorRank = await this.getActorRank(
      this.pool,
      requireOperatorId(req),
    );

    const result = await this.pool.query<PlatformAdminRow>(PLATFORM_ADMIN_SQL);
    return result.rows.map((row) => mapPlatformAdminRow(row, actorRank));
  }

  /** Resolve the acting operator's role rank (TD-017 canManage display truth). */
  private async getActorRank(db: Queryable, actorId: string): Promise<number> {
    const result = await db.query<{ rank: number }>(ACTOR_RANK_SQL, [actorId]);
    return Number(result.rows[0]?.rank ?? 0);
  }

  // POST /api/platform-admins — create a new operator (TD-017 §③⑤). No credential
  //   is ever handled here: the IdP mails an out-of-band initial-setup link to
  //   the new operator's own email; this endpoint only gets a masked delivery
  //   confirmation. roleId's rank must be strictly below the actor's own rank
  //   (enforced at the IdP, defense-in-depth — see OperatorAdminInternalRouter
  //   .create). body: { username, displayName, email, phone?, roleId }.
  //   response: { record: PlatformAdminRecord, deliveredTo: string }.
  @Post()
  @RequireStepUp()
  async createAdmin(
    @Req() req: Request & RequestContext,
    @Body() body: CreateAdminBody,
  ): Promise<{ record: PlatformAdminRecord; deliveredTo: string }> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const input = normalizeCreateAdminInput(body);

    const result = await this.operatorAdmin.createOperator(actorId, input);
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.create",
      resourceType: "operator_account",
      resourceId: result.operatorId,
      after: {
        username: input.username,
        email: input.email,
        roleId: input.roleId,
      },
    });
    const record = await this.fetchAdminRecord(
      this.rwPool,
      result.operatorId,
      actorId,
    );
    return { record, deliveredTo: result.deliveredTo };
  }

  // ── B9-P1a write path（追加，非凭据）──────────────────────────────────────
  // POST /api/platform-admins/:id/role — reassign an operator's single role.
  //   body: { roleId: uuid } — target role must exist. Only non-deleted accounts
  //   are editable. Unknown account → 404; unknown role → 400.
  //   TD-017 graded model (double-rank gate, ranks resolved from DB, never client):
  //     · self role-change forbidden (no self-promotion path);
  //     · actor.rank must be strictly greater than the target's CURRENT role rank;
  //     · actor.rank must be strictly greater than the NEW role's rank (cannot
  //       grant a role at or above one's own level);
  //     · survival guard: demoting the last active super_admin is refused (409).
  //   response: PlatformAdminRecord.
  @Post(":id/role")
  @RequireStepUp()
  async changeAdminRole(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ChangeAdminRoleBody,
  ): Promise<PlatformAdminRecord> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const roleId = requireUuid(
      typeof body?.roleId === "string" ? body.roleId : undefined,
      "roleId is required",
    );
    if (accountId === actorId) {
      throw new ForbiddenException("self_operation_forbidden");
    }

    return withTransaction(this.rwPool, async (client) => {
      const newRoleRes = await client.query<{
        rank: number;
        role_code: string;
      }>(`select rank, role_code from admin.operator_role where id = $1`, [
        roleId,
      ]);
      const newRole = newRoleRes.rows[0];
      if (!newRole) {
        throw new BadRequestException("Target role not found");
      }

      const ranks = await client.query<{
        actor_rank: number;
        target_rank: number;
        target_role_code: string;
      }>(ADMIN_ROLE_RANKS_SQL, [actorId, accountId]);
      if (!ranks.rows[0]) {
        throw new NotFoundException("Platform admin not found");
      }
      const { actor_rank, target_rank, target_role_code } = ranks.rows[0];
      // Strictly greater on BOTH sides: equal rank is refused (super_admin↔super_admin
      // mutual ops forbidden; admin cannot touch a peer admin or mint one).
      if (actor_rank <= target_rank) {
        throw new ForbiddenException("insufficient_rank");
      }
      if (actor_rank <= Number(newRole.rank)) {
        throw new ForbiddenException("insufficient_rank");
      }
      if (
        target_role_code === "super_admin" &&
        newRole.role_code !== "super_admin"
      ) {
        // TD-019: lock the FULL active-super_admin row-set (not excluding the
        // target) before counting — a concurrent demote/disable of a DIFFERENT
        // super_admin (here, or via auth-bff's disableOperatorGuarded, which
        // takes the identical lock) blocks on this until we commit, instead of
        // both independently reading "1 other survivor" and both proceeding.
        const locked = await client.query<{ id: string }>(
          `select a.id
             from admin.operator_account a
             join admin.operator_role r on r.id = a.role_id
            where a.deleted_at is null and a.status = 'active'
              and r.role_code = 'super_admin'
            order by a.id
            for update of a`,
        );
        const remaining = locked.rows.filter((r) => r.id !== accountId).length;
        if (remaining < 1) {
          throw new ConflictException("last_super_admin");
        }
      }

      const updated = await client.query<{ id: string }>(
        ADMIN_ROLE_ASSIGN_SQL,
        [accountId, roleId, actorId],
      );
      if (!updated.rows[0]) {
        throw new NotFoundException("Platform admin not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.account.role.update",
        resourceType: "operator_account",
        resourceId: accountId,
        after: { roleId },
      });
      return this.fetchAdminRecord(client, accountId, actorId);
    });
  }

  // ── B9-P1b-α credential/session ops — delegated to the IdP (auth-bff), which owns
  //   operator credentials + sessions. admin-bff never writes them directly. All
  //   step-up gated + audited; the IdP enforces realm isolation + anti-lockout.

  // POST /api/platform-admins/:id/disable — IdP disables the operator + revokes all
  //   sessions. body: { reason?: string }. response: refreshed PlatformAdminRecord.
  @Post(":id/disable")
  @RequireStepUp()
  async disableAdmin(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ): Promise<PlatformAdminRecord> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    await this.operatorAdmin.disableOperator(accountId, actorId, reason);
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.disable",
      resourceType: "operator_account",
      resourceId: accountId,
    });
    return this.fetchAdminRecord(this.rwPool, accountId, actorId);
  }

  // POST /api/platform-admins/:id/enable — IdP re-enables the operator.
  @Post(":id/enable")
  @RequireStepUp()
  async enableAdmin(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ): Promise<PlatformAdminRecord> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    await this.operatorAdmin.enableOperator(accountId, actorId, reason);
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.enable",
      resourceType: "operator_account",
      resourceId: accountId,
    });
    return this.fetchAdminRecord(this.rwPool, accountId, actorId);
  }

  // POST /api/platform-admins/:id/force-logout — IdP revokes all of the operator's
  //   sessions. body: { reason?: string }. response: { ok: true, revoked: number }.
  @Post(":id/force-logout")
  @RequireStepUp()
  async forceLogoutAdmin(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ): Promise<{ ok: true; revoked: number }> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const result = await this.operatorAdmin.forceLogoutOperator(
      accountId,
      actorId,
      reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.force_logout",
      resourceType: "operator_account",
      resourceId: accountId,
    });
    return result;
  }

  // POST /api/platform-admins/:id/mfa/reset — IdP wipes the operator's enrolled second
  //   factors (TOTP/WebAuthn/recovery) + revokes sessions; policy kept (re-enroll on next
  //   login). body: { reason? }. response: { ok: true, revoked: number }.
  @Post(":id/mfa/reset")
  @RequireStepUp()
  async resetAdminMfa(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ): Promise<{ ok: true; revoked: number }> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const result = await this.operatorAdmin.resetOperatorMfa(
      accountId,
      actorId,
      reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.mfa_reset",
      resourceType: "operator_account",
      resourceId: accountId,
    });
    return result;
  }

  // POST /api/platform-admins/:id/reset-password — IdP generates a single-use reset
  //   token (no plaintext, D1) and MAILS the link to the target operator's own email
  //   (out-of-band, TD-017 — the initiator never sees the link), then revokes sessions.
  //   body: { reason? }. response: { ok: true, deliveredTo: masked, expiresIn }.
  @Post(":id/reset-password")
  @RequireStepUp()
  async resetAdminPassword(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ): Promise<{ ok: true; deliveredTo: string; expiresIn: number }> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const result = await this.operatorAdmin.resetOperatorPassword(
      accountId,
      actorId,
      reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "operator.account.reset_password",
      resourceType: "operator_account",
      resourceId: accountId,
    });
    return result;
  }

  // PUT /api/platform-admins/:id — edit metadata only. Explicitly excludes status,
  //   password and any credential (those are P1b / IdP). Omitted fields keep their
  //   current value (COALESCE); nullable email/phone cannot be cleared to NULL here
  //   (see openIssues). Duplicate email/phone → 409. response: PlatformAdminRecord.
  //   TD-017 graded model: like every other cross-operator mutation, gated by rank —
  //   editing ANOTHER operator requires actor.rank strictly greater than target.rank
  //   (ranks resolved from DB, never client). Self-edit is allowed (own contact info).
  //   ⚠ Residual (TD-017 §③, tracked): a higher-rank actor can still rewrite a lower-
  //   rank target's email/phone, and both are out-of-band delivery targets (reset link
  //   via mail, or SMS) — the root fix is "deliver only to a verified email/phone"
  //   (needs operator_account.email_verified + phone_verified + self-service verify),
  //   a follow-up. before/after is audited so any contact-field change is attributable.
  @Put(":id")
  @RequireStepUp()
  async updateAdminMetadata(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: UpdateAdminMetadataBody,
  ): Promise<PlatformAdminRecord> {
    assertCanManagePlatformAdmins(req);
    const actorId = requireOperatorId(req);
    const accountId = requireUuid(id, "Invalid platform admin id");
    const input = normalizeAdminMetadataInput(body);

    return withTransaction(this.rwPool, async (client) => {
      // Snapshot current values (also the FOR UPDATE lock + rank-gate target read).
      const beforeRes = await client.query<AdminMetadataSnapshotRow>(
        ADMIN_METADATA_SNAPSHOT_SQL,
        [accountId],
      );
      const before = beforeRes.rows[0];
      if (!before) {
        throw new NotFoundException("Platform admin not found");
      }
      // Rank gate — editing another operator requires strictly-higher rank.
      if (accountId !== actorId) {
        const actorRank = await this.getActorRank(client, actorId);
        if (actorRank <= Number(before.role_rank ?? 0)) {
          throw new ForbiddenException("insufficient_rank");
        }
      }

      let updated;
      try {
        updated = await client.query<{ id: string }>(
          ADMIN_METADATA_UPDATE_SQL,
          [
            accountId,
            input.displayName,
            input.email,
            input.phone,
            input.remark,
            input.sort,
            actorId,
          ],
        );
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new ConflictException("email or phone already in use");
        }
        throw error;
      }
      if (!updated.rows[0]) {
        throw new NotFoundException("Platform admin not found");
      }
      await insertOperatorAuditLog(client, req, {
        action: "operator.account.update",
        resourceType: "operator_account",
        resourceId: accountId,
        before: {
          displayName: before.display_name,
          email: before.email,
          phone: before.phone,
          remark: before.remark,
          sort: before.sort,
        },
        // Only the fields actually submitted for change (undefined = untouched).
        after: {
          displayName: input.displayName ?? undefined,
          email: input.email ?? undefined,
          phone: input.phone ?? undefined,
          remark: input.remark ?? undefined,
          sort: input.sort ?? undefined,
        },
      });
      return this.fetchAdminRecord(client, accountId, actorId);
    });
  }

  private async fetchAdminRecord(
    db: Queryable,
    accountId: string,
    actorId?: string,
  ): Promise<PlatformAdminRecord> {
    const actorRank = actorId
      ? await this.getActorRank(db, actorId)
      : undefined;
    const result = await db.query<PlatformAdminRow>(PLATFORM_ADMIN_BY_ID_SQL, [
      accountId,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Platform admin not found");
    }
    return mapPlatformAdminRow(row, actorRank);
  }
}

function assertCanManagePlatformAdmins(req: Request & RequestContext): void {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes("operator:account.manage")) {
    throw new ForbiddenException("Missing platform.admin.manage capability");
  }
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapPlatformAdminRow(
  row: PlatformAdminRow,
  actorRank?: number,
): PlatformAdminRecord {
  const roleRank = Number(row.role_rank ?? 0);
  return {
    id: row.id,
    sort: row.sort,
    username: row.username,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleNameI18nKey: row.role_name_key,
    roleNameEn: row.role_name,
    roleRank,
    ...(actorRank !== undefined ? { canManage: actorRank > roleRank } : {}),
    roleStatusCode: normalizeRoleStatusCode(
      row.role_status_code,
      row.role_status,
    ),
    roleStatus: row.role_status,
    statusCode: normalizeStatusCode(row.status_code, row.status),
    status: row.status,
    isSystem: row.account_type !== "personal",
    lastLoginAt: toIso(row.last_login_at),
    lastLoginIp: row.last_login_ip,
    remark: row.remark,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function normalizeStatusCode(
  value: string | null,
  legacyStatus: boolean,
): PlatformAdminRecord["statusCode"] {
  if (
    value === "active" ||
    value === "disabled" ||
    value === "locked" ||
    value === "pending" ||
    value === "suspended"
  ) {
    return value;
  }
  return legacyStatus ? "active" : "disabled";
}

interface PlatformAdminRow {
  id: string;
  sort: number;
  username: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  role_id: string;
  role_code: string;
  role_name_key: string;
  role_name: string;
  role_rank: number;
  role_status_code: string | null;
  role_status: boolean;
  status_code: string | null;
  status: boolean;
  account_type: string;
  last_login_at: Date | string | null;
  last_login_ip: string | null;
  remark: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const PLATFORM_ADMIN_SQL = `
  select
    a.id,
    a.sort,
    a.username,
    a.display_name,
    a.phone,
    a.email,
    a.role_id,
    r.role_code,
    r.role_name_key,
    r.role_name,
    r.rank as role_rank,
    r.status as role_status_code,
    (r.status = 'active') as role_status,
    a.status as status_code,
    (a.status = 'active') as status,
    a.account_type,
    a.last_login_at,
    a.last_login_ip,
    a.remark,
    a.created_at,
    a.updated_at
  from admin.operator_account a
  join admin.operator_role r
    on r.id = a.role_id
  where a.deleted_at is null
    and a.is_workforce_visible = true
  order by a.sort asc, a.created_at asc
`;

function normalizeRoleStatusCode(
  value: string | null,
  legacyStatus: boolean,
): PlatformAdminRecord["roleStatusCode"] {
  if (value === "active" || value === "disabled" || value === "archived") {
    return value;
  }
  return legacyStatus ? "active" : "disabled";
}

// ── B9-P1a write path helpers（追加）──────────────────────────────────────

function requireOperatorId(req: Request & RequestContext): string {
  const id = req.operator?.id;
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

function optionalSort(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException("sort must be a non-negative integer");
  }
  return value;
}

function normalizeAdminMetadataInput(
  body: UpdateAdminMetadataBody,
): NormalizedAdminMetadata {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const input: NormalizedAdminMetadata = {
    displayName: optionalBoundedText(body.displayName, "displayName", 50),
    email: optionalBoundedText(body.email, "email", 128),
    phone: optionalBoundedText(body.phone, "phone", 32),
    remark: optionalBoundedText(body.remark, "remark", 255),
    sort: optionalSort(body.sort),
  };
  if (
    input.displayName === null &&
    input.email === null &&
    input.phone === null &&
    input.remark === null &&
    input.sort === null
  ) {
    throw new BadRequestException("No editable metadata fields provided");
  }
  return input;
}

interface ChangeAdminRoleBody {
  roleId?: unknown;
}

interface CreateAdminBody {
  username?: unknown;
  displayName?: unknown;
  email?: unknown;
  phone?: unknown;
  roleId?: unknown;
}

interface NormalizedCreateAdmin {
  username: string;
  displayName: string;
  email: string;
  phone: string | null;
  roleId: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeCreateAdminInput(
  body: CreateAdminBody,
): NormalizedCreateAdmin {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body is required");
  }
  const username = requireBoundedText(body.username, "username", 64);
  const displayName = requireBoundedText(body.displayName, "displayName", 50);
  const email = requireBoundedText(body.email, "email", 128).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new BadRequestException("email must be a valid address");
  }
  const roleId = requireUuid(
    typeof body.roleId === "string" ? body.roleId : undefined,
    "roleId is required",
  );
  return {
    username,
    displayName,
    email,
    phone: optionalBoundedText(body.phone, "phone", 32),
    roleId,
  };
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

interface UpdateAdminMetadataBody {
  displayName?: unknown;
  email?: unknown;
  phone?: unknown;
  remark?: unknown;
  sort?: unknown;
}

interface NormalizedAdminMetadata {
  displayName: string | null;
  email: string | null;
  phone: string | null;
  remark: string | null;
  sort: number | null;
}

// ── B9-P1a write SQL（仅真实列，逐列对 80_admin.sql 核对）───────────────────

// TD-017 double-rank gate inputs: actor rank + target current rank/role_code,
// both resolved from DB in one round-trip (never trusted from the client).
const ACTOR_RANK_SQL = `
select r.rank
  from admin.operator_account a
  join admin.operator_role r on r.id = a.role_id
 where a.id = $1 and a.deleted_at is null
`;

const ADMIN_ROLE_RANKS_SQL = `
select actor_r.rank      as actor_rank,
       target_r.rank     as target_rank,
       target_r.role_code as target_role_code
  from admin.operator_account actor_a
  join admin.operator_role    actor_r  on actor_r.id  = actor_a.role_id
  cross join admin.operator_account target_a
  join admin.operator_role    target_r on target_r.id = target_a.role_id
 where actor_a.id = $1 and actor_a.deleted_at is null
   and target_a.id = $2 and target_a.deleted_at is null
`;

// Reassign the single role; only non-deleted accounts are editable.
const ADMIN_ROLE_ASSIGN_SQL = `
update admin.operator_account
set role_id    = $2,
    updated_by = $3,
    updated_at = now()
where id = $1 and deleted_at is null
returning id
`;

// Pre-update snapshot: current metadata (audit before-image) + role rank (rank gate)
// + FOR UPDATE (serialize concurrent edits of the same operator).
interface AdminMetadataSnapshotRow {
  display_name: string | null;
  email: string | null;
  phone: string | null;
  remark: string | null;
  sort: number | null;
  role_rank: number;
}
const ADMIN_METADATA_SNAPSHOT_SQL = `
select a.display_name, a.email, a.phone, a.remark, a.sort, r.rank as role_rank
  from admin.operator_account a
  join admin.operator_role r on r.id = a.role_id
 where a.id = $1 and a.deleted_at is null
 for update of a
`;

// Metadata-only edit (no status / credential). Omitted fields keep current value.
// Operator-changed email/phone drops its verified flag (TD-017 §③): a contact
// rewritten by staff loses out-of-band-delivery eligibility until the OWNER
// re-verifies it via self-service code. Only fires when a new value is submitted.
const ADMIN_METADATA_UPDATE_SQL = `
update admin.operator_account
set display_name   = coalesce($2, display_name),
    email          = coalesce($3, email),
    email_verified = case when $3 is not null then false else email_verified end,
    phone          = coalesce($4, phone),
    phone_verified = case when $4 is not null then false else phone_verified end,
    remark         = coalesce($5, remark),
    sort           = coalesce($6, sort),
    updated_by     = $7,
    updated_at     = now()
where id = $1 and deleted_at is null
returning id
`;

// Single-row enrichment (same shape as the list) for write-endpoint responses.
const PLATFORM_ADMIN_BY_ID_SQL = `
  select
    a.id,
    a.sort,
    a.username,
    a.display_name,
    a.phone,
    a.email,
    a.role_id,
    r.role_code,
    r.role_name_key,
    r.role_name,
    r.rank as role_rank,
    r.status as role_status_code,
    (r.status = 'active') as role_status,
    a.status as status_code,
    (a.status = 'active') as status,
    a.account_type,
    a.last_login_at,
    a.last_login_ip,
    a.remark,
    a.created_at,
    a.updated_at
  from admin.operator_account a
  join admin.operator_role r
    on r.id = a.role_id
  where a.id = $1 and a.deleted_at is null
`;
