/**
 * tenants.router.ts - 租户运营路由
 * @package @vxture/bff-admin
 *
 * Description: 平台租户运营读接口，接 tenancy.tenants（18-schema）。
 *   列表 + 详情共用同一投影：tenancy.tenants join tenant_profiles（展示 / 联系字段）、
 *   account.users(+user_profiles) 取 owner 名 / 邮箱、tenant_memberships 聚合成员数、
 *   kyc.tenant_verifications 取实名审核时间戳。营收 / token / 订阅等跨域字段（billing/
 *   metering/product）此读路径不覆盖，按契约给零值 / 空数组占位。
 *
 * @author AI-Generated
 * @date 2026-07-04
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
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  RequestContext,
  TenantOperationRecord,
  TenantOperationStatus,
  TenantVerificationStatus,
} from "../types/console.types";

@Controller("api/tenants")
export class TenantsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  /**
   * 详情路由的参数是**面向用户的租户编码**（`tenant_no`，如 `100104`），不是
   * 内部 UUID——地址栏是可见面，UUID 不在任何场景对外展示。
   *
   * 同时仍接受 UUID：存量书签、审计日志里记的 id、以及内部工具都还在传它。
   * `tenant_no` 有库级唯一约束（`uq_tenants_tenant_no`），当查找键是安全的。
   * 解不出来就是 404，和「传了个不存在的 UUID」同一个结果，不是 400——
   * 编码写错和格式非法是两回事。
   *
   * 这里只需要区分「传进来的是 id 还是编码」，形状够了，真假交给查询判。
   */
  private async resolveTenantId(value: string): Promise<string> {
    if (UUID_RE.test(value ?? "")) return value;
    // `tenant_no` 是 **bigint**（不像 bill_no / order_no 是 varchar）：把非数字的
    // 串交给它比较，Postgres 会在转型时抛 22P02，出去是 500 而不是 404。所以先
    // 用形状挡一道——非数字必然不是租户编码。19 位是 bigint 的量级上限。
    if (!/^\d{1,19}$/.test(value ?? "")) {
      throw new NotFoundException("Tenant not found");
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from tenancy.tenants where tenant_no = $1::bigint and deleted_at is null limit 1`,
      [value],
    );
    if (!rows[0]) throw new NotFoundException("Tenant not found");
    return rows[0].id;
  }

  @Get()
  async listTenants(
    @Req() req: Request & RequestContext,
  ): Promise<TenantOperationRecord[]> {
    assertCanManageTenants(req);

    const { rows } = await this.pool.query<TenantOperationRow>(TENANT_LIST_SQL);
    return rows.map(mapTenantRow);
  }

  // Static "verifications" routes MUST be declared before the ":id" routes:
  // Nest/Express match in declaration order, so a later static segment would be
  // captured by ":id" (id="verifications" → uuid cast 22P02 → 500).

  /**
   * GET /api/tenants/verifications?status=
   * kyc.tenant_verifications join tenancy.tenants。
   * 查询参数（可选）：status ∈ unverified|pending|verified|rejected。
   * 响应：TenantVerificationRecord[]。
   */
  @Get("verifications")
  async listTenantVerifications(
    @Req() req: Request & RequestContext,
    @Query("status") status?: string,
  ): Promise<TenantVerificationRecord[]> {
    assertCanManageTenants(req);

    const statusFilter = status ? assertVerificationStatus(status) : null;
    const { rows } = await this.pool.query<TenantVerificationRow>(
      `${TENANT_VERIFICATION_SELECT}
       where ($1::varchar is null or v.status = $1)
       order by v.created_at desc
       limit 500`,
      [statusFilter],
    );
    return rows.map(mapVerificationRow);
  }

  /**
   * POST /api/tenants/verifications/:id/approve
   * kyc.tenant_verifications.status → 'verified' + reviewed_at=now() + reviewer_id=operator。
   *   同步反规范化只读 tenancy.tenants.verification_status → 'verified'。
   * 请求体：无。响应：TenantVerificationRecord。
   */
  @Post("verifications/:id/approve")
  async approveTenantVerification(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantVerificationRecord> {
    return this.reviewVerification(req, id, "verified", null);
  }

  /**
   * POST /api/tenants/verifications/:id/reject
   * kyc.tenant_verifications.status → 'rejected' + reviewed_at=now() + reviewer_id +
   *   reject_reason。同步 tenancy.tenants.verification_status → 'rejected'。
   * 请求体：{ reason: string }（必填，≤255）。响应：TenantVerificationRecord。
   */
  @Post("verifications/:id/reject")
  async rejectTenantVerification(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: RejectVerificationBody,
  ): Promise<TenantVerificationRecord> {
    const reason = optionalString(body?.reason, 255, "reason");
    if (!reason) {
      throw new BadRequestException("reason is required");
    }
    return this.reviewVerification(req, id, "rejected", reason);
  }

  @Get(":id")
  async getTenant(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantOperationRecord> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);

    const { rows } = await this.pool.query<TenantOperationRow>(
      TENANT_DETAIL_SQL,
      [tenantId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Tenant not found");
    }
    return mapTenantRow(row);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // B10 tenant-governance — 追加写/读聚合端点（Wave 2 前端接线契约）。
  // 凭据类动作（重置密码/MFA 等）不在本轮，见 openIssues。
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * PUT /api/tenants/:id
   * 更新 tenancy.tenants 的 name/status + upsert tenancy.tenant_profiles 展示字段。
   * 请求体（全部可选，仅更新提供的字段；null/缺省不覆盖已有值）：
   *   { name?: string; status?: "active"|"suspended"|"cancelled";
   *     industry?: string; scale?: string; description?: string; website?: string;
   *     contactName?: string; contactRole?: string; contactEmail?: string;
   *     contactPhone?: string; countryCode?: string; address?: string; postalCode?: string }
   * 响应：TenantOperationRecord（同 GET /:id 投影）。
   * status 口径映射（前端→DB tenants.status）：active→active / suspended→suspended /
   *   cancelled→deleted；'trial' 无 DB 值，拒绝。
   */
  @Put(":id")
  async updateTenant(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: UpdateTenantBody,
  ): Promise<TenantOperationRecord> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);

    const name = optionalString(body?.name, 128, "name");
    const dbStatus = mapIncomingTenantStatus(body?.status);
    const industry = optionalString(body?.industry, 64, "industry");
    const scale = optionalString(body?.scale, 32, "scale");
    const description = optionalText(body?.description);
    const website = optionalString(body?.website, 255, "website");
    const contactName = optionalString(body?.contactName, 96, "contactName");
    const contactRole = optionalString(body?.contactRole, 96, "contactRole");
    const contactEmail = optionalString(
      body?.contactEmail,
      128,
      "contactEmail",
    );
    const contactPhone = optionalString(body?.contactPhone, 32, "contactPhone");
    const countryCode = optionalString(body?.countryCode, 8, "countryCode");
    const address = optionalString(body?.address, 255, "address");
    const postalCode = optionalString(body?.postalCode, 16, "postalCode");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const existing = await client.query<{ id: string }>(
        `select id from tenancy.tenants where id = $1 and deleted_at is null for update`,
        [tenantId],
      );
      if (!existing.rows[0]) {
        throw new NotFoundException("Tenant not found");
      }

      await client.query(
        `
          update tenancy.tenants
          set name       = coalesce($2, name),
              status     = coalesce($3, status),
              updated_at = now()
          where id = $1
            and deleted_at is null
        `,
        [tenantId, name, dbStatus],
      );

      await client.query(
        `
          insert into tenancy.tenant_profiles (
            tenant_id, description, industry, scale, website,
            country_code, address, postal_code, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, now())
          on conflict (tenant_id) do update set
            description   = coalesce(excluded.description,   tenancy.tenant_profiles.description),
            industry      = coalesce(excluded.industry,      tenancy.tenant_profiles.industry),
            scale         = coalesce(excluded.scale,         tenancy.tenant_profiles.scale),
            website       = coalesce(excluded.website,       tenancy.tenant_profiles.website),
            country_code  = coalesce(excluded.country_code,  tenancy.tenant_profiles.country_code),
            address       = coalesce(excluded.address,       tenancy.tenant_profiles.address),
            postal_code   = coalesce(excluded.postal_code,   tenancy.tenant_profiles.postal_code),
            updated_at    = now()
        `,
        [
          tenantId,
          description,
          industry,
          scale,
          website,
          countryCode,
          address,
          postalCode,
        ],
      );

      // Primary contact now lives in tenancy.tenant_contacts 1:N (data_identity_200 §5.8).
      // Admin edits keep the same merge semantics as the profile fields above: a null
      // input keeps the existing value; role maps to title. A fresh row can only be
      // created once the merged state satisfies name+email NOT NULL.
      if (
        contactName !== null ||
        contactRole !== null ||
        contactEmail !== null ||
        contactPhone !== null
      ) {
        const cur = await client.query<{
          id: string;
          name: string;
          title: string | null;
          email: string;
          phone: string | null;
        }>(
          `select id, name, title, email, phone from tenancy.tenant_contacts
            where tenant_id = $1 and contact_type = 'primary'
            order by created_at asc limit 1`,
          [tenantId],
        );
        const prev = cur.rows[0];
        const mergedName = contactName ?? prev?.name ?? null;
        const mergedTitle = contactRole ?? prev?.title ?? null;
        const mergedEmail = contactEmail ?? prev?.email ?? null;
        const mergedPhone = contactPhone ?? prev?.phone ?? null;
        if (prev) {
          await client.query(
            `update tenancy.tenant_contacts
                set name = $2, title = $3, email = $4, phone = $5, updated_at = now()
              where id = $1`,
            [prev.id, mergedName, mergedTitle, mergedEmail, mergedPhone],
          );
        } else if (mergedName && mergedEmail) {
          await client.query(
            `insert into tenancy.tenant_contacts (tenant_id, contact_type, name, title, email, phone)
             values ($1, 'primary', $2, $3, $4, $5)`,
            [tenantId, mergedName, mergedTitle, mergedEmail, mergedPhone],
          );
        }
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return this.loadTenant(tenantId);
  }

  /**
   * POST /api/tenants/:id/suspend
   * tenancy.tenants.status → 'suspended'。请求体：无。
   * 响应：TenantOperationRecord。
   */
  @Post(":id/suspend")
  @RequireStepUp()
  async suspendTenant(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantOperationRecord> {
    assertCanManageTenantLifecycle(req);
    const tenantId = await this.resolveTenantId(id);

    const { rowCount } = await this.rwPool.query(
      `
        update tenancy.tenants
        set status = 'suspended', updated_at = now()
        where id = $1 and deleted_at is null
      `,
      [tenantId],
    );
    if (!rowCount) {
      throw new NotFoundException("Tenant not found");
    }
    return this.loadTenant(tenantId);
  }

  /**
   * POST /api/tenants/:id/resume
   * tenancy.tenants.status → 'active'。请求体：无。
   * 响应：TenantOperationRecord。
   */
  @Post(":id/resume")
  @RequireStepUp()
  async resumeTenant(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantOperationRecord> {
    assertCanManageTenantLifecycle(req);
    const tenantId = await this.resolveTenantId(id);

    const { rowCount } = await this.rwPool.query(
      `
        update tenancy.tenants
        set status = 'active', updated_at = now()
        where id = $1 and deleted_at is null
      `,
      [tenantId],
    );
    if (!rowCount) {
      throw new NotFoundException("Tenant not found");
    }
    return this.loadTenant(tenantId);
  }

  /**
   * GET /api/tenants/:id/members
   * tenancy.tenant_memberships join account.users(+user_profiles) + access.roles。
   * 响应：TenantMemberRecord[]（见接口定义）。
   */
  @Get(":id/members")
  async listTenantMembers(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantMemberRecord[]> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);

    const { rows } = await this.pool.query<TenantMemberRow>(
      `${TENANT_MEMBER_SELECT} order by m.created_at asc`,
      [tenantId],
    );
    return rows.map(mapMemberRow);
  }

  /**
   * POST /api/tenants/:id/members/:userId/role
   * 改 tenancy.tenant_memberships.role_id/role_scope。role_scope 由目标角色的
   *   access.roles.scope 决定（须为 'tenant'——租户成员不得挂 workspace 角色，
   *   由 uq_roles_id_scope 复合约束保证）。
   * 请求体：{ roleId: string }。响应：TenantMemberRecord。
   */
  @Post(":id/members/:userId/role")
  async changeTenantMemberRole(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: ChangeMemberRoleBody,
  ): Promise<TenantMemberRecord> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);
    const memberUserId = requireUuid(userId, "Invalid member user id");
    const roleId = requireUuid(body?.roleId, "Invalid role id");

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const roleResult = await client.query<{ id: string; scope: string }>(
        `select id, scope from access.roles where id = $1`,
        [roleId],
      );
      const role = roleResult.rows[0];
      if (!role) {
        throw new BadRequestException("Target role not found");
      }
      if (role.scope !== "tenant") {
        throw new BadRequestException(
          "Tenant membership can only hold a tenant-scope role",
        );
      }

      const membership = await client.query<{ id: string }>(
        `
          select id from tenancy.tenant_memberships
          where tenant_id = $1 and user_id = $2
          for update
        `,
        [tenantId, memberUserId],
      );
      if (!membership.rows[0]) {
        throw new NotFoundException("Tenant member not found");
      }

      await client.query(
        `
          update tenancy.tenant_memberships
          set role_id = $3, role_scope = $4, updated_at = now()
          where tenant_id = $1 and user_id = $2
        `,
        [tenantId, memberUserId, roleId, role.scope],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return this.loadTenantMember(tenantId, memberUserId);
  }

  /**
   * POST /api/tenants/:id/members/:userId/suspend
   * tenancy.tenant_memberships.status → 'suspended'。请求体：无。
   * 响应：TenantMemberRecord。
   */
  @Post(":id/members/:userId/suspend")
  async suspendTenantMember(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<TenantMemberRecord> {
    return this.setMemberStatus(req, id, userId, "suspended");
  }

  /**
   * POST /api/tenants/:id/members/:userId/remove
   * tenancy.tenant_memberships.status → 'removed'（软移除，保留行）。请求体：无。
   * 响应：TenantMemberRecord。
   */
  @Post(":id/members/:userId/remove")
  async removeTenantMember(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<TenantMemberRecord> {
    return this.setMemberStatus(req, id, userId, "removed");
  }

  private async setMemberStatus(
    req: Request & RequestContext,
    id: string,
    userId: string,
    status: "suspended" | "removed",
  ): Promise<TenantMemberRecord> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);
    const memberUserId = requireUuid(userId, "Invalid member user id");

    const { rowCount } = await this.rwPool.query(
      `
        update tenancy.tenant_memberships
        set status = $3, updated_at = now()
        where tenant_id = $1 and user_id = $2
      `,
      [tenantId, memberUserId, status],
    );
    if (!rowCount) {
      throw new NotFoundException("Tenant member not found");
    }
    return this.loadTenantMember(tenantId, memberUserId);
  }

  private async reviewVerification(
    req: Request & RequestContext,
    id: string,
    nextStatus: "verified" | "rejected",
    reason: string | null,
  ): Promise<TenantVerificationRecord> {
    assertCanManageTenants(req);
    const verificationId = requireUuid(id, "Invalid verification id");
    const reviewerId = requireUuid(
      req.user?.id,
      "Invalid platform operator principal",
    );

    const client = await this.rwPool.connect();
    try {
      await client.query("begin");

      const current = await client.query<{ id: string; tenant_id: string }>(
        `
          select id, tenant_id from kyc.tenant_verifications
          where id = $1
          for update
        `,
        [verificationId],
      );
      const record = current.rows[0];
      if (!record) {
        throw new NotFoundException("Tenant verification not found");
      }

      await client.query(
        `
          update kyc.tenant_verifications
          set status        = $2,
              reviewer_id   = $3,
              reviewed_at   = now(),
              reject_reason = $4,
              updated_at    = now()
          where id = $1
        `,
        [verificationId, nextStatus, reviewerId, reason],
      );

      await client.query(
        `
          update tenancy.tenants
          set verification_status = $2, updated_at = now()
          where id = $1
        `,
        [record.tenant_id, nextStatus],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return this.loadVerification(verificationId);
  }

  // ── 读回助手（复用现有只读投影，返回操作后最新状态）───────────────────────────
  private async loadTenant(tenantId: string): Promise<TenantOperationRecord> {
    const { rows } = await this.pool.query<TenantOperationRow>(
      TENANT_DETAIL_SQL,
      [tenantId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Tenant not found");
    }
    return mapTenantRow(row);
  }

  private async loadTenantMember(
    tenantId: string,
    userId: string,
  ): Promise<TenantMemberRecord> {
    const { rows } = await this.pool.query<TenantMemberRow>(
      `${TENANT_MEMBER_SELECT} and m.user_id = $2 limit 1`,
      [tenantId, userId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Tenant member not found");
    }
    return mapMemberRow(row);
  }

  private async loadVerification(
    verificationId: string,
  ): Promise<TenantVerificationRecord> {
    const { rows } = await this.pool.query<TenantVerificationRow>(
      `${TENANT_VERIFICATION_SELECT} where v.id = $1 limit 1`,
      [verificationId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Tenant verification not found");
    }
    return mapVerificationRow(row);
  }
}

function assertCanManageTenants(req: Request & RequestContext): void {
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

// Suspend/resume are tenant lifecycle transitions — a high-risk (危) operation in
// data_admin_200 §4.2, gated on the dedicated tenant:lifecycle.suspend code
// (super_admin/admin only) rather than the broader profile.manage, and additionally
// step-up gated (@RequireStepUp on the handlers).
function assertCanManageTenantLifecycle(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("tenant:lifecycle.suspend")) {
    throw new ForbiddenException("Missing tenant:lifecycle.suspend capability");
  }
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toCount(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

// tenants.status 枚举 = active/suspended/deleted；前端口径 trial/active/suspended/cancelled。
// deleted→cancelled，其余原样透传，无 trial 来源。
function normalizeStatus(status: string): TenantOperationStatus {
  if (status === "active") return "active";
  if (status === "suspended") return "suspended";
  if (status === "deleted") return "cancelled";
  if (status === "trial") return "trial";
  return "active";
}

function normalizeVerification(status: string): TenantVerificationStatus {
  if (
    status === "unverified" ||
    status === "pending" ||
    status === "verified" ||
    status === "rejected"
  ) {
    return status;
  }
  return "unverified";
}

function mapTenantRow(row: TenantOperationRow): TenantOperationRecord {
  const ownerName = row.owner_display_name ?? row.owner_account ?? "未设置";
  // region：新库 tenant_profiles 无 province/city，仅 country_code/address → 就近兜底。
  const region = row.address ?? row.country_code ?? "未设置";
  const verifiedStatus = normalizeVerification(row.verification_status);

  return {
    id: row.id,
    tenantCode: String(row.tenant_no),
    tenantName: row.name,
    displayName: row.name,
    tenantType: row.type === "personal" ? "individual" : "company",
    status: normalizeStatus(row.status),
    verifiedStatus,
    verificationSubmittedAt: toIsoOrNull(row.verification_submitted_at),
    verifiedAt:
      verifiedStatus === "verified"
        ? toIsoOrNull(row.verification_reviewed_at)
        : null,
    // riskLevel：退役 tenant_setting 无后继，默认 normal（同 tickets 口径）。
    riskLevel: "normal",
    region,
    industry: row.industry ?? "未设置",
    scale: row.scale ?? "未设置",
    ownerName,
    ownerEmail: row.owner_email ?? "",
    contactName: row.contact_name ?? ownerName,
    contactPhone: row.contact_phone ?? "",
    createdAt: toIso(row.created_at),
    // lastActiveAt：无活跃度事件源，用 updated_at 作近似。
    lastActiveAt: toIso(row.updated_at),
    memberCount: toCount(row.member_count),
    activeMemberCount: toCount(row.active_member_count),
    // 以下跨域聚合（billing/metering/product/support）此读路径不覆盖，按契约占位。
    adminCount: 0,
    subscriptionCount: 0,
    productCount: 0,
    monthlyRevenue: 0,
    monthlyCost: 0,
    grossMarginRate: 0,
    tokenUsed: 0,
    tokenQuota: 0,
    ticketOpenCount: 0,
    satisfaction: 0,
    sla: "未设置",
    tags: [],
    notes: row.description ?? "",
    members: [],
    subscriptions: [],
    usage: [],
    modelPolicies: [],
    auditEvents: [],
    tickets: [],
  };
}

// tenancy.tenants(软删 deleted_at) join tenant_profiles(1:1) + owner(account.users/user_profiles)
// + 成员计数(tenant_memberships) + 最新实名审核(kyc.tenant_verifications)。
const TENANT_SELECT = `
select
  t.id,
  t.tenant_no,
  t.name,
  t.type,
  t.status,
  t.verification_status,
  t.created_at,
  t.updated_at,
  p.industry,
  p.scale,
  pc.name  as contact_name,
  pc.phone as contact_phone,
  p.country_code,
  p.address,
  p.description,
  u.email        as owner_email,
  u.account      as owner_account,
  up.display_name as owner_display_name,
  ver.created_at  as verification_submitted_at,
  ver.reviewed_at as verification_reviewed_at,
  (
    select count(*) from tenancy.tenant_memberships m
    where m.tenant_id = t.id and m.status <> 'removed'
  ) as member_count,
  (
    select count(*) from tenancy.tenant_memberships m
    where m.tenant_id = t.id and m.status = 'active'
  ) as active_member_count
from tenancy.tenants t
left join tenancy.tenant_profiles p on p.tenant_id = t.id
left join lateral (
  select c.name, c.phone
  from tenancy.tenant_contacts c
  where c.tenant_id = t.id and c.contact_type = 'primary'
  order by c.created_at asc
  limit 1
) pc on true
left join account.users u on u.id = t.owner_user_id
left join account.user_profiles up on up.user_id = u.id
left join lateral (
  select tv.created_at, tv.reviewed_at
  from kyc.tenant_verifications tv
  where tv.tenant_id = t.id
  order by tv.created_at desc
  limit 1
) ver on true
where t.deleted_at is null
`;

const TENANT_LIST_SQL = `${TENANT_SELECT}
order by t.created_at desc
limit 500
`;

const TENANT_DETAIL_SQL = `${TENANT_SELECT}
  and t.id = $1
limit 1
`;

interface TenantOperationRow {
  id: string;
  tenant_no: string | number;
  name: string;
  type: string;
  status: string;
  verification_status: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  industry: string | null;
  scale: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  country_code: string | null;
  address: string | null;
  description: string | null;
  owner_email: string | null;
  owner_account: string | null;
  owner_display_name: string | null;
  verification_submitted_at: Date | string | null;
  verification_reviewed_at: Date | string | null;
  member_count: string | number | null;
  active_member_count: string | number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// B10 追加：写路径入参校验 + 成员/实名读投影 + 契约类型（append-only）。
// ─────────────────────────────────────────────────────────────────────────────

// 版本位/变体位刻意不卡：判据与理由见 governance.shared.ts 的 `UUID_RE` 注释
//（校验器不该比存储层更严；种子 id 的变体位是段值本身，如 …-4000-d000-…）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string | undefined, message: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestException(message);
  }
  return value;
}

// 可选字符串：undefined/null → null（不覆盖）；空串 → null；超长 → 400。
function optionalString(
  value: unknown,
  maxLen: number,
  field: string,
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

// text 列无长度上限，允许清空为 null（空串归一化为 null）。
function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("description must be a string");
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// 前端 TenantOperationStatus → DB tenancy.tenants.status（CHECK: active/suspended/deleted）。
function mapIncomingTenantStatus(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("status must be a string");
  }
  switch (value) {
    case "active":
      return "active";
    case "suspended":
      return "suspended";
    case "cancelled":
      return "deleted";
    default:
      throw new BadRequestException(`Unsupported tenant status: ${value}`);
  }
}

function assertVerificationStatus(value: string): string {
  if (
    value === "unverified" ||
    value === "pending" ||
    value === "verified" ||
    value === "rejected"
  ) {
    return value;
  }
  throw new BadRequestException(`Unsupported verification status: ${value}`);
}

function mapMemberRow(row: TenantMemberRow): TenantMemberRecord {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    name: row.display_name ?? row.account ?? "未设置",
    account: row.account ?? "",
    email: row.email ?? "",
    userStatus: row.user_status ?? "",
    roleId: row.role_id,
    roleScope: row.role_scope,
    roleCode: row.role_code ?? "",
    roleName: row.role_name ?? row.role_code ?? "",
    status: row.status,
    title: row.title ?? null,
    department: row.department ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapVerificationRow(
  row: TenantVerificationRow,
): TenantVerificationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantNo: String(row.tenant_no),
    tenantName: row.tenant_name,
    tenantType: row.tenant_type,
    tenantStatus: row.tenant_status,
    verificationType: row.verification_type,
    businessLicenseNo: row.business_license_no ?? null,
    businessLicenseImageRef: row.business_license_image_ref ?? null,
    legalPersonName: row.legal_person_name ?? null,
    status: normalizeVerification(row.status),
    reviewerId: row.reviewer_id ?? null,
    reviewedAt: toIsoOrNull(row.reviewed_at),
    rejectReason: row.reject_reason ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// tenancy.tenant_memberships join account.users(+user_profiles) + access.roles。
// 复用 $1=tenant_id；调用方可追加 `order by …` 或 `and m.user_id = $2 …`。
const TENANT_MEMBER_SELECT = `
select
  m.id           as membership_id,
  m.user_id,
  m.role_id,
  m.role_scope,
  m.status,
  m.title,
  m.department,
  m.created_at,
  m.updated_at,
  u.account,
  u.email,
  u.status       as user_status,
  up.display_name,
  r.role_code         as role_code,
  r.role_name         as role_name
from tenancy.tenant_memberships m
left join account.users u on u.id = m.user_id
left join account.user_profiles up on up.user_id = m.user_id
left join access.roles r on r.id = m.role_id
where m.tenant_id = $1
`;

// kyc.tenant_verifications join tenancy.tenants。调用方追加 where/order。
const TENANT_VERIFICATION_SELECT = `
select
  v.id,
  v.tenant_id,
  v.verification_type,
  v.business_license_no,
  v.business_license_image_ref,
  v.legal_person_name,
  v.status,
  v.reviewer_id,
  v.reviewed_at,
  v.reject_reason,
  v.created_at,
  v.updated_at,
  t.name      as tenant_name,
  t.tenant_no,
  t.type      as tenant_type,
  t.status    as tenant_status
from kyc.tenant_verifications v
join tenancy.tenants t on t.id = v.tenant_id
`;

interface UpdateTenantBody {
  name?: unknown;
  status?: unknown;
  industry?: unknown;
  scale?: unknown;
  description?: unknown;
  website?: unknown;
  contactName?: unknown;
  contactRole?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  countryCode?: unknown;
  address?: unknown;
  postalCode?: unknown;
}

interface ChangeMemberRoleBody {
  roleId?: string;
}

interface RejectVerificationBody {
  reason?: unknown;
}

interface TenantMemberRow {
  membership_id: string;
  user_id: string;
  role_id: string;
  role_scope: string;
  status: string;
  title: string | null;
  department: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  account: string | null;
  email: string | null;
  user_status: string | null;
  display_name: string | null;
  role_code: string | null;
  role_name: string | null;
}

// 契约：GET /:id/members 与成员写端点的返回元素。
interface TenantMemberRecord {
  membershipId: string;
  userId: string;
  name: string;
  account: string;
  email: string;
  userStatus: string;
  roleId: string;
  roleScope: string;
  roleCode: string;
  roleName: string;
  status: string; // active | suspended | removed
  title: string | null;
  department: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TenantVerificationRow {
  id: string;
  tenant_id: string;
  verification_type: string;
  business_license_no: string | null;
  business_license_image_ref: string | null;
  legal_person_name: string | null;
  status: string;
  reviewer_id: string | null;
  reviewed_at: Date | string | null;
  reject_reason: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  tenant_name: string;
  tenant_no: string | number;
  tenant_type: string;
  tenant_status: string;
}

// 契约：GET /verifications 与 approve/reject 的返回元素。
interface TenantVerificationRecord {
  id: string;
  tenantId: string;
  tenantNo: string;
  tenantName: string;
  tenantType: string; // personal | organization
  tenantStatus: string; // active | suspended | deleted
  verificationType: string; // individual | enterprise
  businessLicenseNo: string | null;
  businessLicenseImageRef: string | null;
  legalPersonName: string | null;
  status: TenantVerificationStatus; // unverified | pending | verified | rejected
  reviewerId: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}
