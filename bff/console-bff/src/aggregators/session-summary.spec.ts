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
      {} as never,
      {} as never,
    );
    expect(await aggregator.getCurrentUser("self")).toMatchObject({
      accountStatus: "deleting",
      deletionRequestedAt: user.deletionRequestedAt,
    });
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
