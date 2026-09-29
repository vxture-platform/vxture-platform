/**
 * operator-signal-sweep.job.spec.ts —— 作业的编排：回看窗口、上限、两段互不连坐、
 * 失败要显红。文案与 SQL 谓词各有自己的 spec（business-event-signals /
 * audit-event-signals / operator-signal-sweep.itest）。
 *
 * 假 pool 不解析 SQL，所以这里只按「哪一段的 SQL」分发行，断言的是**编排**：
 *   · 首轮把回看压到 10 分钟、之后用配置值 —— 重启不重放历史，而这件事只在
 *     第二轮才看得出来（第一轮怎么都像对的）；
 *   · 一段 SQL 炸了，另外十段照跑 —— 否则一个局部问题会表现成「运营端什么都没有」；
 *   · 炸了之后必须抛：心跳记 failed，opera「任务调度」显红。静默继续正是这批要
 *     消灭的坏法（#231 的病根）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { BUSINESS_EVENT_PASSES } from "../notifications/business-event-signals";
import { AUDIT_SWEEP_SQL } from "../notifications/audit-event-signals";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import {
  FIRST_TICK_LOOKBACK_MINUTES,
  JOB_NAME,
  OperatorSignalSweepJob,
  lookbackMinutes,
  runAuditEventSweep,
  runBusinessEventSweep,
  signalSweepIntervalMs,
  sweepLimit,
  type SystemNoticeWriter,
} from "./operator-signal-sweep.job";

const ENV_KEYS = [
  "OPERATOR_SIGNAL_SWEEP_INTERVAL_MS",
  "OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES",
  "OPERATOR_SIGNAL_SWEEP_LIMIT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * 假 pool。`rowsFor` 按 SQL 片段决定回几行；`throwOn` 里的片段直接抛。
 * 写通告那条 insert 也从这里过（作业内部用真的 PgNoticeRepository），
 * 回一行 = inserted，回零行 = 去重命中。
 */
function fakePool(opts: {
  rowsFor?: (sql: string) => unknown[];
  throwOn?: string;
  noticeInserts?: boolean;
}): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  const query = async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    if (opts.throwOn && sql.includes(opts.throwOn)) {
      throw new Error("relation does not exist");
    }
    if (sql.includes("insert into admin.operator_notices")) {
      return {
        rows: opts.noticeInserts === false ? [] : [{ id: "notice-1" }],
      };
    }
    return { rows: opts.rowsFor ? opts.rowsFor(sql) : [] };
  };
  return { pool: { query } as unknown as Pool, calls };
}

const heartbeat = () =>
  ({
    recordStart: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  }) as unknown as JobHeartbeatService & {
    recordStart: ReturnType<typeof vi.fn>;
    recordSuccess: ReturnType<typeof vi.fn>;
    recordFailure: ReturnType<typeof vi.fn>;
  };

const writer = (inserted = true): SystemNoticeWriter & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    createSystemNotice: async (input) => {
      calls.push(input);
      return { inserted, id: inserted ? "notice-1" : null };
    },
  };
};

const OPTS = { lookbackMinutes: 30, limit: 200 };

describe("env 解析", () => {
  it("间隔默认 2 分钟，低于下限的配置被拉回默认", () => {
    expect(signalSweepIntervalMs()).toBe(120_000);
    process.env.OPERATOR_SIGNAL_SWEEP_INTERVAL_MS = "300000";
    expect(signalSweepIntervalMs()).toBe(300_000);
    // sweepIntervalMs 的下限 5s：写了 1ms 不该让它每毫秒锤一次库。
    process.env.OPERATOR_SIGNAL_SWEEP_INTERVAL_MS = "1";
    expect(signalSweepIntervalMs()).toBe(60_000);
  });

  it("回看与上限有默认值，非法值不生效", () => {
    expect(lookbackMinutes()).toBe(30);
    expect(sweepLimit()).toBe(200);
    process.env.OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES = "90";
    process.env.OPERATOR_SIGNAL_SWEEP_LIMIT = "50";
    expect(lookbackMinutes()).toBe(90);
    expect(sweepLimit()).toBe(50);
    process.env.OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES = "0";
    process.env.OPERATOR_SIGNAL_SWEEP_LIMIT = "abc";
    expect(lookbackMinutes()).toBe(30);
    expect(sweepLimit()).toBe(200);
  });
});

describe("业务事件段", () => {
  it("每段各跑一次，参数是 [回看, 上限, ...该类自己的]", async () => {
    const { pool, calls } = fakePool({});
    const notices = writer();
    const result = await runBusinessEventSweep(pool, notices, OPTS);
    expect(calls).toHaveLength(BUSINESS_EVENT_PASSES.length);
    /* 初版这里写的是「每段参数都是 [30, 200]」——那时候确实如此。
       客户回复那一类要把事件词**绑参**传进去（SQL 里手拄词不会被类型系统
       看见），所以不再统一。现在钉的是真正的不变式：**每段拿到的就是它声明的
       那几个**。多给一个会被 pg 扔回来（bind message supplies N parameters），
       少给一个则是谓词静静地换了规则——后者一个字也不报。 */
    BUSINESS_EVENT_PASSES.forEach((pass, i) => {
      expect(calls[i]!.params, pass.code).toEqual([
        30,
        200,
        ...(pass.extraParams ?? []),
      ]);
    });
    expect(result).toEqual({ scanned: 0, inserted: 0, failures: [] });
  });

  it("扫到的行逐条写通告；去重命中不算新增也不算失败", async () => {
    const { pool } = fakePool({
      rowsFor: (sql) =>
        sql.includes("from support.tickets")
          ? [{ dedupe_key: "TCK-1", code: "TCK-1", priority: "p1" }]
          : [],
    });
    const fresh = writer(true);
    expect(await runBusinessEventSweep(pool, fresh, OPTS)).toEqual({
      scanned: 1,
      inserted: 1,
      failures: [],
    });
    expect(fresh.calls).toHaveLength(1);

    const { pool: pool2 } = fakePool({
      rowsFor: (sql) =>
        sql.includes("from support.tickets")
          ? [{ dedupe_key: "TCK-1", code: "TCK-1", priority: "p1" }]
          : [],
    });
    const dup = writer(false);
    expect(await runBusinessEventSweep(pool2, dup, OPTS)).toEqual({
      scanned: 1,
      inserted: 0,
      failures: [],
    });
  });

  it("一段炸了，其余十段照跑（失败汇总带上事件码）", async () => {
    const { pool, calls } = fakePool({
      throwOn: "from billing.orders",
      rowsFor: (sql) =>
        sql.includes("from support.tickets")
          ? [{ dedupe_key: "TCK-1", code: "TCK-1" }]
          : [],
    });
    const result = await runBusinessEventSweep(pool, writer(), OPTS);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("order.created");
    // 十一段都发过查询，只有那一段抛了。
    const passQueries = calls.filter(
      (c) => !c.sql.includes("insert into admin.operator_notices"),
    );
    expect(passQueries).toHaveLength(BUSINESS_EVENT_PASSES.length);
    expect(result.inserted).toBe(1);
  });
});

describe("运营动作段", () => {
  it("一条 SQL，参数是 [回看, 白名单码数组, 上限]", async () => {
    const { pool, calls } = fakePool({});
    await runAuditEventSweep(pool, writer(), OPTS);
    expect(calls).toHaveLength(1);
    const [lookback, codes, limit] = calls[0]!.params;
    expect(lookback).toBe(30);
    expect(Array.isArray(codes)).toBe(true);
    expect(codes as string[]).toContain("tenant.suspend");
    expect(limit).toBe(200);
  });

  it("白名单外的码扫回来了也静默跳过，不写、不抛", async () => {
    const { pool } = fakePool({
      rowsFor: (sql) =>
        sql === AUDIT_SWEEP_SQL
          ? [
              {
                id: "a1",
                action: "atlas.model.create",
                actor_type: "operator",
                actor_console: "opera",
                occurred_text: "2026-09-28 20:00:00",
              },
              {
                id: "a2",
                action: "tenant.suspend",
                actor_type: "operator",
                actor_console: "admin",
                occurred_text: "2026-09-28 20:00:01",
                tenant_no: "2143889307",
                tenant_name: "示例科技",
              },
            ]
          : [],
    });
    const notices = writer();
    expect(await runAuditEventSweep(pool, notices, OPTS)).toEqual({
      scanned: 2,
      inserted: 1,
      failures: [],
    });
    expect(notices.calls).toHaveLength(1);
  });

  it("整段炸了只汇总一条失败，不影响调用方跑另一段", async () => {
    const { pool } = fakePool({ throwOn: "from support.audit_logs" });
    const result = await runAuditEventSweep(pool, writer(), OPTS);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("audit_logs");
  });
});

describe("作业编排", () => {
  it("首轮回看压到 10 分钟，第二轮起用配置值", async () => {
    process.env.OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES = "45";
    const { pool, calls } = fakePool({});
    const hb = heartbeat();
    const job = new OperatorSignalSweepJob(pool, hb);

    await job.tick();
    expect(calls[0]!.params[0]).toBe(FIRST_TICK_LOOKBACK_MINUTES);

    calls.length = 0;
    await job.tick();
    expect(calls[0]!.params[0]).toBe(45);
  });

  it("配置值本来就小于 10 分钟时，首轮不反而放大", async () => {
    process.env.OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES = "3";
    const { pool, calls } = fakePool({});
    const job = new OperatorSignalSweepJob(pool, heartbeat());
    await job.tick();
    expect(calls[0]!.params[0]).toBe(3);
  });

  it("一轮成功：心跳记 success，items = 新写入的条数", async () => {
    const { pool } = fakePool({
      rowsFor: (sql) =>
        sql.includes("from support.tickets")
          ? [{ dedupe_key: "TCK-1", code: "TCK-1" }]
          : [],
    });
    const hb = heartbeat();
    await new OperatorSignalSweepJob(pool, hb).tick();
    expect(hb.recordStart).toHaveBeenCalledWith(JOB_NAME, 120_000);
    expect(hb.recordSuccess).toHaveBeenCalledTimes(1);
    expect(hb.recordSuccess.mock.calls[0]?.[2]).toBe(1);
    expect(hb.recordFailure).not.toHaveBeenCalled();
  });

  it("有段失败：两段都跑完了才抛，心跳记 failed，tick 自己不往外抛", async () => {
    const { pool, calls } = fakePool({ throwOn: "from support.audit_logs" });
    const hb = heartbeat();
    await expect(
      new OperatorSignalSweepJob(pool, hb).tick(),
    ).resolves.toBeUndefined();
    expect(hb.recordFailure).toHaveBeenCalledTimes(1);
    expect(String(hb.recordFailure.mock.calls[0]?.[2])).toContain("巡检失败");
    expect(hb.recordSuccess).not.toHaveBeenCalled();
    // 业务事件那十一段在审计段炸掉之前已经跑完了（它们都 alias 出 dedupe_key）。
    const businessQueries = calls.filter((c) =>
      c.sql.includes("as dedupe_key"),
    );
    expect(businessQueries).toHaveLength(BUSINESS_EVENT_PASSES.length);
  });
});
