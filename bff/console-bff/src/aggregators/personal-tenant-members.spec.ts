import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SessionAggregator } from "./session.aggregator";

/**
 * 个人租户不做成员管理（owner 2026-09-10 走查）。
 *
 * ── 走查抓到的形状 ──
 * 侧栏按 `tenantTypes: ["organization"]` 把 `/members` 藏了，但那只是**藏**：
 * 从组织租户切到个人租户时页面还留在原地，邀请 / 新建 / 改角色 / 管权限的动作
 * 照样打得出去。**入口不见了不等于门关上了**——服务端那一层此前一个字都没判。
 *
 * 所以这一组不测「按钮在不在」，测的是**动作打不打得动**：五个写方法在个人租户
 * 上下文里必须一律拒绝，且**在动手之前**拒绝。
 */

function build(tenantType: "personal" | "organization") {
  const org = {
    getOrgById: vi.fn(async () => ({ id: "org-1", type: tenantType })),
    addOrgMember: vi.fn(async () => ({ organizationId: "org-1" })),
    createInvitation: vi.fn(async () => ({
      invitation: { id: "inv-1" },
      token: "t",
    })),
    updateOrgMemberRole: vi.fn(async () => ({ organizationId: "org-1" })),
    setOrgMemberStatus: vi.fn(async () => true),
    removeOrgMember: vi.fn(async () => true),
    getOrgMemberDetail: vi.fn(async () => null),
    listInvitations: vi.fn(async () => []),
  };
  const aggregator = Object.create(
    SessionAggregator.prototype,
  ) as SessionAggregator;
  Object.assign(aggregator, {
    org,
    account: {
      getUserById: vi.fn(async () => ({ id: "u-1", email: "a@b.co" })),
      findUserByUserNo: vi.fn(async () => null),
    },
    gov: {
      assertCan: vi.fn(async () => undefined),
      can: vi.fn(async () => true),
    },
    active: {
      resolveActiveContext: vi.fn(async () => ({
        activeOrg: "org-1",
        activeWorkspace: "ws-1",
      })),
    },
    invalidateCapabilities: vi.fn(),
  });
  return { aggregator, org };
}

/** 五个写方法各调一次，形状不同但都该被同一道门挡住。 */
const CALLS: ReadonlyArray<
  [
    name: string,
    run: (a: SessionAggregator) => Promise<unknown>,
    touched: string,
  ]
> = [
  [
    "addExistingMember",
    (a) => a.addExistingMember("u-1", "org-1", { email: "x@y.z" } as never),
    "addOrgMember",
  ],
  [
    "inviteMember",
    (a) => a.inviteMember("u-1", "org-1", { email: "x@y.z" } as never),
    "createInvitation",
  ],
  [
    "updateMember",
    (a) => a.updateMember("u-1", "org-1", "u-2", { roleCode: "manager" }),
    "updateOrgMemberRole",
  ],
  [
    "setMemberStatus",
    (a) => a.setMemberStatus("u-1", "org-1", "u-2", "suspended" as never),
    "setOrgMemberStatus",
  ],
  [
    "removeMember",
    (a) => a.removeMember("u-1", "org-1", "u-2"),
    "removeOrgMember",
  ],
];

describe("个人租户：成员管理的五个写动作一律拒绝", () => {
  for (const [name, run, touched] of CALLS) {
    it(`${name} → 400 personal_tenant_no_members，且没动仓储`, async () => {
      const { aggregator, org } = build("personal");
      await expect(run(aggregator)).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(aggregator)).rejects.toThrow(
        /personal_tenant_no_members/,
      );
      /* 在**动手之前**拒绝：先写进去再说没权限，等于把一次越权做成了一次回滚问题。 */
      const spy = (
        org as unknown as Record<string, { mock: { calls: unknown[] } }>
      )[touched];
      expect(spy?.mock.calls).toHaveLength(0);
    });
  }

  /**
   * 正向对照：组织租户不受影响。
   *
   * 只有拒绝那一半的话，一个「五个方法全都抛」的实现同样能过——那会把成员管理
   * 整个打死，而且是所有租户。
   */
  it("组织租户：同样的调用不被这道门挡", async () => {
    const { aggregator, org } = build("organization");
    await aggregator.removeMember("u-1", "org-1", "u-2").catch(() => undefined); // 别的原因失败无所谓，这里只看有没有走到仓储
    expect(org.removeOrgMember).toHaveBeenCalled();
  });
});

/**
 * 邀请必选工作空间与角色（owner 2026-09-10）。
 *
 * 此前 `roleCode` 缺省成 `"member"`、工作空间根本不问——**两个默认都在替邀请人
 * 做决定**，而这两件事恰恰是邀请的实质内容：进哪个空间、以什么身份。
 *
 * 工作空间还要**回查属不属于这个租户**：前端给的 id 不可信；而且邀请可能躺几天，
 * 这里不判的话，一条指向别的租户的邀请会一路落库，直到接受时才静默落空——
 * 那时没有任何人会知道发生过什么。
 */
describe("邀请：工作空间与角色都必填", () => {
  function orgBuild(workspaces: { id: string }[] = [{ id: "ws-1" }]) {
    const { aggregator, org } = build("organization");
    Object.assign(aggregator, {
      /* 邮箱通道会查一次 findUserByIdentifier(看对方有没有账号)——
         桩不全时它抛 TypeError,表现成「前置没过」,查起来会指错方向。 */
      account: {
        getUserById: vi.fn(async () => ({ id: "u-1", email: "a@b.co" })),
        findUserByIdentifier: vi.fn(async () => null),
        findUserByUserNo: vi.fn(async () => null),
      },
      org: {
        ...org,
        getOrgById: vi.fn(async () => ({ id: "org-1", type: "organization" })),
        listWorkspacesForSwitch: vi.fn(async () => workspaces),
        getOrgMemberDetail: vi.fn(async () => null),
        listInvitations: vi.fn(async () => []),
        createInvitation: vi.fn(async () => ({
          invitation: {
            id: "inv-1",
            expiresAt: new Date(),
            role: "member",
          },
          token: "tok",
        })),
      },
    });
    return aggregator;
  }

  it("不给角色 → 400 role_required", async () => {
    await expect(
      orgBuild().inviteMember("u-1", "org-1", {
        email: "x@y.z",
        workspaceId: "ws-1",
      } as never),
    ).rejects.toThrow(/role_required/);
  });

  it("不给工作空间 → 400 workspace_required", async () => {
    await expect(
      orgBuild().inviteMember("u-1", "org-1", {
        email: "x@y.z",
        roleCode: "member",
      } as never),
    ).rejects.toThrow(/workspace_required/);
  });

  it("工作空间不属于这个租户 → 400 workspace_not_found", async () => {
    await expect(
      orgBuild([{ id: "ws-1" }]).inviteMember("u-1", "org-1", {
        email: "x@y.z",
        roleCode: "member",
        workspaceId: "ws-别的租户的",
      } as never),
    ).rejects.toThrow(/workspace_not_found/);
  });

  /* 正向对照：两项都给、且工作空间站得住时**要走下去**。
     只有拒绝那三条的话，一个「inviteMember 永远抛」的实现同样能过。 */
  it("两项都给且工作空间站得住 → 走到创建邀请那一步", async () => {
    const a = orgBuild([{ id: "ws-1" }]);
    await a
      .inviteMember("u-1", "org-1", {
        email: "x@y.z",
        roleCode: "member",
        workspaceId: "ws-1",
      } as never)
      .catch(() => undefined); // 后面几步的桩不全，这里只看有没有过掉前置
    const org = (
      a as unknown as { org: Record<string, { mock: { calls: unknown[] } }> }
    ).org;
    expect(org["createInvitation"]?.mock.calls.length).toBeGreaterThan(0);
  });
});
