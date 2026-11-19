import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PgOrganizationRepository } from "../repository/pg-organization.repository";
import { ActiveContextService } from "./active-context.service";
import type { OrganizationReadRepository } from "../types/organization.types";

// resolveActiveContext 把「进哪个工作空间」与「我在它里面是什么角色」折进**一次**
// 仓储调用（resolveWorkspaceForSession）。这一组钉的是：那次调用的每种返回形状，
// service 都把 workspace 与 roles 如实透出；以及它**打给解析出来的那个租户**。
//
// 2026-09-09（工作空间切换）：调用从 resolveWorkspaceForSession 换成带提示的
// resolveWorkspaceForSession——「站不站得住」的判定在 SQL 里（属于本租户、启用中、
// 我是活跃成员），service 只负责把提示原样递下去。所以这里钉的是**递没递**，
// 不是判定本身：判定的验收在 workspace-crud.itest 那条线上，用真库。

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

// ============================================================================
// Real repository query against a local database; all fixture changes roll back
// ============================================================================

describe.runIf(process.env.ORG_PRESENTATION_ITEST === "1")(
  "organization presentation through PostgreSQL",
  () => {
    let pool: Pool;
    let service: ActiveContextService;
    let userId: string;
    let orgId: string;
    let fullName: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      await pool.query("begin");
      const selected = await pool.query<{
        user_id: string;
        id: string;
        name: string;
      }>(
        `select m.user_id, o.id, o.name
           from tenancy.tenant_memberships m
           join tenancy.tenants o on o.id = m.tenant_id
          where m.status = 'active' and o.deleted_at is null
          limit 1`,
      );
      const row = selected.rows[0];
      if (!row)
        throw new Error(
          "The local fixture needs an active organization membership",
        );
      userId = row.user_id;
      orgId = row.id;
      fullName = row.name;
      service = new ActiveContextService(new PgOrganizationRepository(pool));
    });

    afterAll(async () => {
      if (pool) {
        await pool.query("rollback");
        await pool.end();
      }
    });

    it.each(["Short", "Renamed", " \t ", null])(
      "reads the current database short name (%j), preserving the full name",
      async (displayName) => {
        await pool.query(
          "update tenancy.tenants set display_name=$2 where id=$1",
          [orgId, displayName],
        );
        expect(await service.resolveActiveContext(userId, orgId)).toMatchObject(
          {
            activeOrg: orgId,
            activeOrgName: fullName,
            activeOrgDisplayName: displayName?.trim() || null,
          },
        );
      },
    );

    it("does not return another account's organization presentation", async () => {
      expect(
        await service.resolveActiveContext(
          "00000000-0000-4000-8000-000000000638",
          orgId,
        ),
      ).toBeNull();
    });
  },
);

const build = (
  over: Partial<Record<keyof OrganizationReadRepository, unknown>> = {},
) => {
  const repo = {
    listOrgMembershipsForUser: vi.fn().mockResolvedValue([]),
    resolveWorkspaceForSession: vi
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
  it.each([undefined, null, "", " \t ", " Short name "])(
    "keeps the full name and normalizes the selected organization's short name (%j)",
    async (displayName) => {
      const selected = membership(
        "org-1",
        "member",
        "organization",
        "Full name",
      );
      const { service } = build({
        listOrgMembershipsForUser: vi.fn().mockResolvedValue([
          {
            ...selected,
            organization: { ...selected.organization, displayName },
          },
        ]),
      });
      expect(await service.resolveActiveContext("u-1")).toMatchObject({
        activeOrgName: "Full name",
        activeOrgDisplayName: displayName?.trim() || null,
        roles: ["org:member"],
      });
    },
  );

  it("reloads presentation from the selected membership on switch and refresh", async () => {
    const first = membership("org-1", "owner");
    const second = membership("org-2", "member");
    const memberships = [
      {
        ...first,
        organization: { ...first.organization, displayName: "First" },
      },
      {
        ...second,
        organization: { ...second.organization, displayName: "Second" },
      },
    ];
    const { service } = build({
      listOrgMembershipsForUser: vi.fn().mockResolvedValue(memberships),
    });
    expect(await service.resolveActiveContext("u-1", "org-1")).toMatchObject({
      activeOrg: "org-1",
      activeOrgDisplayName: "First",
    });
    expect(await service.resolveActiveContext("u-1", "org-2")).toMatchObject({
      activeOrg: "org-2",
      activeOrgDisplayName: "Second",
    });
    memberships[1]!.organization.displayName = "Renamed";
    expect(await service.resolveActiveContext("u-1", "org-2")).toMatchObject({
      activeOrg: "org-2",
      activeOrgDisplayName: "Renamed",
    });
    expect(
      await service.resolveActiveContext("u-1", "unrelated-org"),
    ).toMatchObject({
      activeOrg: "org-1",
      activeOrgDisplayName: "First",
    });
  });

  it("returns null and skips the workspace lookup when the user has no membership", async () => {
    const { service, repo } = build({
      listOrgMembershipsForUser: vi.fn().mockResolvedValue([]),
    });
    expect(await service.resolveActiveContext("u-1")).toBeNull();
    expect(repo.resolveWorkspaceForSession).not.toHaveBeenCalled();
  });

  it("includes the workspace role when the user has an active workspace membership", async () => {
    const { service } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-1", "owner")]),
      resolveWorkspaceForSession: vi.fn().mockResolvedValue({
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
      resolveWorkspaceForSession: vi.fn().mockResolvedValue({
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
      resolveWorkspaceForSession: vi
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
    expect(repo.resolveWorkspaceForSession).toHaveBeenCalledWith(
      "org-2",
      "u-1",
      undefined,
    );
  });

  /**
   * 工作空间提示要**原样递到仓储**（owner 2026-09-09）。
   *
   * 这一条钉的不是「提示对不对」——那是 SQL 的事（属于本租户、启用中、我是成员），
   * 在 workspace-crud.itest 里用真库验。这里钉的是这一层**没把它吃掉**：
   * 少传一个参数不会报错，只会让切换永远停在默认工作空间上，而那看起来像
   * 「切换按钮没反应」，最难查。
   */
  it("把工作空间提示原样递给仓储", async () => {
    const { service, repo } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-2", "manager")]),
    });
    await service.resolveActiveContext("u-1", "org-2", "ws-9");
    expect(repo.resolveWorkspaceForSession).toHaveBeenCalledWith(
      "org-2",
      "u-1",
      "ws-9",
    );
  });

  /** 仓储退回默认时，service 照常给出工作空间——退回不是失败。 */
  it("提示站不住时仓储退回默认，context 仍然带着工作空间", async () => {
    const { service, repo } = build({
      listOrgMembershipsForUser: vi
        .fn()
        .mockResolvedValue([membership("org-2", "manager")]),
      resolveWorkspaceForSession: vi.fn().mockResolvedValue({
        workspace: {
          id: "ws-default",
          organizationId: "org-2",
          name: "默认空间",
          isDefault: true,
        },
        membershipRole: "member",
      }),
    });
    const ctx = await service.resolveActiveContext("u-1", "org-2", "ws-gone");
    expect(repo.resolveWorkspaceForSession).toHaveBeenCalledWith(
      "org-2",
      "u-1",
      "ws-gone",
    );
    expect(ctx?.activeWorkspace).toBe("ws-default");
    expect(ctx?.roles).toContain("workspace:member");
  });
});
