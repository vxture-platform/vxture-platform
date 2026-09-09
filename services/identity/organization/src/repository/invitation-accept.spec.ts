import { beforeEach, describe, expect, it } from "vitest";
import { MockOrganizationRepository } from "./mock-organization.repository";
import { deriveInvitationStatus, rejectAcceptance } from "./invitation-rules";

/**
 * 接受邀请的拒绝矩阵 + 重发 / 停用的取档(console 批 2)。
 *
 * 与 transfer-owner.spec 同一理由:这几条判定就是权限门本身——邮箱不符还能接受,
 * 等于链接被转发给谁租户就归谁。pg 与 mock 共用 invitation-rules.ts,这里钉住
 * 规则;pg 的事务与行锁另由 itest 覆盖。
 */
describe("invitation-rules", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  const base = { targetType: "email", target: "Ann@Example.com" };
  /** 「谁也不是」——既没邮箱也没用户号。行状态类的拒绝与人无关，用它做入参。 */
  const NOBODY = { email: null, userNo: null };

  it("pending 且未过期、邮箱一致(大小写不敏感)→ 可接受", () => {
    expect(
      rejectAcceptance(
        { ...base, status: "pending", expiresAt: future },
        { email: "ann@example.com", userNo: null },
      ),
    ).toBeNull();
  });

  it("邮箱不符 / 无邮箱 → email_mismatch", () => {
    const inv = { ...base, status: "pending", expiresAt: future };
    expect(
      rejectAcceptance(inv, { email: "bob@example.com", userNo: null }),
    ).toBe("email_mismatch");
    expect(rejectAcceptance(inv, NOBODY)).toBe("email_mismatch");
  });

  /**
   * 按平台用户号邀请（owner 2026-09-09）。
   *
   * 与邮箱通道同一条要求：**邀请链接会被转发**，收件人校验是这条链上唯一挡住
   * 「链接给谁谁就能进」的东西。这一组用例存在的理由就是它。
   */
  describe("user_no 通道", () => {
    const byNo = { targetType: "user_no", target: "1000000017" };

    it("用户号一致 → 可接受", () => {
      expect(
        rejectAcceptance(
          { ...byNo, status: "pending", expiresAt: future },
          { email: null, userNo: "1000000017" },
        ),
      ).toBeNull();
    });

    it("**用户号不符 → user_mismatch**（链接被转发给别人）", () => {
      expect(
        rejectAcceptance(
          { ...byNo, status: "pending", expiresAt: future },
          { email: null, userNo: "1000000099" },
        ),
      ).toBe("user_mismatch");
    });

    it("没有用户号 → user_mismatch，不是放行", () => {
      expect(
        rejectAcceptance(
          { ...byNo, status: "pending", expiresAt: future },
          NOBODY,
        ),
      ).toBe("user_mismatch");
    });

    it("邮箱对得上也不算数 —— 这一条邀请核的是用户号", () => {
      /* 交叉校验：两个通道各管各的判据。少了这条，一个「邮箱恰好也对」的人
         能接受一条本该只有某个用户号才能接受的邀请。 */
      expect(
        rejectAcceptance(
          { ...byNo, status: "pending", expiresAt: future },
          { email: "ann@example.com", userNo: null },
        ),
      ).toBe("user_mismatch");
    });

    it("首尾空白不算不符（库里存的是写入时的原样）", () => {
      expect(
        rejectAcceptance(
          { ...byNo, status: "pending", expiresAt: future },
          { email: null, userNo: " 1000000017 " },
        ),
      ).toBeNull();
    });

    it("行状态仍然优先：已撤销的邀请，号对得上也说「已撤销」", () => {
      expect(
        rejectAcceptance(
          { ...byNo, status: "revoked", expiresAt: future },
          { email: null, userNo: "1000000017" },
        ),
      ).toBe("revoked");
    });
  });

  /**
   * 认不出的 target_type 一律拒绝。
   *
   * 这一条钉的是 `switch` 的 **default 分支**：原来的写法是
   * `if (targetType === "email") 校验`，意味着**任何新增的 targetType 默认放行**
   * ——加一种通道就开一个洞，而且不报错。库里 `target_type` 没有 CHECK 约束，
   * 脏数据也会落到这里。
   */
  it("认不出的 target_type → unknown_target，不放行", () => {
    expect(
      rejectAcceptance(
        {
          targetType: "phone",
          target: "13800000000",
          status: "pending",
          expiresAt: future,
        },
        { email: "ann@example.com", userNo: "1000000017" },
      ),
    ).toBe("unknown_target");
  });

  it("行状态优先于邮箱:撤销 / 已接受 / 过期各有其名", () => {
    expect(
      rejectAcceptance(
        { ...base, status: "revoked", expiresAt: future },
        NOBODY,
      ),
    ).toBe("revoked");
    expect(
      rejectAcceptance(
        { ...base, status: "accepted", expiresAt: future },
        NOBODY,
      ),
    ).toBe("already_accepted");
    expect(
      rejectAcceptance({ ...base, status: "pending", expiresAt: past }, NOBODY),
    ).toBe("expired");
  });

  it("deriveInvitationStatus:pending 过期 → expired,其余原样", () => {
    expect(deriveInvitationStatus("pending", past)).toBe("expired");
    expect(deriveInvitationStatus("pending", future)).toBe("pending");
    expect(deriveInvitationStatus("revoked", future)).toBe("revoked");
  });
});

describe("MockOrganizationRepository invitations & member status", () => {
  let repo: MockOrganizationRepository;
  let orgId: string;

  beforeEach(async () => {
    repo = new MockOrganizationRepository();
    const { org } = await repo.createTeamOrg("u-owner", "Acme");
    orgId = org.id;
  });

  async function invite(target = "ann@example.com") {
    return repo.createInvitation({
      scope: "org",
      organizationId: orgId,
      targetType: "email",
      target,
      role: "member",
      createdBy: "u-owner",
    });
  }

  it("接受成功:邀请转 accepted,租户级 + 默认工作空间两级 membership 都挂上", async () => {
    const { invitation, token } = await invite();
    const result = await repo.acceptInvitation({ token: token }, "u-ann", {
      email: "ann@example.com",
      userNo: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenantName).toBe("Acme");
    expect(result.membership.role).toBe("member");

    const members = await repo.listOrgMembers(orgId);
    expect(members.some((m) => m.userId === "u-ann")).toBe(true);
    const ws = await repo.getDefaultWorkspace(orgId);
    expect(await repo.getWorkspaceMembership("u-ann", ws!.id)).not.toBeNull();

    const list = await repo.listInvitations(orgId);
    expect(list.find((i) => i.id === invitation.id)?.status).toBe("accepted");
    // 同一链接不能再用一次。
    const again = await repo.acceptInvitation({ token: token }, "u-ann", {
      email: "ann@example.com",
      userNo: null,
    });
    expect(again).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("邮箱不符 → email_mismatch,邀请仍是 pending", async () => {
    const { invitation, token } = await invite();
    const result = await repo.acceptInvitation({ token: token }, "u-bob", {
      email: "bob@x.com",
      userNo: null,
    });
    expect(result).toEqual({ ok: false, reason: "email_mismatch" });
    const list = await repo.listInvitations(orgId);
    expect(list.find((i) => i.id === invitation.id)?.status).toBe("pending");
  });

  it("重发 = 换 token:旧链接失效、新链接可用;撤销后不能重发", async () => {
    const { invitation, token } = await invite();
    const rotated = await repo.rotateInvitationToken(invitation.id, orgId);
    expect(rotated?.email).toBe("ann@example.com");
    expect(rotated?.token).not.toBe(token);

    expect(await repo.getInvitationByToken(token)).toBeNull();
    expect((await repo.getInvitationByToken(rotated!.token))?.status).toBe(
      "pending",
    );

    expect(await repo.revokeInvitation(invitation.id, orgId)).toBe(true);
    expect(await repo.rotateInvitationToken(invitation.id, orgId)).toBeNull();
    expect(
      await repo.acceptInvitation({ token: rotated!.token }, "u-ann", {
        email: "ann@example.com",
        userNo: null,
      }),
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("停用 / 恢复:两级 membership 同步改 status,目录仍列出停用者", async () => {
    await repo.addOrgMember(orgId, "u-ann", "member");
    const ws = await repo.getDefaultWorkspace(orgId);
    await repo.addWorkspaceMember(ws!.id, "u-ann", "member");

    const suspended = await repo.setOrgMemberStatus(
      orgId,
      "u-ann",
      "suspended",
    );
    expect(suspended?.status).toBe("suspended");
    expect(await repo.getWorkspaceMembership("u-ann", ws!.id)).toBeNull();
    expect(
      (await repo.listOrgMembersWithUser(orgId)).find(
        (m) => m.userId === "u-ann",
      )?.status,
    ).toBe("suspended");

    const restored = await repo.setOrgMemberStatus(orgId, "u-ann", "active");
    expect(restored?.status).toBe("active");
    expect(await repo.getWorkspaceMembership("u-ann", ws!.id)).not.toBeNull();
    expect(
      await repo.setOrgMemberStatus(orgId, "u-nobody", "active"),
    ).toBeNull();
  });

  it("解除关联删两级 membership", async () => {
    await repo.addOrgMember(orgId, "u-ann", "member");
    const ws = await repo.getDefaultWorkspace(orgId);
    await repo.addWorkspaceMember(ws!.id, "u-ann", "member");
    expect(await repo.removeOrgMember(orgId, "u-ann")).toBe(true);
    expect(await repo.getWorkspaceMembership("u-ann", ws!.id)).toBeNull();
    expect(await repo.getOrgMemberDetail(orgId, "u-ann")).toBeNull();
  });
});
/**
 * declined 的取档（owner 2026-09-09）。
 *
 * 这一条钉的不是「能不能拒绝」，而是**拒绝之后邀请人看到的是什么**。
 * `deriveInvitationStatus` 有个兜底 `expired`：任何没在白名单里点名的状态都会
 * 悄悄变成「已过期」。漏点名不报错——它只是把「对方拒绝了」讲成「没人理」。
 */
describe("declined 取档", () => {
  const future = new Date(Date.now() + 60_000);

  it("declined 原样透出，不落到兜底的 expired", () => {
    expect(deriveInvitationStatus("declined", future)).toBe("declined");
  });

  /* 反向对照：兜底确实还在（否则上一条不构成证明——一个「原样返回一切」的实现
     同样能让它通过）。 */
  it("未知状态仍走兜底 → expired", () => {
    expect(deriveInvitationStatus("something_new", future)).toBe("expired");
  });

  /* 拒绝与接受共用同一张矩阵：一条我无权接受的邀请，也不该由我来拒绝——
     否则任何人都能替别人把邀请回绝掉。 */
  it("拒绝走的是同一张矩阵：号不对就不许动", () => {
    const inv = {
      targetType: "user_no",
      target: "1000000017",
      status: "pending",
      expiresAt: future,
    };
    expect(rejectAcceptance(inv, { email: null, userNo: "1000000099" })).toBe(
      "user_mismatch",
    );
  });
});
