/**
 * model-health-watch.job.spec.ts — #562 作业编排：
 *   · 未配 secret（client 返回 null）→ 0 条、不抛；
 *   · 有坏信号 → 逐条写通告（走内部 PgNoticeRepository → 假 pool 的 insert）；
 *   · 读健康抛了 → pass() 抛（心跳记 failed，不静默）。
 * 通告文案/去重键在 model-health-notice.spec 里测，这里只测编排。
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { ModelHealthWatchJob } from "./model-health-watch.job";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import { AtlasHealthClient } from "../notifications/atlas-health.client";
import type { ServiceHealthView } from "../notifications/model-health-notice";

afterEach(() => {
  delete process.env.MODEL_HEALTH_WATCH_INTERVAL_MS;
});

interface Call {
  sql: string;
  params: readonly unknown[];
}

/** 假 pool：记录调用；insert 回一行（=inserted）。 */
function fakePool(): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  const query = async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: "n1" }], rowCount: 1 };
  };
  return { pool: { query } as unknown as Pool, calls };
}

function fakeClient(
  impl: () => Promise<ServiceHealthView | null>,
): AtlasHealthClient {
  return { getHealth: impl } as unknown as AtlasHealthClient;
}

const heartbeat = {} as JobHeartbeatService;

const okView: ServiceHealthView = {
  generatedAt: "2026-10-09T00:00:00.000Z",
  models: [],
  routes: [],
  vendors: [],
  atlas: [],
};

function newJob(client: AtlasHealthClient, pool: Pool): ModelHealthWatchJob {
  return new ModelHealthWatchJob(pool, heartbeat, client);
}

describe("ModelHealthWatchJob.pass", () => {
  it("writes one notice per qualifying signal (route down)", async () => {
    const { pool, calls } = fakePool();
    const view: ServiceHealthView = {
      ...okView,
      routes: [
        {
          code: "chat/pro",
          state: "down",
          severity: "critical",
          primary: { modelCode: "p", state: "unavailable" },
          fallback: null,
          configIssues: [],
        },
      ],
    };
    const job = newJob(
      fakeClient(async () => view),
      pool,
    );
    const inserted = await (
      job as unknown as { pass(): Promise<number> }
    ).pass();
    expect(inserted).toBe(1);
    const inserts = calls.filter((c) =>
      /insert into admin\.operator_notices/i.test(c.sql),
    );
    expect(inserts).toHaveLength(1);
  });

  it("returns 0 and writes nothing when unconfigured (client returns null)", async () => {
    const { pool, calls } = fakePool();
    const job = newJob(
      fakeClient(async () => null),
      pool,
    );
    const inserted = await (
      job as unknown as { pass(): Promise<number> }
    ).pass();
    expect(inserted).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("throws when the health read fails (so the heartbeat records failed)", async () => {
    const { pool } = fakePool();
    const job = newJob(
      fakeClient(async () => {
        throw new Error("Atlas /s2s/health returned status 503");
      }),
      pool,
    );
    await expect(
      (job as unknown as { pass(): Promise<number> }).pass(),
    ).rejects.toThrow(/503/);
  });
});
