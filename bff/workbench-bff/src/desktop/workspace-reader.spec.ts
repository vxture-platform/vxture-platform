/**
 * workspace-reader.spec.ts - Live membership projections through the domain service.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-22
 */
// ⚠️ 跨层引用: Exercise public organization services, not Console aggregators.
import {
  MockOrganizationRepository,
  OrganizationService,
} from "@vxture/service-organization";
// ⚠️ 跨层引用: Map the verified identity using the shared RP mapper.
import { mapAccessClaims } from "@vxture/core-oidc-rp";
import { describe, expect, it } from "vitest";
import { WorkspaceReader } from "./workspace-reader";

describe("organization query reuse", () => {
  it("projects actual domain membership and refuses another account's organization", async () => {
    const org = new OrganizationService(new MockOrganizationRepository());
    const userId = "11111111-1111-4111-8111-111111111111";
    const account = await org.createPersonalOrg(userId, "Synthetic Personal");
    const reader = new WorkspaceReader(org),
      user = mapAccessClaims({
        sub: `usr_${userId}`,
        active_org: account.org.id,
        active_workspace: account.workspace.id,
      });
    const rows = await reader.all(user);
    expect(rows).toEqual([
      {
        tenantId: account.org.id,
        tenantName: "Synthetic Personal",
        tenantType: "personal",
        workspaceId: account.workspace.id,
        workspaceName: account.workspace.name,
        workspaceIsDefault: account.workspace.isDefault,
        isCurrent: true,
      },
    ]);
    expect((await reader.mine(user)).map((space) => space.id)).toEqual([
      account.workspace.id,
    ]);
    const other = mapAccessClaims({
      sub: "usr_44444444-4444-4444-8444-444444444444",
      active_org: account.org.id,
      active_workspace: account.workspace.id,
    });
    expect(await reader.all(other)).toEqual([]);
    await expect(reader.current(other)).rejects.toMatchObject({ status: 403 });
  });

  it("never substitutes the default for an inaccessible explicit current workspace", async () => {
    const org = new OrganizationService(new MockOrganizationRepository()),
      userId = "11111111-1111-4111-8111-111111111111";
    const account = await org.createPersonalOrg(userId, "Synthetic");
    const reader = new WorkspaceReader(org),
      user = mapAccessClaims({
        sub: `usr_${userId}`,
        active_org: account.org.id,
        active_workspace: "unknown",
      });
    await expect(reader.mine(user)).rejects.toMatchObject({ status: 403 });
    const rows = await reader.all(user);
    expect(rows.every((row) => !row.isCurrent)).toBe(true);
  });
});
