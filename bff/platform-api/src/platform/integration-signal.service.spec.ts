/**
 * integration-signal.service.spec.ts - throttle + no-throw contract of the
 * C2 last-seen recorder.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 * Both properties fail silently in production if they regress: a missing
 * throttle shows up as Redis write volume proportional to entitlement reads,
 * and a leaked rejection shows up as an unhandled rejection on a hot read
 * path. Neither is caught by tsc or by the router's own behaviour.
 *
 * @author AI-Generated
 * @date 2026-08-31
 */
import { describe, expect, it, vi } from "vitest";
import {
  C2_SIGNAL_THROTTLE_MS,
  C2_SIGNAL_TTL_SEC,
  EntitlementSeenRecorder,
  c2SignalKey,
  type EntitlementSeenSignal,
} from "./integration-signal.service";

function makeRecorder(opts: {
  set?: (
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
  ) => Promise<unknown>;
  now?: () => number;
}) {
  const set = vi.fn(opts.set ?? (async () => "OK"));
  const log = { warn: vi.fn(), log: vi.fn() };
  const recorder = new EntitlementSeenRecorder({
    client: { set },
    keyPrefix: "vx:",
    log,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { recorder, set, log };
}

/** Let the fire-and-forget promise settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("c2SignalKey", () => {
  it("prefix + fixed infix + product code (opera-bff builds the same string)", () => {
    expect(c2SignalKey("vx:", "arda")).toBe("vx:integration:c2:arda");
  });
});

describe("EntitlementSeenRecorder — write shape", () => {
  it("writes JSON {lastSeenAt, via, workspaceId} with the 30-day TTL", async () => {
    const t0 = Date.UTC(2026, 7, 31, 12, 0, 0);
    const { recorder, set } = makeRecorder({ now: () => t0 });

    recorder.record({ productCode: "arda", via: "s2s", workspaceId: "ws-1" });
    await settle();

    expect(set).toHaveBeenCalledTimes(1);
    const [key, raw, mode, ttl] = set.mock.calls[0]!;
    expect(key).toBe("vx:integration:c2:arda");
    expect(mode).toBe("EX");
    expect(ttl).toBe(C2_SIGNAL_TTL_SEC);
    expect(JSON.parse(raw) as EntitlementSeenSignal).toEqual({
      lastSeenAt: "2026-08-31T12:00:00.000Z",
      via: "s2s",
      workspaceId: "ws-1",
    });
  });
});

describe("EntitlementSeenRecorder — throttle", () => {
  it("at most one write per product per minute; the window reopens after it", () => {
    let now = 1_000_000;
    const { recorder, set } = makeRecorder({ now: () => now });
    const input = {
      productCode: "arda",
      via: "s2s" as const,
      workspaceId: "ws-1",
    };

    recorder.record(input);
    now += 10_000;
    recorder.record(input);
    now += C2_SIGNAL_THROTTLE_MS - 10_001; // 1ms short of the window
    recorder.record(input);
    expect(set).toHaveBeenCalledTimes(1);

    now += 1;
    recorder.record(input);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("products are throttled independently", () => {
    const { recorder, set } = makeRecorder({ now: () => 5 });
    recorder.record({ productCode: "arda", via: "s2s", workspaceId: "ws-1" });
    recorder.record({
      productCode: "karda",
      via: "internal-auth",
      workspaceId: "ws-1",
    });
    recorder.record({ productCode: "arda", via: "s2s", workspaceId: "ws-2" });
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.map((c) => c[0])).toEqual([
      "vx:integration:c2:arda",
      "vx:integration:c2:karda",
    ]);
  });

  it("a failed attempt still occupies the window (a down Redis is not retried per request)", async () => {
    let now = 0;
    const { recorder, set } = makeRecorder({
      now: () => now,
      set: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const input = {
      productCode: "arda",
      via: "s2s" as const,
      workspaceId: null,
    };
    recorder.record(input);
    await settle();
    now += 1_000;
    recorder.record(input);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe("EntitlementSeenRecorder — never throws, logs once per streak", () => {
  it("a rejecting client does not throw and is logged once until a write succeeds", async () => {
    let fail = true;
    let now = 0;
    const { recorder, set, log } = makeRecorder({
      now: () => now,
      set: async () => {
        if (fail) throw new Error("ECONNREFUSED");
        return "OK";
      },
    });

    const tick = (productCode: string) => {
      now += C2_SIGNAL_THROTTLE_MS;
      expect(() =>
        recorder.record({ productCode, via: "s2s", workspaceId: null }),
      ).not.toThrow();
    };

    tick("arda");
    tick("karda");
    tick("arda");
    await settle();
    expect(set).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("ECONNREFUSED");

    fail = false;
    tick("arda");
    await settle();
    expect(log.log).toHaveBeenCalledTimes(1); // recovery line

    fail = true;
    tick("arda");
    await settle();
    expect(log.warn).toHaveBeenCalledTimes(2); // a new streak logs again
  });

  it("a client that throws synchronously is contained the same way", () => {
    const { recorder, log } = makeRecorder({
      set: () => {
        throw new Error("client closed");
      },
    });
    expect(() =>
      recorder.record({ productCode: "arda", via: "s2s", workspaceId: null }),
    ).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
