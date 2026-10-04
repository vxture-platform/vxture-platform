/**
 * legacy-auth-usage.service.spec.ts - batching, hourly log throttle and the
 * no-throw contract of the E6 legacy-credential counter.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 * 四件事错了都没有外在症状：批量没起作用 = Redis 写入量与产品面请求数成正比；
 * 日志没限速 = 每个旧凭据请求一行；写失败漏出去 = 热路径上的 unhandled rejection；
 * 上限只对一个 60s 批次成立 = 拿着口令的调用方每分钟 512 个新名字、一个月 2200 万个
 * field（2026-10-04 评审：第一版的判据是 pending Map 的 size，而 flush 每分钟清一次它）。
 * 所以上限的用例必须**跨两个 flush 窗口**，单窗口的用例对这条性质是盲的。
 * 全部用假时钟（vi.useFakeTimers 同时替换 setInterval 与 Date.now）。
 *
 * @author AI-Generated
 * @date 2026-10-04
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_AUTH_FLUSH_MS,
  LEGACY_AUTH_LOG_INTERVAL_MS,
  LEGACY_AUTH_MAX_FIELDS,
  LEGACY_AUTH_OVERFLOW_PRODUCT,
  LEGACY_AUTH_TTL_SEC,
  LegacyAuthUsageRecorder,
  legacyAuthField,
  legacyAuthKey,
  legacyAuthMonth,
} from "./legacy-auth-usage.service";

/** 2026-10-04T12:00:00Z */
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const KEY_OCT = "vx:integration:legacy-auth:2026-10";

function makeRecorder(
  opts: {
    hincrby?: (key: string, field: string, n: number) => Promise<unknown>;
    expire?: (key: string, ttl: number) => Promise<unknown>;
    start?: boolean;
  } = {},
) {
  const hincrby = vi.fn(opts.hincrby ?? (async () => 1));
  const expire = vi.fn(opts.expire ?? (async () => 1));
  const log = { warn: vi.fn(), log: vi.fn() };
  const recorder = new LegacyAuthUsageRecorder({
    client: { hincrby, expire },
    keyPrefix: "vx:",
    log,
  });
  if (opts.start !== false) recorder.start();
  return { recorder, hincrby, expire, log };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("key / field / month helpers (opera-bff builds the same strings)", () => {
  it("month is the UTC calendar month", () => {
    expect(legacyAuthMonth(T0)).toBe("2026-10");
    expect(legacyAuthMonth(Date.UTC(2026, 9, 31, 23, 59, 59))).toBe("2026-10");
    expect(legacyAuthMonth(Date.UTC(2026, 10, 1, 0, 0, 0))).toBe("2026-11");
  });

  it("key = prefix + infix + month; field = route|product", () => {
    expect(legacyAuthKey("vx:", "2026-10")).toBe(KEY_OCT);
    expect(legacyAuthField("usage.consume", "arda")).toBe("usage.consume|arda");
  });
});

describe("LegacyAuthUsageRecorder — batching", () => {
  it("writes nothing before the 60s tick, then one HINCRBY per (route, product) with the summed count and one EXPIRE of 90d", async () => {
    const { recorder, hincrby, expire } = makeRecorder();
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "usage.consume", productCode: "karda" });

    await tick(LEGACY_AUTH_FLUSH_MS - 1);
    expect(hincrby).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();

    await tick(1);
    expect(hincrby.mock.calls).toEqual([
      [KEY_OCT, "entitlements|arda", 3],
      [KEY_OCT, "usage.consume|karda", 1],
    ]);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith(KEY_OCT, LEGACY_AUTH_TTL_SEC);
    expect(LEGACY_AUTH_TTL_SEC).toBe(90 * 24 * 60 * 60);

    // Flushed counts are gone: an idle minute writes nothing.
    await tick(LEGACY_AUTH_FLUSH_MS);
    expect(hincrby).toHaveBeenCalledTimes(2);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("requests on either side of a month boundary land in two keys", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 31, 23, 59, 30));
    const { recorder, hincrby, expire } = makeRecorder();
    recorder.record({ route: "sharing.visible-set", productCode: "arda" });
    await tick(40_000); // now 2026-11-01T00:00:10Z — no flush yet (first tick is at 60s)
    recorder.record({ route: "sharing.visible-set", productCode: "arda" });
    await tick(20_000);
    expect(hincrby.mock.calls).toEqual([
      ["vx:integration:legacy-auth:2026-10", "sharing.visible-set|arda", 1],
      ["vx:integration:legacy-auth:2026-11", "sharing.visible-set|arda", 1],
    ]);
    expect(expire.mock.calls.map((c) => c[0])).toEqual([
      "vx:integration:legacy-auth:2026-10",
      "vx:integration:legacy-auth:2026-11",
    ]);
  });

  it("the cap is per month, not per flush window: after 512 distinct names this month, a fresh code in a later window still lands in __other__ while a known one keeps its name", async () => {
    const { recorder, hincrby, log } = makeRecorder();
    for (let i = 0; i < LEGACY_AUTH_MAX_FIELDS; i += 1) {
      recorder.record({ route: "entitlements", productCode: `p${i}` });
    }
    await tick(LEGACY_AUTH_FLUSH_MS); // window 1 flushed; pending is empty now
    expect(hincrby).toHaveBeenCalledTimes(LEGACY_AUTH_MAX_FIELDS);
    expect(log.warn).not.toHaveBeenCalled();

    // Window 2: a flood of brand-new codes plus one known one plus one __other__ per route.
    for (let i = 0; i < LEGACY_AUTH_MAX_FIELDS; i += 1) {
      recorder.record({ route: "entitlements", productCode: `q${i}` });
    }
    recorder.record({ route: "usage.gauge", productCode: "also-too-many" });
    recorder.record({ route: "entitlements", productCode: "p0" });
    await tick(LEGACY_AUTH_FLUSH_MS);

    const window2 = hincrby.mock.calls.slice(LEGACY_AUTH_MAX_FIELDS);
    const fields = window2.map((c) => c[1] as string);
    expect(fields).toEqual(
      expect.arrayContaining([
        `entitlements|${LEGACY_AUTH_OVERFLOW_PRODUCT}`,
        `usage.gauge|${LEGACY_AUTH_OVERFLOW_PRODUCT}`,
        "entitlements|p0",
      ]),
    );
    expect(fields).toHaveLength(3); // not 512 new names
    expect(fields.some((f) => f.startsWith("entitlements|q"))).toBe(false);
    expect(hincrby).toHaveBeenCalledWith(
      KEY_OCT,
      `entitlements|${LEGACY_AUTH_OVERFLOW_PRODUCT}`,
      LEGACY_AUTH_MAX_FIELDS,
    );
    expect(hincrby).toHaveBeenCalledWith(KEY_OCT, "entitlements|p0", 1);

    // Distinct hash fields this month: 512 names + one __other__ per route touched.
    const distinct = new Set(hincrby.mock.calls.map((c) => c[1] as string));
    expect(distinct.size).toBe(LEGACY_AUTH_MAX_FIELDS + 2);

    // One warn for the month, not one per folded request.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("2026-10");
    expect(String(log.warn.mock.calls[0]![0])).toContain(
      LEGACY_AUTH_OVERFLOW_PRODUCT,
    );
  });

  it("a new month starts with a fresh name budget and may warn again", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 31, 23, 59, 0));
    const { recorder, hincrby, log } = makeRecorder();
    for (let i = 0; i <= LEGACY_AUTH_MAX_FIELDS; i += 1) {
      recorder.record({ route: "entitlements", productCode: `p${i}` });
    }
    await tick(LEGACY_AUTH_FLUSH_MS); // now 2026-11-01T00:00:00Z
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(hincrby.mock.calls.map((c) => c[1])).toContain(
      `entitlements|${LEGACY_AUTH_OVERFLOW_PRODUCT}`,
    );

    hincrby.mockClear();
    recorder.record({
      route: "entitlements",
      productCode: `p${LEGACY_AUTH_MAX_FIELDS}`,
    });
    await tick(LEGACY_AUTH_FLUSH_MS);
    expect(hincrby.mock.calls).toEqual([
      [
        "vx:integration:legacy-auth:2026-11",
        `entitlements|p${LEGACY_AUTH_MAX_FIELDS}`,
        1,
      ],
    ]);
    for (let i = 0; i <= LEGACY_AUTH_MAX_FIELDS; i += 1) {
      recorder.record({ route: "entitlements", productCode: `n${i}` });
    }
    await tick(LEGACY_AUTH_FLUSH_MS);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(String(log.warn.mock.calls[1]![0])).toContain("2026-11");
  });

  it("a self-reported code that is not a product code never becomes a field name or a log value: it is counted under __other__", async () => {
    const { recorder, hincrby, log } = makeRecorder();
    const bad = [
      "x\ny",
      "Karda",
      "a".repeat(33),
      "legacy internal-auth: route=entitlements product=karda n=0",
      " karda",
      "",
      "9lives",
    ];
    for (const code of bad) {
      recorder.record({ route: "provisioning.ack", productCode: code });
    }
    recorder.record({ route: "provisioning.ack", productCode: "karda" });
    await tick(LEGACY_AUTH_FLUSH_MS);
    expect(hincrby.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [`provisioning.ack|${LEGACY_AUTH_OVERFLOW_PRODUCT}`, bad.length],
      ["provisioning.ack|karda", 1],
    ]);
    for (const line of log.log.mock.calls.map((c) => String(c[0]))) {
      expect(line).not.toContain("\n");
      expect(line).toMatch(
        /^legacy internal-auth: route=[a-z.-]+ product=(__other__|[a-z][a-z0-9_-]{0,31}) n=\d+$/,
      );
    }
    // Shape rejection is not the overflow condition: no cap warn.
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("flush() resolves true after a written batch, false after a failed one, true when idle", async () => {
    let fail = false;
    const { recorder } = makeRecorder({
      hincrby: async () => {
        if (fail) throw new Error("down");
        return 1;
      },
      start: false,
    });
    await expect(recorder.flush()).resolves.toBe(true);
    recorder.record({ route: "entitlements", productCode: "arda" });
    await expect(recorder.flush()).resolves.toBe(true);
    fail = true;
    recorder.record({ route: "entitlements", productCode: "arda" });
    await expect(recorder.flush()).resolves.toBe(false);
    expect(recorder.pendingCount()).toBe(0);
  });

  it("pendingCount() is the number of (month, field) counters waiting", () => {
    const { recorder } = makeRecorder({ start: false });
    expect(recorder.pendingCount()).toBe(0);
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "usage.consume", productCode: "arda" });
    expect(recorder.pendingCount()).toBe(2);
  });

  it("stop() ends the periodic flush; an explicit flush() still works", async () => {
    const { recorder, hincrby } = makeRecorder();
    recorder.stop();
    recorder.record({ route: "provisioning.ack", productCode: "arda" });
    await tick(LEGACY_AUTH_FLUSH_MS * 3);
    expect(hincrby).not.toHaveBeenCalled();
    void recorder.flush();
    await tick(0);
    expect(hincrby).toHaveBeenCalledWith(KEY_OCT, "provisioning.ack|arda", 1);
  });
});

describe("LegacyAuthUsageRecorder — one log line per (route, product) per hour", () => {
  it("first flush logs with n; the next flushes within the hour stay quiet; after an hour it logs the accumulated n", async () => {
    const { recorder, log } = makeRecorder();
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "entitlements", productCode: "arda" });
    recorder.record({ route: "usage.consume", productCode: "arda" });
    await tick(LEGACY_AUTH_FLUSH_MS); // t = 1 min
    expect(log.log.mock.calls.map((c) => c[0])).toEqual([
      "legacy internal-auth: route=entitlements product=arda n=2",
      "legacy internal-auth: route=usage.consume product=arda n=1",
    ]);

    for (let i = 0; i < 5; i += 1) {
      recorder.record({ route: "entitlements", productCode: "arda" });
    }
    await tick(LEGACY_AUTH_FLUSH_MS); // t = 2 min, same hour → quiet
    expect(log.log).toHaveBeenCalledTimes(2);

    await tick(LEGACY_AUTH_LOG_INTERVAL_MS - 2 * LEGACY_AUTH_FLUSH_MS); // t = 60 min
    recorder.record({ route: "entitlements", productCode: "arda" });
    await tick(LEGACY_AUTH_FLUSH_MS); // t = 61 min → an hour since the first line
    expect(log.log).toHaveBeenCalledTimes(3);
    expect(log.log.mock.calls[2]![0]).toBe(
      "legacy internal-auth: route=entitlements product=arda n=6",
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("LegacyAuthUsageRecorder — the log table stays bounded under a flood", () => {
  it("an hour of 512 fresh codes per minute logs the legitimate field once, plus one __other__ line per hour, plus one cap warn", async () => {
    const { recorder, log } = makeRecorder();
    let codeNo = 0;
    const minutes = LEGACY_AUTH_LOG_INTERVAL_MS / LEGACY_AUTH_FLUSH_MS; // 60
    for (let m = 0; m < minutes; m += 1) {
      // The legitimate product is already named this month before the flood
      // starts; a product whose first call of the month comes after the cap is
      // folded (that is the documented blind spot, not a bug of this test).
      recorder.record({ route: "usage.consume", productCode: "arda" });
      for (let i = 0; i < LEGACY_AUTH_MAX_FIELDS; i += 1) {
        codeNo += 1;
        recorder.record({ route: "entitlements", productCode: `f${codeNo}` });
      }
      await tick(LEGACY_AUTH_FLUSH_MS);
    }
    const lines = log.log.mock.calls.map((c) => String(c[0]));
    const arda = lines.filter((l) => l.includes("product=arda"));
    const other = lines.filter((l) =>
      l.includes(`product=${LEGACY_AUTH_OVERFLOW_PRODUCT}`),
    );
    const named = lines.filter(
      (l) => l.includes("product=f") && !l.includes("__other__"),
    );
    expect(arda).toHaveLength(1); // minute 1; minute 61 would be the next
    expect(other).toHaveLength(1); // minute 1 too: arda took one slot, f512 was folded
    expect(named).toHaveLength(LEGACY_AUTH_MAX_FIELDS - 1); // the 511 names that got in
    expect(lines).toHaveLength(LEGACY_AUTH_MAX_FIELDS + 1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("LegacyAuthUsageRecorder — never throws, warns once per failure streak", () => {
  it("a rejecting client drops the batch, warns once, stays quiet until a write succeeds, then warns again on a new streak", async () => {
    let fail = true;
    const { recorder, hincrby, log } = makeRecorder({
      hincrby: async () => {
        if (fail) throw new Error("ECONNREFUSED");
        return 1;
      },
    });
    const round = async () => {
      recorder.record({ route: "entitlements", productCode: "arda" });
      await tick(LEGACY_AUTH_FLUSH_MS);
    };

    await round();
    await round();
    await round();
    expect(hincrby).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("ECONNREFUSED");

    fail = false;
    await round();
    expect(
      log.log.mock.calls.some((c) =>
        String(c[0]).includes("counter writes recovered"),
      ),
    ).toBe(true);

    fail = true;
    await round();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("a client that throws synchronously is contained the same way", async () => {
    const { recorder, log } = makeRecorder({
      hincrby: () => {
        throw new Error("client closed");
      },
    });
    recorder.record({ route: "usage.gauge", productCode: "arda" });
    expect(() => void recorder.flush()).not.toThrow();
    await tick(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("client closed");
  });

  it("an EXPIRE failure alone is also a failure of the batch (logged once), HINCRBY having gone through", async () => {
    const { recorder, hincrby, log } = makeRecorder({
      expire: async () => {
        throw new Error("NOPERM expire");
      },
    });
    recorder.record({ route: "entitlements", productCode: "arda" });
    await tick(LEGACY_AUTH_FLUSH_MS);
    expect(hincrby).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("NOPERM expire");
  });
});
