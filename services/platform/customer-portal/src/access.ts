/**
 * Live membership authorization for the exact organization bound to a public host.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-15
 */
import { ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import type { PublishedPortal } from "./service";

export interface PortalIdentity {
  userId: string;
  activeOrg: string | null;
  activeWorkspace: string | null;
  userType: string | null;
  accountStatus: string | null;
}
export interface PortalMember {
  name: string;
  workspaceName: string;
}

/** A signed context is necessary, but current organization membership is authoritative. */
export class PortalAccessService {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async assertMember(
    portal: PublishedPortal,
    user: PortalIdentity,
  ): Promise<PortalMember> {
    if (
      user.userType !== "tenant_user" ||
      user.accountStatus !== "active" ||
      user.activeOrg !== portal.tenantId ||
      user.activeWorkspace !== portal.workspaceId
    ) {
      throw new ForbiddenException("仅限本机构授权成员访问");
    }
    const { rows } = await this.pool.query<PortalMember>(
      `
      select coalesce(nullif(up.display_name,''), u.account) as name, w.name as "workspaceName"
      from tenancy.customer_portals p
      join tenancy.customer_portal_versions v on v.id=p.published_version_id
        and v.portal_id=p.id and v.status='approved'
      join tenancy.tenants t on t.id=p.tenant_id and t.type='organization'
        and t.status='active' and t.deleted_at is null
      join tenancy.workspaces w on w.id=p.workspace_id and w.tenant_id=t.id
        and w.status='active' and w.deleted_at is null
      join tenancy.tenant_memberships tm on tm.tenant_id=t.id and tm.user_id=$4 and tm.status='active'
      join tenancy.workspace_memberships wm on wm.tenant_id=t.id and wm.workspace_id=w.id
        and wm.user_id=tm.user_id and wm.status='active'
      join account.users u on u.id=tm.user_id and u.status='active' and u.deleted_at is null
      left join account.user_profiles up on up.user_id=u.id
      where p.id=$1 and p.hostname=$2 and p.tenant_id=$3 and p.workspace_id=$5 and p.enabled`,
      [
        portal.id,
        portal.hostname,
        portal.tenantId,
        user.userId,
        portal.workspaceId,
      ],
    );
    const member = rows[0];
    if (!member)
      throw new ForbiddenException("当前账号不属于本机构或访问权限已失效");
    return member;
  }
}
