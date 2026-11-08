/**
 * Customer lifecycle proofs and resumable cross-domain cleanup.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { CustomerLifecycleService } from "./customer-lifecycle.service";
import type { CustomerSessionContext } from "./realm-session.service";

// ============================================================================
// Domain adapters and stable customer context
// ============================================================================
const context: CustomerSessionContext = {
  userId: "user",
  sid: "sid",
  user: {
    id: "user",
    account: "name",
    email: "a@b.test",
    emailVerified: true,
    phone: "+8613800000000",
    phoneVerified: true,
    status: "active",
    name: null,
    avatarHash: null,
  },
};
function build() {
  const account = {
    getUserById: vi.fn(async () => context.user),
    listIdentitiesByUser: vi.fn(async () => []),
    requestDeletion: vi.fn(async () => ({ purgeAt: "2030-01-01T00:00:00Z" })),
    cancelDeletion: vi.fn(async () => ({})),
  };
  const owned: {
    id: string;
    type: string;
    name: string;
    ownerUserId: string;
  }[] = [];
  const org = {
    listOrgMembershipsForUser: vi.fn(async () => []),
    listOwnedOrganizations: vi.fn(async () => owned),
    cleanupAccountMemberships: vi.fn(async () => 0),
    revokeInvitationsCreatedBy: vi.fn(async () => 0),
  };
  const snapshot = {
    unpaidBills: 0,
    paidBalance: "0.00",
    giftedBalance: "0.00",
    currency: "CNY",
    refundsInProgress: 0,
    receiptsInProgress: 0,
    pendingOrdersWithMoney: 0,
    pendingOrdersCancellable: [] as string[],
    unexpiredSubscriptions: 0,
  };
  const closure = { getSnapshot: vi.fn(async () => snapshot) };
  const orders = { cancel: vi.fn(async () => ({})) };
  const challenges = {
    start: vi.fn(async () => ({ challengeId: "proof" })),
    consume: vi.fn(
      async (_context: unknown, _id: string, _operation: string) => ({
        operation: "account-deletion",
        target: "",
        snapshot: {},
      }),
    ),
  };
  const payload: { sessions: { sid: string; clients: string[] | null }[] } = {
    sessions: [{ sid: "sid", clients: null }],
  };
  const save = vi.fn(async () => {});
  const lifecycle = {
    getForUser: vi.fn(async () => ({ status: "pending", attempts: 1 })),
    run: vi.fn(
      async (
        _id: string,
        work: (
          operation: { id: string; userId: string; payload: typeof payload },
          checkpoint: (value: typeof payload) => Promise<void>,
        ) => Promise<void>,
      ) => {
        await work({ id: "op", userId: "user", payload }, save);
        return true;
      },
    ),
  };
  const oidc = {
    getCustomerLogoutClients: vi.fn(async () => ["console"]),
    cleanupCustomerLifecycleSession: vi.fn(async () => {}),
  };
  return {
    service: new CustomerLifecycleService(
      account as never,
      lifecycle as never,
      org as never,
      closure as never,
      orders as never,
      challenges as never,
      oidc as never,
    ),
    account,
    lifecycle,
    org,
    closure,
    orders,
    challenges,
    oidc,
    payload,
    save,
    owned,
    snapshot,
  };
}

describe("customer lifecycle", () => {
  it("accepts an account without any tenant and commits before asynchronous cleanup", async () => {
    const f = build();
    expect(
      await f.service.request(context, {
        challengeId: "proof",
        acknowledged: true,
        userId: "attacker",
      }),
    ).toMatchObject({ status: "deleting", cleanupPending: true });
    expect(f.challenges.consume).toHaveBeenCalledWith(
      context,
      "proof",
      "account-deletion",
    );
    expect(f.account.requestDeletion).toHaveBeenCalledWith("user", {});
    expect(f.lifecycle.run).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgement before consuming a proof", async () => {
    const f = build();
    await expect(
      f.service.request(context, { challengeId: "proof" }),
    ).rejects.toThrow();
    expect(f.challenges.consume).not.toHaveBeenCalled();
  });
  it("blocks ownership even when no active membership exists", async () => {
    const f = build();
    f.owned.push({
      id: "org",
      type: "organization",
      name: "owned",
      ownerUserId: "user",
    });
    await expect(
      f.service.request(context, { challengeId: "proof", acknowledged: true }),
    ).rejects.toThrow("deletion_blocked");
    expect(f.account.requestDeletion).not.toHaveBeenCalled();
  });
  it("persists RP recipients before cache deletion and keeps them for retries", async () => {
    const f = build();
    await f.service.process("op");
    expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(
      f.oidc.cleanupCustomerLifecycleSession.mock.invocationCallOrder[0]!,
    );
    expect(f.oidc.cleanupCustomerLifecycleSession).toHaveBeenCalledWith(
      "user",
      "sid",
      ["console"],
    );
    await f.service.process("op");
    expect(f.oidc.getCustomerLogoutClients).toHaveBeenCalledOnce();
  });
  it("leaves work retryable without business effects when logout fails", async () => {
    const f = build();
    f.oidc.cleanupCustomerLifecycleSession.mockRejectedValue(
      new Error("RP down"),
    );
    await expect(f.service.process("op")).rejects.toThrow("RP down");
    expect(f.org.cleanupAccountMemberships).not.toHaveBeenCalled();
    expect(f.save).toHaveBeenCalledOnce();
  });
  it("rechecks money blockers before business cleanup", async () => {
    const f = build();
    f.owned.push({
      id: "personal",
      type: "personal",
      name: "personal",
      ownerUserId: "user",
    });
    f.snapshot.paidBalance = "1.00";
    await expect(f.service.process("op")).rejects.toThrow("deletion_blocked");
    expect(f.org.cleanupAccountMemberships).not.toHaveBeenCalled();
  });
  it("binds order cancellation retries to the exact lifecycle request", async () => {
    const f = build();
    f.owned.push({
      id: "personal",
      type: "personal",
      name: "personal",
      ownerUserId: "user",
    });
    f.snapshot.pendingOrdersCancellable = ["order"];
    await f.service.process("op");
    expect(f.orders.cancel).toHaveBeenCalledWith(
      "order",
      { actorType: "customer", actorId: "user", remark: "account_deletion:op" },
      "cancelled",
      "op",
    );
  });
  it("does not depend on billing or tenant selection to start recovery", async () => {
    const f = build();
    const deleting = {
      ...context,
      user: {
        ...context.user,
        status: "deleting",
        deletionRequestedAt: new Date().toISOString(),
      },
    };
    await f.service.start(
      deleting,
      { method: "email", target: "attacker" },
      true,
    );
    expect(f.challenges.start).toHaveBeenCalledWith(
      deleting,
      "account-recovery",
      deleting.user.deletionRequestedAt,
      "email",
    );
    expect(f.closure.getSnapshot).not.toHaveBeenCalled();
  });
  it("passes the exact proven retention request to the atomic recovery predicate", async () => {
    const f = build();
    const timestamp = new Date().toISOString();
    f.challenges.consume.mockResolvedValue({
      operation: "account-recovery",
      target: timestamp,
      snapshot: {},
    });
    await f.service.recover(
      {
        ...context,
        user: {
          ...context.user,
          status: "deleting",
          deletionRequestedAt: timestamp,
        },
      },
      { challengeId: "proof" },
    );
    expect(f.account.cancelDeletion).toHaveBeenCalledWith("user", timestamp);
  });
  it("rejects recovery proofs from an earlier deletion request", async () => {
    const f = build();
    await expect(
      f.service.recover(
        {
          ...context,
          user: {
            ...context.user,
            status: "deleting",
            deletionRequestedAt: new Date().toISOString(),
          },
        },
        { challengeId: "proof" },
      ),
    ).rejects.toThrow("lifecycle_state_changed");
    expect(f.account.cancelDeletion).not.toHaveBeenCalled();
  });
  it("does not disclose RP delivery metadata in the status response", async () => {
    const f = build();
    const result = await f.service.view(context);
    expect(result.cleanup).toEqual({ status: "pending", attempts: 1 });
    expect(JSON.stringify(result)).not.toContain('"sid"');
  });
});
