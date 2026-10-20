/**
 * model-health-watch.job.spec.ts - Watchdog heartbeat and persistence regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-19
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ModelHealthWatchJob, JOB_NAME } from "./model-health-watch.job";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import type { AtlasHealthClient } from "../notifications/atlas-health.client";
import type { ServiceHealthView } from "../notifications/model-health-notice";

// ============================================================================
// Fixtures
// ============================================================================

const okView: ServiceHealthView = {
  generatedAt: "2026-10-19T00:00:00.000Z",
  models: [],
  routes: [],
  vendors: [],
  atlas: [],
};
const badView: ServiceHealthView = {
  ...okView,
  models: [
    { modelCode: "m", providerCode: "p", state: "unavailable" },
    { modelCode: "n", providerCode: "p", state: "rate_limited" },
  ],
};
function setup(view = okView) {
  const query = vi.fn().mockResolvedValue({ rows: [{ id: "n1" }] });
  const heartbeat = {
    recordStart: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const atlas = { getHealth: vi.fn().mockResolvedValue(view) };
  const job = new ModelHealthWatchJob(
    { query } as unknown as Pool,
    heartbeat as unknown as JobHeartbeatService,
    atlas as unknown as AtlasHealthClient,
  );
  return { job, query, heartbeat, atlas };
}

// ============================================================================
// Observable tick behavior
// ============================================================================

describe("ModelHealthWatchJob", () => {
  it("records zero for a healthy snapshot without writing notices", async () => {
    const m = setup();
    await m.job.tick();
    expect(m.heartbeat.recordStart).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
    );
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      0,
    );
    expect(m.query).not.toHaveBeenCalled();
    expect(m.heartbeat.recordFailure).not.toHaveBeenCalled();
  });

  it("counts only newly inserted notices, excluding duplicate signals", async () => {
    const m = setup(badView);
    m.query.mockResolvedValueOnce({ rows: [] });
    await m.job.tick();
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.query).toHaveBeenCalledWith(
      expect.stringMatching(/insert into admin.operator_notices/i),
      expect.arrayContaining([["admin"]]),
    );
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      1,
    );
  });

  it("marks a read or missing-credentials failure instead of a successful zero", async () => {
    const m = setup();
    m.atlas.getHealth.mockRejectedValueOnce(
      new Error("credentials are not configured"),
    );
    await m.job.tick();
    expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("credentials are not configured"),
    );
    expect(m.heartbeat.recordSuccess).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    await m.job.tick();
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not accept an absent snapshot as health", async () => {
    const m = setup();
    m.atlas.getHealth.mockResolvedValueOnce(null);
    await m.job.tick();
    expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("snapshot is unavailable"),
    );
    expect(m.heartbeat.recordSuccess).not.toHaveBeenCalled();
  });

  it("attempts remaining notices and fails the heartbeat when one write fails", async () => {
    const m = setup(badView);
    m.query.mockRejectedValueOnce(new Error("private database error"));
    await m.job.tick();
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      "Error: Model health notice writes failed: 1; inserted: 1",
    );
    expect(m.heartbeat.recordSuccess).not.toHaveBeenCalled();
    await m.job.tick();
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      2,
    );
  });

  it("skips overlapping ticks and resumes after the in-flight read", async () => {
    const m = setup();
    let release!: (v: ServiceHealthView) => void;
    m.atlas.getHealth.mockReturnValueOnce(
      new Promise<ServiceHealthView>((resolve) => {
        release = resolve;
      }),
    );
    const first = m.job.tick();
    await Promise.resolve();
    await m.job.tick();
    expect(m.atlas.getHealth).toHaveBeenCalledTimes(1);
    release(okView);
    await first;
    await m.job.tick();
    expect(m.atlas.getHealth).toHaveBeenCalledTimes(2);
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledTimes(2);
  });
});
