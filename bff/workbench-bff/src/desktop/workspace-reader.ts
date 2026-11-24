/**
 * workspace-reader.ts - Desktop projections of shared organization queries.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category adapter
 * @author AI-Generated
 * @date 2026-11-22
 */
import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
// ⚠️ 跨层引用: Domain services retain all SQL and membership query rules.
import {
  type OrganizationService,
  type OrgMembershipView,
  type WorkspaceView,
} from "@vxture/service-organization";
// ⚠️ 跨层引用: Use the verified RP identity, never request-supplied account IDs.
import type { RpUser } from "@vxture/core-oidc-rp";
import type { ScopeService } from "../scope-service";

export type OrganizationReads = Pick<
  OrganizationService,
  "listOrgMembershipsForUser" | "listWorkspacesForSwitch"
>;

function inaccessible(): never {
  throw new ForbiddenException({
    code: "WORKSPACE_ACCESS_REMOVED",
    message: "This organization or workspace is no longer accessible",
  });
}

function unavailable(): never {
  throw new ServiceUnavailableException({
    code: "WORKSPACE_SOURCE_UNAVAILABLE",
    message: "Workspace information is temporarily unavailable",
  });
}

/** Presentation assembly only; no defaults, seat inference or management reads. */
export class WorkspaceReader {
  constructor(
    private readonly org: OrganizationReads,
    private readonly scope?: Pick<ScopeService, "assertCurrent">,
  ) {}

  private async memberships(user: RpUser): Promise<OrgMembershipView[]> {
    return (
      await this.org.listOrgMembershipsForUser(user.userId).catch(unavailable)
    ).filter(
      (member) =>
        member.userId === user.userId &&
        member.status === "active" &&
        member.organization?.id === member.organizationId &&
        member.organization.status === "active",
    );
  }

  private async spaces(
    member: OrgMembershipView,
    user: RpUser,
  ): Promise<WorkspaceView[]> {
    return (
      await this.org
        .listWorkspacesForSwitch(member.organizationId, user.userId)
        .catch(unavailable)
    ).filter((space) => space.organizationId === member.organizationId);
  }

  async all(user: RpUser) {
    const rows = [];
    for (const member of await this.memberships(user)) {
      const org = member.organization!;
      for (const space of await this.spaces(member, user))
        rows.push({
          tenantId: org.id,
          tenantName: org.name,
          tenantType: org.type,
          workspaceId: space.id,
          workspaceName: space.name,
          workspaceIsDefault: space.isDefault,
          isCurrent:
            org.id === user.activeOrg && space.id === user.activeWorkspace,
        });
    }
    return rows;
  }

  async current(user: RpUser) {
    await this.scope?.assertCurrent(user);
    const member = (await this.memberships(user)).find(
      (row) => row.organizationId === user.activeOrg,
    );
    if (!member) inaccessible();
    const spaces = await this.spaces(member, user);
    if (!spaces.some((space) => space.id === user.activeWorkspace))
      inaccessible();
    return { organization: member.organization!, spaces };
  }

  async mine(user: RpUser) {
    return (await this.current(user)).spaces.map((space) => ({
      id: space.id,
      name: space.name,
      isDefault: space.isDefault,
    }));
  }
}

export function requireWorkspaceReader(
  reader: WorkspaceReader | undefined,
): WorkspaceReader {
  if (!reader) unavailable();
  return reader;
}
