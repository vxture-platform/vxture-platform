import { beforeEach, describe, expect, it } from "vitest";
import { MockOrganizationRepository } from "./mock-organization.repository";

/**
 * 转让所有权的拒绝矩阵(owner 2026-08-21 裁定,决策 3 批一)。
 *
 * 这条路径值得逐分支覆盖,理由是它的**权限门就在这段逻辑里**——不像别的写端点
 * 那样先过 `gov.assertCan` 再落库。所有权转让不该有任何权限授予能够替代
 * 「你就是当前 owner」,所以那个判断没有上游兜底:这里错一条,就是越权。
 *
 * 用 mock 仓储而非 itest:五条拒绝分支要的是判定逻辑,不是 SQL 行为;
 * pg 实现的事务与 `for update` 另由 itest 覆盖。两份实现的**取档必须一致**
 * (原 owner 降 manager 而非 member),所以这份 spec 也钉住那一条。
 */
describe("transferOrgOwner", () => {
  let repo: MockOrganizationRepository;
  let orgId: string;

  /** 建一个组织租户 + 一名 active 成员,返回 (租户, owner, 成员) 三元组。 */
  async function seedOrgWithMember() {
    const { org } = await repo.createTeamOrg("u-owner", "Acme");
    await repo.addOrgMember(org.id, "u-member", "member");
    return org.id;
  }

  beforeEach(async () => {
    repo = new MockOrganizationRepository();
    orgId = await seedOrgWithMember();
  });

  it("转让成功后:租户 owner 改写、目标升 owner、原 owner 降 manager", async () => {
    const result = await repo.transferOrgOwner(orgId, "u-owner", "u-member");

    expect(result).toEqual({
      ok: true,
      previousOwnerUserId: "u-owner",
      newOwnerUserId: "u-member",
    });

    const org = await repo.getOrgById(orgId);
    expect(org?.ownerUserId).toBe("u-member");

    const members = await repo.listOrgMembers(orgId);
    expect(members.find((m) => m.userId === "u-member")?.role).toBe("owner");
    // 降 manager 不是 member——转让是职责交接不是离场。这条是裁定,不是实现细节。
    expect(members.find((m) => m.userId === "u-owner")?.role).toBe("manager");
  });

  it("非 owner 发起 → not_owner(而不是静默成功)", async () => {
    const result = await repo.transferOrgOwner(orgId, "u-member", "u-owner");
    expect(result).toEqual({ ok: false, reason: "not_owner" });

    const org = await repo.getOrgById(orgId);
    expect(org?.ownerUserId).toBe("u-owner");
  });

  it("目标不是本租户成员 → target_not_member", async () => {
    const result = await repo.transferOrgOwner(orgId, "u-owner", "u-outsider");
    expect(result).toEqual({ ok: false, reason: "target_not_member" });
  });

  it("转给自己 → same_user", async () => {
    const result = await repo.transferOrgOwner(orgId, "u-owner", "u-owner");
    expect(result).toEqual({ ok: false, reason: "same_user" });
  });

  it("个人租户 → personal_tenant", async () => {
    const { org } = await repo.createPersonalOrg("u-solo", "Solo");
    await repo.addOrgMember(org.id, "u-other", "member");
    const result = await repo.transferOrgOwner(org.id, "u-solo", "u-other");
    expect(result).toEqual({ ok: false, reason: "personal_tenant" });
  });

  it("租户不存在 → tenant_not_found", async () => {
    const result = await repo.transferOrgOwner(
      "00000000-0000-0000-0000-000000000000",
      "u-owner",
      "u-member",
    );
    expect(result).toEqual({ ok: false, reason: "tenant_not_found" });
  });

  it("被拒时不留下任何改动(校验先于写入)", async () => {
    await repo.transferOrgOwner(orgId, "u-member", "u-owner");
    await repo.transferOrgOwner(orgId, "u-owner", "u-outsider");

    const org = await repo.getOrgById(orgId);
    expect(org?.ownerUserId).toBe("u-owner");
    const members = await repo.listOrgMembers(orgId);
    expect(members.find((m) => m.userId === "u-owner")?.role).toBe("owner");
    expect(members.find((m) => m.userId === "u-member")?.role).toBe("member");
  });
});
