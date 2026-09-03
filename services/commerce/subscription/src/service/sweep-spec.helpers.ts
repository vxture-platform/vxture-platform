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
  orderNo: null,
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
  };
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
    // Voucher-less suites: promotion is out of scope here (declare specs own it).
    { reserveForOrder: async () => [] } as never,
  );
  return { repo, provisioning, service };
};
