import { vi } from "vitest";
import { SubscriptionService } from "./subscription.service";
import type { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { SubscriptionRecord } from "../types/subscription.types";

// Shared fixtures for the "→ expired" sweep specs (trial-expiry-sweep.spec /
// expiry-sweep.spec): repo + provisioning mocked, service wired the same way.

export const subscriptionFixture = (
  over: Partial<SubscriptionRecord> = {},
): SubscriptionRecord => ({
  id: "s-1",
  tenantId: "org-1",
  workspaceId: "ws-1",
  planVersionId: "pv-1",
  cycleType: "monthly",
  cycleCount: 1,
  startAt: new Date("2026-06-01T00:00:00Z"),
  endAt: null,
  trialEndAt: null,
  status: "active",
  subscriptionKind: "paid",
  activationMethod: "offline_purchase",
  autoRenew: true,
  payAmount: null,
  currency: "CNY",
  createdBy: "u-1",
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...over,
});

export interface SweepMocks {
  repo: {
    update: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    findLapsedTrialIds: ReturnType<typeof vi.fn>;
    findExpiredSubscriptionIds: ReturnType<typeof vi.fn>;
    listVersionProducts: ReturnType<typeof vi.fn>;
    hasOtherActiveCoverage: ReturnType<typeof vi.fn>;
    /* 2026-09-25（批 2）：服务轴两个新写入方与「冻结中到期不通知」都要能在这里断言。 */
    findOverdueCandidates: ReturnType<typeof vi.fn>;
    findExpiringSoon: ReturnType<typeof vi.fn>;
    getNotifyDisplay: ReturnType<typeof vi.fn>;
    /* 2026-09-25 步骤三：暂停顺延（结算 + 到点处置）。 */
    settleResumedSuspensions: ReturnType<typeof vi.fn>;
    findOverdueSuspensions: ReturnType<typeof vi.fn>;
    closeSuspension: ReturnType<typeof vi.fn>;
    getMaxSuspendDays: ReturnType<typeof vi.fn>;
  };
  /** 客户通知（已注入）：断言「该发的发了、不该发的一条没发」。 */
  notifier: { notify: ReturnType<typeof vi.fn> };
  provisioning: {
    onSubscriptionActivated: ReturnType<typeof vi.fn>;
    onSubscriptionDeactivated: ReturnType<typeof vi.fn>;
    enqueueEvent: ReturnType<typeof vi.fn>;
  };
  service: SubscriptionService;
}

export const buildSweepMocks = (product: {
  productId: string;
  productCode: string;
  planCode: string;
}): SweepMocks => {
  const repo = {
    update: vi.fn(),
    getById: vi.fn(),
    findLapsedTrialIds: vi.fn().mockResolvedValue([]),
    findExpiredSubscriptionIds: vi.fn().mockResolvedValue([]),
    listVersionProducts: vi.fn().mockResolvedValue([product]),
    hasOtherActiveCoverage: vi.fn().mockResolvedValue(false),
    findOverdueCandidates: vi.fn().mockResolvedValue([]),
    findExpiringSoon: vi.fn().mockResolvedValue([]),
    getNotifyDisplay: vi.fn().mockResolvedValue(null),
    settleResumedSuspensions: vi.fn().mockResolvedValue([]),
    findOverdueSuspensions: vi.fn().mockResolvedValue([]),
    closeSuspension: vi.fn().mockResolvedValue(undefined),
    getMaxSuspendDays: vi.fn().mockResolvedValue(60),
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
  /* 注入 notifier：不注入的话 `emit` 在第一行就 return false，通知那一半根本跑不到，
     「该发没发」这类断言会全绿地测了个空。getNotifyDisplay 默认回 null，于是已有的
     那些 spec 行为不变（emit 拿不到 input，照样不发）。 */
  const notifier = { notify: vi.fn(async () => undefined) };
  service.setCustomerNotifier(notifier);
  return { repo, provisioning, service, notifier };
};
