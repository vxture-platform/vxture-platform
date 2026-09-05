import { describe, expect, it, vi } from "vitest";
import { ActiveContextService } from "./active-context.service";
import type { OrganizationReadRepository } from "../types/organization.types";

// resolveActiveContext folds the default-workspace lookup and the user's
// workspace-membership role into one repo call (getDefaultWorkspaceWithMembership).
// These guard that the service still surfaces workspace + roles correctly for each
// shape that merged call can return, and that it targets the resolved org.

const membership = (
  orgId: string,
  role: string,
  type: "personal" | "organization" = "organization",
  name = "Org",
) => ({
  organizationId: orgId,
  userId: "u-1",
  role,
  status: "active",
  organization: {
    id: orgId,
    name,
    type,
    ownerUserId: "u-1",
    status: "active",
  },
});

const build = (
  over: Partial<Record<keyof OrganizationReadRepository, unknown>> = {},
) => {
  const repo = {
    listOrgMembershipsForUser: vi.fn().mockResolvedValue([]),
    getDefaultWorkspaceWithMembership: vi
      .fn()
      .mockResolvedValue({ workspace: null, membershipRole: null }),
    ...over,
  };
  const service = new ActiveContextService(
    repo as unknown as OrganizationReadRepository,
  );
  return { repo, service };
};

describe("resolveActiveContext", () => {
  it("returns null and skips the workspace lookup when the user has no membership", async () => {
    const { service, repo } = build({
      listOrgMembershipsForUser: vi.fn().mockResolvedValue([]),
    });
    expect(await service.resolveActiveContext("u-1")).toBeNull();
    expect(repo.getDefaultWorkspaceWithMembership).not.toHaveBeenCalled();
  });

  it("includes the workspace role when the user has an active workspace membership", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-1", "owner")]),
      getDefaultWorkspaceWithMembership: vi.fn().mockResolvedValue({
        workspace: {
          id: "ws-1",
          organizationId: "org-1",
          name: "Default",
          isDefault: true,
        },
        membershipRole: "manager",
      }),
    });
    const ctx = await service.resolveActiveContext("u-1");
    expect(ctx?.activeOrg).toBe("org-1");
    expect(ctx?.activeWorkspace).toBe("ws-1");
    expect(ctx?.activeWorkspaceName).toBe("Default");
    expect(ctx?.roles).toEqual(["org:owner", "workspace:manager"]);
  });

  it("keeps the workspace but omits the workspace role when membershipRole is null", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-1", "member")]),
      getDefaultWorkspaceWithMembership: vi.fn().mockResolvedValue({
        workspace: {
          id: "ws-1",
          organizationId: "org-1",
          name: "Default",
          isDefault: true,
        },
        membershipRole: null,
      }),
    });
    const ctx = await service.resolveActiveContext("u-1");
    expect(ctx?.activeWorkspace).toBe("ws-1");
    expect(ctx?.roles).toEqual(["org:member"]);
  });

  it("leaves workspace fields null when the org has no default workspace", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-1", "owner")]),
      getDefaultWorkspaceWithMembership: vi
        .fn()
        .mockResolvedValue({ workspace: null, membershipRole: null }),
    });
    const ctx = await service.resolveActiveContext("u-1");
    expect(ctx?.activeWorkspace).toBeNull();
    expect(ctx?.activeWorkspaceName).toBeNull();
    expect(ctx?.roles).toEqual(["org:owner"]);
  });

  it("prefers the membership marked default over personal-first order when there is no hint", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([
          membership("org-personal", "owner", "personal", "Personal"),
          { ...membership("org-2", "manager"), isDefault: true },
        ]),
    });
    const ctx = await service.resolveActiveContext("u-1");
    expect(ctx?.activeOrg).toBe("org-2");
  });

  it("lets a valid hint beat the default membership", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([
          membership("org-personal", "owner", "personal", "Personal"),
          { ...membership("org-2", "manager"), isDefault: true },
        ]),
    });
    const ctx = await service.resolveActiveContext("u-1", "org-personal");
    expect(ctx?.activeOrg).toBe("org-personal");
  });

  it("resolves the hinted org and targets it in the merged workspace lookup", async () => {
    const { service, repo } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([
          membership("org-personal", "owner", "personal", "Personal"),
          membership("org-2", "manager"),
        ]),
    });
    const ctx = await service.resolveActiveContext("u-1", "org-2");
    expect(ctx?.activeOrg).toBe("org-2");
    expect(repo.getDefaultWorkspaceWithMembership).toHaveBeenCalledWith(
      "org-2",
      "u-1",
    );
  });
});
