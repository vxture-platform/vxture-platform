/**
 * Browser-stream state transitions, idle traffic and stale-account protection.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSessionEvents, type SessionRecheck } from "./session-events";

// ============================================================================
// Real WHATWG streams exercise chunk boundaries; fake time measures idle traffic.
// ============================================================================
let source: ReadableStreamDefaultController<Uint8Array>;
let signal: AbortSignal;
let stop: (() => void) | undefined;
let eventSync = false;
const encoder = new TextEncoder();
const recheck = vi.fn<() => Promise<SessionRecheck>>();
const request = vi.fn<typeof fetch>();
const page = new EventTarget() as EventTarget & { visibilityState: string };
function send(text: string) {
  source.enqueue(encoder.encode(text));
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T00:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
  page.visibilityState = "visible";
  eventSync = false;
  vi.stubGlobal("document", page);
  vi.stubGlobal("fetch", request);
  recheck.mockReset().mockResolvedValue("active");
  request.mockReset().mockImplementation(async (_url, init) => {
    signal = init!.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        signal.addEventListener("abort", () => {
          try {
            controller.error(new Error("Aborted"));
          } catch {
            /* Already closed. */
          }
        });
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        ...(eventSync ? { "x-vxture-session-sync": "events-v1" } : {}),
      },
    });
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Console session SSE consumer", () => {
  it("retires compatibility sync only after explicit capability and a successful connected read", async () => {
    eventSync = true;
    const mode = vi.fn();
    let finish!: (state: SessionRecheck) => void;
    recheck.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    stop = startSessionEvents(recheck, mode);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(mode).not.toHaveBeenCalledWith(true);
    finish("active");
    await settle();
    expect(mode).toHaveBeenLastCalledWith(true);
    source.close();
    await settle();
    expect(mode).toHaveBeenLastCalledWith(false);
  });

  it("keeps compatibility sync for older or logout-only servers", async () => {
    const mode = vi.fn();
    stop = startSessionEvents(recheck, mode);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(mode).not.toHaveBeenCalledWith(true);
  });

  it("does not enable event sync from a late view result after unmount", async () => {
    eventSync = true;
    const mode = vi.fn();
    let finish!: (state: SessionRecheck) => void;
    recheck.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    stop = startSessionEvents(recheck, mode);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    stop();
    const stoppedCalls = mode.mock.calls.length;
    finish("active");
    await settle();
    expect(mode).not.toHaveBeenCalledWith(true);
    expect(mode).toHaveBeenCalledTimes(stoppedCalls);
  });

  it("restores compatibility sync on watchdog expiry or failed reconciliation", async () => {
    eventSync = true;
    const mode = vi.fn();
    stop = startSessionEvents(recheck, mode);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(mode).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(75000);
    expect(mode).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(1000);
    recheck.mockResolvedValue("unavailable");
    mode.mockClear();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(mode).not.toHaveBeenCalledWith(true);
    expect(mode).toHaveBeenLastCalledWith(false);
  });
  it.each(["context-changed", "access-changed"])(
    "rereads the current Cookie for %s",
    async (name) => {
      stop = startSessionEvents(recheck);
      await settle();
      send(`event: ${name}\ndata: ${JSON.stringify({ reason: name })}\n\n`);
      await settle();
      expect(recheck).toHaveBeenCalledOnce();
      expect(signal.aborted).toBe(false);
    },
  );
  it("uses a same-origin cookie without tokens, identifiers or a replay cursor", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    expect(request).toHaveBeenCalledWith(
      "/auth/events",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      }),
    );
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(recheck).toHaveBeenCalledOnce();
  });

  it("does not query identity for heartbeats or healthy focus/visibility over two old polling periods", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    for (let pulse = 0; pulse < 26; pulse += 1) {
      await vi.advanceTimersByTimeAsync(25000);
      send(": keepalive\n\n");
      page.dispatchEvent(new Event("visibilitychange"));
      await settle();
    }
    expect(request).toHaveBeenCalledOnce();
    expect(recheck).toHaveBeenCalledOnce();
  });

  it("rechecks the current Cookie after a stale stream ends and preserves the new login", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    send('event: session-ended\ndata: {"reason":"revoked"}\n\n');
    source.close();
    await settle();
    expect(recheck).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops only after a fresh snapshot confirms anonymous, fencing old pending requests in the provider", async () => {
    recheck.mockResolvedValue("anonymous");
    stop = startSessionEvents(recheck);
    await settle();
    send('event: session-ended\ndata: {"reason":"revoked"}\n\n');
    await settle();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(600000);
    expect(request).toHaveBeenCalledOnce();
  });

  it("preserves identity on 503 and backs off rather than polling the snapshot", async () => {
    request.mockResolvedValue(
      new Response(null, { status: 503, headers: { "Retry-After": "5" } }),
    );
    stop = startSessionEvents(recheck);
    await settle();
    await vi.advanceTimersByTimeAsync(4999);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("does not convert a 401 from an old Cookie request into logout without rechecking", async () => {
    request.mockResolvedValueOnce(new Response(null, { status: 401 }));
    stop = startSessionEvents(recheck);
    await settle();
    expect(recheck).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([204, 400, 403, 404])(
    "stops the optional stream on HTTP %s",
    async (status) => {
      request.mockResolvedValue(new Response(null, { status }));
      stop = startSessionEvents(recheck);
      await settle();
      await vi.advanceTimersByTimeAsync(600000);
      expect(request).toHaveBeenCalledOnce();
      expect(recheck).not.toHaveBeenCalled();
    },
  );

  it("reconnects after missing heartbeats without interpreting a disconnect as logout", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    await vi.advanceTimersByTimeAsync(75000);
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("parses split CRLF frames and ignores unrelated events", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    send("event: unknown\ndata: {}\n\nevent: session-ended\r");
    await settle();
    send('\ndata: {"reason":"revoked"}\r\n\r\n');
    await settle();
    expect(recheck).toHaveBeenCalledOnce();
  });

  it("bounds unfinished frames and recovers without applying untrusted data", async () => {
    stop = startSessionEvents(recheck);
    await settle();
    send("x".repeat(65537));
    await settle();
    expect(signal.aborted).toBe(true);
    expect(recheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries a failed view read while preserving the previous identity", async () => {
    recheck.mockResolvedValue("unavailable");
    stop = startSessionEvents(recheck);
    await settle();
    send('event: resync-required\ndata: {"reason":"connected"}\n\n');
    await settle();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels reconnect work on unmount", async () => {
    request.mockRejectedValue(new Error("Offline"));
    stop = startSessionEvents(recheck);
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(request).toHaveBeenCalledOnce();
  });
});
