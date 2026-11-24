/**
 * Reconcile a complete session view and retire compatibility reads after negotiation.
 * @package @vxture/core-identity-sdk
 * @layer Infrastructure
 * @category session
 * @author AI-Generated
 * @date 2026-11-24
 */
import { startSessionEvents, type SessionRecheck } from "./session-events";

// ============================================================================
// A notification is only a hint; the caller owns identity and authorization.
// ============================================================================
/**
 * Coordinate bounded reads without dropping a notification behind an older request.
 * @param read Read and atomically apply the complete current-Cookie view.
 * @param path Same-origin stream endpoint, including any trusted realm selector.
 * @returns Manual refresh and effect cleanup.
 */
export function startSessionSync(
  read: (signal: AbortSignal, event: boolean) => Promise<SessionRecheck>,
  path = "/auth/events",
): { refresh: () => Promise<SessionRecheck>; stop: () => void } {
  let stopped = false;
  let pending: Promise<SessionRecheck> | undefined;
  let stopEvents: (() => void) | undefined;
  let compatibility: ReturnType<typeof setInterval> | undefined;
  let lastRead = 0;
  const lifetime = new AbortController();
  // A fresh same-origin page may hold a different HttpOnly cookie than older tabs.
  // The message only requests a read and never contains an identity or token.
  const channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel(`vx:session-sync:${path}`);
  let announced = false;

  const reconcile = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRead >= 1500)
      void sync(false);
  };
  const mode = (events: boolean) => {
    if (compatibility) clearInterval(compatibility);
    compatibility = undefined;
    window.removeEventListener("focus", reconcile);
    window.removeEventListener("pageshow", reconcile);
    document.removeEventListener("visibilitychange", reconcile);
    if (events || stopped) return;
    compatibility = setInterval(reconcile, 300000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
  };
  const sync = async (event: boolean): Promise<SessionRecheck> => {
    if (pending) {
      if (!event) return pending;
      // A pre-notification read cannot satisfy this invalidation.
      await pending;
      return sync(event);
    }
    if (stopped) return "unavailable";
    lastRead = Date.now();
    pending = (async (): Promise<SessionRecheck> => {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 15000);
      try {
        const signal = AbortSignal.any([lifetime.signal, deadline.signal]);
        const result = await read(signal, event);
        if (signal.aborted || stopped) return "unavailable";
        if (result === "active" && !announced) {
          announced = true;
          channel?.postMessage("recheck");
        }
        if (result === "active" && !stopEvents)
          stopEvents = startSessionEvents(() => sync(true), mode, path);
        if (result === "anonymous") {
          announced = false;
          stopEvents?.();
          stopEvents = undefined;
        }
        return result;
      } catch {
        return "unavailable";
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
  if (channel)
    channel.onmessage = (message: MessageEvent<unknown>) => {
      if (message.data === "recheck") void sync(true);
    };
  mode(false);
  void sync(false);
  return {
    refresh: () => sync(true),
    stop: () => {
      stopped = true;
      lifetime.abort();
      channel?.close();
      stopEvents?.();
      mode(false);
    },
  };
}
