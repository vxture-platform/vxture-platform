/**
 * Retry job lifecycle, fault isolation and overlap prevention.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { afterEach, expect, it, vi } from "vitest";
import { LogoutRetryJob } from "./logout-retry.job";
import type { OidcService } from "./oidc.service";

afterEach(() => vi.useRealTimers());

it("starts recovery immediately and stops polling on shutdown", async () => {
  vi.useFakeTimers();
  const retryPendingLogouts = vi.fn(async () => {});
  const job = new LogoutRetryJob({
    retryPendingLogouts,
  } as unknown as OidcService);
  job.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(1000);
  expect(retryPendingLogouts).toHaveBeenCalledTimes(2);
  job.onModuleDestroy();
  await vi.advanceTimersByTimeAsync(2000);
  expect(retryPendingLogouts).toHaveBeenCalledTimes(2);
});

it("skips overlapping passes and recovers from a failed scan", async () => {
  let finish: (() => void) | undefined;
  const retryPendingLogouts = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const job = new LogoutRetryJob({
    retryPendingLogouts,
  } as unknown as OidcService);
  const pass = job.pass();
  await job.pass();
  expect(retryPendingLogouts).toHaveBeenCalledTimes(1);
  finish!();
  await pass;
  retryPendingLogouts.mockRejectedValueOnce(new Error("Redis unavailable"));
  await expect(job.pass()).resolves.toBeUndefined();
  expect(retryPendingLogouts).toHaveBeenCalledTimes(2);
});
