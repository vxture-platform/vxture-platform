/**
 * Preserve lifecycle state and public tenant numbers in business summaries.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { describe, expect, it, vi } from "vitest";
import { SessionAggregator } from "./session.aggregator";

describe("business session summaries", () => {
  it("returns account deletion state so Console displays the recovery gate", async () => {
    const user = {
      id: "self",
      account: "customer",
      status: "deleting",
      avatarHash: null,
      deletionRequestedAt: "2026-11-01T00:00:00.000Z",
    };
    const account = { getUserById: vi.fn().mockResolvedValue(user) };
    const aggregator = new SessionAggregator(
      {} as never,
      {} as never,
      {} as never,
      account as never,
      {} as never,
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      {} as never,
    );
    expect(await aggregator.getCurrentUser("self")).toMatchObject({
      accountStatus: "deleting",
      deletionRequestedAt: user.deletionRequestedAt,
    });
  });

  it.each(["verified", "unverified", "pending", "rejected", null])(
    "reports personal verification from the caller's KYC status: %s",
    async (status) => {
      const query = vi
        .fn()
        .mockResolvedValue({ rows: status ? [{ status }] : [] });
      const account = {
        getUserById: vi.fn().mockResolvedValue({
          id: "self",
          account: "customer",
          avatarHash: null,
        }),
      };
      const aggregator = new SessionAggregator(
        {} as never,
        {} as never,
        {} as never,
        account as never,
        {} as never,
        { query } as never,
        {} as never,
      );
      const result = await aggregator.getCurrentUser("self");
      expect(result?.realNameVerified).toBe(status === "verified");
      expect(query).toHaveBeenCalledWith(
        "select status from kyc.user_kycs where user_id = $1",
        ["self"],
      );
      expect(result).not.toHaveProperty("status");
    },
  );

  it("does not misreport an unavailable KYC query as unverified", async () => {
    const aggregator = new SessionAggregator(
      {} as never,
      {} as never,
      {} as never,
      { getUserById: vi.fn().mockResolvedValue({ id: "self" }) } as never,
      {} as never,
      {
        query: vi.fn().mockRejectedValue(new Error("permission denied")),
      } as never,
      {} as never,
    );
    await expect(aggregator.getCurrentUser("self")).rejects.toThrow(
      "permission denied",
    );
  });

  it("keeps public numbers distinct from internal tenant IDs", async () => {
    const org = {
      listOrgMembershipsForUser: vi.fn().mockResolvedValue([
        {
          organization: {
            id: "internal-id",
            tenantNo: "12345678",
            name: "Team",
            type: "organization",
          },
          role: "member",
          isDefault: true,
          joinedAt: new Date("2026-11-01"),
        },
      ]),
      getDefaultWorkspace: vi
        .fn()
        .mockResolvedValue({ id: "space", name: "Team space" }),
    };
    const aggregator = new SessionAggregator(
      org as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await aggregator.getMyWorkspaces("self", "internal-id")).toEqual([
      expect.objectContaining({
        tenantId: "internal-id",
        tenantNo: "12345678",
        role: "member",
        isCurrent: true,
        isDefault: true,
        workspaceName: "Team space",
      }),
    ]);
    expect(org.listOrgMembershipsForUser).toHaveBeenCalledWith("self");
  });
});
