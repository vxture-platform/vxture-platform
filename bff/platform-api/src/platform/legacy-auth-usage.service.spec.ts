/**
 * legacy-auth-usage.service.spec.ts - batching, hourly log throttle and the
 * no-throw contract of the E6 legacy-credential counter.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 * 三件事错了都没有外在症状：批量没起作用 = Redis 写入量与产品面请求数成正比；
 * 日志没限速 = 每个旧凭据请求一行；写失败漏出去 = 热路径上的 unhandled rejection。
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

  it("beyond LEGACY_AUTH_MAX_FIELDS distinct fields in a month, the product part becomes __other__ (bounded Map and hash)", async () => {
    const { recorder, hincrby } = makeRecorder();
    for (let i = 0; i < LEGACY_AUTH_MAX_FIELDS; i += 1) {
      recorder.record({ route: "entitlements", productCode: `p${i}` });
    }
    recorder.record({ route: "entitlements", productCode: "one-too-many" });
    recorder.record({ route: "usage.gauge", productCode: "also-too-many" });
    // A field that already exists keeps counting under its own name.
    recorder.record({ route: "entitlements", productCode: "p0" });
    await tick(LEGACY_AUTH_FLUSH_MS);
    const fields = hincrby.mock.calls.map((c) => c[1] as string);
    expect(fields).not.toContain("entitlements|one-too-many");
    expect(fields).not.toContain("usage.gauge|also-too-many");
    expect(fields).toContain(`entitlements|${LEGACY_AUTH_OVERFLOW_PRODUCT}`);
    expect(fields).toContain(`usage.gauge|${LEGACY_AUTH_OVERFLOW_PRODUCT}`);
    expect(hincrby).toHaveBeenCalledWith(KEY_OCT, "entitlements|p0", 2);
  });

  it("stop() ends the periodic flush; an explicit flush() still works", async () => {
    const { recorder, hincrby } = makeRecorder();
    recorder.stop();
    recorder.record({ route: "provisioning.ack", productCode: "arda" });
    await tick(LEGACY_AUTH_FLUSH_MS * 3);
    expect(hincrby).not.toHaveBeenCalled();
    recorder.flush();
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
    expect(() => recorder.flush()).not.toThrow();
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
