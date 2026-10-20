/**
 * Watcher feed-drain, liveness and heartbeat behavior.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-20
 */
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ModelHealthWatchJob, JOB_NAME } from "./model-health-watch.job";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import type { AtlasHealthClient } from "../notifications/atlas-health.client";
import type { HealthWatchRepository } from "../notifications/health-watch.repository";
import type { HealthEvent } from "../notifications/health-watch.types";

// ============================================================================
// Fixtures
// ============================================================================
const checkpoint = { cursor: "stored", initialized: true, failures: 0 };
const event: HealthEvent = {
  id: "e",
  createdAt: "2026-10-20T00:00:00Z",
  subjectKind: "route",
  subjectKey: "chat/a",
  providerCode: null,
  from: "ok",
  to: "down",
  severity: "critical",
  upstreamStatus: null,
  detail: null,
  affectedRoutes: [],
};
function setup() {
  const client = {} as PoolClient;
  const store = {
    exclusive: vi.fn(
      async (
        work: (db: PoolClient, state: typeof checkpoint) => Promise<number>,
      ) => work(client, { ...checkpoint }),
    ),
    liveness: vi.fn(async () => 0),
    apply: vi.fn(async () => 1),
  };
  const heartbeat = {
    recordStart: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const atlas = {
    isAlive: vi.fn(async () => true),
    getEvents: vi.fn(async (_after: string | null) => ({
      items: [] as HealthEvent[],
      nextCursor: "stored",
    })),
    getHealth: vi.fn(async () => ({
      generatedAt: "2026-10-20T00:00:00Z",
      models: [],
      routes: [],
      vendors: [],
      atlas: [],
    })),
  };
  const job = new ModelHealthWatchJob(
    store as unknown as HealthWatchRepository,
    heartbeat as unknown as JobHeartbeatService,
    atlas as unknown as AtlasHealthClient,
  );
  return { client, store, heartbeat, atlas, job };
}

// ============================================================================
// Failure and restart boundaries
// ============================================================================
describe("durable model health watcher", () => {
  it("drains full pages before committing the final cursor", async () => {
    const m = setup();
    const full = Array.from({ length: 200 }, (_, i) => ({
      ...event,
      id: `e${i}`,
    }));
    m.atlas.getEvents
      .mockResolvedValueOnce({ items: full, nextCursor: "next" })
      .mockResolvedValueOnce({ items: [event], nextCursor: "final" });
    await m.job.tick();
    expect(m.atlas.getEvents.mock.calls).toEqual([["stored"], ["next"]]);
    expect(m.store.apply).toHaveBeenCalledWith(
      m.client,
      checkpoint,
      [...full, event],
      "final",
      [],
    );
    expect(m.heartbeat.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      1,
    );
  });
  it("leaves cursor unchanged if a later page fails", async () => {
    const m = setup();
    m.atlas.getEvents
      .mockResolvedValueOnce({
        items: Array(200).fill(event),
        nextCursor: "next",
      })
      .mockRejectedValueOnce(new Error("feed failed"));
    await m.job.tick();
    expect(m.store.apply).not.toHaveBeenCalled();
    expect(m.store.liveness).toHaveBeenCalledOnce();
    expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("feed failed"),
    );
    await m.job.tick();
    expect(m.atlas.getEvents.mock.calls[2]).toEqual(["stored"]);
  });
  it("records liveness independently and does not misclassify token failure as process death", async () => {
    const m = setup();
    m.atlas.getEvents.mockRejectedValueOnce(new Error("credential failure"));
    await m.job.tick();
    expect(m.store.liveness).toHaveBeenCalledWith(m.client, true, checkpoint);
    expect(m.heartbeat.recordFailure).toHaveBeenCalledOnce();
  });
  it("persists failed probes without calling authenticated endpoints", async () => {
    const m = setup();
    m.atlas.isAlive.mockResolvedValue(false);
    await m.job.tick();
    expect(m.store.liveness).toHaveBeenCalledWith(m.client, false, checkpoint);
    expect(m.atlas.getEvents).not.toHaveBeenCalled();
    expect(m.heartbeat.recordSuccess).not.toHaveBeenCalled();
  });
  it("refuses a cyclic feed without advancing the checkpoint", async () => {
    const m = setup();
    m.atlas.getEvents.mockResolvedValue({
      items: Array(200).fill(event),
      nextCursor: "cycle",
    });
    await m.job.tick();
    expect(m.store.apply).not.toHaveBeenCalled();
    expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("repeated a cursor"),
    );
  });
  it("serializes overlapping ticks", async () => {
    const m = setup();
    let release!: (alive: boolean) => void;
    m.atlas.isAlive.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = m.job.tick();
    await vi.waitFor(() => expect(m.atlas.isAlive).toHaveBeenCalledOnce());
    await m.job.tick();
    expect(m.store.exclusive).toHaveBeenCalledOnce();
    release(true);
    await first;
    await m.job.tick();
    expect(m.store.exclusive).toHaveBeenCalledTimes(2);
  });
  it("bounds feed draining so the next independent liveness check is not starved", async () => {
    const m = setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    m.atlas.getEvents.mockImplementationOnce(async () => {
      now.mockReturnValue(61_000);
      return { items: Array(200).fill(event), nextCursor: "next" };
    });
    try {
      await m.job.tick();
      expect(m.atlas.getEvents).toHaveBeenCalledOnce();
      expect(m.store.apply).not.toHaveBeenCalled();
      expect(m.heartbeat.recordFailure).toHaveBeenCalledWith(
        JOB_NAME,
        expect.any(Number),
        expect.stringContaining("page budget"),
      );
    } finally {
      now.mockRestore();
    }
  });
});
