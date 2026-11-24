/**
 * Verify negotiated polling retirement and current-Cookie reconciliation ordering.
 * @package @vxture/core-identity-sdk
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startSessionSync } from "./session-sync";
import type { SessionRecheck } from "./session-events";
const harness = vi.hoisted(() => ({ events: vi.fn() }));
vi.mock("./session-events", () => ({ startSessionEvents: harness.events }));
let stop: (() => void) | undefined;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  harness.events.mockReset().mockReturnValue(vi.fn());
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ============================================================================
// A negotiated stream replaces compatibility reads only after a complete view.
// ============================================================================
it("retires timed/focus reads and reinstates them on transport loss", async () => {
  const read = vi.fn(async (): Promise<SessionRecheck> => "active");
  stop = startSessionSync(read).stop;
  await flush();
  const mode = harness.events.mock.calls[0]![1] as (value: boolean) => void;
  mode(true);
  await vi.advanceTimersByTimeAsync(600000);
  window.dispatchEvent(new Event("focus"));
  expect(read).toHaveBeenCalledTimes(1);
  mode(false);
  await vi.advanceTimersByTimeAsync(300000);
  expect(read).toHaveBeenCalledTimes(2);
});
it("does a fresh read after an older pending read, even in a hidden tab", async () => {
  let release!: (value: SessionRecheck) => void;
  const read = vi
    .fn<() => Promise<SessionRecheck>>()
    .mockResolvedValueOnce("active")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue("active");
  const sync = startSessionSync(read);
  stop = sync.stop;
  await flush();
  const older = sync.refresh();
  await flush();
  Object.assign(document, { visibilityState: "hidden" });
  const incoming = harness.events.mock
    .calls[0]![0] as () => Promise<SessionRecheck>;
  const result = incoming();
  release("active");
  await older;
  await result;
  expect(read).toHaveBeenCalledTimes(3);
});
it("preserves outage state and opens a new stream after anonymous-to-active transition", async () => {
  const read = vi
    .fn<() => Promise<SessionRecheck>>()
    .mockResolvedValueOnce("active")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("anonymous")
    .mockResolvedValueOnce("active");
  const sync = startSessionSync(read);
  stop = sync.stop;
  await flush();
  expect(await sync.refresh()).toBe("unavailable");
  expect(await sync.refresh()).toBe("anonymous");
  expect(await sync.refresh()).toBe("active");
  expect(harness.events).toHaveBeenCalledTimes(2);
});
it("aborts a bounded view read at 15 seconds and on cleanup", async () => {
  let signal!: AbortSignal;
  const read = vi.fn((value: AbortSignal) => {
    signal = value;
    return new Promise<SessionRecheck>((resolve) =>
      value.addEventListener("abort", () => resolve("unavailable")),
    );
  });
  const sync = startSessionSync(read);
  stop = sync.stop;
  await vi.advanceTimersByTimeAsync(15000);
  expect(signal.aborted).toBe(true);
  expect(harness.events).not.toHaveBeenCalled();
  const pending = sync.refresh();
  await flush();
  sync.stop();
  await pending;
  expect(signal.aborted).toBe(true);
});

it("announces a new cookie view without sending credentials or creating message loops", async () => {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    sent: unknown[] = [];
    constructor(readonly name: string) {
      channels.push(this);
    }
    postMessage(data: unknown) {
      this.sent.push(data);
      for (const peer of channels) {
        if (peer !== this && peer.name === this.name)
          peer.onmessage?.({ data } as MessageEvent<unknown>);
      }
    }
    close() {
      this.onmessage = null;
    }
  }
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const oldRead = vi.fn(async (): Promise<SessionRecheck> => "active");
  const first = startSessionSync(oldRead);
  await flush();
  Object.assign(document, { visibilityState: "hidden" });
  const newRead = vi.fn(async (): Promise<SessionRecheck> => "active");
  const second = startSessionSync(newRead);
  stop = () => {
    first.stop();
    second.stop();
  };
  await flush();
  expect(oldRead).toHaveBeenCalledTimes(2);
  expect(newRead).toHaveBeenCalledTimes(1);
  expect(channels.map((channel) => channel.sent)).toEqual([
    ["recheck"],
    ["recheck"],
  ]);
  await second.refresh();
  await flush();
  expect(oldRead).toHaveBeenCalledTimes(2);
});
