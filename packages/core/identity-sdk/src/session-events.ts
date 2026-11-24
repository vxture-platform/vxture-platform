/**
 * Same-origin session invalidation stream with bounded parsing and reconnect backoff.
 * @package @vxture/core-identity-sdk
 * @layer Infrastructure
 * @category session
 * @author AI-Generated
 * @date 2026-11-24
 */
export type SessionRecheck = "active" | "anonymous" | "unavailable";

// ============================================================================
// Notifications only trigger a current-Cookie read; they never change identity.
// ============================================================================
/**
 * Subscribe while the portal holds a session, falling back to existing sync if disabled.
 * @param recheck Read the current server snapshot; distinguish outages from logout.
 * @param onEventSync Report negotiated, reconciled event coverage for this live connection.
 * @returns Cleanup that aborts the stream and all reconnect/idle timers.
 */
export function startSessionEvents(
  recheck: () => Promise<SessionRecheck>,
  onEventSync: (active: boolean) => void = () => undefined,
  path = "/auth/events",
): () => void {
  let stopped = false;
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let finishWait: (() => void) | undefined;
  let lastByte = 0;
  let failures = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    onEventSync(false);
    controller?.abort();
    if (retry) clearTimeout(retry);
    if (idle) clearTimeout(idle);
    finishWait?.();
    document.removeEventListener("visibilitychange", resume);
  };
  const resume = () => {
    // A sleeping browser can suppress timers; a healthy connection needs no read.
    if (
      document.visibilityState === "visible" &&
      lastByte &&
      Date.now() - lastByte > 75000
    )
      controller?.abort();
  };
  const touch = () => {
    lastByte = Date.now();
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => controller?.abort(), 75000);
  };
  const reconcile = async (): Promise<SessionRecheck> => {
    const state = await recheck();
    if (state === "anonymous") stop();
    return state;
  };
  const wait = (delay: number) =>
    new Promise<void>((resolve) => {
      finishWait = resolve;
      retry = setTimeout(() => {
        finishWait = undefined;
        resolve();
      }, delay);
    });

  // ========================================================================
  // Fetch exposes 401/503/204; an EventSource error cannot distinguish them.
  // ========================================================================
  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      const began = Date.now();
      let retryAfter = 0;
      try {
        touch();
        const response = await fetch(path, {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if ([204, 400, 403, 404].includes(response.status)) {
          await response.body?.cancel();
          stop();
          return;
        }
        if (response.status === 401) {
          await response.body?.cancel();
          if (!stopped) await reconcile();
        } else if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.startsWith("text/event-stream")
        ) {
          const seconds = Number(response.headers.get("retry-after"));
          if (Number.isFinite(seconds))
            retryAfter = Math.min(30000, Math.max(0, seconds * 1000));
          await response.body?.cancel();
        } else {
          const eventSync =
            response.headers.get("x-vxture-session-sync") === "events-v1";
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done || stopped) break;
              touch();
              buffer = (
                buffer + decoder.decode(part.value, { stream: true })
              ).replaceAll("\r\n", "\n");
              if (buffer.length > 65536)
                throw new Error("Session event frame exceeds limit");
              let boundary: number;
              while ((boundary = buffer.indexOf("\n\n")) >= 0 && !stopped) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const lines = frame.split("\n");
                const name = lines
                  .find((line) => line.startsWith("event:"))
                  ?.slice(6)
                  .trim();
                if (
                  ![
                    "session-ended",
                    "resync-required",
                    "context-changed",
                    "access-changed",
                  ].includes(name ?? "")
                )
                  continue;
                const data: unknown = JSON.parse(
                  lines
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trim())
                    .join("\n"),
                );
                if (
                  !data ||
                  typeof data !== "object" ||
                  !("reason" in data) ||
                  ![
                    "connected",
                    "expired",
                    "revoked",
                    "context-changed",
                    "access-changed",
                  ].includes(String(data.reason))
                )
                  throw new Error("Invalid session event");
                const state = await reconcile();
                if (state === "unavailable")
                  throw new Error("Session view unavailable");
                if (
                  !stopped &&
                  !controller.signal.aborted &&
                  name === "resync-required" &&
                  data.reason === "connected" &&
                  state === "active"
                )
                  onEventSync(eventSync);
              }
            }
          } finally {
            await reader.cancel().catch(() => undefined);
          }
        }
      } catch {
        // Transport and snapshot failures preserve identity; recovery uses backoff.
      } finally {
        // A stopped effect must not overwrite a newer connection's sync mode.
        if (!stopped) onEventSync(false);
        if (idle) clearTimeout(idle);
        controller.abort();
      }
      if (stopped) break;
      if (Date.now() - began >= 60000) failures = 0;
      const backoff = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
      await wait(
        Math.max(
          retryAfter,
          Math.min(30000, backoff + Math.floor((Math.random() * backoff) / 2)),
        ),
      );
    }
  };
  document.addEventListener("visibilitychange", resume);
  void run();
  return stop;
}
