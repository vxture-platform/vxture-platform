import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { ConsoleUser } from "../types/console.types";
import { ADMIN_BFF_RW_POOL } from "../tokens";

// Single-point bridge: three-segment perm_codes (post-cutover DB catalog,
// data_admin_200 §4.2) → legacy flat strings still checked by business routers.
// Per-router domain-correct re-gating is a follow-up authz pass; until then the
// bridge keeps business-router behavior stable across the cutover.
const LEGACY_CAPABILITY_BRIDGE: Record<string, string[]> = {
  "tenant:profile.manage": ["platform.tenant.manage"],
  "product:plan.manage": ["platform.product.manage"],
  // product:price.manage → platform.pricing.manage retired (TD-027): the finance
  // routers that borrowed it now check commerce:* domain codes; no admin router
  // consumes platform.pricing.manage anymore.
  // model:*.manage → platform.model.manage 与 audit:read → platform.audit.read 两条
  // 2026-09-14 摘掉：前者是 opera 的码，后者是 arche 的码，三平台严格隔离，admin 不认
  // 别的平台的码（/atlas 的读门改为 admin 自己的 pricing:model.read）。
};

/**
 * PlatformAuthService — operator (admin.operator_account) authorization source.
 *
 * Authentication (password/phone) is the IdP (auth-bff operator realm, RS256);
 * this service is read-only, resolving the operator profile + capabilities from
 * admin.operator_* for the RP-authoritative AuthMiddleware and the session aggregator.
 */
@Injectable()
export class PlatformAuthService {
  constructor(@Inject(ADMIN_BFF_RW_POOL) private readonly pool: Pool) {}

  async getCurrentUser(accountId: string): Promise<ConsoleUser | null> {
    const admin = await this.getPlatformAdminById(accountId);
    return admin ? mapPlatformAdminUser(admin) : null;
  }

  async getCapabilities(accountId: string): Promise<string[]> {
    const admin = await this.getPlatformAdminById(accountId);
    return admin?.permissions ?? [];
  }

  private async getPlatformAdminById(
    adminId: string,
  ): Promise<PlatformAdminView | null> {
    const result = await this.pool.query<PlatformAdminRow>(
      `
        select
          a.id,
          a.username,
          a.email,
          a.phone,
          a.display_name,
          r.role_code,
          r.role_name_key,
          r.role_name,
          r.rank as role_rank,
          a.email_verified,
          coalesce(array_remove(array_agg(distinct p.perm_code), null), array[]::varchar[]) as permissions
        from admin.operator_account a
        join admin.operator_role r
          on r.id = a.role_id
         and r.status = 'active'
        left join admin.operator_role_permission rp
          on rp.role_id = r.id
        left join admin.operator_permission p
          on p.id = rp.permission_id
         and p.is_active = true
        where a.deleted_at is null
          and a.status = 'active'
          and a.id = $1
        group by a.id, r.role_code, r.role_name_key, r.role_name, r.rank
        limit 1
      `,
      [adminId],
    );

    return mapPlatformAdminRow(result.rows[0]);
  }
}

interface PlatformAdminRow {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  role_code: string;
  role_name_key: string;
  role_name: string;
  role_rank: number;
  email_verified: boolean;
  permissions: string[];
}

interface PlatformAdminView {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  roleCode: string;
  roleI18nKey: string;
  roleNameEn: string;
  roleRank: number;
  emailVerified: boolean;
  permissions: string[];
}

function mapPlatformAdminRow(row?: PlatformAdminRow): PlatformAdminView | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    displayName: row.display_name,
    roleCode: row.role_code,
    roleI18nKey: row.role_name_key,
    roleNameEn: row.role_name,
    roleRank: Number(row.role_rank ?? 0),
    emailVerified: Boolean(row.email_verified),
    permissions: normalizePlatformPermissions(row.permissions ?? []),
  };
}

function normalizePlatformPermissions(permissions: string[]): string[] {
  const normalized = new Set(permissions);

  // Bridge new-catalog codes → legacy flat strings (see LEGACY_CAPABILITY_BRIDGE).
  for (const [permCode, legacyCaps] of Object.entries(
    LEGACY_CAPABILITY_BRIDGE,
  )) {
    if (normalized.has(permCode)) {
      legacyCaps.forEach((cap) => normalized.add(cap));
    }
  }

  return [...normalized];
}

function mapPlatformAdminUser(admin: PlatformAdminView): ConsoleUser {
  return {
    id: admin.id,
    name: admin.username,
    displayName: admin.displayName,
    email: admin.email ?? `${admin.username}@local.vxture`,
    roleLabel: admin.roleI18nKey,
    roleCode: admin.roleCode,
    roleI18nKey: admin.roleI18nKey,
    roleNameEn: admin.roleNameEn,
    roleRank: admin.roleRank,
    emailVerified: admin.emailVerified,
    username: admin.username,
    phone: admin.phone,
  };
}
