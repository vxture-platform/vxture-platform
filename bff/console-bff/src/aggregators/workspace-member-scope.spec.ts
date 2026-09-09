import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { SessionAggregator } from "./session.aggregator";

/**
 * 工作空间成员管理的**作用域**判定。
 *
 * 这一组钉的不是「有没有能力」，而是「能力管不管得到那一个空间」——这两件事在这里
 * 会分开，而分开的方式很隐蔽：
 *
 *   `workspace.member.manage` 在 `tenant:owner` 身上是**全租户**的；
 *   在 `workspace:manager` / `workspace:owner` 身上却只来自**当前活跃**工作空间
 *   （有效权限 = 租户角色 ∪ 活跃工作空间角色，见 GovernanceService）。
 *
 * 于是只挂 `@RequireCapability("workspace.member.manage")` 的话，A 空间的管理员
 * 切到 A、拿着 A 给他的那个码，就能去改 B 空间的人。守卫全绿、类型全绿、
 * 请求 200——能力有，作用域不对。所以处理器里按**目标空间**再判一次。
 *
 * 这些用例用假仓储：判定本身是几个布尔的组合，不需要真库；
 * 真库那条线（谁在哪个空间里是什么角色）在 workspace-switch.itest 里。
 */

/** 只搭出判定要用到的那几个协作者，其余留空——用到了会立刻抛，不会静默走过去。 */
function build(opts: {
  /** `gov.can(userId, ctx, "tenant.workspace.manage")` 的答案。 */
  tenantWide: boolean;
  /** 我在**目标**工作空间里的角色码；null = 我不在里面。 */
  roleInTarget: string | null;
}) {
  const gov = { can: vi.fn(async () => opts.tenantWide) };
  const org = {
    getWorkspaceRole: vi.fn(async () => opts.roleInTarget),
    getOrgMemberDetail: vi.fn(async () => ({ userId: "u-target" })),
    addWorkspaceMember: vi.fn(async () => undefined),
    removeWorkspaceMember: vi.fn(async () => ({ ok: true as const })),
  };
  const active = {
    resolveActiveContext: vi.fn(async () => ({
      activeOrg: "org-1",
      activeWorkspace: "ws-a",
    })),
  };
  const aggregator = Object.create(
    SessionAggregator.prototype,
  ) as SessionAggregator;
  Object.assign(aggregator, {
    gov,
    org: { ...org, getOrgById: vi.fn(async () => ({ id: "org-1" })) },
    active,
    invalidateCapabilities: vi.fn(),
  });
  return { aggregator, gov, org };
}

describe("工作空间成员管理的作用域门", () => {
  it("租户级 workspace.manage → 任何工作空间都管得了", async () => {
    const { aggregator, org } = build({
      tenantWide: true,
      roleInTarget: null, // 我甚至不在那个空间里
    });
    await expect(
      aggregator.addWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-target",
        "member",
      ),
    ).resolves.toEqual({ ok: true });
    /* 持租户级码时**不必**再查我在目标空间的角色——那是一次没必要的往返。 */
    expect(org.getWorkspaceRole).not.toHaveBeenCalled();
  });

  it("我在目标空间里是 manager → 管得了那一个", async () => {
    const { aggregator } = build({
      tenantWide: false,
      roleInTarget: "manager",
    });
    await expect(
      aggregator.addWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-target",
        "member",
      ),
    ).resolves.toEqual({ ok: true });
  });

  /**
   * 这一条是整组的理由：能力门已经放行了（他在 A 空间是 manager，
   * `workspace.member.manage` 在他的有效权限里），但目标是 B。
   */
  it("我只是别的空间的 manager → 管不了目标空间(403)", async () => {
    const { aggregator, org } = build({
      tenantWide: false,
      roleInTarget: null,
    });
    await expect(
      aggregator.addWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-target",
        "member",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // 判定发生在**动手之前**：不能先写进去再说没权限。
    expect(org.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("我在目标空间里只是普通成员 → 管不了(403)", async () => {
    const { aggregator } = build({ tenantWide: false, roleInTarget: "member" });
    await expect(
      aggregator.addWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-target",
        "member",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("移除走同一道门：别的空间的 manager 一样被挡", async () => {
    const { aggregator, org } = build({
      tenantWide: false,
      roleInTarget: null,
    });
    await expect(
      aggregator.removeWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-target",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(org.removeWorkspaceMember).not.toHaveBeenCalled();
  });

  /* 目标必须已经是租户成员。库里的 fk_workspace_memberships_tenant_member 也挡，
     但那会抛外键错、变成 500；这里先判，给的是 404。 */
  it("目标不在租户里 → 404，而不是让外键抛 500", async () => {
    const { aggregator, org } = build({ tenantWide: true, roleInTarget: null });
    org.getOrgMemberDetail = vi.fn(async () => null) as never;
    Object.assign(aggregator, {
      org: {
        ...org,
        getOrgById: vi.fn(async () => ({ id: "org-1" })),
        getOrgMemberDetail: vi.fn(async () => null),
      },
    });
    await expect(
      aggregator.addWorkspaceMemberScoped(
        "u-1",
        "org-1",
        "ws-b",
        "u-nobody",
        "member",
      ),
    ).rejects.toThrow(/member_not_found/);
  });
});
