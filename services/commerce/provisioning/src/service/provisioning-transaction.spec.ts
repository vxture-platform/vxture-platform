/**
 * provisioning-transaction.spec.ts - Explicit enqueue transaction propagation.
 * @package @vxture/service-provisioning
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ProvisioningService } from "./provisioning.service";
import type { PgProvisioningRepository } from "../repository/pg-provisioning.repository";

// ============================================================================
// Boundary fixtures: no dispatcher, database or network is started.
// ============================================================================
const lifecycle = {
  workspaceId: "workspace-1",
  tenantId: "tenant-1",
  applicationId: "product-1",
  appCode: "product",
};
const notification = {
  ...lifecycle,
  event: "subscription_changed" as const,
  idempotencyKey: "test-change-1",
  data: { subscription_id: "subscription-1" },
};
function build() {
  const repo = {
    enqueue: vi.fn().mockResolvedValue({ deliveryId: "delivery-1", seq: 1 }),
    enqueueEvent: vi.fn().mockResolvedValue("event-1"),
  };
  const transaction = {
    query: vi.fn(),
    release: vi.fn(),
  } as unknown as PoolClient;
  const service = new ProvisioningService(
    repo as unknown as PgProvisioningRepository,
    {
      maxAttempts: 3,
      backoffBaseSec: 1,
      backoffCapSec: 10,
      leaseSeconds: 30,
      batchSize: 5,
      timeoutMs: 1000,
    },
    { resolve: () => null },
    { deliveryFailed: vi.fn() },
  );
  return { repo, transaction, service };
}

// ============================================================================
// Caller connection identity, compatibility and failure propagation.
// ============================================================================
describe("ProvisioningService enqueue transaction boundary", () => {
  it("passes exactly the supplied transaction to lifecycle persistence", async () => {
    const h = build();
    const input = { ...lifecycle, event: "tenant.provisioned" as const };
    await expect(h.service.enqueue(input, h.transaction)).resolves.toEqual({
      deliveryId: "delivery-1",
      seq: 1,
    });
    expect(h.repo.enqueue).toHaveBeenCalledExactlyOnceWith(
      input,
      h.transaction,
    );
    expect(h.transaction.query).not.toHaveBeenCalled();
    expect(h.transaction.release).not.toHaveBeenCalled();
  });

  it("passes exactly the supplied transaction to generic event persistence", async () => {
    const h = build();
    await expect(
      h.service.enqueueEvent(notification, h.transaction),
    ).resolves.toBe("event-1");
    expect(h.repo.enqueueEvent).toHaveBeenCalledExactlyOnceWith(
      notification,
      h.transaction,
    );
  });

  it.each(["onSubscriptionActivated", "onSubscriptionDeactivated"] as const)(
    "%s forwards caller ownership through the convenience method",
    async (method) => {
      const h = build();
      await h.service[method](lifecycle, h.transaction);
      expect(h.repo.enqueue).toHaveBeenCalledExactlyOnceWith(
        {
          ...lifecycle,
          event:
            method === "onSubscriptionActivated"
              ? "tenant.provisioned"
              : "tenant.deprovisioned",
        },
        h.transaction,
      );
      expect(h.transaction.query).not.toHaveBeenCalled();
      expect(h.transaction.release).not.toHaveBeenCalled();
    },
  );

  it("preserves legacy calls without an extra undefined argument", async () => {
    const h = build();
    const input = { ...lifecycle, event: "tenant.provisioned" as const };
    await h.service.enqueue(input);
    expect(h.repo.enqueue).toHaveBeenCalledExactlyOnceWith(input);
    await h.service.enqueueEvent(notification);
    expect(h.repo.enqueueEvent).toHaveBeenCalledExactlyOnceWith(notification);
  });

  it.each(["onSubscriptionActivated", "onSubscriptionDeactivated"] as const)(
    "%s preserves the legacy argument shape",
    async (method) => {
      const h = build();
      await h.service[method](lifecycle);
      expect(h.repo.enqueue).toHaveBeenCalledExactlyOnceWith({
        ...lifecycle,
        event:
          method === "onSubscriptionActivated"
            ? "tenant.provisioned"
            : "tenant.deprovisioned",
      });
    },
  );

  it("preserves the repository's no-registration/idempotent skip result", async () => {
    const h = build();
    h.repo.enqueueEvent.mockResolvedValue(null);
    await expect(
      h.service.enqueueEvent(notification, h.transaction),
    ).resolves.toBeNull();
  });

  it("does not swallow a generic notification persistence error", async () => {
    const h = build();
    const failure = new Error("queue unavailable");
    h.repo.enqueueEvent.mockRejectedValue(failure);
    await expect(
      h.service.enqueueEvent(notification, h.transaction),
    ).rejects.toBe(failure);
    expect(h.transaction.release).not.toHaveBeenCalled();
  });

  it.each(["onSubscriptionActivated", "onSubscriptionDeactivated"] as const)(
    "%s does not swallow a lifecycle persistence error",
    async (method) => {
      const h = build();
      const failure = new Error("lifecycle queue unavailable");
      h.repo.enqueue.mockRejectedValue(failure);
      await expect(h.service[method](lifecycle, h.transaction)).rejects.toBe(
        failure,
      );
    },
  );
});
