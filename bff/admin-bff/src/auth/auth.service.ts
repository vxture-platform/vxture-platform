import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { ConsoleUser } from "../types/console.types";
import { ADMIN_BFF_RW_POOL } from "../tokens";

// 2026-10-04：LEGACY_CAPABILITY_BRIDGE 整个删掉。它曾把目录里的三段式码合成成业务
// router 判的遗留扁平串（tenant:profile.manage → platform.tenant.manage，
// product:plan.manage → platform.product.manage；更早还有 pricing / model / audit 三条，
// 分别于 TD-027 与 2026-09-14 摘掉）。租户 / 工单两条线 2026-10-03（#577）、账号 / 待办 /
// 搜索 / 产品目录 / 解决方案 / 套餐 / 定价 2026-10-04 全部改判目录里本域的细码之后，
// 两个合成串一个消费方都没有了。req.capabilities 现在**就是** operator_role_permission
// 里的 perm_code，没有任何一条运行时合成的码。

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

/** 去重而已（array_agg distinct 已去过一次；这里是保险，不合成任何码）。 */
function normalizePlatformPermissions(permissions: string[]): string[] {
  return [...new Set(permissions)];
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
