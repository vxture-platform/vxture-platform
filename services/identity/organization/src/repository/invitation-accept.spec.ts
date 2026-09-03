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

  it("pending 且未过期、邮箱一致(大小写不敏感)→ 可接受", () => {
    expect(
      rejectAcceptance(
        { ...base, status: "pending", expiresAt: future },
        "ann@example.com",
      ),
    ).toBeNull();
  });

  it("邮箱不符 / 无邮箱 → email_mismatch", () => {
    const inv = { ...base, status: "pending", expiresAt: future };
    expect(rejectAcceptance(inv, "bob@example.com")).toBe("email_mismatch");
    expect(rejectAcceptance(inv, null)).toBe("email_mismatch");
  });

  it("行状态优先于邮箱:撤销 / 已接受 / 过期各有其名", () => {
    expect(
      rejectAcceptance({ ...base, status: "revoked", expiresAt: future }, null),
    ).toBe("revoked");
    expect(
      rejectAcceptance(
        { ...base, status: "accepted", expiresAt: future },
        null,
      ),
    ).toBe("already_accepted");
    expect(
      rejectAcceptance({ ...base, status: "pending", expiresAt: past }, null),
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
    const result = await repo.acceptInvitation(
      token,
      "u-ann",
      "ann@example.com",
    );
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
    const again = await repo.acceptInvitation(
      token,
      "u-ann",
      "ann@example.com",
    );
    expect(again).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("邮箱不符 → email_mismatch,邀请仍是 pending", async () => {
    const { invitation, token } = await invite();
    const result = await repo.acceptInvitation(token, "u-bob", "bob@x.com");
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
      await repo.acceptInvitation(rotated!.token, "u-ann", "ann@example.com"),
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
