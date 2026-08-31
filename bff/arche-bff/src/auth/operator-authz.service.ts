/**
 * operator-authz.service.ts — 从活库解析操作者主体与能力码。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * RP 令牌**不携带 operator 的细粒度权限**（同 admin-bff 的判断），所以每个请求都要
 * 回库查一次。查的是 admin 域的同一套表：operator_account → operator_role →
 * operator_role_permission → operator_permission，与 admin-bff 完全同源——能力码
 * 是平台级的，不因为换了个门户就换一套。
 *
 * 只读，走 RO 池。
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ARCHE_BFF_RO_POOL } from "../tokens";
import type { Capability, OperatorPrincipal } from "../types/request-context";

interface OperatorRow {
  id: string;
  display_name: string | null;
  permissions: string[] | null;
}

/**
 * 与 admin-bff `PlatformAuthService.getPlatformAdminById` 的 where/join 条件逐条
 * 对齐（只少取展示字段）。三个过滤缺一不可：
 *   - `a.deleted_at is null` + `a.status = 'active'`：软删或停用的账号不给主体
 *   - `r.status = 'active'`：角色停用即失去全部能力，而不是留着旧能力码
 *   - `p.is_active = true`：**这一列是布尔 `is_active`，不是 `status`**
 *     （operator_role 用 status、operator_permission 用 is_active，两张表不同构；
 *     我第一版按 status 写，实测列不存在——照抄前对过活库的 information_schema）
 *
 * `array_remove(..., null)` 让"有角色但零权限"落成空数组而不是 `[null]`。
 */
const OPERATOR_AUTHZ_SQL = `
select
  a.id,
  a.display_name,
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
group by a.id, a.display_name
limit 1
`;

@Injectable()
export class OperatorAuthzService {
  constructor(@Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool) {}

  /** 解析主体 + 能力码；账号不存在 / 停用 / 角色停用一律返回 null（调用方转 401）。 */
  async resolve(operatorId: string): Promise<{
    operator: OperatorPrincipal;
    capabilities: Capability[];
  } | null> {
    const { rows } = await this.pool.query<OperatorRow>(OPERATOR_AUTHZ_SQL, [
      operatorId,
    ]);
    const row = rows[0];
    if (!row) return null;

    return {
      operator: { id: row.id, displayName: row.display_name },
      capabilities: row.permissions ?? [],
    };
  }
}
