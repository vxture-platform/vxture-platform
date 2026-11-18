/**
 * invitation-integrity.spec.ts - Identity and channel guards before signing invitations.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-18
 */
import { describe, expect, it, vi } from "vitest";
import { SessionAggregator } from "./session.aggregator";

// ===== Trusted account and organization fixture =====
function fixture() {
  const person = {
    id: "recipient",
    userNo: "1000000017",
    email: "recipient@example.test",
    emailVerified: true,
    phone: "+8613800138000",
    phoneVerified: true,
    status: "active",
    name: "Recipient",
    account: "recipient",
  };
  const org = {
    getOrgById: vi.fn(async () => ({
      id: "tenant",
      name: "Organization",
      type: "organization",
    })),
    listWorkspacesForSwitch: vi.fn(async () => [{ id: "workspace" }]),
    getOrgMemberDetail: vi.fn(async () => null as { status: string } | null),
    listInvitations: vi.fn(
      async () =>
        [] as {
          status: string;
          recipientUserId?: string;
          targetType: string;
          target: string;
          email: string;
        }[],
    ),
    createInvitation: vi.fn(async () => ({
      invitation: { id: "invitation", expiresAt: new Date(Date.now() + 60000) },
      token: "token",
    })),
  };
  const account = {
    findUserByIdentifier: vi.fn(async () => person),
    findUserByUserNo: vi.fn(async () => person),
    getUserById: vi.fn(async () => person),
  };
  const aggregator = Object.create(
    SessionAggregator.prototype,
  ) as SessionAggregator;
  Object.assign(aggregator, {
    org,
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    active: {
      resolveActiveContext: vi.fn(async () => ({
        activeOrg: "tenant",
        activeWorkspace: "workspace",
      })),
    },
    account,
    gov: { assertCan: vi.fn(async () => undefined) },
  });
  return { aggregator, org, account, person };
}
const base = { roleCode: "member", workspaceId: "workspace" };

// ===== Input guards and preview identity =====
describe("invitation integrity", () => {
  it("resolves a bound member only once in the member directory", async () => {
    const { aggregator, org, person } = fixture();
    Object.assign(org, {
      listOrgMembersWithUser: vi.fn(async () => [
        {
          userId: person.id,
          email: person.email,
          account: person.account,
          name: person.name,
          phone: person.phone,
          role: "member",
          status: "active",
          joinedAt: new Date(),
        },
      ]),
      listWorkspaceMembersByTenant: vi.fn(async () => new Map()),
    });
    org.listInvitations.mockResolvedValue([
      {
        status: "pending",
        recipientUserId: person.id,
        targetType: "user_no",
        target: person.userNo,
        email: "",
      },
    ]);
    expect(await aggregator.listMembers("admin", "tenant")).toHaveLength(1);
  });

  it("normalizes a phone and signs an identity-bound in-app invitation", async () => {
    const { aggregator, org } = fixture();
    const result = await aggregator.inviteMember("admin", "tenant", {
      ...base,
      phone: "138 0013 8000",
      expectedUserNo: "1000000017",
    });
    expect(org.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "phone",
        target: "+8613800138000",
        recipientUserId: "recipient",
      }),
    );
    expect(result).toMatchObject({
      email: "",
      targetType: "phone",
      targetUserId: "recipient",
    });
  });
  it.each([
    { phone: "not-a-number" },
    { phone: "+8613800138000", email: "recipient@example.test" },
    { phone: "+8613800138000", userNo: "1000000017" },
    {},
    { email: [] as unknown as string },
  ])(
    "rejects invalid or ambiguous channels before creating an invitation: %j",
    async (input) => {
      const { aggregator, org } = fixture();
      await expect(
        aggregator.inviteMember("admin", "tenant", { ...base, ...input }),
      ).rejects.toThrow();
      expect(org.createInvitation).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "1000000099"])(
    "requires a current confirmed phone identity: %s",
    async (expectedUserNo) => {
      const { aggregator, org } = fixture();
      await expect(
        aggregator.inviteMember("admin", "tenant", {
          ...base,
          phone: "13800138000",
          ...(expectedUserNo ? { expectedUserNo } : {}),
        }),
      ).rejects.toThrow("invitation_identity_changed");
      expect(org.createInvitation).not.toHaveBeenCalled();
    },
  );
  it("does not invite an unverified phone", async () => {
    const { aggregator, person, org } = fixture();
    person.phoneVerified = false;
    await expect(
      aggregator.inviteMember("admin", "tenant", {
        ...base,
        phone: "13800138000",
        expectedUserNo: person.userNo,
      }),
    ).rejects.toThrow("user_not_found");
    expect(org.createInvitation).not.toHaveBeenCalled();
  });
  it("does not invite a disabled account through phone lookup", async () => {
    const { aggregator, person } = fixture();
    person.status = "disabled";
    expect(
      await aggregator.lookupUserByPhone("admin", "tenant", "13800138000"),
    ).toEqual({ found: false });
  });
  it("returns masked contacts for phone preview", async () => {
    const { aggregator, person } = fixture();
    const preview = await aggregator.lookupUserByPhone(
      "admin",
      "tenant",
      "13800138000",
    );
    expect(preview).toMatchObject({ found: true, userNo: person.userNo });
    expect(preview && "maskedPhone" in preview && preview.maskedPhone).not.toBe(
      person.phone,
    );
    expect(preview && "maskedEmail" in preview && preview.maskedEmail).not.toBe(
      person.email,
    );
  });
  it("detects a pending invitation issued by another administrator and channel", async () => {
    const { aggregator, org, person } = fixture();
    org.listInvitations.mockResolvedValue([
      {
        status: "pending",
        recipientUserId: person.id,
        targetType: "user_no",
        target: person.userNo,
        email: "",
      },
    ]);
    await expect(
      aggregator.inviteMember("other-admin", "tenant", {
        ...base,
        email: person.email,
      }),
    ).rejects.toThrow("invitation_pending");
    expect(org.createInvitation).not.toHaveBeenCalled();
  });
  it("does not expose the internal recipient UUID through invitation history", async () => {
    const { aggregator, org, person } = fixture();
    org.listInvitations.mockResolvedValue([
      {
        status: "pending",
        recipientUserId: person.id,
        targetType: "user_no",
        target: person.userNo,
        email: "",
      },
    ]);
    const list = await aggregator.listInvitations("admin", "tenant");
    expect(list[0]).not.toHaveProperty("recipientUserId");
  });
  it.each(["active", "suspended"])(
    "existing %s members cannot be re-invited",
    async (status) => {
      const { aggregator, org, person } = fixture();
      org.getOrgMemberDetail.mockResolvedValue({ status });
      await expect(
        aggregator.inviteMember("admin", "tenant", {
          ...base,
          phone: person.phone,
          expectedUserNo: person.userNo,
        }),
      ).rejects.toThrow("already_member");
      expect(org.createInvitation).not.toHaveBeenCalled();
    },
  );
});
