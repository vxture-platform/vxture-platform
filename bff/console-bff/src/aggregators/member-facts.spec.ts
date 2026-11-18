/**
 * member-facts.spec.ts - Tenant-scoped identity metadata and contact redaction.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it, vi } from "vitest";
import { SessionAggregator } from "./session.aggregator";

// ===== Scoped fixtures =====
function fixture() {
  const member = {
    userId: "member",
    name: "Member",
    account: "member",
    email: "person@example.test",
    phone: "+8613800138000",
    role: "member",
    status: "active",
    joinedAt: new Date("2026-10-01T00:00:00Z"),
  };
  const pool = {
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [
        {
          id: "member",
          user_no: "1649201736",
          created_at: new Date("2026-01-01T00:00:00Z"),
          status: "active",
          avatar_hash: null,
          last_login_at: new Date("2026-11-18T09:00:00Z"),
        },
      ],
    })),
  };
  const org = {
    getOrgById: vi.fn(async () => ({ id: "tenant", type: "organization" })),
    listOrgMembersWithUser: vi.fn(async () => [member]),
    getOrgMemberDetail: vi.fn(async (_org: string, id: string) =>
      id === member.userId ? member : null,
    ),
    listInvitations: vi.fn(async () => []),
    listWorkspaceMembersByTenant: vi.fn(
      async () =>
        new Map([
          [
            "member",
            [
              {
                id: "workspace",
                name: "Workspace",
                role: "member",
                isDefault: true,
              },
            ],
          ],
        ]),
    ),
  };
  const aggregator: SessionAggregator = Object.assign(
    Object.create(SessionAggregator.prototype) as SessionAggregator,
    {
      org,
      pool,
      config: { auth: { OIDC_ISSUER: "https://accounts.example.test" } },
      active: {
        resolveActiveContext: vi.fn(async () => ({ activeOrg: "tenant" })),
      },
    },
  );
  return { aggregator, pool, org };
}

// ===== Privacy and independent lifecycle timestamps =====
describe("member facts", () => {
  it("keeps registration, membership and successful authentication independent", async () => {
    const { aggregator, pool } = fixture();
    const [member] = await aggregator.listMembers("actor", "tenant");
    expect(member).toMatchObject({
      registeredAt: "2026-01-01T00:00:00.000Z",
      joinedAt: "2026-10-01T00:00:00.000Z",
      lastLoginAt: "2026-11-18T09:00:00.000Z",
      presence: "unknown",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0]).toEqual([
      expect.stringContaining("l.result = 'success'"),
      [["member"]],
    ]);
  });
  it("redacts contacts for member details as well as the list", async () => {
    const { aggregator } = fixture();
    const member = await aggregator.getMember("actor", "tenant", "member", {
      includeContacts: false,
    });
    expect(member?.email).toBe("p***@example.test");
    expect(member?.phone).not.toBe("+8613800138000");
  });
  it("does not query identity facts for a user outside the tenant", async () => {
    const { aggregator, pool } = fixture();
    expect(
      await aggregator.getMember("actor", "tenant", "outsider"),
    ).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
  it("rejects an explicit tenant mismatch before reading its members", async () => {
    const { aggregator, pool, org } = fixture();
    expect(await aggregator.listMembers("actor", "other-tenant")).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(org.listOrgMembersWithUser).not.toHaveBeenCalled();
  });
});
