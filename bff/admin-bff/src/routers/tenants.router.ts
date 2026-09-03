/**
 * tenants.router.ts - 租户运营路由
 * @package @vxture/bff-admin
 *
 * Description: 平台租户运营读接口，接 tenancy.tenants（18-schema）。
 *   列表 + 详情共用同一标量投影：tenancy.tenants join tenant_profiles（展示 / 联系字段）、
 *   account.users(+user_profiles) 取 owner 名 / 邮箱、tenant_memberships 聚合成员数、
 *   kyc.tenant_verifications 取实名审核时间戳，外加按 tenant_id 相关子查询取的跨域计数
 *   （metering.subscriptions / product.plan_components / billing.payments / support.tickets /
 *   admin.risk_records / session.auth_sessions）。详情再挂五段明细数组（成员 / 订阅 /
 *   当月用量 / 未结工单 / 审计事件），列表不带——2026-08-30 之前这些字段全是字面占位
 *   （0 / "未设置" / []），混在一份库里读出来的响应里，读者分不出哪个是量出来的。
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
import { SUBSCRIPTION_STATUSES } from "@vxture-platform/shared";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import type {
  RequestContext,
  TenantOperationAuditEvent,
  TenantOperationDetailRecord,
  TenantOperationMember,
  TenantOperationRecord,
  TenantOperationStatus,
  TenantOperationSubscription,
  TenantOperationTicket,
  TenantOperationUsageMetric,
  TenantRiskLevel,
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

  /**
   * GET /api/tenants/:id
   * 响应：TenantOperationDetailRecord = 列表投影 + members / subscriptions / usage /
   * auditEvents / tickets 五段明细（各自的口径见对应 SQL 常量的注释）。
   */
  @Get(":id")
  async getTenant(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<TenantOperationDetailRecord> {
    assertCanManageTenants(req);
    const tenantId = await this.resolveTenantId(id);
    return this.loadTenant(tenantId);
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
  ): Promise<TenantOperationDetailRecord> {
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
  ): Promise<TenantOperationDetailRecord> {
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
  ): Promise<TenantOperationDetailRecord> {
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
  /**
   * 详情 = 标量投影（与列表同一条 SQL）+ 五段明细。先拿主行判 404，再并发打五条
   * 明细——它们互不依赖，串行只是白等；只读池，不需要同一连接。
   */
  private async loadTenant(
    tenantId: string,
  ): Promise<TenantOperationDetailRecord> {
    const { rows } = await this.pool.query<TenantOperationRow>(
      TENANT_DETAIL_SQL,
      [tenantId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Tenant not found");
    }

    const [members, subscriptions, usage, auditEvents, tickets] =
      await Promise.all([
        this.pool.query<TenantMemberRow>(TENANT_DETAIL_MEMBERS_SQL, [tenantId]),
        this.pool.query<TenantSubscriptionRow>(
          TENANT_DETAIL_SUBSCRIPTIONS_SQL,
          [tenantId],
        ),
        this.pool.query<TenantUsageRow>(TENANT_DETAIL_USAGE_SQL, [tenantId]),
        this.pool.query<TenantAuditRow>(TENANT_DETAIL_AUDIT_SQL, [tenantId]),
        this.pool.query<TenantTicketRow>(TENANT_DETAIL_TICKETS_SQL, [tenantId]),
      ]);

    return {
      ...mapTenantRow(row),
      members: members.rows.map(mapOperationMemberRow),
      subscriptions: subscriptions.rows.map(mapOperationSubscriptionRow),
      usage: usage.rows.map(mapUsageRow),
      auditEvents: auditEvents.rows.map(mapAuditRow),
      tickets: tickets.rows.map(mapTicketRow),
    };
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
    riskLevel: normalizeRiskLevel(row.risk_level),
    region,
    industry: row.industry ?? "未设置",
    scale: row.scale ?? "未设置",
    ownerName,
    ownerEmail: row.owner_email ?? "",
    contactName: row.contact_name ?? ownerName,
    contactPhone: row.contact_phone ?? "",
    createdAt: toIso(row.created_at),
    lastActiveAt: toIsoOrNull(row.last_active_at),
    memberCount: toCount(row.member_count),
    activeMemberCount: toCount(row.active_member_count),
    adminCount: toCount(row.admin_count),
    subscriptionCount: toCount(row.subscription_count),
    productCount: toCount(row.product_count),
    monthlyRevenue: toMoney(row.month_revenue),
    totalRevenue: toMoney(row.total_revenue),
    ticketOpenCount: toCount(row.ticket_open_count),
    notes: row.description ?? "",
  };
}

// 2026-08-30 之前这里写死 "normal"（退役 tenant_setting 无后继）。现在从 admin.risk_records
// 派生：没有未复核的记录就是 normal；CHECK 只放行三个值，第四个值说明契约破了，抛出比
// 静默降成 normal 好——后者把一次契约破裂伪装成「没有风险」。
function normalizeRiskLevel(value: string | null): TenantRiskLevel {
  if (value === null) return "normal";
  if (value === "normal" || value === "follow_up" || value === "high") {
    return value;
  }
  throw new Error(`Unknown risk level from DB: ${value}`);
}

// numeric(12,2) 经 pg 出来是字符串；两位小数是列定义，四舍五入只是去掉浮点尾巴。
function toMoney(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// pg 对 numeric 给字符串、对 bigint 也给字符串；null 保持 null（「没有配额池」≠「配额为 0」）。
function toNullableNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function assertDomain<T extends string>(
  value: string,
  domain: readonly T[],
  what: string,
): T {
  const hit = domain.find((item) => item === value);
  if (!hit) throw new Error(`Unknown ${what} from DB: ${value}`);
  return hit;
}

const SUBSCRIPTION_KINDS = ["paid", "trial", "free"] as const;
const CYCLE_UNITS = ["day", "week", "month", "year", "perpetual"] as const;
const AUDIT_RESULTS = ["success", "failure", "denied"] as const;
const TICKET_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

function mapOperationMemberRow(row: TenantMemberRow): TenantOperationMember {
  return {
    id: row.membership_id,
    accountCode: row.account ?? "",
    name: row.display_name ?? row.account ?? "",
    email: row.email ?? "",
    role: row.role_name ?? row.role_code ?? "",
    roleCode: row.role_code ?? "",
    // 查询已过滤 removed；CHECK 只剩 active/suspended。
    status: row.status === "suspended" ? "suspended" : "active",
    joinedAt: toIso(row.created_at),
    lastActiveAt: toIsoOrNull(row.last_active_at),
    lastActiveIp: row.last_active_ip ?? null,
  };
}

function mapOperationSubscriptionRow(
  row: TenantSubscriptionRow,
): TenantOperationSubscription {
  return {
    id: row.id,
    orderNo: row.order_no ?? null,
    productNames: row.product_names ?? [],
    planName: row.plan_name ?? null,
    planVersion: row.version_no ?? null,
    kind: assertDomain(
      row.subscription_kind,
      SUBSCRIPTION_KINDS,
      "subscription kind",
    ),
    status: assertDomain(
      row.status,
      SUBSCRIPTION_STATUSES,
      "subscription status",
    ),
    cycleUnit: assertDomain(row.cycle_unit, CYCLE_UNITS, "cycle unit"),
    cycleCount: toCount(row.cycle_count) || 1,
    payAmount: row.pay_amount === null ? null : toMoney(row.pay_amount),
    currency: row.currency ?? "CNY",
    autoRenew: Boolean(row.auto_renew),
    startedAt: toIso(row.start_at),
    endsAt: toIsoOrNull(row.end_at),
    nextRenewalAt: toIsoOrNull(row.next_renewal_at),
  };
}

function mapUsageRow(row: TenantUsageRow): TenantOperationUsageMetric {
  return {
    metricKey: row.metric_key,
    unit: row.unit ?? null,
    monthUsage: toCount(row.month_amount),
    quotaLimit: toNullableNumber(row.quota_limit),
    quotaUsed: toNullableNumber(row.quota_used),
  };
}

function mapAuditRow(row: TenantAuditRow): TenantOperationAuditEvent {
  return {
    id: row.id,
    action: row.action,
    // operator 有平台账号名；customer 有用户资料名 / 登录句柄；system / api 只剩 actor_type。
    actor:
      row.operator_name ??
      row.customer_display_name ??
      row.customer_account ??
      row.actor_type,
    at: toIso(row.created_at),
    result: assertDomain(row.result, AUDIT_RESULTS, "audit result"),
  };
}

// 只取未结工单（见 TENANT_OPEN_TICKET_STATUSES），所以只会落到 open / processing；
// blocked / closed 两档留给 tickets.router 的全量口径。
function mapTicketRow(row: TenantTicketRow): TenantOperationTicket {
  return {
    id: row.ticket_no,
    title: row.title,
    status:
      row.status === "pending" || row.status === "in_progress"
        ? "processing"
        : "open",
    priority: assertDomain(row.priority, TICKET_PRIORITIES, "ticket priority"),
    updatedAt: toIso(row.updated_at),
  };
}

// 「权益仍在」的订阅态：active / expiring（临近到期仍生效）/ trialing / overdue
// （欠费宽限、权益仍在——语义见 @shared catalog-domains 与 status-tone.ts）。
// suspended / expired / cancelled 三档权益已停，不进「订阅产品」计数。
const IN_FORCE_SUBSCRIPTION_STATUSES = `('active','expiring','trialing','overdue')`;

// 未结工单：support.tickets CHECK 七值里 resolved / closed / cancelled 是终态，其余四个
// 都还有人要跟。与首页看板 ticket_in_progress + ticket_pending 的并集一致。
const TENANT_OPEN_TICKET_STATUSES = `('open','pending','in_progress','reopened')`;

// tenancy.tenants(软删 deleted_at) join tenant_profiles(1:1) + owner(account.users/user_profiles)
// + 最新实名审核(kyc.tenant_verifications) + 一组按 tenant_id 的相关子查询（各自口径见行内注释）。
// 列表 500 行 × 9 个相关子查询：每个都走 tenant_id 索引，运营台列表可承受；原来就有两个。
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
  ) as active_member_count,
  -- 管理员 = 活跃成员里持 tenant 作用域 owner / manager 角色的人（seed-catalog ROLES：
  -- owner / manager / member / readonly / guest，前两者是治理角色）。停用的成员不能管理，不计。
  (
    select count(*) from tenancy.tenant_memberships m
    join access.roles r on r.id = m.role_id
    where m.tenant_id = t.id and m.status = 'active'
      and r.scope = 'tenant' and r.role_code in ('owner','manager')
  ) as admin_count,
  (
    select count(*) from metering.subscriptions s
    where s.tenant_id = t.id and s.deleted_at is null
      and s.status in ${IN_FORCE_SUBSCRIPTION_STATUSES}
  ) as subscription_count,
  -- 产品数 = 上述订阅的套餐版本里 primary 组件（套餐卖的那个产品）去重；bundled 是
  -- 随主产品搭售的配件，不单算一个「订阅产品」。
  (
    select count(distinct pcm.product_id)
    from metering.subscriptions s
    join product.plan_components pcm on pcm.plan_version_id = s.plan_version_id
    where s.tenant_id = t.id and s.deleted_at is null
      and s.status in ${IN_FORCE_SUBSCRIPTION_STATUSES}
      and pcm.component_role = 'primary'
  ) as product_count,
  -- 本月收入 = 本自然月（库会话时区，与首页看板 dashboard-overview 同一 now()）内
  -- billing.payments pay_status='paid' 的 paid_amount 合计。毛额：退款不冲减（看板也不冲），
  -- refunding 态的支付不在 'paid' 里，自然不计。billing 按 tenant_id 结算，不必卷 workspace。
  (
    select coalesce(sum(pay.paid_amount), 0) from billing.payments pay
    where pay.tenant_id = t.id and pay.pay_status = 'paid'
      and pay.paid_at >= date_trunc('month', now())
      and pay.paid_at <  date_trunc('month', now()) + interval '1 month'
  ) as month_revenue,
  (
    select coalesce(sum(pay.paid_amount), 0) from billing.payments pay
    where pay.tenant_id = t.id and pay.pay_status = 'paid'
  ) as total_revenue,
  (
    select count(*) from support.tickets k
    where k.tenant_id = t.id and k.deleted_at is null
      and k.status in ${TENANT_OPEN_TICKET_STATUSES}
  ) as ticket_open_count,
  -- 风险档 = 未复核（reviewer_id is null，与风控页「待处置」同一判据）记录里最高的一档；
  -- 没有未复核记录 → null → normal。复核过的记录视为已处置，不再抬高租户档位。
  (
    select rr.risk_level from admin.risk_records rr
    where rr.tenant_id = t.id and rr.deleted_at is null and rr.reviewer_id is null
    order by case rr.risk_level when 'high' then 0 when 'follow_up' then 1 else 2 end
    limit 1
  ) as risk_level,
  -- 最近活跃 = 成员在 customer realm 的会话最近活动时刻（与账号页同源）。会话是
  -- Redis 主存、OIDC 登录不落库，所以这里可能偏早或为 null——但它是量出来的，不再拿
  -- updated_at 冒充。
  (
    select max(ses.last_active_at)
    from session.auth_sessions ses
    join tenancy.tenant_memberships m on m.user_id = ses.user_id
    where m.tenant_id = t.id and m.status <> 'removed' and ses.realm = 'customer'
  ) as last_active_at
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
  admin_count: string | number | null;
  subscription_count: string | number | null;
  product_count: string | number | null;
  month_revenue: string | number | null;
  total_revenue: string | number | null;
  ticket_open_count: string | number | null;
  risk_level: string | null;
  last_active_at: Date | string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 详情五段明细（GET /:id 与写端点读回共用；列表不打这些）。$1 = tenant_id。
// ─────────────────────────────────────────────────────────────────────────────

// 成员明细 TENANT_DETAIL_MEMBERS_SQL 复用 /members 端点的 TENANT_MEMBER_SELECT，
// 定义在那个常量之后（顶层模板串不能引用还没初始化的 const）。

// 订阅：全部未软删的订阅（含已停 / 已取消，作为历史），权益仍在的排前面。
// 产品名取套餐版本的 primary 组件（与 product_count 同口径），按 sort_order 排。
// 可读码 = 最近一次履约它的订单号（billing.orders 经 current_order_id，product_330）。
const TENANT_DETAIL_SUBSCRIPTIONS_SQL = `
select
  s.id,
  cur.order_no,
  s.status,
  s.subscription_kind,
  s.cycle_unit,
  s.cycle_count,
  s.pay_amount,
  s.currency,
  s.auto_renew,
  s.start_at,
  s.end_at,
  s.next_renewal_at,
  pl.plan_name,
  pv.version_no,
  prod.product_names
from metering.subscriptions s
left join billing.orders cur on cur.id = s.current_order_id
left join product.plan_versions pv on pv.id = s.plan_version_id
left join product.plans pl on pl.id = pv.plan_id
left join lateral (
  select array_agg(p.product_name order by pcm.sort_order asc, pcm.priority asc) as product_names
  from product.plan_components pcm
  join product.products p on p.id = pcm.product_id
  where pcm.plan_version_id = s.plan_version_id and pcm.component_role = 'primary'
) prod on true
where s.tenant_id = $1 and s.deleted_at is null
order by
  case when s.status in ${IN_FORCE_SUBSCRIPTION_STATUSES} then 0 else 1 end,
  s.start_at desc
limit 100
`;

// 当月用量：按 metric_key 跨该租户所有 workspace / 产品聚合。
//   month_amount：metering.usage_summary_months 当前自然月（YYYYMM，库会话时区）合计——
//     看板口径，永不作计费依据（50_metering §9）；
//   quota_limit / quota_used：活跃且未过期的 metering.quota_pools 合计（权益水位，按订阅
//     锚定周期推进，不是自然月）。两者时间窗不同，契约里分开两个字段，不相除。
//   unit：平台共享键查 platform_metrics，产品私有键查 product_metrics；都没有就 null。
// 键集 = 两边的并集：有池没用量（刚开通）与有用量没池（池已退役）都要能看见。
const TENANT_DETAIL_USAGE_SQL = `
with ws as (
  select w.id from tenancy.workspaces w
  where w.tenant_id = $1 and w.deleted_at is null
),
month_usage as (
  select um.metric_key, sum(um.total_amount) as month_amount
  from metering.usage_summary_months um
  join ws on ws.id = um.workspace_id
  where um.period_month = to_char(now(), 'YYYYMM')
  group by um.metric_key
),
pools as (
  select qp.metric_key,
         sum(qp.quota_limit) as quota_limit,
         sum(qp.quota_used)  as quota_used
  from metering.quota_pools qp
  join ws on ws.id = qp.workspace_id
  where qp.status = 'active'
    and (qp.expires_at is null or qp.expires_at > now())
  group by qp.metric_key
),
keys as (
  select metric_key from month_usage
  union
  select metric_key from pools
)
select
  k.metric_key,
  coalesce(mu.month_amount, 0) as month_amount,
  po.quota_limit,
  po.quota_used,
  coalesce(
    pm.metric_unit,
    (select max(x.metric_unit) from product.product_metrics x where x.metric_key = k.metric_key)
  ) as unit
from keys k
left join month_usage mu on mu.metric_key = k.metric_key
left join pools po on po.metric_key = k.metric_key
left join product.platform_metrics pm on pm.metric_key = k.metric_key
order by k.metric_key asc
`;

// 审计：support.audit_logs 按 tenant_id 取最近 20 条（按月分区，tenant_id+created_at 有索引）。
// actor 解析与 audit-logs.router 同法：operator → admin.operator_account；customer 多补一层
// account.users / user_profiles（这是租户视角，成员操作才是主角）；system / api 没有账号。
const TENANT_DETAIL_AUDIT_SQL = `
select
  a.id,
  a.action,
  a.result,
  a.actor_type,
  a.created_at,
  op.display_name  as operator_name,
  cup.display_name as customer_display_name,
  cu.account       as customer_account
from support.audit_logs a
left join admin.operator_account op
  on op.id = a.actor_id and a.actor_type = 'operator'
left join account.users cu
  on cu.id = a.actor_id and a.actor_type = 'customer'
left join account.user_profiles cup on cup.user_id = cu.id
where a.tenant_id = $1
order by a.created_at desc
limit 20
`;

// 未结工单（与 ticket_open_count 同一过滤），先按优先级、再按最近更新。id 用可视码 ticket_no。
const TENANT_DETAIL_TICKETS_SQL = `
select
  k.ticket_no,
  k.title,
  k.status,
  k.priority,
  k.updated_at
from support.tickets k
where k.tenant_id = $1 and k.deleted_at is null
  and k.status in ${TENANT_OPEN_TICKET_STATUSES}
order by
  case k.priority when 'p0' then 0 when 'p1' then 1 when 'p2' then 2 else 3 end,
  k.updated_at desc
limit 50
`;

interface TenantSubscriptionRow {
  id: string;
  order_no: string | null;
  status: string;
  subscription_kind: string;
  cycle_unit: string;
  cycle_count: string | number | null;
  pay_amount: string | number | null;
  currency: string | null;
  auto_renew: boolean;
  start_at: Date | string | null;
  end_at: Date | string | null;
  next_renewal_at: Date | string | null;
  plan_name: string | null;
  version_no: number | null;
  product_names: string[] | null;
}

interface TenantUsageRow {
  metric_key: string;
  month_amount: string | number | null;
  quota_limit: string | number | null;
  quota_used: string | number | null;
  unit: string | null;
}

interface TenantAuditRow {
  id: string;
  action: string;
  result: string;
  actor_type: string;
  created_at: Date | string | null;
  operator_name: string | null;
  customer_display_name: string | null;
  customer_account: string | null;
}

interface TenantTicketRow {
  ticket_no: string;
  title: string;
  status: string;
  priority: string;
  updated_at: Date | string | null;
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
    lastActiveAt: toIsoOrNull(row.last_active_at),
    lastActiveIp: row.last_active_ip ?? null,
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

// tenancy.tenant_memberships join account.users(+user_profiles) + access.roles
// + session.auth_sessions 最近一条（customer realm；与账号页同源，2026-08-30 起——此前
// 成员页拿 updated_at 冒充「最近活跃」）。
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
  r.role_name         as role_name,
  ls.last_active_at,
  ls.last_active_ip
from tenancy.tenant_memberships m
left join account.users u on u.id = m.user_id
left join account.user_profiles up on up.user_id = m.user_id
left join access.roles r on r.id = m.role_id
left join lateral (
  select s.last_active_at, s.ip_address as last_active_ip
  from session.auth_sessions s
  where s.user_id = m.user_id and s.realm = 'customer'
  order by s.last_active_at desc
  limit 1
) ls on true
where m.tenant_id = $1
`;

// 详情 members[]：同一投影，过滤已移除、按加入时间排。
const TENANT_DETAIL_MEMBERS_SQL = `${TENANT_MEMBER_SELECT}
  and m.status <> 'removed'
order by m.created_at asc
limit 200
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
  last_active_at: Date | string | null;
  last_active_ip: string | null;
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
  /** customer realm 最近会话活动；没有会话为 null（不用 updatedAt 冒充）。 */
  lastActiveAt: string | null;
  lastActiveIp: string | null;
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
