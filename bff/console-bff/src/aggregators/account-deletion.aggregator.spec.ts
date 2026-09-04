import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { TenantClosureSnapshot } from "@vxture/service-billing";
import { AccountDeletionAggregator } from "./account-deletion.aggregator";

/**
 * 资格判定的口径测试(owner 2026-09-04 裁定):阻断 / 确认 / 自动三档各自的判据,
 * 以及 request() 在有阻断时不动账号。服务全部用假件——判定是纯编排逻辑,不需要库。
 */

const USER = "u-1";

function snapshot(
  tenantId: string,
  patch: Partial<TenantClosureSnapshot> = {},
): TenantClosureSnapshot {
  return {
    tenantId,
    unpaidBills: 0,
    currency: "CNY",
    balance: "0.00",
    paidBalance: "0.00",
    giftedBalance: "0.00",
    refundsInProgress: 0,
    receiptsInProgress: 0,
    pendingOrdersCancellable: [],
    pendingOrdersWithMoney: 0,
    unexpiredSubscriptions: 0,
    ...patch,
  };
}

function membership(
  id: string,
  type: "personal" | "organization",
  ownerUserId: string,
  role = "owner",
) {
  return {
    organizationId: id,
    userId: USER,
    role,
    status: "active",
    joinedAt: new Date("2026-01-01"),
    organization: {
      id,
      name: `org-${id}`,
      type,
      ownerUserId,
      status: "active",
    },
  };
}

function build(opts: {
  status?: string;
  memberships?: ReturnType<typeof membership>[];
  snapshots?: Record<string, TenantClosureSnapshot>;
  identities?: number;
}) {
  const account = {
    getUserById: vi.fn(
      async (): Promise<{
        id: string;
        status: string;
        deletionRequestedAt: string | null;
      }> => ({
        id: USER,
        status: opts.status ?? "active",
        deletionRequestedAt: null,
      }),
    ),
    listIdentitiesByUser: vi.fn(async () =>
      Array.from({ length: opts.identities ?? 0 }, (_, i) => ({
        provider: `p${i}`,
      })),
    ),
    requestDeletion: vi.fn(async () => ({
      deletionRequestedAt: "2026-09-04T00:00:00.000Z",
      purgeAt: "2026-10-04T00:00:00.000Z",
      revokedSessions: 1,
      unboundIdentities: 0,
    })),
    cancelDeletion: vi.fn(async () => ({ id: USER, status: "active" })),
  };
  const org = {
    listOrgMembershipsForUser: vi.fn(async () => opts.memberships ?? []),
    removeOrgMember: vi.fn(async () => true),
    revokeInvitationsCreatedBy: vi.fn(async () => 0),
  };
  const closure = {
    getSnapshot: vi.fn(
      async (tenantId: string) =>
        opts.snapshots?.[tenantId] ?? snapshot(tenantId),
    ),
  };
  const orders = { cancel: vi.fn(async () => ({})) };
  const aggregator = new AccountDeletionAggregator(
    account as never,
    org as never,
    closure as never,
    orders as never,
  );
  return { aggregator, account, org, closure, orders };
}

describe("AccountDeletionAggregator.getState", () => {
  it("is deletable for a clean personal-tenant-only user", async () => {
    const { aggregator } = build({
      memberships: [membership("p", "personal", USER)],
    });
    const state = await aggregator.getState(USER);
    expect(state.status).toBe("active");
    expect(state.canDelete).toBe(true);
    expect(state.blockers).toEqual([]);
    expect(state.autoActions.map((a) => a.code)).toEqual([
      "revoke_sessions",
      "revoke_invitations",
      "delete_personal_tenant",
    ]);
  });

  it("blocks an organization owner and lists the organization", async () => {
    const { aggregator } = build({
      memberships: [
        membership("p", "personal", USER),
        membership("o", "organization", USER),
      ],
    });
    const state = await aggregator.getState(USER);
    expect(state.canDelete).toBe(false);
    expect(state.blockers).toContainEqual({
      code: "org_owner",
      count: 1,
      names: ["org-o"],
    });
  });

  it("blocks on money: unpaid bills, paid balance, refunds, receipts, paid orders", async () => {
    const { aggregator } = build({
      memberships: [membership("p", "personal", USER)],
      snapshots: {
        p: snapshot("p", {
          unpaidBills: 2,
          balance: "30.00",
          paidBalance: "10.00",
          giftedBalance: "20.00",
          refundsInProgress: 1,
          receiptsInProgress: 1,
          pendingOrdersWithMoney: 1,
          pendingOrdersCancellable: ["o-1"],
          unexpiredSubscriptions: 1,
        }),
      },
    });
    const state = await aggregator.getState(USER);
    expect(state.canDelete).toBe(false);
    expect(state.blockers.map((b) => b.code)).toEqual([
      "unpaid_bills",
      "paid_balance",
      "refund_in_progress",
      "receipt_in_progress",
      "pending_order_with_payment",
    ]);
    expect(state.blockers[1]).toEqual({
      code: "paid_balance",
      amount: "10.00",
      currency: "CNY",
    });
    expect(state.confirmations.map((c) => c.code)).toEqual([
      "active_subscription",
      "gifted_balance",
    ]);
    expect(state.autoActions[0]).toEqual({
      code: "cancel_pending_orders",
      count: 1,
    });
  });

  it("treats non-owner organization memberships as auto leave, not blockers", async () => {
    const { aggregator } = build({
      memberships: [
        membership("p", "personal", USER),
        membership("o", "organization", "someone-else", "member"),
      ],
      identities: 2,
    });
    const state = await aggregator.getState(USER);
    expect(state.canDelete).toBe(true);
    expect(state.autoActions).toContainEqual({
      code: "leave_organizations",
      count: 1,
      names: ["org-o"],
    });
    expect(state.autoActions).toContainEqual({
      code: "unbind_identities",
      count: 2,
    });
  });

  it("reports the retention window while deleting", async () => {
    const { aggregator, account } = build({ status: "deleting" });
    account.getUserById.mockResolvedValueOnce({
      id: USER,
      status: "deleting",
      deletionRequestedAt: "2026-09-04T00:00:00.000Z",
    });
    const state = await aggregator.getState(USER);
    expect(state.status).toBe("deleting");
    expect(state.canDelete).toBe(false);
    expect(state.purgeAt).toBe("2026-10-04T00:00:00.000Z");
    expect(state.retentionDays).toBe(30);
  });
});

describe("AccountDeletionAggregator.request", () => {
  it("refuses with the blockers and leaves the account untouched", async () => {
    const { aggregator, account, org, orders } = build({
      memberships: [membership("o", "organization", USER)],
    });
    await expect(aggregator.request(USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(account.requestDeletion).not.toHaveBeenCalled();
    expect(org.removeOrgMember).not.toHaveBeenCalled();
    expect(orders.cancel).not.toHaveBeenCalled();
  });

  it("runs the side effects, then flips the account", async () => {
    const { aggregator, account, org, orders } = build({
      memberships: [
        membership("p", "personal", USER),
        membership("o", "organization", "someone-else", "member"),
      ],
      snapshots: {
        p: snapshot("p", { pendingOrdersCancellable: ["o-1", "o-2"] }),
      },
    });
    await aggregator.request(USER, "1.2.3.4");
    expect(orders.cancel).toHaveBeenCalledTimes(2);
    expect(orders.cancel).toHaveBeenCalledWith("o-1", {
      actorType: "customer",
      actorId: USER,
      remark: "account_deletion",
      clientIp: "1.2.3.4",
    });
    expect(org.removeOrgMember).toHaveBeenCalledWith("o", USER);
    expect(org.revokeInvitationsCreatedBy).toHaveBeenCalledWith(USER);
    expect(account.requestDeletion).toHaveBeenCalledWith(USER);
  });
});
