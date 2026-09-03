/**
 * sweep-interval.util.ts — shared minute-cadence sweep interval clamp, used
 * by every minute-scale admin-bff sweep job (trial-expiry, sharing-expiry).
 * Floor 5s (guards against a misconfigured near-zero interval hammering the
 * DB), default 60s.
 *
 * `provisioning-dispatch.job.ts`'s `dispatchIntervalMs` is a genuinely
 * DIFFERENT clamp (1s floor / 10s default — a faster-cadence job) and stays
 * separate; only the two byte-identical 60s/5s sweeps share this one.
 */
import type { Logger } from "@nestjs/common";
import type { JobHeartbeatService } from "./job-heartbeat.service";

export function sweepIntervalMs(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5000 ? n : 60_000;
}

/** Non-negative integer day count from env, with a default. */
export function envDays(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/**
 * One heartbeat-wrapped tick: recordStart → run → recordSuccess(items) or
 * recordFailure(error). A failing pass never kills the interval — the error
 * is logged and the next tick retries. Shared by the sweep jobs so the
 * skeleton lives once (product_330 P2-c pulled it out of the per-job copies).
 */
export async function runHeartbeatTick(
  ctx: {
    heartbeat: JobHeartbeatService;
    jobName: string;
    intervalMs: number;
    logger: Logger;
    /** Log line prefix for the failure message. */
    label: string;
  },
  pass: () => Promise<number>,
): Promise<void> {
  const startedAt = Date.now();
  await ctx.heartbeat.recordStart(ctx.jobName, ctx.intervalMs);
  try {
    const items = await pass();
    await ctx.heartbeat.recordSuccess(
      ctx.jobName,
      Date.now() - startedAt,
      items,
    );
  } catch (err) {
    ctx.logger.error(`${ctx.label} failed: ${String(err)}`);
    await ctx.heartbeat.recordFailure(
      ctx.jobName,
      Date.now() - startedAt,
      String(err),
    );
  }
}
