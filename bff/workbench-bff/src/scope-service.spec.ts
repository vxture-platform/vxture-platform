/**
 * API scope checks reject domain login fallbacks and removed memberships.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActiveContextService,
  MockOrganizationRepository,
  OrganizationService,
  GovernanceService,
  type ProvisionedOrg,
} from "@vxture/service-organization"; // ⚠️ 跨层引用: exercise real domain context selection over in-memory test data.
import type { RpUser } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: canonical identity fixture.
import { ScopeService } from "./scope-service";

// ============================================================================
// Domain behavior is real; storage is synthetic and does not validate SQL.
// ============================================================================
describe("workbench live workspace authorization", () => {
  let repo: MockOrganizationRepository;
  let active: ActiveContextService;
  let service: ScopeService;
  let provisioned: ProvisionedOrg;
  let user: RpUser;

  beforeEach(async () => {
    repo = new MockOrganizationRepository();
    active = new ActiveContextService(repo);
    service = new ScopeService(
      active,
      new OrganizationService(repo),
      new GovernanceService(repo),
    );
    const userId = randomUUID();
    provisioned = await repo.createPersonalOrg(userId, "Synthetic account");
    user = {
      userId,
      sub: `usr_${userId}`,
      activeOrg: provisioned.org.id,
      activeOrgType: "personal",
      activeOrgName: provisioned.org.name,
      activeWorkspace: provisioned.workspace.id,
      activeWorkspaceName: provisioned.workspace.name,
      roles: ["org:owner", "workspace:owner"],
      userType: "tenant_user",
      name: "Synthetic account",
      preferredUsername: null,
      email: null,
      emailVerified: null,
      phone: null,
      phoneVerified: null,
      accountStatus: "active",
      picture: null,
    };
  });

  it("accepts the exact current organization and workspace membership", async () => {
    await expect(service.assertCurrent(user)).resolves.toBeUndefined();
    expect(
      await service.canSwitch(user, undefined, provisioned.workspace.id),
    ).toBe(true);
  });
  it("uses live permissions and does not let workspace grants expose tenant money", async () => {
    vi.spyOn(repo, "getEffectiveOrgPermissions").mockResolvedValue([]);
    vi.spyOn(repo, "getEffectiveWorkspacePermissions").mockResolvedValue([
      "tenant.quota.read",
      "tenant.billing.read",
    ]);
    await expect(
      service.assertRead(user, "tenant.quota.read"),
    ).resolves.toBeUndefined();
    await expect(
      service.assertRead(user, "tenant.billing.read", true),
    ).rejects.toThrow();
    vi.spyOn(repo, "getEffectiveOrgPermissions").mockResolvedValue([
      "tenant.billing.read",
    ]);
    await expect(
      service.assertRead(user, "tenant.billing.read", true),
    ).resolves.toBeUndefined();
    vi.spyOn(repo, "listOrgMembershipsForUser").mockResolvedValue([]);
    await expect(
      service.assertRead(user, "tenant.billing.read", true),
    ).rejects.toThrow();
  });
  it("rejects a workspace hint even when domain login resolves a valid default", async () => {
    const unknown = randomUUID();
    const fallback = await active.resolveActiveContext(
      user.userId,
      user.activeOrg!,
      unknown,
    );
    expect(fallback?.activeWorkspace).toBe(provisioned.workspace.id);
    await expect(
      service.assertCurrent({ ...user, activeWorkspace: unknown }),
    ).rejects.toThrow();
  });
  it("rejects an organization fallback rather than using another membership", async () => {
    const other = randomUUID();
    expect(
      (await active.resolveActiveContext(user.userId, other))?.activeOrg,
    ).toBe(provisioned.org.id);
    await expect(
      service.assertCurrent({ ...user, activeOrg: other }),
    ).rejects.toThrow();
  });
  it("requires current domain membership even when the token still claims a workspace role", async () => {
    vi.spyOn(repo, "resolveWorkspaceForSession").mockResolvedValue({
      workspace: provisioned.workspace,
      membershipRole: null,
    });
    await expect(service.assertCurrent(user)).rejects.toThrow();
  });
  it("denies removed organization membership and missing context", async () => {
    vi.spyOn(repo, "listOrgMembershipsForUser").mockResolvedValue([]);
    await expect(service.assertCurrent(user)).rejects.toThrow();
    await expect(
      service.assertCurrent({ ...user, activeWorkspace: null }),
    ).rejects.toThrow();
  });
  it("never offers another user's workspace as a switch target", async () => {
    const other = await repo.createPersonalOrg(randomUUID(), "Other account");
    expect(await service.canSwitch(user, other.org.id)).toBe(false);
    expect(await service.canSwitch(user, undefined, other.workspace.id)).toBe(
      false,
    );
    expect((await service.workspaces(user)).map((item) => item.id)).toEqual([
      provisioned.workspace.id,
    ]);
  });
  it("uses live display names and workspace names rather than stale token claims", async () => {
    const org = new OrganizationService(repo);
    vi.spyOn(org, "getOrgById").mockResolvedValue({
      ...provisioned.org,
      displayName: "Updated organization",
    });
    vi.spyOn(org, "listWorkspacesForSwitch").mockResolvedValue([
      { ...provisioned.workspace, name: "Updated workspace" },
    ]);
    const context = await new ScopeService(active, org).context(user);
    expect(context).toMatchObject({
      id: provisioned.org.id,
      name: "Updated organization",
      workspace: provisioned.workspace.id,
      workspaceName: "Updated workspace",
    });
  });
  it("rejects a workspace from another organization even when the organization is accessible", async () => {
    const other = await repo.createPersonalOrg(randomUUID(), "Other account");
    expect(
      await service.canSwitch(user, provisioned.org.id, other.workspace.id),
    ).toBe(false);
    expect(
      await service.canSwitch(
        user,
        provisioned.org.id,
        provisioned.workspace.id,
      ),
    ).toBe(true);
    const groups = await service.organizations(user);
    expect(groups.map((group) => group.id)).toEqual([provisioned.org.id]);
    expect(groups[0]?.workspaces.map((space) => space.id)).toEqual([
      provisioned.workspace.id,
    ]);
  });
});
