import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionService } from "./subscription.service";
import type { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { SubscriptionRecord } from "../types/subscription.types";

// Provisioning-wire unit tests (product_310 P2.3b): repo + provisioning are
// mocked; the wire's fan-out / coverage / transition rules are the subject.

const SUB: SubscriptionRecord = {
  id: "sub-1",
  tenantId: "org-1",
  workspaceId: "ws-1",
  planVersionId: "pv-1",
  cycleType: "monthly",
  cycleCount: 1,
  startAt: new Date(),
  endAt: null,
  trialEndAt: null,
  status: "active",
  subscriptionKind: "paid",
  activationMethod: "online_purchase",
  autoRenew: true,
  payAmount: null,
  currency: "CNY",
  createdBy: "u-1",
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const ARDA = {
  productId: "prod-arda",
  productCode: "arda",
  planCode: "arda-free",
};
const RUNOS = {
  productId: "prod-runos",
  productCode: "runos",
  planCode: "bundle-pro",
};

interface Mocks {
  repo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    listVersionProducts: ReturnType<typeof vi.fn>;
    hasOtherActiveCoverage: ReturnType<typeof vi.fn>;
    findTierConflicts: ReturnType<typeof vi.fn>;
  };
  provisioning: {
    onSubscriptionActivated: ReturnType<typeof vi.fn>;
    onSubscriptionDeactivated: ReturnType<typeof vi.fn>;
    enqueueEvent: ReturnType<typeof vi.fn>;
  };
  service: SubscriptionService;
}

const build = (): Mocks => {
  const repo = {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    listVersionProducts: vi.fn().mockResolvedValue([ARDA]),
    hasOtherActiveCoverage: vi.fn().mockResolvedValue(false),
    findTierConflicts: vi.fn().mockResolvedValue([]),
  };
  const provisioning = {
    onSubscriptionActivated: vi
      .fn()
      .mockResolvedValue({ deliveryId: "d", seq: 1 }),
    onSubscriptionDeactivated: vi
      .fn()
      .mockResolvedValue({ deliveryId: "d", seq: 2 }),
    enqueueEvent: vi.fn().mockResolvedValue("d-evt"),
  };
  const service = new SubscriptionService(
    repo as unknown as PgSubscriptionRepository,
    provisioning as unknown as ProvisioningService,
  );
  return { repo, provisioning, service };
};

describe("createSubscription → tenant.provisioned per component", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("fires one provisioned event per bundled product", async () => {
    m.repo.create.mockResolvedValue(SUB);
    m.repo.listVersionProducts.mockResolvedValue([ARDA, RUNOS]);
    await m.service.createSubscription({} as never);
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledTimes(2);
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      tenantId: "org-1",
      applicationId: "prod-arda",
      appCode: "arda",
      plan: "arda-free",
    });
  });

  it("does not fire when the created record is not activated", async () => {
    m.repo.create.mockResolvedValue({ ...SUB, status: "suspended" });
    await m.service.createSubscription({} as never);
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("an enqueue failure never fails the committed create", async () => {
    m.repo.create.mockResolvedValue(SUB);
    m.provisioning.onSubscriptionActivated.mockRejectedValue(new Error("db"));
    await expect(m.service.createSubscription({} as never)).resolves.toEqual(
      SUB,
    );
  });
});

describe("cancelSubscription → per-component deprovision fallout (§11.4)", () => {
  let m: Mocks;
  beforeEach(() => {
    m = build();
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, status: "cancelled" });
  });

  it("deprovisions a product with no surviving coverage", async () => {
    await m.service.cancelSubscription("sub-1");
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      tenantId: "org-1",
      applicationId: "prod-arda",
      appCode: "arda",
    });
  });

  it("keeps a product still covered by another active subscription", async () => {
    m.repo.hasOtherActiveCoverage.mockResolvedValue(true);
    await m.service.cancelSubscription("sub-1");
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("checks coverage excluding the cancelled subscription itself", async () => {
    await m.service.cancelSubscription("sub-1");
    expect(m.repo.hasOtherActiveCoverage).toHaveBeenCalledWith(
      "ws-1",
      "prod-arda",
      "sub-1",
    );
  });
});

describe("upgradeSubscription → provision new set, deprovision dropped set", () => {
  let m: Mocks;
  beforeEach(() => {
    m = build();
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, planVersionId: "pv-2" });
  });

  it("provisions the new version's products and deprovisions dropped ones", async () => {
    m.repo.listVersionProducts.mockImplementation(async (pv: string) =>
      pv === "pv-2" ? [RUNOS] : [ARDA, RUNOS],
    );
    await m.service.upgradeSubscription("sub-1", "pv-2");
    // new set provisioned
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(
      m.provisioning.onSubscriptionActivated.mock.calls[0]![0].appCode,
    ).toBe("runos");
    // arda dropped and uncovered → deprovisioned
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledTimes(1);
    expect(
      m.provisioning.onSubscriptionDeactivated.mock.calls[0]![0].appCode,
    ).toBe("arda");
  });

  it("keeps dropped products that another subscription still covers", async () => {
    m.repo.listVersionProducts.mockImplementation(async (pv: string) =>
      pv === "pv-2" ? [RUNOS] : [ARDA, RUNOS],
    );
    m.repo.hasOtherActiveCoverage.mockResolvedValue(true);
    await m.service.upgradeSubscription("sub-1", "pv-2");
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });
});

describe("updateSubscription → transition-derived events", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("suspended → active fires provisioned", async () => {
    m.repo.getById.mockResolvedValue({ ...SUB, status: "suspended" });
    m.repo.update.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { status: "active" });
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledTimes(1);
  });

  it("active → expired fires the deprovision check", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, status: "expired" });
    await m.service.updateSubscription("sub-1", { status: "expired" });
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledTimes(1);
  });

  it("active → suspended fires nothing (space is kept)", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, status: "suspended" });
    await m.service.updateSubscription("sub-1", { status: "suspended" });
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("no-op update fires nothing", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { autoRenew: false });
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("version change via update routes through the version-change flow", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, planVersionId: "pv-2" });
    m.repo.listVersionProducts.mockImplementation(async (pv: string) =>
      pv === "pv-2" ? [ARDA] : [ARDA],
    );
    await m.service.updateSubscription("sub-1", { toPlanVersionId: "pv-2" });
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });
});

/* 2026-10-03 修的缺陷（owner：「这是 bug，你来修正」）。
   值域七档，撤销钩子原先的判据只认 active/trialing，终态集只有 cancelled/expired ——
   **expiring / overdue / suspended 三档夹在中间，落在两个集合的缝里**：
   进这三档时不发信号（对的，服务还在），从这三档进终态时**也不发**（错的）。
   于是「关了自动续费、正常到期」那一批（必经 expiring）产品侧永远收不到
   tenant.deprovisioned，而没经过 expiring 的那批收得到 —— 同一个终态、
   产品侧收到的东西不同。这一组用例在旧代码下全是红的。 */
describe("中间态 → 终态必须发 deprovisioned（expiring/overdue/suspended 的缝）", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  const MIDDLE = ["expiring", "overdue", "suspended"] as const;
  const TERMINAL = ["expired", "cancelled"] as const;

  for (const from of MIDDLE) {
    for (const to of TERMINAL) {
      it(`${from} → ${to} 发一条 deprovisioned`, async () => {
        m.repo.getById.mockResolvedValue({ ...SUB, status: from });
        m.repo.update.mockResolvedValue({ ...SUB, status: to });
        await m.service.updateSubscription("sub-1", { status: to } as never);
        expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledTimes(
          1,
        );
        expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledWith({
          workspaceId: "ws-1",
          tenantId: "org-1",
          applicationId: "prod-arda",
          appCode: "arda",
        });
      });
    }
  }

  /* 逃生口：别把判据放宽成「谁都发」。还占着产品的那几档**互相之间**走动时
     一个信号都不该发 —— 服务没断。 */
  it("active → expiring 不发任何信号（服务还在）", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, status: "expiring" });
    await m.service.updateSubscription("sub-1", {
      status: "expiring",
    } as never);
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("expiring → overdue 不发任何信号（两档都还占着）", async () => {
    m.repo.getById.mockResolvedValue({ ...SUB, status: "expiring" });
    m.repo.update.mockResolvedValue({ ...SUB, status: "overdue" });
    await m.service.updateSubscription("sub-1", { status: "overdue" } as never);
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  /* 第二处同病：换版本那条路的门同样只认 ACTIVATED，于是处在中间态的订阅换版本时
     被移除的产品在产品侧永远留着。 */
  it("expiring 态换版本：被移除的产品要发 deprovisioned", async () => {
    m.repo.getById.mockResolvedValue({ ...SUB, status: "expiring" });
    m.repo.update.mockResolvedValue({
      ...SUB,
      status: "expiring",
      planVersionId: "pv-2",
    });
    m.repo.listVersionProducts.mockImplementation(async (pv: string) =>
      pv === "pv-2" ? [ARDA] : [ARDA, RUNOS],
    );
    await m.service.updateSubscription("sub-1", { toPlanVersionId: "pv-2" });
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      tenantId: "org-1",
      applicationId: "prod-runos",
      appCode: "runos",
    });
  });
});

describe("subscription_changed → C2 entitlement invalidate (P2.4 debt)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("create fires subscription_changed per covered product", async () => {
    m.repo.create.mockResolvedValue(SUB);
    m.repo.listVersionProducts.mockResolvedValue([ARDA, RUNOS]);
    await m.service.createSubscription({} as never);
    const events = m.provisioning.enqueueEvent.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      workspaceId: "ws-1",
      applicationId: "prod-arda",
      appCode: "arda",
      event: "subscription_changed",
      data: { products: ["arda"], subscription_id: "sub-1" },
    });
    expect(events[0].idempotencyKey).toContain("subchg:sub-1:prod-arda:");
    // must fit provisioning.webhook_deliveries.idempotency_key varchar(128)
    // with real uuids: "subchg:" + 3 × 36 + 2 separators = 117
    expect(events[0].idempotencyKey.length).toBeLessThanOrEqual(128);
  });

  it("create fires it even for a non-activated (suspended) record", async () => {
    m.repo.create.mockResolvedValue({ ...SUB, status: "suspended" });
    await m.service.createSubscription({} as never);
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledTimes(1);
  });

  it("cancel fires it even when another subscription still covers", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, status: "cancelled" });
    m.repo.hasOtherActiveCoverage.mockResolvedValue(true);
    await m.service.cancelSubscription("sub-1");
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledTimes(1);
  });

  it("upgrade fans out over the union of old + new version products, deduped", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue({ ...SUB, planVersionId: "pv-2" });
    m.repo.listVersionProducts.mockImplementation(async (pv: string) =>
      pv === "pv-2" ? [RUNOS] : [ARDA, RUNOS],
    );
    await m.service.upgradeSubscription("sub-1", "pv-2");
    const codes = m.provisioning.enqueueEvent.mock.calls
      .map((c) => c[0].appCode)
      .sort();
    expect(codes).toEqual(["arda", "runos"]);
  });

  it("no-op update fires nothing", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { autoRenew: false });
    expect(m.provisioning.enqueueEvent).not.toHaveBeenCalled();
  });

  it("an enqueue failure never fails the committed write", async () => {
    m.repo.create.mockResolvedValue(SUB);
    m.provisioning.enqueueEvent.mockRejectedValue(new Error("db"));
    await expect(m.service.createSubscription({} as never)).resolves.toEqual(
      SUB,
    );
  });
});

describe("tier-stacking guardrail (D12 invariant, arda reply-07 §3)", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  const CONFLICT = [
    { productCode: "arda", newTier: "pro", existingTier: "starter" },
  ];

  it("create: a different-tier live subscription for the same product rejects", async () => {
    m.repo.findTierConflicts.mockResolvedValue(CONFLICT);
    await expect(
      m.service.createSubscription({
        workspaceId: "ws-1",
        planVersionId: "pv-2",
      } as never),
    ).rejects.toThrow(/档位不同/);
    expect(m.repo.create).not.toHaveBeenCalled();
  });

  it("create: no conflict proceeds (same tier / bundled coexistence stay legal)", async () => {
    m.repo.create.mockResolvedValue(SUB);
    await m.service.createSubscription({
      workspaceId: "ws-1",
      planVersionId: "pv-2",
    } as never);
    expect(m.repo.create).toHaveBeenCalled();
  });

  it("upgrade: checks the target version excluding the subscription itself", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue(SUB);
    await m.service.upgradeSubscription("sub-1", "pv-2");
    expect(m.repo.findTierConflicts).toHaveBeenCalledWith(
      "ws-1",
      "pv-2",
      "sub-1",
    );
    m.repo.findTierConflicts.mockResolvedValue(CONFLICT);
    await expect(
      m.service.upgradeSubscription("sub-1", "pv-3"),
    ).rejects.toThrow(/档位不同/);
  });

  it("update: plan change and revival-to-live both check; a plain field update does not", async () => {
    m.repo.getById.mockResolvedValue(SUB);
    m.repo.update.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { toPlanVersionId: "pv-2" });
    expect(m.repo.findTierConflicts).toHaveBeenLastCalledWith(
      "ws-1",
      "pv-2",
      "sub-1",
    );

    // revival: suspended → active re-enters live coverage on the CURRENT version
    m.repo.getById.mockResolvedValue({ ...SUB, status: "suspended" });
    m.repo.update.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { status: "active" } as never);
    expect(m.repo.findTierConflicts).toHaveBeenLastCalledWith(
      "ws-1",
      "pv-1",
      "sub-1",
    );

    // plain field update creates no coverage — no probe
    m.repo.findTierConflicts.mockClear();
    m.repo.getById.mockResolvedValue(SUB);
    await m.service.updateSubscription("sub-1", { autoRenew: false });
    expect(m.repo.findTierConflicts).not.toHaveBeenCalled();
  });
});
