import { describe, it, vi } from "vitest";
import { SessionAggregator } from "./session.aggregator";
describe("probe", () => {
  it("看它抛什么", async () => {
    const a = Object.create(SessionAggregator.prototype) as SessionAggregator;
    Object.assign(a, {
      org: {
        getOrgById: vi.fn(async () => ({ id: "org-1", type: "organization" })),
        listWorkspacesForSwitch: vi.fn(async () => [{ id: "ws-1" }]),
        getOrgMemberDetail: vi.fn(async () => null),
        listInvitations: vi.fn(async () => []),
        createInvitation: vi.fn(async () => ({
          invitation: { id: "i" },
          token: "t",
        })),
      },
      account: {
        getUserById: vi.fn(async () => ({ id: "u-1" })),
        findUserByIdentifier: vi.fn(async () => null),
        findUserByUserNo: vi.fn(async () => null),
      },
      gov: { assertCan: vi.fn(async () => undefined) },
      active: {
        resolveActiveContext: vi.fn(async () => ({ activeOrg: "org-1" })),
      },
      invalidateCapabilities: vi.fn(),
    });
    try {
      await a.inviteMember("u-1", "org-1", {
        email: "x@y.z",
        roleCode: "member",
        workspaceId: "ws-1",
      } as never);
      console.log("PROBE: 没抛");
    } catch (e) {
      console.log("PROBE 抛了:", String(e));
    }
  });
});
