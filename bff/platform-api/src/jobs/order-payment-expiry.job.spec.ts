/**
 * order-payment-expiry.job.spec.ts - Payment sweep and durable refund recovery driver.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { afterEach, describe, expect, it, vi } from "vitest";
// ⚠️ 跨层引用: only public domain service types are used for job doubles.
import type { AddonService, OrderService } from "@vxture/service-subscription";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import { JOB_NAME, OrderPaymentExpiryJob } from "./order-payment-expiry.job";

function build() {
  const orders = {
    sweepExpired: vi.fn().mockResolvedValue(2),
    reconcileHungPaid: vi.fn().mockResolvedValue(3),
    reconcileRefundSettlements: vi.fn().mockResolvedValue(7),
    initiateRefundTransfer: vi.fn(),
    executeRefund: vi.fn(),
  };
  const addons = { sweepExpiredOrders: vi.fn().mockResolvedValue(5) };
  const heartbeat = {
    recordStart: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const job = new OrderPaymentExpiryJob(
    orders as unknown as OrderService,
    addons as unknown as AddonService,
    heartbeat as unknown as JobHeartbeatService,
  );
  return { orders, addons, heartbeat, job };
}

// ============================================================================
// Previous sweep behavior remains mandatory; recovery never executes money.
// ============================================================================
describe("OrderPaymentExpiryJob.tick", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("preserves every sweep, runs recovery last and totals heartbeat counts", async () => {
    vi.stubEnv("ORDER_PAYMENT_TTL_MINUTES", "45.9");
    const { job, orders, addons, heartbeat } = build();
    await job.tick();
    expect(orders.sweepExpired).toHaveBeenCalledWith(45);
    expect(orders.reconcileHungPaid).toHaveBeenCalledTimes(1);
    expect(addons.sweepExpiredOrders).toHaveBeenCalledWith(45);
    expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(1);
    expect(
      orders.reconcileRefundSettlements.mock.invocationCallOrder[0],
    ).toBeGreaterThan(addons.sweepExpiredOrders.mock.invocationCallOrder[0]!);
    expect(heartbeat.recordStart).toHaveBeenCalledWith(JOB_NAME, 60000);
    expect(heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      17,
    );
    expect(heartbeat.recordFailure).not.toHaveBeenCalled();
    expect(orders.initiateRefundTransfer).not.toHaveBeenCalled();
    expect(orders.executeRefund).not.toHaveBeenCalled();
  });

  it.each(["", "bad", "0", "-1", "Infinity"])(
    "uses the fallback TTL for %s",
    async (ttl) => {
      vi.stubEnv("ORDER_PAYMENT_TTL_MINUTES", ttl);
      const { job, orders, addons } = build();
      await job.tick();
      expect(orders.sweepExpired).toHaveBeenCalledWith(30);
      expect(addons.sweepExpiredOrders).toHaveBeenCalledWith(30);
    },
  );

  it("reports zero work without inventing recovery items", async () => {
    const { job, orders, addons, heartbeat } = build();
    orders.sweepExpired.mockResolvedValue(0);
    orders.reconcileHungPaid.mockResolvedValue(0);
    orders.reconcileRefundSettlements.mockResolvedValue(0);
    addons.sweepExpiredOrders.mockResolvedValue(0);
    await job.tick();
    expect(heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      0,
    );
  });

  it("keeps a failed intention retryable on the next tick", async () => {
    const { job, orders, heartbeat } = build();
    orders.reconcileRefundSettlements.mockRejectedValueOnce(
      new Error("controlled recovery failure"),
    );
    await expect(job.tick()).resolves.toBeUndefined();
    expect(heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("controlled recovery failure"),
    );
    expect(heartbeat.recordSuccess).not.toHaveBeenCalled();
    await job.tick();
    expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(2);
    expect(heartbeat.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not reenter while recovery is awaiting storage", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const { job, orders, heartbeat } = build();
    orders.reconcileRefundSettlements.mockImplementationOnce(async () => {
      await gate;
      return 1;
    });
    const first = job.tick();
    await vi.waitFor(() =>
      expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(1),
    );
    await job.tick();
    expect(heartbeat.recordStart).toHaveBeenCalledTimes(1);
    release();
    await first;
    await job.tick();
    expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(2);
  });

  it("clears the guard even if heartbeat start unexpectedly rejects", async () => {
    const { job, orders, heartbeat } = build();
    heartbeat.recordStart.mockRejectedValueOnce(
      new Error("controlled heartbeat failure"),
    );
    await expect(job.tick()).resolves.toBeUndefined();
    expect(orders.sweepExpired).not.toHaveBeenCalled();
    await job.tick();
    expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(1);
  });

  it("preserves retry after the original expiry pass fails", async () => {
    const { job, orders, heartbeat } = build();
    orders.sweepExpired.mockRejectedValueOnce(
      new Error("controlled expiry failure"),
    );
    await job.tick();
    expect(orders.reconcileRefundSettlements).not.toHaveBeenCalled();
    expect(heartbeat.recordFailure).toHaveBeenCalledTimes(1);
    await job.tick();
    expect(orders.reconcileHungPaid).toHaveBeenCalledTimes(1);
    expect(orders.reconcileRefundSettlements).toHaveBeenCalledTimes(1);
  });
});
